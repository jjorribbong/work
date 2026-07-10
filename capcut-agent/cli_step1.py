#!/usr/bin/env python3
"""1단: silence_detect + build_draft (점프컷 드래프트, UI 없음).

    python3 cli_step1.py input.mp4 [project_name]

무음 구간을 제거한 CapCut 드래프트를 생성한다. 실행 후 CapCut을 열어
"프로젝트 이름"을 직접 재생해서 컷이 자연스러운지 확인하는 것이 검증이다
(이 스크립트가 에러 없이 끝나는 것은 검증이 아니다).
"""
from __future__ import annotations

import sys
from pathlib import Path

from app.draft_builder import build_jump_cut_draft
from app.paths import find_capcut_draft_dir
from app.silence import speech_segments


def main() -> int:
    if len(sys.argv) < 2:
        print("사용법: python3 cli_step1.py <video.mp4> [project_name]")
        return 1

    video_path = Path(sys.argv[1]).expanduser().resolve()
    if not video_path.exists():
        print(f"파일을 찾을 수 없습니다: {video_path}")
        return 1

    project_name = sys.argv[2] if len(sys.argv) > 2 else f"{video_path.stem}_jumpcut"

    draft_dir = find_capcut_draft_dir()
    if draft_dir is None:
        print(
            "CapCut 드래프트 폴더를 찾을 수 없습니다.\n"
            "CapCut을 1회 실행한 뒤 다시 시도하거나, CAPCUT_DRAFT_DIR 환경변수로 직접 지정하세요."
        )
        return 1

    print(f"[1/2] 무음 구간 분석 중... ({video_path.name})")
    segments = speech_segments(str(video_path))
    total_dur_kept = sum(s.duration for s in segments)
    print(f"      → 발화 구간 {len(segments)}개, 총 {total_dur_kept:.1f}s 보존")

    print(f"[2/2] CapCut 드래프트 생성 중... (프로젝트명: {project_name})")
    out_path = build_jump_cut_draft(str(video_path), segments, draft_dir, project_name)
    print(f"      → {out_path}")

    print(
        "\n완료. CapCut을 열어 '{}' 프로젝트를 직접 재생해서\n"
        "컷이 자연스러운지 확인하세요 (핵심 검증 단계).".format(project_name)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
