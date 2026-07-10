#!/usr/bin/env python3
"""1단: silence_detect + build_draft (점프컷 드래프트, UI 없음).

    python3 cli_step1.py input.mp4 [project_name]

무음 구간을 제거한 CapCut 드래프트를 생성한다. 실행 후 CapCut을 열어
"프로젝트 이름"을 직접 재생해서 컷이 자연스러운지 확인하는 것이 검증이다
(이 스크립트가 에러 없이 끝나는 것은 검증이 아니다).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.draft_builder import build_jump_cut_draft
from app.paths import find_capcut_draft_dir
from app.silence import detect_silence, speech_segments


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="1단: silence_detect + build_draft")
    p.add_argument("video", help="입력 mp4/mov 경로")
    p.add_argument("project_name", nargs="?", default=None, help="CapCut 프로젝트 이름")
    p.add_argument(
        "--noise-db", type=float, default=-30.0,
        help="이 값보다 조용하면 무음으로 판정 (기본 -30). 배경 소음이 있으면"
             " -20 처럼 0에 더 가까운(덜 엄격한) 값을 시도해보세요.",
    )
    p.add_argument(
        "--min-silence-dur", type=float, default=0.5,
        help="이 초(sec) 이상 계속 조용해야 무음으로 판정 (기본 0.5)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        print(f"파일을 찾을 수 없습니다: {video_path}")
        return 1

    project_name = args.project_name or f"{video_path.stem}_jumpcut"

    draft_dir = find_capcut_draft_dir()
    if draft_dir is None:
        print(
            "CapCut 드래프트 폴더를 찾을 수 없습니다.\n"
            "CapCut을 1회 실행한 뒤 다시 시도하거나, CAPCUT_DRAFT_DIR 환경변수로 직접 지정하세요."
        )
        return 1

    print(
        f"[1/2] 무음 구간 분석 중... ({video_path.name}, "
        f"noise={args.noise_db}dB, min_dur={args.min_silence_dur}s)"
    )
    silences = detect_silence(str(video_path), args.noise_db, args.min_silence_dur)
    print(f"      → 감지된 무음 구간 {len(silences)}개")
    for s in silences:
        print(f"         무음: {s.start:.2f}s ~ {s.end:.2f}s ({s.duration:.2f}s)")

    segments = speech_segments(
        str(video_path), args.noise_db, args.min_silence_dur,
    )
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
