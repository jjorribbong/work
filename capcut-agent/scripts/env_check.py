#!/usr/bin/env python3
"""Step 0: 환경 점검.

의존성 없이(표준 라이브러리만) 실행 가능해야 한다 - pip install도 하기 전에
먼저 이 스크립트로 로컬 환경이 준비됐는지 확인한다.

    python3 scripts/env_check.py

실패 항목이 있으면 설치 명령만 안내하고 종료한다 (자동 설치하지 않음).
"""
from __future__ import annotations

import platform
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.paths import detect_track, find_capcut_draft_dir  # noqa: E402

MIN_FREE_DISK_GB = 5


class Check:
    def __init__(self, name: str, ok: bool, detail: str = "", fix: str = ""):
        self.name = name
        self.ok = ok
        self.detail = detail
        self.fix = fix


def check_disk_space(path: Path) -> tuple[bool, float]:
    usage = shutil.disk_usage(path if path.exists() else path.parent)
    free_gb = usage.free / (1024 ** 3)
    return free_gb >= MIN_FREE_DISK_GB, free_gb


def run_checks() -> list[Check]:
    system = platform.system()
    machine = platform.machine()
    checks: list[Check] = []

    track_id, track_desc = detect_track()
    checks.append(Check("OS/트랙", True, f"{system} {machine} → 트랙 {track_id} ({track_desc})"))

    if system == "Darwin":
        brew_ok = shutil.which("brew") is not None
        checks.append(Check(
            "Homebrew", brew_ok,
            fix='/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        ))

        py311_ok = shutil.which("python3.11") is not None or sys.version_info[:2] >= (3, 11)
        checks.append(Check("python@3.11", py311_ok, fix="brew install python@3.11"))

        ffmpeg_ok = shutil.which("ffmpeg") is not None
        checks.append(Check("ffmpeg", ffmpeg_ok, fix="brew install ffmpeg"))

    elif system == "Windows":
        py_ok = shutil.which("python") is not None or shutil.which("python3") is not None
        checks.append(Check(
            "Python", py_ok,
            fix="https://www.python.org/downloads/ 에서 설치 (Add to PATH 체크)",
        ))

        ffmpeg_ok = shutil.which("ffmpeg") is not None
        checks.append(Check("ffmpeg", ffmpeg_ok, fix="winget install ffmpeg"))

    else:
        ffmpeg_ok = shutil.which("ffmpeg") is not None
        checks.append(Check(
            "ffmpeg", ffmpeg_ok,
            fix="배포판 패키지 매니저로 ffmpeg 설치 (예: apt install ffmpeg)",
        ))

    draft_dir = find_capcut_draft_dir(system)
    checks.append(Check(
        "CapCut 드래프트 폴더", draft_dir is not None,
        detail=str(draft_dir) if draft_dir else "",
        fix=(
            "CapCut을 설치하고 최소 1회 실행 + 빈 프로젝트 1개 생성 후 다시 실행하세요.\n"
            "   그래도 안 잡히면 CapCut 앱 > 설정 > 환경설정에서 '드래프트 위치'를 확인해\n"
            "   CAPCUT_DRAFT_DIR 환경변수로 직접 지정하세요."
        ),
    ))

    disk_target = draft_dir if draft_dir else Path.home()
    disk_ok, free_gb = check_disk_space(disk_target)
    checks.append(Check(
        f"디스크 여유공간 ({MIN_FREE_DISK_GB}GB+)", disk_ok,
        detail=f"{free_gb:.1f}GB 여유",
        fix="공간을 확보한 뒤 다시 실행하세요 (원본 영상 + 캐시 + whisper 모델 다운로드 용량 필요).",
    ))

    return checks


def main() -> int:
    print("=== 캡컷 에이전트 : Step 0 환경 점검 ===\n")
    checks = run_checks()

    all_ok = True
    for c in checks:
        status = "OK " if c.ok else "FAIL"
        line = f"[{status}] {c.name}"
        if c.detail:
            line += f" — {c.detail}"
        print(line)
        if not c.ok:
            all_ok = False
            if c.fix:
                print(f"       ↳ 설치/조치: {c.fix}")

    print()
    if all_ok:
        print("모든 항목 통과. 1단(silence_detect + build_draft)으로 진행할 수 있습니다.")
        return 0

    print("위 FAIL 항목을 해결한 뒤 다시 `python3 scripts/env_check.py` 를 실행하세요.")
    print("(자동 설치는 하지 않습니다 — 위 명령을 직접 실행해주세요.)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
