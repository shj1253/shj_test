import { useEffect, useRef, useCallback } from 'react'

// 개발: localhost:8000
// 프로덕션: VITE_API_URL을 wss://로 변환 (예: https://... → wss://...)
const WS_BASE = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/^https?/, (p: string) => p === 'https' ? 'wss' : 'ws')
  : 'ws://localhost:8000'

type MessageHandler = (data: unknown) => void

export function useWebSocket(channel: 'stream' | 'metrics' | 'al', onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!mounted.current) return

    const ws = new WebSocket(`${WS_BASE}/ws/${channel}`)
    wsRef.current = ws

    ws.onopen = () => console.log(`[WS] Connected: ${channel}`)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessageRef.current(data)
      } catch (e) {
        console.error('[WS] Parse error', e)
      }
    }

    ws.onerror = () => console.warn(`[WS] Error on ${channel}`)

    ws.onclose = () => {
      console.log(`[WS] Disconnected: ${channel}`)
      if (mounted.current) {
        reconnectTimer.current = setTimeout(connect, 3000)
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
