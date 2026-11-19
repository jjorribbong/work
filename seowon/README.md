# 서원대학교 규정집 (모바일 웹앱)

서원대학교 홈페이지 규정집(https://www.seowon.ac.kr/seowon/301/subview.do)의 규정을 휴대폰에서 검색하고,
규정 간 위임조항·동일 유사 내용을 검증하고, 국가법령정보센터(law.go.kr) 법령과 비교하는 웹앱입니다.
청주대학교 규정집 앱(`rules/`, gh-pages 현재 버전)과 같은 화면·엔진을 쓰고, 데이터 수집만 서원대 규정집에 맞게 새로 만들었습니다.

GitHub Pages 주소의 `/seowon/`에서 열고, 브라우저 메뉴의 **홈 화면에 추가**를 누르면 앱처럼 설치됩니다.

## 기능

| 탭 | 내용 |
| --- | --- |
| 검색 | 규정명·본문 낱말 검색(띄어쓰기 무시, 여러 낱말 AND, `"구절"`), 분류(편) 필터, 개정 기간으로 조문 찾기 |
| 규정목록 | 편별 목록(제1편 학교법인 ~ 제8편 기타), 즐겨찾기, 최근 개정, 상위법 개정 알림 |
| 위임관계 | 규정별 상위(근거)·하위(위임) 규정, 위임 체계도, 준용·참조, 대상 미지정 위임, 외부 법령 인용 |
| 검증 | 정합성 점검, 상위법 비교(국가법령정보센터 조문 대조, 법 숫자 기준 자동 대조), 동일·유사 조항 |
| 데이터 | 최신 데이터 받기, JSON·HWPX·DOCX·TXT 가져오기, 본문 붙여넣기, 내보내기 |

규정 보기 머리말에는 편·장, 규정번호(예: 3-1-01), 소관부서, 개정일이 나오고 **원문 보기**를 누르면 서원대 규정집의
미리보기 화면이 열립니다. 맨 아래 **규정 파일·별표**에서 현행 규정(전문)과 신구조문대비표 HWP를 바로 받습니다.
별표·서식은 현행 규정(전문) 파일 끝에 들어 있고, 앱 본문에도 표(셀을 `|`로 구분)로 보입니다.

## 규정 데이터 수집 (`tools/seowon_rules_crawler.py`)

서원대 규정집은 규정을 HWP 파일로만 제공하고, 다른 주소의 웹앱이 직접 읽을 수 없습니다(CORS).
수집기가 다음 순서로 전문을 모아 `data/rules.json`(청주대 앱과 같은 형식)으로 저장합니다.

1. 분류 트리(`/regltn/seowon/7/get_node/operation?id=…`)를 따라 편·장과 규정 노드를 모음
2. 규정마다 제·개정 이력(`registView.do`)에서 가장 최근 판을 고르고, 첫 화면의 현행 규정 목록(`view.do`, 26쪽)과 맞춰 봄
3. 현행 규정 HWP(`/regltn/seowon/7/{번호}/1/download.do`)를 받아 본문을 텍스트로 추출(`tools/hwp5text.py`, olefile만 사용)

```bash
pip install -r seowon/tools/requirements.txt
python seowon/tools/seowon_rules_crawler.py                 # → seowon/data/rules.json
python seowon/tools/seowon_rules_crawler.py --changes seowon/data/changes.json --history-days 120   # 최근 개정 이력도 생성
python seowon/tools/seowon_rules_crawler.py --text 파일.hwp  # HWP 하나를 텍스트로 확인
```

- 요청 사이에 0.4초(`--delay`) 쉽니다. `--cache 폴더`를 주면 받은 HWP를 저장해 다시 씁니다.
- `--changes`: 최근 N일 안에 개정된 규정의 **직전 판**도 받아 `changes.json`(개정 전·후 본문)을 만듭니다. 앱의
  **최근 개정**과 규정 보기의 **개정 비교**(조문별 신구대비)에 쓰입니다.
- 규정 항목: `id`(트리 노드 번호, 판이 바뀌어도 같음), `seq`(현행 판 번호), `title`, `code`(규정번호), `category`(편),
  `chapter`(장), `dept`(소관부서), `revised`, `url`(미리보기), `text`, `attachments`, `versions`(최근 판 목록)

## 국가 법령 확인 (`tools/law_check.py`)

규정이 인용한 법률·시행령·시행규칙·고시·훈령·예규를 국가법령정보센터 Open API로 확인합니다(청주대 앱과 같은 프로그램).
현행 법령인지, 인용한 조가 있는지, 삭제된 조인지를 점검하고 인용 조문과 법령 전체 조문(`data/lawtext/`)을 저장합니다.

```bash
python seowon/tools/law_check.py --oc 인증키 --text-dir seowon/data/lawtext   # → seowon/data/laws.json
```

인증키(OC)는 [open.law.go.kr](https://open.law.go.kr)에서 OPEN API를 신청할 때 정하고, 실행할 PC의 공인 IP를 등록합니다.
공동활용 법령종류는 '대한민국 현행법령'과 '현행 행정규칙'의 목록 JSON·본문 JSON을 고릅니다.

**인증키 없이 확인(`--seed`)**: 이미 국가법령정보센터 API로 받아 둔 `laws.json`·`lawtext/`(예: 청주대 규정집의 `rules/data/`)를
API 대신 읽습니다. 그 자료에 없는 법령은 '없는 법령'으로 단정하지 않고 건너뛰며, `laws.json`의 `unchecked`에 이름을 남깁니다.

```bash
python seowon/tools/law_check.py --seed rules/data/laws.json --rules seowon/data/rules.json \
  --out seowon/data/laws.json --text-dir seowon/data/lawtext
```

지금 올라 있는 `data/laws.json`·`data/lawtext/`는 학교 PC에서 인증키로 실행한 결과입니다(2026-11-06, 인용 법령 121개 중 현행 101개 확인).

## 한 번에 업데이트하기 (업데이트 프로그램)

규정 수집 → 법령 확인 → GitHub 업로드를 버튼 하나로 실행합니다.

1. `seowon/tools/`의 `update_gui.py`, `규정업데이트.bat`, `seowon_rules_crawler.py`, `hwp5text.py`, `law_check.py`를 한 폴더에 둡니다.
2. `pip install -r requirements.txt` 후 `규정업데이트.bat`을 더블클릭하고, 처음 한 번 법령 API 인증키(OC)와 GitHub 토큰을 넣습니다.
   - GitHub 토큰: Settings → Developer settings → Fine-grained tokens → 이 저장소만 선택 → Contents: Read and write
3. **업데이트 시작**을 누르면 끝까지 자동으로 진행되고, 바뀐 규정 목록을 보여줍니다.

- 저장소(gh-pages)의 `seowon/data/`에 바뀐 파일만 올립니다. 수집된 규정 수가 기존보다 크게 적으면(80% 미만) 올리지 않습니다.
- 규정이 바뀌면 `changes.json`(개정 이력), 법령 전체 조문이 바뀌면 `lawchanges.json`(상위법 개정 알림)을 함께 올립니다.
- 설정은 이 PC의 `%APPDATA%\seowon-rules\config.json`에만 저장됩니다.

## 검토 의견 (`data/reviews.json`)

> **데모 버전 (2026-11-10)**: 자동 점검 후보 54건 중 유형별 17건만 원문과 대조해 검토 의견을 넣었습니다(개정 필요 8, 확인 필요 3, 문제 없음 6).
> 검증 탭의 **전체 검토**에 규정별로 모아 보이고, **상위법 비교** 결과의 해당 항목 아래에도 붙습니다. 머리글의 '데모' 표시와
> `reviews.json`의 `demo` 문구는 전체 검토를 마치면 지웁니다.

자동 점검이 찾은 후보를 원문(규정·법령)을 읽고 판단한 의견을 담는 파일입니다. 처음에는 비어 있고,
`tools/review_queue.js`로 대기열을 만들어 검토한 뒤 반영합니다(청주대 앱과 같은 방식).

```bash
node seowon/tools/review_queue.js queue --out /tmp/q   # 대기열: /tmp/q/queue.txt, queue.json
node seowon/tools/review_queue.js apply 판정.json      # 판정 반영
```

## 청주대 앱과 다른 점

- 데이터 출처: 규정관리시스템 HTML(청주대) → 홈페이지 규정집 HWP 파일(서원대). HWP 본문을 직접 해석합니다.
- 인용 이름 앞말: 「서원대학교 학칙」→「학칙」, 「학교법인 서원학원 정관」→「정관」을 같은 규정으로 봅니다.
- 조문 개정 표시는 `<개정 2025.4.30.>`·`<신설 …>` 형식을 읽습니다(개정 기간 검색에 사용).
- 규정 머리말에 장(章)·규정번호·소관부서를 함께 보여줍니다.
- 브라우저 저장소 이름이 달라(`swrules.*`, `sw-rules`) 같은 기기에서 청주대 앱과 데이터가 섞이지 않습니다.

## 파일

- `index.html`, `engine.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`: 앱
- `data/rules.json`: 규정 데이터(수집기 출력) · `data/changes.json`: 최근 개정 이력
- `data/laws.json`, `data/lawtext/`: 국가법령정보센터 법령 확인 결과·전체 조문
- `data/topics.json`: 분야별 기본 법령(상위법 비교의 '분야') · `data/reviews.json`: 검토 의견 · `data/sample.json`: 체험용 예시
- `tools/seowon_rules_crawler.py`, `tools/hwp5text.py`: 규정 수집기·HWP 본문 추출
- `tools/law_check.py`: 국가 법령 확인 · `tools/update_gui.py`, `tools/규정업데이트.bat`: 업데이트 프로그램
- `tools/review_queue.js`: 검토 의견 대기열

자동 분석은 문언 패턴에 기반하므로, 결과는 검토 대상 목록으로 활용하고 최종 판단은 원문과 담당 부서가 합니다.
