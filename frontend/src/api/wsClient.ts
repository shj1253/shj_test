import { useEffect, useRef, useCallback } from 'react'

// 개발: localhost:8000
// 프로덕션: VITE_API_URL을 wss://로 변환 (예: https://... → wss://...)
const WS_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/^https?/, (p: string) => p === 'https' ? 'wss' : 'ws')
  : 'ws://localhost:8000'

type MessageHandler = (data: unknown) => void
type StatusHandler = (online: boolean, reconnectIn?: number) => void

export function useWebSocket(channel: string, onMessage: MessageHandler, onStatusChange?: StatusHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const onMessageRef = useRef(onMessage)
  const onStatusRef = useRef(onStatusChange)
  onMessageRef.current = onMessage
  onStatusRef.current = onStatusChange

  const connect = useCallback(() => {
    if (!mounted.current) return

    const ws = new WebSocket(`${WS_BASE}/ws/${channel}`)
    wsRef.current = ws

    ws.onopen = () => {
      console.log(`[WS] Connected: ${channel}`)
      onStatusRef.current?.(true)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessageRef.current(data)
      } catch (e) {
        console.error('[WS] Parse error', e)
      }
    }

    ws.onerror = () => {
      console.warn(`[WS] Error on ${channel}`)
      onStatusRef.current?.(false)
    }

    ws.onclose = () => {
      console.log(`[WS] Disconnected: ${channel}`)
      if (mounted.current) {
        // 재연결 카운트다운 (3초)
        let remaining = 3
        onStatusRef.current?.(false, remaining)
        const tick = setInterval(() => {
          remaining -= 1
          if (remaining <= 0) {
            clearInterval(tick)
          } else {
            onStatusRef.current?.(false, remaining)
          }
        }, 1000)
        reconnectTimer.current = setTimeout(() => {
          clearInterval(tick)
          connect()
        }, 3000)
      } else {
        onStatusRef.current?.(false)
      }
    }
  }, [channel])

  useEffect(() => {
    mounted.current = true
    connect()

    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 30000)

    return () => {
      mounted.current = false
      clearInterval(heartbeat)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { send }
}

/**
 * 바이너리 WebSocket 훅 — JPEG 프레임 수신용
 * onFrame: Blob을 받아서 처리
 */
type FrameHandler = (blob: Blob) => void

export function useWebSocketBinary(channel: string, onFrame: FrameHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  const connect = useCallback(() => {
    if (!mounted.current) return

    const ws = new WebSocket(`${WS_BASE}/ws/${channel}`)
    ws.binaryType = 'blob'
    wsRef.current = ws

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        onFrameRef.current(event.data)
      }
    }

    ws.onclose = () => {
      if (mounted.current) {
        reconnectTimer.current = setTimeout(() => connect(), 2000)
      }
    }
  }, [channel])

  useEffect(() => {
    mounted.current = true
    connect()
    return () => {
      mounted.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])
}
