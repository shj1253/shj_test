# Cannon Project — 컨텍스트 문서

> **목적**: 토큰 소진 후 Claude / 다른 AI 도구와 이어서 작업할 때 흐름을 끊기지 않도록 유지하는 백브리핑 + 상태 기록 문서.
> **최종 업데이트**: 2026-04-04 (세션 4 — 동적 타겟 수, 전처리 모듈, 증강 강도 UI 완료)

---

## 1. 프로젝트 개요 (백브리핑)

### 무엇을 만드는가
산업용 핸드헬드 카메라로 촬영한 영상에서 **4개의 Target 이미지(T1→T2→T3→T4)를 순서대로 검출**하는 머신러닝 시스템.

### 왜 만드는가
- 현업(생산 라인 등)에서 비전공자가 직접 사용 가능한 실무 즉시 적용 시스템
- **속도 + 정확도를 정량적으로 비교**하여 최적 모델 조합을 찾는 것이 핵심 목표

### 최종 목표
두 가지 파이프라인 조합을 동일 데이터로 벤치마크하여 승자 선정:
- **조합 A**: PatchCore (Gate) + ResNet (Classify)
- **조합 B**: EfficientNet-B3 (Gate) + ResNet (Classify)

---

## 2. 시스템 아키텍처

### 3단계 파이프라인
```
카메라 프레임
     ↓
[1] Gate (이상 감지)
     ├─ Pass → [2] Classify (4-class 분류)
     │              ↓
     │         [3] Sequence (상태 머신 T1→T2→T3→T4)
     └─ Fail → 스킵 (Active Learning 샘플 수집 가능)
```

### Gate 모델 (A/B 비교)
| | PatchCore | EfficientNet Gate |
|---|---|---|
| 방식 | faiss IVFFlat + k-NN 거리 | Mahalanobis 거리 |
| 백본 | WideResNet50 / ResNet18 | EfficientNet-B3 (timm, num_classes=0) |
| 학습 | 메모리 뱅크 구축 (negative 불필요) | 클래스별 평균/공분산 추정 |
| 장점 | patch-level 정밀도 | 경량, 빠름 |

### Classify 모델
- ResNet 18/34/50 (ImageNet pretrained)
- FC head: Dropout + Linear(4)
- 출력: 4-class softmax 확률

### 상태 머신
```
WAIT_T1 → WAIT_T2 → WAIT_T3 → WAIT_T4 → COMPLETE
```
- Undo 지원 (마지막 confirmed 이벤트 취소)
- 순서 위반 시 violation_reason 기록

### Active Learning
- **Gate 샘플**: 거리 기반 (margin zone 진입 시 자동 수집, 추가 비용 0)
- **Classify 샘플**: Uncertainty Sampling (1st prob < threshold) → Margin Sampling (1st-2nd gap 기준 정렬)
- **배치 선정**: Core-Set (greedy farthest-first, 다양성 보장)
- **제외**: Entropy Sampling (4-class에서 중복)

### 벤치마크 승자 공식
```
score = 0.5×F1 + 0.3×(1-FPR) + 0.2×speed_score
```

---

## 3. 기술 스택

| 레이어 | 기술 |
|---|---|
| Backend | FastAPI + uvicorn, WebSocket (3채널), structlog, pydantic-settings |
| ML | PyTorch, timm, faiss-cpu, scikit-learn, albumentations |
| Frontend | React 18 + TypeScript + Vite, Zustand, recharts, Tailwind CSS |
| 개발 | pyproject.toml (setuptools, pip install -e .), Vite proxy /api→8000 |

---

## 4. 프로젝트 폴더 구조

```
cannon 프로젝트/
├── backend/
│   ├── main.py                  # FastAPI app, lifespan, WebSocket endpoints
│   ├── config.py                # Pydantic BaseSettings (settings singleton)
│   ├── exceptions.py            # 전체 예외 계층
│   ├── logging_config.py        # structlog 설정
│   ├── stream_manager.py        # 프레임 루프, AL 연동, WebSocket 브로드캐스트
│   ├── models/
│   │   ├── base.py              # GateResult, ClassifyResult, ABC 정의
│   │   ├── gate/
│   │   │   ├── patchcore.py     # PatchCoreModel
│   │   │   └── efficientnet_gate.py  # EfficientNetGate
│   │   ├── classifier/
│   │   │   └── resnet_classifier.py  # ResNetClassifier
│   │   └── registry.py          # ModelRegistry singleton
│   ├── core/
│   │   ├── pipeline.py          # InferencePipeline (async, Gate→Classify→Seq)
│   │   └── state_machine.py     # SequenceStateMachine
│   ├── active_learning/
│   │   ├── al_engine.py         # ALEngine (process, compose_batch)
│   │   ├── labeling_queue.py    # LabelingQueue (push/label/undo)
│   │   └── sampling/
│   │       ├── distance_based.py
│   │       ├── uncertainty.py
│   │       ├── margin.py
│   │       └── coreset.py
│   ├── metrics/
│   │   └── realtime_tracker.py  # RealtimeMetricsTracker (sliding window)
│   ├── comparison/
│   │   └── benchmark.py         # BenchmarkRunner, BenchmarkReport
│   ├── camera/
│   │   └── camera_source.py     # OpenCVCamera, FileSource
│   └── api/
│       ├── websocket/manager.py # ConnectionManager
│       └── routes/
│           ├── inference.py     # POST /infer/, /infer/batch
│           ├── camera.py        # /camera/* endpoints
│           ├── models.py        # /models/* endpoints
│           ├── active_learning.py  # /al/* endpoints
│           └── metrics.py       # /metrics/* endpoints
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # 라우터 (5개 페이지)
│   │   ├── types/index.ts       # TypeScript 인터페이스
│   │   ├── store/index.ts       # Zustand 3개 스토어
│   │   ├── api/
│   │   │   ├── httpClient.ts    # axios + 모든 엔드포인트
│   │   │   └── wsClient.ts      # useWebSocket hook (자동 재연결)
│   │   ├── pages/
│   │   │   ├── LivePage.tsx     # 실시간 카메라 + 상태 표시
│   │   │   ├── TestPage.tsx     # 파일 업로드 테스트
│   │   │   ├── MetricsPage.tsx  # recharts 실시간 차트
│   │   │   ├── LabelReviewPage.tsx  # AL 레이블링 UI
│   │   │   └── ModelComparePage.tsx # A/B 벤치마크 UI
│   │   └── components/
│   │       ├── SequenceIndicator/  # T1→T4 진행 표시
│   │       └── MetricsPanel/       # 실시간 지표 패널
│   ├── package.json
│   ├── vite.config.ts           # /api, /ws 프록시 → 8000
│   ├── tailwind.config.js
│   └── tsconfig.json
├── training/
│   └── train_pipeline.py        # CLI 학습 스크립트
├── artifacts/
│   ├── data/raw/                # ← T1.jpg, T2.jpg, T3.jpg, T4.jpg 여기에 넣기
│   ├── models/                  # 학습된 모델 저장
│   └── reports/                 # 벤치마크 리포트 JSON
├── pyproject.toml               # Python 의존성
├── .env                         # 임계값, 경로, 모델 선택 설정
├── .env.example                 # 설정 템플릿
└── PROJECT_CONTEXT.md           # 이 파일
```

---

## 5. 현재 구현 상태 (2026-04-03 기준)

### ✅ 완료된 파일
**Backend:**
- `backend/config.py` — Pydantic BaseSettings
- `backend/exceptions.py` — 전체 예외 계층
- `backend/logging_config.py` — structlog 설정
- `backend/models/base.py` — 데이터클래스 + ABC
- `backend/models/gate/patchcore.py` — PatchCoreModel
- `backend/models/gate/efficientnet_gate.py` — EfficientNetGate
- `backend/models/classifier/resnet_classifier.py` — ResNetClassifier
- `backend/models/registry.py` — ModelRegistry
- `backend/core/state_machine.py` — SequenceStateMachine
- `backend/core/pipeline.py` — InferencePipeline
- `backend/active_learning/sampling/distance_based.py`
- `backend/active_learning/sampling/uncertainty.py`
- `backend/active_learning/sampling/margin.py`
- `backend/active_learning/sampling/coreset.py`
- `backend/active_learning/labeling_queue.py`
- `backend/active_learning/al_engine.py`
- `backend/metrics/realtime_tracker.py`
- `backend/comparison/benchmark.py`
- `backend/camera/camera_source.py`
- `backend/api/websocket/manager.py`
- `backend/api/routes/inference.py`
- `backend/api/routes/camera.py`
- `backend/api/routes/models.py`
- `backend/api/routes/active_learning.py`
- `backend/api/routes/metrics.py`
- `backend/stream_manager.py`
- `backend/main.py`
- `training/train_pipeline.py`
- `pyproject.toml`
- `.env.example`

**Frontend:**
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/tailwind.config.js`
- `frontend/postcss.config.js`
- `frontend/tsconfig.json`
- `frontend/src/types/index.ts`
- `frontend/src/store/index.ts`
- `frontend/src/api/httpClient.ts`
- `frontend/src/api/wsClient.ts`
- `frontend/src/App.tsx`
- `frontend/src/pages/LivePage.tsx`
- `frontend/src/pages/TestPage.tsx`
- `frontend/src/pages/MetricsPage.tsx`
- `frontend/src/pages/LabelReviewPage.tsx`
- `frontend/src/pages/ModelComparePage.tsx`
- `frontend/src/components/SequenceIndicator/SequenceIndicator.tsx`
- `frontend/src/components/MetricsPanel/MetricsPanel.tsx`

### ✅ 추가 완료 (Claude 세션 4)
- **동적 타겟 수** — `SequenceStateMachine(num_targets=N)` : 전이 테이블 자동 생성, 1~20개 지원
- **전처리 모듈** — `backend/data/preprocessor.py` : 필수(RGB변환·Resize·정규화) + 선택(CLAHE·Denoise·Sharpen·비율패딩)
- **증강 강도 프리셋** — `augmentation.py` : 약/중약/중/중강/강/최강 6단계, `from_intensity()` 팩토리
- **학습 설정 API** — `backend/api/routes/training.py` : GET/POST `/training/config`, 프리셋 목록
- **프론트엔드 학습 설정 페이지** — `/training` 탭 신규 추가
  - 타겟 수 슬라이더 (1~20개)
  - 필수 전처리 잠금 표시 + 선택 전처리 ON/OFF 토글
  - 증강 강도 6단계 버튼 + ⓘ 툴팁 (마우스 오버/클릭)
  - 타겟당 증강 수 슬라이더+입력 (10~5000)
  - 다음 단계 CLI 커맨드 자동 생성 표시
- `frontend/src/types/index.ts` — `TrainingConfig`, `AugIntensity`, `IntensityOption` 타입 추가
- `frontend/src/api/httpClient.ts` — training 엔드포인트 추가
- **빌드/테스트** : 42/42 PASSED, npm build 성공

### ✅ 추가 완료 (Claude 세션 3)
- `backend/config.py` — `protected_namespaces=()` 추가 (pydantic model_ 경고 제거)
- `backend/active_learning/sampling/coreset.py` — list → numpy array 변환 버그 수정
- `frontend/package.json` — `"type": "module"` 추가 (postcss 모듈 경고 제거)
- `tests/__init__.py`, `tests/unit/__init__.py`, `tests/integration/__init__.py` — 생성
- `tests/unit/test_state_machine.py` — 15개 테스트 (정상 흐름, 위반, Undo, Reset, 직렬화)
- `tests/unit/test_sampling.py` — 16개 테스트 (DistanceBased, Uncertainty, Margin, CoreSet)
- `tests/unit/test_labeling_queue.py` — 11개 테스트 (Push, Label, Undo, Clear)
- **검증 결과**: 백엔드 26개 모듈 전부 임포트 OK, FastAPI 28개 라우트 정상 로드
- **빌드 결과**: 프론트엔드 `npm run build` 성공 (2379 modules, 경고 없음)
- **테스트 결과**: 42/42 PASSED

### ✅ 추가 완료 (Antigravity 세션)
- `backend/**/__init__.py` — 14개 패키지 전체 생성 완료 (data/ 포함)
- `backend/data/__init__.py` — augmentation.py용 패키지 init (원본 목록에 누락됐던 것)
- `frontend/tsconfig.node.json` — 생성 완료
- `frontend/index.html` — 이미 존재 확인
- `frontend/src/main.tsx` — 이미 존재 확인
- `frontend/src/index.css` — 이미 존재 확인
- `pyproject.toml` — 빌드 백엔드 hatchling → setuptools 변경 + packages.find 추가
- `pip install -e . --no-deps` — cannon-project 0.1.0 editable 설치 완료
- `npm install` — 198 packages 설치 완료
- Python 패키지 수동 설치 완료 (fastapi, uvicorn, torch 2.9.1+cpu, faiss-cpu 1.13.2 등)

### ❌ 아직 안 된 것들

| 항목 | 설명 |
|---|---|
| Target 이미지 | `artifacts/data/raw/T1.jpg` ~ `T4.jpg` — 실제 이미지 배치 필요 (폴더 비어있음) |
| 모델 학습 | 이미지 배치 후 `python training/train_pipeline.py` 실행 |
| 서버 기동 테스트 | 학습 완료 후 uvicorn + vite dev 실행 |

---

## 6. 다음 할 일 (우선순위 순)

1. ~~**`__init__.py` 파일 생성**~~ ✅ 완료
2. ~~**`frontend/tsconfig.node.json` 생성**~~ ✅ 완료
3. ~~**`frontend/index.html` + `src/main.tsx` + `src/index.css` 생성**~~ ✅ 완료
4. ~~**의존성 설치**~~ ✅ 완료 (torch 2.9.1+cpu, faiss-cpu 1.13.2 등)
5. **Target 이미지 준비** — T1~T4 실제 이미지를 `artifacts/data/raw/`에 배치 ← ⚠️ **여기부터 (유일한 블로커)**
6. **학습 실행** — `python training/train_pipeline.py --target-dir artifacts/data/raw --gate-type both --n-aug 500`
7. **서버 기동** — `uvicorn backend.main:app --reload --port 8000` + `cd frontend && npm run dev`
8. **A/B 벤치마크 실행** — `http://localhost:5173/compare`

---

## 7. 핵심 설정값 (.env)

```bash
# 모델 선택
GATE_MODEL=patchcore          # patchcore | efficientnet
CLASSIFIER_MODEL=resnet18     # resnet18 | resnet34 | resnet50

# 임계값
GATE_THRESHOLD=0.5
GATE_MARGIN_LOW=0.4
GATE_MARGIN_HIGH=0.6
CLASSIFY_UNCERTAINTY_THRESHOLD=0.7
AL_QUEUE_MAX_SIZE=200
AL_BATCH_SIZE=20

# 경로
DATA_DIR=artifacts/data
MODEL_DIR=artifacts/models

# 서버
HOST=0.0.0.0
PORT=8000
```

---

## 8. API 주요 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/infer/` | 단일 이미지 추론 |
| POST | `/infer/batch` | 최대 50개 일괄 |
| POST | `/camera/start` | 카메라 스트리밍 시작 |
| POST | `/camera/file` | 파일 소스 설정 |
| GET | `/models/list` | 로드된 모델 목록 |
| POST | `/models/swap-gate` | Gate 모델 핫스왑 |
| POST | `/models/compare` | A/B 벤치마크 실행 |
| GET | `/al/queue` | AL 큐 조회 |
| POST | `/al/label` | 레이블 부여 |
| POST | `/al/train` | 재학습 트리거 |
| GET | `/metrics/summary` | 현재 지표 요약 |
| WS | `/ws/stream` | 실시간 추론 결과 |
| WS | `/ws/metrics` | 실시간 메트릭 (1s) |
| WS | `/ws/al` | AL 큐 업데이트 |

---

## 9. 설계 철학 — 왜 라벨링이 최소화되는가

> **2026-04-03 세션 3에서 기록** — Physical AI 강의 중 3D feature matching과 비교하며 도출한 설계 근거.

### 기존 Object Detection과의 차이

**전통적 방식 (YOLO 계열 등)**
```
수백~수천 장 촬영
→ 사람이 바운딩 박스 하나하나 그리고 "이게 T1" 라벨 부여
→ 증강 생성
→ 학습
→ 제품 조금 바뀌면 처음부터 반복
```

**현재 방식 (PatchCore / EfficientNet Gate)**
```
T1~T4 대표 이미지 몇 장만 폴더에 넣기
→ CNN이 feature map 자동 추출 (내부 특징점 자동 탐지)
→ 클래스별 feature 분포 자동 구성 (메모리 뱅크 or Mahalanobis)
→ 새 프레임 = feature 거리 비교로 판단
```

### 핵심 원리 (3D feature matching과 동일 개념)
- 3D에서 SIFT/ORB/SuperPoint가 특징점을 자동 추출해 매칭하듯
- CNN backbone이 patch-level feature를 자동으로 추출
- 사람이 "어디가 특징점인지" 지정할 필요 없음
- **분포 자체를 학습**하므로 조명/각도/스케일 변화에도 강인

### 현업 적용 시 실제 부담 비교

| 작업 | 기존 방식 | 현재 방식 |
|---|---|---|
| 초기 셋업 | 수백 장 라벨링 (수일) | 이미지 몇 장 폴더에 배치 (수분) |
| 제품 변경 시 | 처음부터 재라벨링 | 이미지 교체 후 재학습 |
| 유지보수 | 지속적 라벨링 인력 필요 | AL이 엣지케이스 자동 수집, 가끔 확인만 |
| 담당자 | ML 전문가 필요 | 현장 작업자 직접 운영 가능 |

### 이 설계가 구현된 위치
- `backend/models/gate/patchcore.py` — layer2/layer3 feature 자동 추출 + faiss 메모리 뱅크
- `backend/models/gate/efficientnet_gate.py` — 클래스별 Mahalanobis 거리 (특징점 라벨링 불필요)
- `backend/active_learning/al_engine.py` — 운영 중 엣지케이스 자동 수집 (인력 부담 최소화)

---

## 10. 새 AI 도구에게 (컨텍스트 복원용)

이 프로젝트는 **구현이 대부분 완료된 상태**입니다. 코드는 작성되었으나 아직 실행 전입니다.

**지금 당장 도움이 필요한 것**: 위 섹션 6의 "다음 할 일" 목록 처리.

**절대 건드리면 안 되는 것**:
- 3단계 파이프라인 로직 (Gate→Classify→Sequence)
- AL 전략 (Uncertainty + Margin + Core-Set 조합)
- 벤치마크 공식 (0.5×F1 + 0.3×(1-FPR) + 0.2×speed)
- 상태 머신 전환 순서 (T1→T2→T3→T4)

**변경 가능한 것**: 임계값(.env), 모델 크기(resnet18/34/50), 백본 선택.
