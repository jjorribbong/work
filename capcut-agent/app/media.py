"""ffprobe 기반 소스 영상 메타데이터 조회."""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class MediaInfo:
    duration: float  # seconds
    width: int
    height: int
    fps: float


def probe_duration(video_path: str) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", video_path,
        ],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def probe_media_info(video_path: str) -> MediaInfo:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate",
            "-show_entries", "format=duration",
            "-of", "json", video_path,
        ],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(out.stdout)
    stream = data["streams"][0]
    num, den = stream["r_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) else float(num)
    return MediaInfo(
        duration=float(data["format"]["duration"]),
        width=int(stream["width"]),
        height=int(stream["height"]),
        fps=fps,
    )
