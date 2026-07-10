"""무음 구간을 제거한 점프컷 CapCut 드래프트 생성.

draft_content.json 포맷을 직접 다루지 않고 pycapcut
(https://github.com/GuanYixuan/pyCapCut) 라이브러리에 위임한다 — 포맷 함정
(시간 단위, transform 좌표계 등)을 재발명하지 않기 위함.
"""
from __future__ import annotations

from pathlib import Path

from app.media import probe_media_info
from app.silence import Segment


def build_jump_cut_draft(
    video_path: str,
    keep_segments: list[Segment],
    draft_dir: Path,
    project_name: str,
) -> Path:
    if not keep_segments:
        raise ValueError("보존할 발화 구간이 없습니다 (전부 무음으로 판정됨).")

    import pycapcut as cc
    from pycapcut import SEC, trange

    info = probe_media_info(video_path)

    draft_folder = cc.DraftFolder(str(draft_dir))
    script = draft_folder.create_draft(
        project_name, info.width, info.height, round(info.fps), allow_replace=True,
    )
    script.add_track(cc.TrackType.video, "main_video")

    # 마이크로초 정수로만 계산한다 — "x.xxxs" 문자열로 초 단위 반올림을 매
    # 세그먼트마다 독립적으로 하면 누적 오차로 인접 세그먼트 사이에 ~1ms
    # 틈/겹침이 생겨 pycapcut의 SegmentOverlap 예외가 난다.
    cursor_us = 0
    for seg in keep_segments:
        dur_us = round(seg.duration * SEC)
        src_start_us = round(seg.start * SEC)
        video_seg = cc.VideoSegment(
            video_path,
            target_timerange=trange(cursor_us, dur_us),
            source_timerange=trange(src_start_us, dur_us),
        )
        script.add_segment(video_seg, "main_video")
        cursor_us += dur_us

    script.save()
    return draft_dir / project_name
