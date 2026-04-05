import axios from 'axios'

// 개발: Vite proxy(/api → localhost:8000)
// 프로덕션: VITE_API_URL 환경변수 (예: https://cannon-api.up.railway.app)
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}`
  : '/api'

export const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

// 요청 로깅
http.interceptors.request.use((config) => {
  return config
})

// 에러 처리
http.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.detail || err.response?.data?.error || err.message
    console.error('[API Error]', msg)
    return Promise.reject(new Error(msg))
  }
)

// API 함수들
export const api = {
  // Health
  health: () => http.get('/health'),

  // Inference
  inferImage: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post('/infer/', fd)
  },

  // Camera (단일 카메라 - 하위 호환)
  startCamera: (deviceId = 0, fps = 30) =>
    http.post('/camera/start', { device_id: deviceId, fps }),
  stopCamera: () => http.post('/camera/stop'),
  startFile: (path: string, loop = false) =>
    http.post('/camera/file', { path, loop }),
  cameraStatus: () => http.get('/camera/status'),

  // Camera (다중 카메라)
  listCameras: () => http.get('/camera/list'),
  startCameraById: (cameraId: string, deviceId = 0, fps = 30) =>
    http.post(`/camera/${cameraId}/start`, { device_id: deviceId, fps }),
  stopCameraById: (cameraId: string) =>
    http.post(`/camera/${cameraId}/stop`),
  startFileById: (cameraId: string, path: string, loop = false) =>
    http.post(`/camera/${cameraId}/file`, { path, loop }),
  cameraStatusById: (cameraId: string) =>
    http.get(`/camera/${cameraId}/status`),
  removeCameraById: (cameraId: string) =>
    http.delete(`/camera/${cameraId}`),

  // Models
  listModels: () => http.get('/models/list'),
  loadModel: (data: {
    gate_type: string
    gate_key: string
    classifier_backbone: string
    classifier_key: string
    gate_model_path?: string
    classifier_model_path?: string
  }) => http.post('/models/load', data),
  swapGate: (key: string) => http.post('/models/swap-gate', { key }),
  compareModels: (data: {
    gate_a_key: string
    gate_b_key: string
    classifier_key: string
    test_images_dir: string
  }) => http.post('/models/compare', data),
  compareModelsUpload: (formData: FormData) =>
    http.post('/models/compare-upload', formData),

  // Metrics
  getMetrics: () => http.get('/metrics/summary'),
  getMetricsHistory: (n = 50) => http.get(`/metrics/history?n=${n}`),
  resetMetrics: () => http.post('/metrics/reset'),
  pipelineStatus: () => http.get('/metrics/pipeline'),
  getKpiReport: (cameraId = '0') => http.get(`/metrics/kpi?camera_id=${cameraId}`),
  setOfflineMetrics: (data: Record<string, number>) => http.post('/metrics/kpi/offline', data),

  // Active Learning
  getALQueue: () => http.get('/al/queue'),
  getSampleImage: (sampleId: string) => http.get(`/al/samples/${sampleId}/image`),
  submitLabel: (sampleId: string, label: number) =>
    http.post('/al/label', { sample_id: sampleId, label }),
  undoLabel: (sampleId?: string) =>
    sampleId
      ? http.delete(`/al/label/${sampleId}`)
      : http.delete('/al/label'),
  skipSample: (sampleId: string) => http.delete(`/al/queue/${sampleId}`),
  triggerTraining: (epochs = 10, lr = 1e-4) =>
    http.post('/al/train', { epochs, lr }),
  alStats: () => http.get('/al/stats'),

  // Pipeline control
  resetSequence: () => http.post('/metrics/reset'),

  // Training run
  startTraining: () => http.post('/training/run'),
  getTrainingStatus: () => http.get('/training/status'),

  // Training config
  getTrainingConfig: () => http.get('/training/config'),
  updateTrainingConfig: (data: {
    num_targets: number
    preprocess: object
    augmentation: object
  }) => http.post('/training/config', data),
  getAugPresets: () => http.get('/training/augmentation/presets'),
  getPreprocessOptions: () => http.get('/training/preprocess/options'),
  uploadTrainingImages: (targetId: number, files: File[]) => {
    const fd = new FormData()
    fd.append('target_id', String(targetId))
    files.forEach(f => fd.append('files', f))
    return http.post('/training/upload', fd)
  },
  getUploadStats: () => http.get('/training/upload/stats'),
}
