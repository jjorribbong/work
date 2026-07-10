# 캡컷 에이전트

한국어 토킹 영상 자동 편집기. `mp4/mov` 입력 → 무음/잔말/NG 컷 + 단어별
자막이 적용된 CapCut 드래프트를 생성한다.

빌드는 단계별로 쌓는다. **각 단계는 CapCut에서 실제로 재생해 확인한 뒤에만
다음 단계로 넘어간다.** 스크립트가 에러 없이 끝나는 것은 검증이 아니다.

## 진행 상황

- [x] Step 0 — 환경 점검 (`scripts/env_check.py`)
- [x] 1단 — silence_detect + build_draft (점프컷 드래프트, UI 없음)
- [ ] 2단 — FastAPI + 정적 HTML (drag/drop + SSE stepper)
- [ ] 3단 — Whisper 전사(세그먼트+단어) + 세그먼트 자막
- [ ] 4단 — filler_ng + cuts 통합 + transcript 결과 카드
- [ ] 5단 — 영상 프리뷰 + 보존 구간 마킹 (`[`/`]` 키)

## Step 0: 환경 점검

```bash
python3 scripts/env_check.py
```

의존성 없이(표준 라이브러리만) 동작한다. 부족한 도구가 있으면 설치 명령만
출력하고 종료한다 (자동 설치 안 함).

- **Mac**: `brew`, `python@3.11`, `ffmpeg`
- **Windows**: [python.org](https://www.python.org/downloads/) 설치, `winget install ffmpeg`
- **CapCut 드래프트 폴더**: CapCut을 최소 1회 실행 + 프로젝트 1개 생성해야 잡힘
- 디스크 여유공간 5GB+

트랙 분기: Mac(Apple Silicon) → 트랙 A(`mlx-whisper`) / Windows AMD64 → 트랙
C(`faster-whisper`) / 그 외 → fallback(`faster-whisper`).

### CapCut 드래프트 폴더를 못 찾을 때 (macOS 샌드박스 이슈)

CapCut 6.0+ 와 macOS Sequoia 조합에서 드래프트가 `~/Movies/CapCut/...` 표준
경로 대신 App Sandbox 컨테이너로 옮겨지는 사례가 보고되어 있다. 정확한
컨테이너 번들 ID는 버전마다 달라 자동 탐지가 100% 보장되지 않는다.

자동 탐지가 실패하면 CapCut 앱 안에서 **설정 > 환경설정 > 드래프트 위치**를
직접 확인한 뒤, 아래처럼 환경변수로 지정한다.

```bash
export CAPCUT_DRAFT_DIR="/실제/경로/com.lveditor.draft"
```

## 1단: silence_detect + build_draft

```bash
pip install -r requirements.txt
python3 cli_step1.py input.mp4 [project_name]
```

무음 구간(기본 -30dB, 0.5초 이상)을 잘라내고 발화 구간만 남긴 CapCut
드래프트를 생성한다. UI 없음 — 이 단계의 목적은 컷 로직과 draft 생성이
CapCut에서 실제로 재생 가능한지 확인하는 것 자체다.

**검증 방법**: 스크립트 실행 후 CapCut을 열어 생성된 프로젝트를 재생한다.
컷 경계가 부자연스럽거나(말이 잘림), CapCut이 프로젝트를 열지 못하면
실패다.

### 구현 메모

- draft JSON을 직접 다루지 않고 [`pycapcut`](https://github.com/GuanYixuan/pyCapCut)
  라이브러리에 위임한다 (`draft_content.json` 포맷을 재발명하지 않기 위함).
- 세그먼트 경계는 **마이크로초 정수**로만 계산한다. 초 단위 문자열
  (`"1.234s"`)을 세그먼트마다 독립적으로 반올림하면 누적 오차로 인접
  세그먼트 사이에 ~1ms 틈/겹침이 생겨 pycapcut이 `SegmentOverlap` 예외를
  던진다.
- pycapcut 문서상 "생성된 드래프트의 (프로그래밍적) export는 Windows판
  CapCut이 필요"하다고 되어 있다 — 이는 pycapcut 자체의 자동 export 기능
  이야기이고, 이 프로젝트는 그 기능을 쓰지 않는다. 사용자가 CapCut GUI에서
  직접 재생/편집/내보내기 하는 것은 Mac에서도 정상 동작한다.
- 컷 경계 양쪽에 150ms 패딩을 둬서 어두/자음이 잘리는 것을 방지한다
  (`app/silence.py`의 `pad` 파라미터).

## 프로젝트 구조

```
capcut-agent/
  scripts/env_check.py   # Step 0
  cli_step1.py            # 1단 CLI 진입점
  app/
    paths.py              # CapCut 드래프트 폴더 탐지
    media.py              # ffprobe 메타데이터
    silence.py            # ffmpeg silencedetect → 발화 구간
    draft_builder.py      # pycapcut으로 점프컷 드래프트 생성
```
