"""
타겟 화면 메타데이터 — 감지 시 알림에 표시할 상황/조치 정보
"""
from __future__ import annotations

# severity: "error" | "warning" | "info" | "success"
TARGET_META: dict[int, dict] = {
    1: {
        "name": "에러 - 전원 재시작 필요",
        "screen_desc": "초기화 오류 발생 (빨간 경고창)",
        "situation": "복합기 데이터 초기화 중 오류가 발생했습니다. 우측 스위치로 전원 OFF/ON 재시작이 필요한 상태입니다.",
        "action": "우측 스위치로 전원 OFF 후 ON으로 재시작하세요.",
        "severity": "error",
    },
    2: {
        "name": "대기 중 - 전원 OFF 금지",
        "screen_desc": "시스템 정보 저장 중 (빨간 경고창)",
        "situation": "시스템 정보를 저장하고 있습니다. 이 상태에서 전원을 차단하면 데이터가 손상될 수 있습니다.",
        "action": "전원 OFF 절대 금지. 자동으로 완료될 때까지 대기하세요 (약 2~3분).",
        "severity": "warning",
    },
    3: {
        "name": "FACTORY 진단 모드",
        "screen_desc": "팩토리 화면 (BIOS/ROM 버전 표시)",
        "situation": "복합기가 팩토리 진단 모드로 부팅 중입니다. ROM 버전 및 하드웨어 정보(TPM, WiFi MAC)를 표시하고 있습니다.",
        "action": "정상 부팅 진행 중입니다. 자동으로 다음 단계로 전환됩니다. 대기하세요.",
        "severity": "info",
    },
    4: {
        "name": "홈 화면 - 부팅 완료",
        "screen_desc": "정상 동작 (Copy / Scan / Fax 메뉴)",
        "situation": "복합기가 정상적으로 부팅 완료되었습니다. Copy, Scan and Send, Fax 등 모든 기능을 사용할 수 있습니다.",
        "action": "정상 상태입니다. 추가 조치가 필요하지 않습니다.",
        "severity": "success",
    },
}


def get_meta(target_id: int) -> dict:
    return TARGET_META.get(target_id, {
        "name": f"타겟 T{target_id}",
        "screen_desc": "등록되지 않은 화면",
        "situation": f"T{target_id}이(가) 감지되었습니다. 메타데이터가 등록되지 않은 타겟입니다.",
        "action": "시스템 관리자에게 문의하세요.",
        "severity": "info",
    })
