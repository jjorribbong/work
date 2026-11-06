# 규정집 테스트용 복사본 (열람 승인 기능 시험)

`rules/` 앱을 그대로 두고, 검토 의견 열람 승인 기능을 넣은 화면만 따로 둔 곳입니다.

- 주소: https://jjorribbong.github.io/work/rules-test/
- 규정·법령 데이터와 `engine.js`는 실제 앱(`../rules/`)의 것을 그대로 읽습니다. 화면(`index.html`)만 다릅니다.
- 승인 전에는 검증 메뉴 전체(전체 검토·상위법 비교·동일·유사)를 가리고 열람 신청 화면만 보입니다.
- 검토 의견은 공개 파일을 읽지 않고 `review-access.json`의 승인 서버(Google Apps Script)에서만 받습니다.
- 브라우저 저장소 이름을 따로 쓰고(`cjurules-test.*`, IndexedDB `cju-rules-test`) 오프라인 캐시를 쓰지 않아 실제 앱과 섞이지 않습니다.
- 시험이 끝나 실제 앱에 적용하면 이 폴더는 지웁니다.
