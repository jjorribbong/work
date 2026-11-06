# 검토 의견 열람 승인 (카카오톡 승인)

규정 전체 검토 의견은 담당 부서 확인 전의 내부 자료라, 승인받은 교직원만 앱에서 볼 수 있게 합니다.

```
신청자(앱)  ──신청──▶  승인 서버(Google Apps Script) ──카카오톡 '나와의 채팅'──▶ 관리자
                         │  신청 기록: Google 시트 '신청'           [승인] [거절] 버튼
                         │  검토 의견: 비공개 GitHub 저장소에서 읽음
신청자(앱)  ◀──의견──  승인된 신청자에게만 내려줌
```

- 신청자는 앱 **검증 → 전체 검토**에서 이름·부서·학교 이메일·사유를 적고 신청합니다.
- 앱이 기기에서 비밀 키를 만들어 함께 보내고, 이후 이 키로 본인을 확인합니다(서버에는 해시만 저장).
- 관리자 카카오톡으로 신청 내용과 **[승인] [거절]** 버튼이 옵니다. 버튼을 누르면 확인 화면이 열리고 **승인 확정**을 한 번 더 눌러야 처리됩니다(링크 미리보기로 잘못 승인되는 것을 막습니다).
- 승인되면 신청자가 앱에서 **승인 확인**을 눌러 의견을 봅니다. 승인은 기본 365일 유효합니다.
- 권한 회수: 시트에서 그 사람의 **상태**를 `회수`로 바꾸면 바로 막힙니다.

> 검토 의견 원본(`reviews.json`)이 공개 저장소에 남아 있으면 이 승인 절차는 의미가 없습니다. 아래 1단계에서 반드시 옮기십시오.

## 설치 (관리자, 한 번)

### 1. 검토 의견을 비공개 저장소로 옮기기

1. GitHub에서 **비공개(Private)** 저장소를 만듭니다. 예: `jjorribbong/cju-rules-reviews`
2. `rules/data/reviews.json`을 그 저장소의 `reviews.json`으로 올립니다.
3. 공개 저장소(gh-pages)의 `rules/data/reviews.json`을 지웁니다. 과거 커밋 기록에도 남아 있으므로 기록 정리 여부를 정합니다.
4. GitHub → Settings → Developer settings → **Fine-grained tokens** → 새 토큰
   - Repository access: 위 비공개 저장소 하나만
   - Permissions: **Contents: Read-only**
   - 토큰 값을 복사해 둡니다(3단계에서 사용).

### 2. 카카오 앱 만들기 (developers.kakao.com)

1. 관리자 본인 카카오 계정으로 로그인 → **내 애플리케이션 → 애플리케이션 추가**
2. **앱 키**의 **REST API 키**를 복사합니다.
3. **플랫폼 → Web → 사이트 도메인**에 `https://script.google.com` 등록
4. **카카오 로그인 → 활성화 ON**
5. **카카오 로그인 → 동의항목 → 카카오톡 메시지 전송(talk_message)** 을 '선택 동의'로 설정
6. Redirect URI는 3단계에서 웹 앱 주소가 나온 뒤 등록합니다.

### 3. 승인 서버 만들기 (Google Apps Script)

1. 관리자 Google 계정으로 새 **Google 스프레드시트**를 만듭니다(이름 예: 규정집 열람 신청).
2. **확장 프로그램 → Apps Script** → 기본 코드를 지우고 이 폴더의 `Code.gs` 내용을 붙여 넣고 저장합니다.
3. **프로젝트 설정(톱니바퀴) → 스크립트 속성**에 추가합니다.

   | 속성 | 값 |
   |---|---|
   | `KAKAO_REST_KEY` | 2단계의 REST API 키 |
   | `ADMIN_SETUP_CODE` | 아무 비밀 문구(카카오 연결 화면을 열 때 사용) |
   | `GITHUB_TOKEN` | 1단계의 토큰 |
   | `REVIEWS_REPO` | `jjorribbong/cju-rules-reviews` |
   | `REVIEWS_PATH` | `reviews.json` |
   | `ALLOWED_EMAIL_DOMAIN` | `cju.ac.kr` (학교 이메일만 받으려면) |
   | `APPROVAL_DAYS` | (선택) 승인 유효 일수, 기본 365 |
   | `KAKAO_CLIENT_SECRET` | (선택) 카카오 앱에서 Client Secret을 켠 경우 |

4. 편집기 위쪽에서 함수 **`setup`** 을 골라 **실행** → 권한 허용. ('신청' 시트와 주간 토큰 갱신 트리거가 만들어집니다.)
5. **배포 → 새 배포 → 유형: 웹 앱**
   - 실행: **나**, 액세스 권한: **모든 사용자**
   - 배포 후 나오는 웹 앱 주소(`https://script.google.com/macros/s/…/exec`)를 복사합니다.
6. 카카오 앱 **카카오 로그인 → Redirect URI**에 이 웹 앱 주소를 그대로 등록합니다.
7. 브라우저에서 `웹앱주소?action=kakao_setup&code_word=ADMIN_SETUP_CODE값` 을 열어 **카카오로 연결** → 관리자 카카오 계정으로 동의합니다.
   카카오톡 '나와의 채팅'에 연결 확인 메시지가 오면 끝입니다.

> 코드를 고친 뒤 다시 배포할 때는 **배포 관리 → 기존 배포 수정(새 버전)** 으로 하십시오. 새 배포를 만들면 주소가 바뀝니다.

### 4. 앱에 승인 서버 연결

공개 저장소의 `rules/review-access.json`에 웹 앱 주소를 넣습니다.

```json
{
 "api": "https://script.google.com/macros/s/…/exec"
}
```

주소가 비어 있으면 앱은 예전처럼 `data/reviews.json`을 읽습니다.

### 5. 매일 자동 검토 작업 바꾸기

자동 검토 작업이 비공개 저장소의 파일을 읽고 쓰도록 `REVIEWS_FILE`을 줍니다.

```bash
git clone https://github.com/jjorribbong/cju-rules-reviews /tmp/reviews
REVIEWS_FILE=/tmp/reviews/reviews.json node rules/tools/review_queue.js queue --out /tmp/q
REVIEWS_FILE=/tmp/reviews/reviews.json node rules/tools/review_queue.js apply 판정.json
# 이후 /tmp/reviews에서 커밋·푸시 (공개 저장소에는 올리지 않음)
```

예약 작업 세션에 비공개 저장소 접근 권한도 추가해야 합니다.

## 운영

- **신청 목록**: 스프레드시트 '신청' 시트(신청번호, 이름, 부서, 이메일, 사유, 상태, 처리일시, 만료일, 최근조회)
- **회수**: 상태를 `회수`로 변경 / **재승인**: 상태를 `승인`으로, 만료일을 새 날짜로
- **카카오 연결 유지**: 카카오 갱신 토큰은 2개월 유효하며, `setup`이 만든 주간 트리거가 자동으로 갱신합니다. 끊겼다면 3-7을 다시 합니다.
- **알림 시험**: 편집기에서 `testKakao` 실행
- 같은 이메일로는 하루 3건까지만 신청을 받습니다.
- 검토 의견은 서버에서 10분간 캐시하므로, 비공개 저장소를 고친 뒤 최대 10분 뒤에 반영됩니다.
