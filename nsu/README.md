# 남서울대학교 규정집 (모바일 웹앱)

남서울대학교 전자규정집(규정관리시스템, https://law.nsu.ac.kr)의 규정을 휴대폰에서 검색하고,
규정 간 위임조항·동일 유사 내용을 검증하고, 국가법령정보센터(law.go.kr) 법령과 비교하는 웹앱입니다.
서원대학교 규정집 앱(`seowon/`)·청주대학교 규정집 앱(`rules/`)과 같은 화면·엔진을 쓰고, 데이터 수집만 남서울대 전자규정집에 맞게 새로 만들었습니다.

GitHub Pages 주소의 `/nsu/`에서 열고, 브라우저 메뉴의 **홈 화면에 추가**를 누르면 앱처럼 설치됩니다.

## 기능

| 탭 | 내용 |
| --- | --- |
| 검색 | 규정명·본문 낱말 검색(띄어쓰기 무시, 여러 낱말 AND, `"구절"`), 분류(편) 필터, 개정 기간으로 조문 찾기 |
| 규정목록 | 편별 목록(제1편 학교법인 ~ 제8편 기타), 즐겨찾기, 최근 개정, 상위법 개정 알림 |
| 위임관계 | 규정별 상위(근거)·하위(위임) 규정, 위임 체계도, 준용·참조, 대상 미지정 위임, 외부 법령 인용 |
| 검증 | 정합성 점검, 상위법 비교(국가법령정보센터 조문 대조, 법 숫자 기준 자동 대조), 동일·유사 조항 |
| 데이터 | 최신 데이터 받기, JSON·HWPX·DOCX·TXT 가져오기, 본문 붙여넣기, 내보내기 |

규정 보기 머리말에는 편·장, 규정번호(예: 2-1-2), 담당부서, 개정일이 나오고 **원문 보기**를 누르면 전자규정집의
해당 규정 화면이 열립니다. 맨 아래 **규정 파일·별표**에서 현행 규정 원문·신구대비표 HWP와 별표·서식 파일을 바로 받습니다.

## 규정 데이터 수집 (`tools/nsu_rules_crawler.py`)

남서울대 전자규정집은 청주대와 같은 규정관리시스템(lmxsrv)이지만, 다른 주소의 웹앱이 직접 읽을 수 없습니다(CORS).
수집기가 다음 순서로 전문을 모아 `data/rules.json`(청주대·서원대 앱과 같은 형식)으로 저장합니다.

1. 분류 트리(`/lmxsrv/law/lawTreeNodes.do?LAWGROUP=1`)를 따라 편·장·규정번호와 규정 목록을 모음(`[폐지]` 폴더와
   제10편 '고등교육기관 관련 법령'은 제외 — 국가 법령 사본이라 넣으면 「고등교육법」 인용이 국가법령정보센터 대신 사본으로 연결됨. `--include-law-copies`로 포함)
2. 규정마다 상세 화면(`lawDetail_areaC.do`)에서 담당부서와 제·개정 연혁(판 번호·날짜)을 읽음
3. 현행 판 본문(`lawFullContent.do?SEQ=…&SEQ_HISTORY=…`)을 텍스트로 바꾸고 별표·서식 파일 목록을 모음
4. 현행 판 개정정보(`lawRevisionInfo.do`)에서 원문(전문)·신구대비표 HWP 받기 번호를 붙임

```bash
pip install -r nsu/tools/requirements.txt
python nsu/tools/nsu_rules_crawler.py                 # → nsu/data/rules.json
python nsu/tools/nsu_rules_crawler.py --changes nsu/data/changes.json --history-days 120   # 최근 개정 이력도 생성
python nsu/tools/nsu_rules_crawler.py --limit 5 --out /tmp/t.json                          # 시험용
```

- 요청 사이에 0.4초(`--delay`) 쉽니다. `--cache 폴더`를 주면 받은 본문 HTML을 저장해 다시 씁니다.
- `--changes`: 최근 N일 안에 개정된 규정의 **직전 판**도 받아 `changes.json`(개정 전·후 본문)을 만듭니다. 앱의
  **최근 개정**과 규정 보기의 **개정 비교**(조문별 신구대비)에 쓰입니다.
- 규정 항목: `id`(`nsu`+트리 번호, 판이 바뀌어도 같음), `seq`(현행 판 번호), `title`, `code`(규정번호), `category`(편),
  `chapter`(장), `dept`(담당부서), `revised`, `url`(전자규정집 화면), `text`, `attachments`, `versions`(판 목록)
- 별표·원문 파일 받기는 전자규정집의 `fileDown`(`/lmxsrv/fileDown.do?FILE_SEQ=…&FILE_TYPE=…`)을 그대로 씁니다.

## 국가 법령 확인 (`tools/law_check.py`)

규정이 인용한 법률·시행령·시행규칙·고시·훈령·예규를 국가법령정보센터 Open API로 확인합니다(청주대·서원대 앱과 같은 프로그램).

```bash
python nsu/tools/law_check.py --oc 인증키 --rules nsu/data/rules.json --out nsu/data/laws.json --text-dir nsu/data/lawtext
```

인증키(OC)는 [open.law.go.kr](https://open.law.go.kr)에서 OPEN API를 신청할 때 정하고, 실행할 PC의 공인 IP를 등록합니다.

**지금 올라 있는 `data/laws.json`·`data/lawtext/`**는 인증키 없이(`--seed`) 청주대·서원대 규정집 앱이 2026-11-05~06에 국가법령정보센터에서 받아 둔
법령 자료로 만든 것입니다(인용 법령 62개 확인). 그 자료에 없는 법령은 '없는 법령'으로 단정하지 않고 건너뛰며 `laws.json`의 `unchecked`에 이름을 남깁니다.
학교 PC에서 인증키로 한 번 실행하면(또는 업데이트 프로그램을 돌리면) 모든 인용 법령이 확인됩니다.

## 한 번에 업데이트하기 (업데이트 프로그램)

규정 수집 → 법령 확인 → GitHub 업로드를 버튼 하나로 실행합니다.

1. `nsu/tools/`의 `update_gui.py`, `규정업데이트.bat`, `nsu_rules_crawler.py`, `law_check.py`를 한 폴더에 둡니다.
2. `pip install -r requirements.txt` 후 `규정업데이트.bat`을 더블클릭하고, 처음 한 번 법령 API 인증키(OC)와 GitHub 토큰을 넣습니다.
   - GitHub 토큰: Settings → Developer settings → Fine-grained tokens → 이 저장소만 선택 → Contents: Read and write
3. **업데이트 시작**을 누르면 끝까지 자동으로 진행되고, 바뀐 규정 목록을 보여줍니다.

- 저장소(gh-pages)의 `nsu/data/`에 바뀐 파일만 올립니다. 수집된 규정 수가 기존보다 크게 적으면(80% 미만) 올리지 않습니다.
- 설정은 이 PC의 `%APPDATA%\nsu-rules\config.json`에만 저장됩니다.

## 검토 의견 (`data/reviews.json`)

> **데모 버전 (2026-11-12)**: 주요 규정 20개를 골라 자동 점검 후보 28건과 규정 전문을 원문(규정·법령)과 대조해 검토 의견 42건을 넣었습니다
> (위반 9, 개정 필요 9, 확인 필요 11, 문제 없음 13, 이 중 25건에 개정안(신구대비) 포함). 검증 탭의 **전체 검토**에 규정별로 모아 보이고,
> 엑셀로 내려받을 수 있습니다. 머리글의 '데모' 표시와 `reviews.json`의 `demo` 문구는 전체 검토를 마치면 지웁니다.
> 주요 규정 20개: 학교법인 성암학원 정관, 학칙, 남서울대학교 학사규정, 대학원 학칙, 직제규정, 위임전결규정, 재무회계규정, 자체감사규정,
> 교원인사규정, 강사인사규정, 직원인사 규정, 직원복무규정, 교직원보수규정, 교직원징계규정, 교원업적평가 규정, 등록금심의위원회운영규정,
> 대학평의원회 운영규정, 연구윤리규정, 기관생명윤리위원회 규정, 연구실 안전관리에 관한 규정.

자동 점검이 찾은 후보를 원문(규정·법령)을 읽고 판단한 의견을 담는 파일입니다. 처음에는 비어 있고,
`tools/review_queue.js`로 대기열을 만들어 검토한 뒤 반영합니다(청주대·서원대 앱과 같은 방식).

```bash
node nsu/tools/review_queue.js queue --out /tmp/q   # 대기열: /tmp/q/queue.txt, queue.json
node nsu/tools/review_queue.js apply 판정.json      # 판정 반영
```

## 서원대 앱과 다른 점

- 데이터 출처: 홈페이지 규정집 HWP 파일(서원대) → 규정관리시스템 HTML(남서울대, 청주대와 같은 lmxsrv). HWP 해석이 필요 없습니다.
- 인용 이름 앞말: 「남서울대학교 학칙」→「학칙」, 「학교법인 성암학원 정관」→「정관」을 같은 규정으로 봅니다.
- 별표·서식은 규정마다 따로 올라 있는 파일을 그대로 받고, 현행 원문·신구대비표 HWP도 함께 받을 수 있습니다.
- 브라우저 저장소 이름이 달라(`nsurules.*`, `nsu-rules`) 같은 기기에서 청주대·서원대 앱과 데이터가 섞이지 않습니다.

## 안내 매뉴얼 · 담당자 꾸러미

- `docs/안내매뉴얼.docx`: 설치, 화면별 사용법, 검토 의견 읽는 법, 데모 검토 결과(주요 규정 20개), 업데이트·이관 방법
- `docs/nsu-kit.zip`: 학교 자체 저장소에 앱을 새로 만드는 꾸러미(서원대 `seowon-kit`과 같은 구성). 앱 코드, 수집·법령 확인·업데이트 프로그램,
  Claude 작업 지침(`CLAUDE.md`), 담당자 안내(`README.md`), 사이트 구조(`docs/site-structure.md`), 수집 점검(`tools/check_data.js`),
  데모 검토 의견(`docs/demo-reviews.json`), 안내 매뉴얼. 저장소 루트(GitHub Pages `main` 브랜치) 배치 기준이며,
  업데이트 프로그램은 저장소를 화면에서 입력받습니다.
- 앱의 데이터 탭에도 두 파일의 받기 링크가 있습니다.

## 파일

- `index.html`, `engine.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`: 앱
- `data/rules.json`: 규정 데이터(수집기 출력) · `data/changes.json`: 최근 개정 이력
- `data/laws.json`, `data/lawtext/`: 국가법령정보센터 법령 확인 결과·전체 조문
- `data/topics.json`: 분야별 기본 법령(상위법 비교의 '분야') · `data/reviews.json`: 검토 의견 · `data/sample.json`: 체험용 예시
- `tools/nsu_rules_crawler.py`: 규정 수집기 · `tools/law_check.py`: 국가 법령 확인
- `tools/update_gui.py`, `tools/규정업데이트.bat`: 업데이트 프로그램 · `tools/review_queue.js`: 검토 의견 대기열

자동 분석은 문언 패턴에 기반하므로, 결과는 검토 대상 목록으로 활용하고 최종 판단은 원문과 담당 부서가 합니다.
