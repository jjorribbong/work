"""CapCut 드래프트 폴더 탐지.

표준 라이브러리만 사용 — Step 0(env_check.py)에서도 그대로 임포트해서 쓴다.

CapCut 6.0+ / macOS Sequoia 조합에서 App Sandbox 컨테이너로 드래프트 경로가
이전되는 사례가 보고되어(정확한 번들 ID는 버전마다 달라 확정 불가), 표준 경로
+ Containers 하위 글롭을 모두 훑는다. 그래도 못 찾으면 CAPCUT_DRAFT_DIR 환경
변수로 사용자가 직접 지정하게 한다 (CapCut 앱 > 설정 > 환경설정 > 드래프트
위치에서 확인 가능).
"""
from __future__ import annotations

import os
import platform
from pathlib import Path

MAC_STANDARD_DRAFT_DIR = "~/Movies/CapCut/User Data/Projects/com.lveditor.draft"
MAC_CONTAINER_GLOB = "*/Data/Movies/CapCut/User Data/Projects/com.lveditor.draft"


def find_capcut_draft_dir(system: str | None = None) -> Path | None:
    system = system or platform.system()

    override = os.environ.get("CAPCUT_DRAFT_DIR")
    if override:
        p = Path(override).expanduser()
        return p if p.is_dir() else None

    candidates: list[Path] = []
    if system == "Darwin":
        candidates.append(Path(MAC_STANDARD_DRAFT_DIR).expanduser())
        containers = Path("~/Library/Containers").expanduser()
        if containers.is_dir():
            candidates.extend(containers.glob(MAC_CONTAINER_GLOB))
    elif system == "Windows":
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if local_appdata:
            candidates.append(
                Path(local_appdata) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
            )

    for c in candidates:
        if c.exists() and c.is_dir():
            return c
    return None


def detect_track() -> tuple[str, str]:
    system = platform.system()
    machine = platform.machine()
    if system == "Darwin" and machine == "arm64":
        return "A", "Mac M칩 (Apple Silicon) → mlx-whisper"
    if system == "Windows" and machine in ("AMD64", "x86_64"):
        return "C", "Windows AMD64 → faster-whisper (MP4 export 보너스)"
    return "fallback", f"{system} {machine} → faster-whisper (fallback)"
