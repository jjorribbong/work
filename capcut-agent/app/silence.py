"""ffmpeg silencedetect 기반 무음 구간 탐지 → 발화(=보존) 구간 계산."""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass

from app.media import probe_duration

_SILENCE_START_RE = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*(-?[\d.]+)")


@dataclass(frozen=True)
class Segment:
    start: float  # seconds
    end: float  # seconds

    @property
    def duration(self) -> float:
        return self.end - self.start


def detect_silence(
    video_path: str,
    noise_db: float = -30.0,
    min_silence_dur: float = 0.5,
) -> list[Segment]:
    """ffmpeg silencedetect로 무음 구간 목록을 반환한다."""
    cmd = [
        "ffmpeg", "-i", video_path, "-af",
        f"silencedetect=noise={noise_db}dB:d={min_silence_dur}",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)

    silences: list[Segment] = []
    pending_start: float | None = None
    for line in result.stderr.splitlines():
        m_start = _SILENCE_START_RE.search(line)
        if m_start:
            pending_start = float(m_start.group(1))
            continue
        m_end = _SILENCE_END_RE.search(line)
        if m_end and pending_start is not None:
            silences.append(Segment(pending_start, float(m_end.group(1))))
            pending_start = None

    return silences


def speech_segments(
    video_path: str,
    noise_db: float = -30.0,
    min_silence_dur: float = 0.5,
    pad: float = 0.15,
    min_keep_dur: float = 0.2,
) -> list[Segment]:
    """무음 구간의 여집합(=발화 구간)을 계산한다.

    pad: 컷 경계에서 자음/어두가 잘리지 않도록 발화 구간 양쪽에 붙이는 여유(초).
    min_keep_dur: 이보다 짧은 발화 구간은 노이즈로 간주하고 버린다.
    """
    duration = probe_duration(video_path)
    silences = detect_silence(video_path, noise_db, min_silence_dur)

    speech: list[Segment] = []
    cursor = 0.0
    for s in silences:
        if s.start > cursor:
            speech.append(Segment(cursor, s.start))
        cursor = max(cursor, s.end)
    if cursor < duration:
        speech.append(Segment(cursor, duration))

    padded: list[Segment] = []
    for seg in speech:
        if seg.duration < min_keep_dur:
            continue
        start = max(0.0, seg.start - pad)
        end = min(duration, seg.end + pad)
        padded.append(Segment(start, end))

    # 패딩으로 인접 구간이 겹치면 병합
    merged: list[Segment] = []
    for seg in padded:
        if merged and seg.start <= merged[-1].end:
            merged[-1] = Segment(merged[-1].start, max(merged[-1].end, seg.end))
        else:
            merged.append(seg)

    return merged
