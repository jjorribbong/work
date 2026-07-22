#!/usr/bin/env python3
"""content/site.json 내용을 index.html의 CMS 마커 구간에 반영합니다.

관리자(Decap CMS)가 content/site.json을 수정하면 GitHub Actions가 이 스크립트를
실행해 index.html을 재생성합니다. 표준 라이브러리만 사용하며 외부 의존성이 없습니다.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "content" / "site.json"
INDEX_PATH = ROOT / "index.html"
GALLERY_PALETTE_COUNT = 6
PHONE_TEL = "tel:010-3431-9862"


def esc(value):
    return html.escape(value or "", quote=True)


def render_experiences(items):
    cards = []
    for item in items:
        cards.append(
            "        <article class=\"card\">\n"
            f"          <h3>{esc(item.get('title'))}</h3>\n"
            f"          <p class=\"card-meta\">{esc(item.get('meta'))}</p>\n"
            f"          <p>{esc(item.get('description'))}</p>\n"
            f"          <a href=\"{PHONE_TEL}\" class=\"card-link\">전화로 예약하기 →</a>\n"
            "        </article>"
        )
    return "\n".join(cards)


def render_gallery(items):
    tiles = []
    for i, item in enumerate(items):
        palette_class = f"gi-{(i % GALLERY_PALETTE_COUNT) + 1}"
        image = (item.get("image") or "").strip()
        style = f" style=\"background-image:url('{esc(image)}')\"" if image else ""
        tiles.append(
            f"        <div class=\"gallery-item {palette_class}\"{style}><span>{esc(item.get('label'))}</span></div>"
        )
    return "\n".join(tiles)


def replace_block(text, marker, new_inner):
    start = f"<!-- CMS:{marker}:START -->"
    end = f"<!-- CMS:{marker}:END -->"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        raise SystemExit(f"마커를 찾을 수 없습니다: {marker}")
    replacement = f"{start}\n{new_inner}\n      {end}"
    return pattern.sub(lambda m: replacement, text, count=1)


def main():
    if not DATA_PATH.exists():
        print(f"데이터 파일이 없습니다: {DATA_PATH}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    text = INDEX_PATH.read_text(encoding="utf-8")
    text = replace_block(text, "EXPERIENCES", render_experiences(data.get("experiences", [])))
    text = replace_block(text, "GALLERY", render_gallery(data.get("gallery", [])))
    INDEX_PATH.write_text(text, encoding="utf-8")
    print("index.html을 content/site.json 기준으로 갱신했습니다.")


if __name__ == "__main__":
    main()
