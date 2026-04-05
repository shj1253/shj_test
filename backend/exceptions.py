"""
커스텀 예외 계층
모든 도메인 예외는 CannonBaseError를 상속한다.
"""
from __future__ import annotations


class CannonBaseError(Exception):
    """모든 커스텀 예외의 루트"""

    def __init__(self, message: str, *, detail: str | None = None, hint: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.hint = hint  # 사용자에게 보여줄 복구 힌트

    def __str__(self) -> str:
        if self.detail:
            return f"{self.message} | detail: {self.detail}"
        return self.message


# ── Model Errors ────────────────────────────────────────────────────────────

class ModelNotLoadedError(CannonBaseError):
    """모델이 로드되지 않은 상태에서 추론 시도"""


class ModelLoadError(CannonBaseError):
    """모델 가중치 로드 실패"""


class ModelSaveError(CannonBaseError):
    """모델 가중치 저장 실패"""


class UnsupportedModelError(CannonBaseError):
    """지원하지 않는 모델 타입"""


# ── Pipeline Errors ─────────────────────────────────────────────────────────

class PipelineError(CannonBaseError):
    """파이프라인 실행 중 오류"""


class FrameProcessingError(PipelineError):
    """프레임 전처리 실패"""


class InferenceError(PipelineError):
    """추론 실행 실패"""


# ── State Machine Errors ────────────────────────────────────────────────────

class StateMachineError(CannonBaseError):
    """State Machine 오류"""


class InvalidStateTransitionError(StateMachineError):
    """허용되지 않는 상태 전이 시도"""


class UndoNotAvailableError(StateMachineError):
    """되돌릴 이력이 없음"""


# ── Camera Errors ────────────────────────────────────────────────────────────

class CameraError(CannonBaseError):
    """카메라 관련 오류"""


class CameraNotOpenedError(CameraError):
    """카메라 장치 열기 실패"""
    def __init__(self, message: str = "카메라 장치를 열 수 없습니다", *, detail: str | None = None, hint: str | None = None):
        super().__init__(
            message,
            detail=detail,
            hint=hint or "장치 ID가 올바른지 확인하세요. USB 케이블 연결 상태를 점검하고, 다른 앱이 카메라를 점유 중인지 확인하세요.",
        )


class CameraReadError(CameraError):
    """프레임 읽기 실패"""
    def __init__(self, message: str = "카메라에서 프레임을 읽을 수 없습니다", *, detail: str | None = None, hint: str | None = None):
        super().__init__(
            message,
            detail=detail,
            hint=hint or "카메라 연결을 확인하거나 스트림을 재시작하세요.",
        )


class FileSourceError(CameraError):
    """파일 소스 오류 (이미지/영상 파일)"""
    def __init__(self, message: str = "파일 소스 오류", *, detail: str | None = None, hint: str | None = None):
        super().__init__(
            message,
            detail=detail,
            hint=hint or "파일 경로가 올바른지, 파일이 존재하는지 확인하세요. 지원 형식: mp4, avi, jpg, png",
        )


# ── Active Learning Errors ───────────────────────────────────────────────────

class ALError(CannonBaseError):
    """Active Learning 관련 오류"""


class ALQueueFullError(ALError):
    """AL 큐 최대 용량 초과"""
    def __init__(self, message: str = "AL 큐가 가득 찼습니다", *, detail: str | None = None, hint: str | None = None):
        super().__init__(
            message,
            detail=detail,
            hint=hint or "레이블 리뷰 페이지에서 쌓인 샘플을 레이블링하면 큐에 공간이 생깁니다.",
        )


class SampleNotFoundError(ALError):
    """샘플 ID 조회 실패"""
    def __init__(self, message: str = "샘플을 찾을 수 없습니다", *, detail: str | None = None, hint: str | None = None):
        super().__init__(
            message,
            detail=detail,
            hint=hint or "이미 레이블링되었거나 만료된 샘플입니다. 큐를 새로고침하세요.",
        )


class LabelingError(ALError):
    """레이블링 오류"""


# ── Data Errors ──────────────────────────────────────────────────────────────

class DataError(CannonBaseError):
    """데이터 관련 오류"""


class AugmentationError(DataError):
    """증강 파이프라인 오류"""


class DatasetError(DataError):
    """데이터셋 로드/파싱 오류"""


# ── Comparison Errors ────────────────────────────────────────────────────────

class BenchmarkError(CannonBaseError):
    """벤치마크 실행 오류"""
