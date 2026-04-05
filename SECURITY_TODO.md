# 보안 이슈 — 향후 검토 사항

> 현재 데모/파일럿 단계에서는 기능 완성 우선. 실제 현장 배포 전 반드시 검토.

## 고위험 (배포 전 필수)

| ID | 항목 | 위치 | 설명 |
|----|------|------|------|
| S-1 | 인증 없음 | 전 엔드포인트 | API Key 또는 JWT 미들웨어 추가 필요 |
| S-2 | `/ws/al` 비인증 WebSocket | `main.py:265` | 연결 시 토큰 검증 없음 → 외부에서 임의 레이블 주입 가능 |
| S-3 | MJPEG 스트림 공개 | `/camera/{id}/feed` | 인증 없이 카메라 화면 외부 노출 |
| S-4 | CORS `allow_origins=["*"]` + `allow_credentials=True` | `main.py:148` | RFC 6454 위반. 출처를 명시적 도메인으로 제한 필요 |

## 중위험 (운영 투입 전 수정)

| ID | 항목 | 위치 | 설명 |
|----|------|------|------|
| S-5 | 파일 업로드 경로 탐색 | `training.py:183` | `target_dir / f.filename` → `../` 로 임의 경로에 쓰기 가능. `Path(f.filename).name` 으로 교체 |
| S-6 | `FileSourceRequest.path` 검증 부재 | `camera.py` | GStreamer 파이프라인 인젝션 또는 시스템 파일 읽기 가능 |

## 운영 인프라 (장기 개선)

| 항목 | 설명 |
|------|------|
| JSON 구조화 로그 | 현재 `ConsoleRenderer` 사용 중 — Railway/Docker 환경에서 로그 쿼리 불가. `JSONRenderer` 전환 필요 |
| Railway 아티팩트 영속성 | `artifacts/` 는 재배포 시 초기화 → Volume Mount 또는 외부 스토리지(S3) 연결 |
| Prometheus `/metrics` 엔드포인트 | 현재 없음 — Grafana 연동 시 필요 |
| WebSocket `disconnect()` finally 보장 | `main.py` WS 핸들러에서 예외 시 disconnect 누락 가능 |

## 우선순위 가이드

```
파일럿 테스트 → S-5(파일 업로드) 수정 후 진행
현장 제안 발표 → S-1, S-3 최소 대응 (내부망 격리 또는 API Key)
실제 현장 배포 → S-1~S-6 전체 + JSON 로그 + 볼륨 마운트
```
