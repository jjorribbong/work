# 솜씨쟁이 도예공방 홈페이지

청주시 서원구 도예공방 "솜씨쟁이"의 홈페이지입니다. 빌드 도구 없이 순수 HTML/CSS/JS로 만들어져
있어서 별도 설치 없이 파일을 열거나 바로 배포할 수 있고, 내용 수정도 파일을 직접 여는 것만으로
가능합니다. 체험프로그램·갤러리는 개발 지식 없이 브라우저에서 로그인해 수정할 수 있는 관리자
화면(`/admin`)도 함께 제공합니다.

## 파일 구성

- `index.html` — 페이지 전체 구조와 텍스트 콘텐츠
- `styles.css` — 디자인/색상/레이아웃 (색상은 `:root` 변수에서 한 번에 관리)
- `script.js` — 모바일 메뉴, 스크롤 효과 등 상호작용
- `robots.txt`, `sitemap.xml` — 검색엔진 크롤링/색인 설정
- `REFERENCES.md` — 홈페이지 디자인 개선용 레퍼런스 리스트 (자동 갱신됨)
- `content/site.json` — 체험프로그램/갤러리 데이터. 관리자 화면이 이 파일을 수정합니다
- `admin/` — 관리자 화면(Decap CMS) 진입점(`index.html`)과 설정(`config.yml`)
- `scripts/build_content.py` — `content/site.json`을 `index.html`에 반영하는 빌드 스크립트
- `.github/workflows/build-content.yml` — 관리자가 저장하면 위 스크립트를 자동 실행하는 GitHub Actions
- `netlify.toml` — Netlify 배포 설정 (관리자 화면은 검색엔진에 노출되지 않도록 처리)

## 배포 전 반드시 확인할 것

`index.html`에 `⚠️` 주석으로 표시된 항목을 실제 정보로 교체해 주세요.

1. **주소** — `LocalBusiness` JSON-LD와 "오시는길" 섹션의 `streetAddress`/주소 표시가 현재
   자리표시자입니다. 실제 상세 주소가 정해지면 두 곳 모두 교체하세요.
2. **도메인** — `og:url`, `canonical`, JSON-LD의 `url`, `sitemap.xml`, `robots.txt`에
   `https://www.somssijaengi.kr/`가 예시로 들어있습니다. 실제 구매한 도메인으로 전체 교체하세요.
3. **지도** — "오시는길" 섹션의 `.map-placeholder`를 실제 카카오맵/구글맵 embed 코드로 교체하세요.
4. **가격/시간표** — 체험프로그램 설명(`content/site.json` 또는 관리자 화면), 정기수강
   요일·시간표(`index.html`의 정기수강 표)는 예시이므로 확정된 값으로 교체하세요.
5. **사진** — 갤러리는 실제 사진이 없어 색상 플레이스홀더로 채워져 있습니다. 촬영 후 관리자
   화면 또는 `content/site.json`에서 각 항목에 사진을 추가하세요.
6. **OG 이미지** — SNS 공유 시 노출되는 `/og-image.png`(1200x630px 권장)를 만들어 루트에 추가하세요.
7. **관리자 화면 브랜치** — `admin/config.yml`의 `branch` 값을 Netlify에 연결한 실제 배포
   브랜치 이름으로 교체하세요.

## 콘텐츠 수정 방법

두 가지 방법이 있습니다.

**① 체험프로그램 / 갤러리 — 관리자 화면(`/admin`)에서 로그인 후 수정 (권장)**

배포 후 `https://<도메인>/admin`에 접속해 Netlify Identity로 로그인하면 체험프로그램 카드
추가/수정/삭제, 갤러리 사진 업로드가 브라우저에서 바로 가능합니다. 저장하면 GitHub Actions가
자동으로 `index.html`을 재생성해 몇 분 안에 실제 사이트에 반영됩니다. 설정 방법은 아래
"배포 방법 → Netlify" 섹션을 참고하세요.

**② 그 외 텍스트(소개, 정기수강, 오시는길, FAQ 등) — `index.html` 직접 수정**

이 영역은 관리자 화면에 아직 연결되어 있지 않습니다. `index.html`을 텍스트 편집기로 열어
원하는 문구를 바로 고치면 됩니다. 각 섹션은 `<!-- ... -->` 주석으로 구분되어 있어 원하는
영역을 쉽게 찾을 수 있습니다. FAQ를 수정할 경우, 화면에 보이는 FAQ 문구와 `<head>`의
`FAQPage` JSON-LD 내용을 동일하게 맞춰주세요. (검색엔진이 실제 화면과 다른 구조화 데이터는
무시하거나 페널티를 줄 수 있습니다.)

> `index.html`의 체험프로그램/갤러리 영역(`<!-- CMS:...:START/END -->` 주석 사이)은
> `scripts/build_content.py`가 자동으로 덮어씁니다. 이 영역은 직접 수정하지 말고
> `content/site.json` 또는 관리자 화면에서 수정하세요.

## 배포 방법

관리자 화면(CMS) 로그인 기능을 무료로 가장 간단하게 쓸 수 있어 **Netlify를 권장**합니다.
GitHub Pages/Vercel도 정적 사이트 배포 자체는 가능하지만, 관리자 화면을 쓰려면 별도 인증
서버(OAuth 프록시)를 직접 구축해야 합니다.

### Netlify (권장)

1. [Netlify](https://www.netlify.com/)에 GitHub 계정으로 로그인 후 "Add new site" →
   "Import an existing project"로 이 저장소를 연결
2. Build command는 비워두고, Publish directory는 `.`(루트)로 설정
3. 배포에 사용할 브랜치를 선택 (예: 이 PR이 머지될 브랜치)
4. Site settings → Identity → **Enable Identity**
5. Identity → Registration을 "Invite only"로 설정 (아무나 가입해 관리자가 되는 것을 방지)
6. Identity → Services → **Enable Git Gateway**
7. Site settings → Identity → Invite users에서 관리자(공방 사장님) 이메일 초대
8. `admin/config.yml`의 `branch` 값을 4번에서 선택한 브랜치 이름으로 수정 후 커밋
9. Domain settings에서 구매한 도메인 연결

이후 `https://<도메인>/admin`에서 초대받은 이메일로 로그인하면 관리자 화면을 쓸 수 있습니다.

### GitHub Pages / Vercel (관리자 화면 없이 정적 배포만 필요할 때)

1. 저장소를 GitHub Pages 또는 Vercel에 연결하면 push할 때마다 자동 배포
2. 각 서비스의 "Domains" 설정에서 구매한 도메인을 연결
3. 이 경우 `content/site.json`은 계속 직접 수정해서 커밋하면 되고, `/admin` 관리자 화면은
   비활성 상태로 남습니다(별도 OAuth 인증 서버를 구축하기 전까지)

## 도메인 구매 안내

도메인 구매·결제는 이 세션에서 대신 진행할 수 없습니다. 가비아, 후이즈, Cloudflare Registrar 등에서
원하는 도메인을 직접 구매한 뒤, 위 배포 방법에 따라 DNS를 연결해 주세요.

## SEO / AEO / GEO 체크리스트

이미 반영된 항목:

- [x] `title`/`description` 메타 태그, `canonical`, Open Graph 태그
- [x] `LocalBusiness` 구조화 데이터(JSON-LD) — 지도·로컬 검색·AI 답변엔진 인용에 사용
- [x] `FAQPage` 구조화 데이터 — AI 답변엔진(AEO)이 질문-답변을 그대로 인용하기 쉬운 형태
- [x] 시맨틱 마크업(`header`/`nav`/`main`/`section`), 논리적 heading 구조(h1 → h2 → h3)
- [x] 첫 문단에 지역·업종·핵심 서비스를 명시해 생성형 검색(GEO)이 요약하기 쉬운 문장 구조
- [x] `robots.txt`, `sitemap.xml`
- [x] 모바일 반응형, 가벼운 순수 HTML/CSS/JS(빠른 로딩)

배포 후 직접 해야 할 것:

- [ ] [Google Search Console](https://search.google.com/search-console)에 도메인 등록 후
      `sitemap.xml` 제출
- [ ] [Google 비즈니스 프로필](https://www.google.com/business/) 등록 (지도/로컬 검색 노출에 중요)
- [ ] **네이버**: 한국 로컬 검색은 네이버 비중이 매우 높습니다. [네이버 서치어드바이저](https://searchadvisor.naver.com/)에 사이트 등록 + **네이버 플레이스** 등록을 강력히 권장합니다. (이번 작업 범위에는 포함하지 않았습니다.)
- [ ] 실제 주소가 확정되면 JSON-LD의 위도/경도(`geo`)도 추가하면 지도 노출에 더 유리합니다.

## 레퍼런스 리스트 자동 업데이트

`REFERENCES.md`는 예약 작업(Routine)이 주기적으로 웹 검색을 수행해 도예공방/공예 스튜디오
디자인 레퍼런스를 갱신하고 자동으로 커밋·푸시합니다. 주기나 방식을 바꾸고 싶다면 언제든 말씀해
주세요.

## 참고: 기존 콘텐츠

이 브랜치에서 루트의 `index.html`은 이전 테트리스 게임(`claude/tetris-web-game` 브랜치 등)을
이 홈페이지로 교체한 것입니다. 테트리스 게임은 git 히스토리와 별도 브랜치에 그대로 남아있습니다.
