/**
 * 청주대 규정집 앱 — 검토 의견 열람 승인 서버 (Google Apps Script)
 *
 * 하는 일
 *  1. 앱에서 받은 열람 신청(이름·부서·이메일·사유)을 이 스프레드시트의 '신청' 시트에 적습니다.
 *  2. 관리자 카카오톡 '나와의 채팅'으로 [승인] [거절] 버튼이 달린 알림을 보냅니다(카카오 '나에게 보내기' API).
 *  3. 관리자가 버튼을 누르면 상태를 바꾸고, 승인된 신청자에게만 검토 의견(reviews.json)을 내려줍니다.
 *     검토 의견 원본은 비공개 GitHub 저장소에 두고, 이 스크립트만 읽기 전용 토큰으로 읽습니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보십시오. 비밀값은 모두 '스크립트 속성'에 넣고 코드에는 적지 않습니다.
 *
 * 스크립트 속성
 *  KAKAO_REST_KEY        카카오 앱 REST API 키
 *  KAKAO_CLIENT_SECRET   (선택) 카카오 앱에서 Client Secret을 켰을 때
 *  KAKAO_REFRESH_TOKEN   (자동 저장) 관리자 카카오 로그인 후 저장됨
 *  ADMIN_SETUP_CODE      관리자 카카오 연결 페이지를 열 때 쓰는 비밀 문구(아무 문자열)
 *  SIGN_SECRET           (자동 생성) 승인·거절 링크 서명용
 *  GITHUB_TOKEN          비공개 저장소 읽기 전용 토큰(fine-grained, Contents: Read-only)
 *  REVIEWS_REPO          예: jjorribbong/cju-rules-reviews
 *  REVIEWS_PATH          예: reviews.json
 *  REVIEWS_REF           (선택) 브랜치, 기본 main
 *  ALLOWED_EMAIL_DOMAIN  (선택) 예: cju.ac.kr — 이 도메인 이메일만 신청 가능
 *  APPROVAL_DAYS         (선택) 승인 유효 기간(일), 기본 365
 */

const SHEET = '신청';
const COLS = ['신청번호', '신청일시', '이름', '부서', '이메일', '사유', '상태', '처리일시', '만료일', '키해시', '최근조회'];
const C = Object.fromEntries(COLS.map((n, i) => [n, i]));
const ST = { WAIT: '대기', OK: '승인', NO: '거절', OFF: '회수' };

const props = () => PropertiesService.getScriptProperties();
const prop = k => props().getProperty(k) || '';
const nowStr = () => Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
const json = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const hex = bytes => bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
const sha256 = s => hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
// 시트가 날짜 문자열을 날짜로 바꿔 저장해도 'yyyy-MM-dd HH:mm' 글자로 다룹니다.
const dstr = v => v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(v || '');
const clip = (s, n) => String(s || '').trim().slice(0, n);
const webUrl = () => ScriptApp.getService().getUrl();

function signSecret() {
  let s = prop('SIGN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props().setProperty('SIGN_SECRET', s); }
  return s;
}
function sign(id, decision) {
  return hex(Utilities.computeHmacSha256Signature(id + '|' + decision, signSecret())).slice(0, 32);
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), COLS.length).setNumberFormat('@'); // 날짜·번호를 글자 그대로 저장
    sh.hideColumns(C['키해시'] + 1);
  }
  return sh;
}
function findRow(id) {
  const sh = sheet();
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(r => String(r[0]));
  const i = ids.indexOf(String(id));
  return i < 0 ? null : { sh, row: i + 2, v: sh.getRange(i + 2, 1, 1, COLS.length).getValues()[0] };
}

/* ---------- 앱에서 오는 요청(POST, text/plain JSON) ---------- */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json({ ok: false, error: '요청 형식이 잘못되었습니다.' }); }
  try {
    if (body.action === 'request') return json(request_(body));
    if (body.action === 'status') return json(status_(body));
    if (body.action === 'data') return json(data_(body));
    return json({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: '서버 오류: ' + err.message });
  }
}

function request_(b) {
  const name = clip(b.name, 30), dept = clip(b.dept, 40), email = clip(b.email, 80).toLowerCase(), reason = clip(b.reason, 300);
  const key = String(b.key || '');
  if (!name || !dept || !email) return { ok: false, error: '이름, 부서, 이메일을 모두 적어 주십시오.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: '이메일 형식이 맞지 않습니다.' };
  const dom = prop('ALLOWED_EMAIL_DOMAIN');
  if (dom && !email.endsWith('@' + dom)) return { ok: false, error: `학교 이메일(@${dom})로 신청해 주십시오.` };
  if (key.length < 32) return { ok: false, error: '앱을 새로고침한 뒤 다시 신청해 주십시오.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet();
    const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).getValues() : [];
    // 같은 이메일의 대기 신청이 하루 3건을 넘으면 받지 않습니다(장난 신청 방지).
    const today = nowStr().slice(0, 10);
    if (rows.filter(r => r[C['이메일']] === email && dstr(r[C['신청일시']]).slice(0, 10) === today).length >= 3)
      return { ok: false, error: '오늘은 더 신청할 수 없습니다. 관리자에게 문의해 주십시오.' };
    const id = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6);
    const row = COLS.map(() => '');
    Object.assign(row, { [C['신청번호']]: id, [C['신청일시']]: nowStr(), [C['이름']]: name, [C['부서']]: dept,
      [C['이메일']]: email, [C['사유']]: reason, [C['상태']]: ST.WAIT, [C['키해시']]: sha256(key) });
    sh.appendRow(row);
    SpreadsheetApp.flush();
    let notified = true;
    try { notifyAdmin_(id, name, dept, email, reason); } catch (err) { notified = false; console.error('카카오 알림 실패', err); }
    return { ok: true, id, status: ST.WAIT, notified };
  } finally {
    lock.releaseLock();
  }
}

// 신청자 확인: 신청할 때 앱이 만든 비밀 키의 해시가 맞아야 합니다.
function check_(b) {
  const r = findRow(b.id);
  if (!r || sha256(String(b.key || '')) !== r.v[C['키해시']]) return null;
  const exp = dstr(r.v[C['만료일']]).slice(0, 10);
  if (r.v[C['상태']] === ST.OK && exp && exp < Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')) return Object.assign(r, { status: '만료' });
  return Object.assign(r, { status: r.v[C['상태']] });
}

function status_(b) {
  const r = check_(b);
  if (!r) return { ok: false, error: '신청 내역을 찾지 못했습니다. 다시 신청해 주십시오.', reset: true };
  return { ok: true, status: r.status, name: r.v[C['이름']], expires: dstr(r.v[C['만료일']]).slice(0, 10) };
}

function data_(b) {
  const r = check_(b);
  if (!r) return { ok: false, error: '신청 내역을 찾지 못했습니다.', reset: true };
  if (r.status !== ST.OK) return { ok: false, status: r.status, error: r.status === ST.WAIT ? '승인 대기 중입니다.' : `열람 권한이 없습니다(${r.status}).` };
  r.sh.getRange(r.row, C['최근조회'] + 1).setValue(nowStr());
  return { ok: true, reviews: loadReviews_() };
}

// 비공개 저장소의 reviews.json을 읽어 10분간 캐시합니다(캐시 한도 100KB라 나눠 담습니다).
function loadReviews_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('rv.n') || 0);
  if (n) {
    const parts = cache.getAll(Array.from({ length: n }, (_, i) => 'rv.' + i));
    if (Object.keys(parts).length === n) return JSON.parse(Array.from({ length: n }, (_, i) => parts['rv.' + i]).join(''));
  }
  const url = `https://api.github.com/repos/${prop('REVIEWS_REPO')}/contents/${encodeURI(prop('REVIEWS_PATH') || 'reviews.json')}?ref=${encodeURIComponent(prop('REVIEWS_REF') || 'main')}`;
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + prop('GITHUB_TOKEN'), Accept: 'application/vnd.github.raw+json' }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('검토 의견 원본을 읽지 못했습니다(' + res.getResponseCode() + ').');
  const text = res.getContentText('UTF-8');
  const size = 90000, chunks = {};
  for (let i = 0; i * size < text.length; i++) chunks['rv.' + i] = text.slice(i * size, (i + 1) * size);
  cache.putAll(Object.assign(chunks, { 'rv.n': String(Object.keys(chunks).length) }), 600);
  return JSON.parse(text);
}

/* ---------- 관리자: 카카오톡 버튼 링크, 카카오 연결(GET) ---------- */
function doGet(e) {
  const p = e.parameter || {};
  if (p.code && p.state) return kakaoCallback_(p);
  if (p.action === 'decide') return decide_(p);
  if (p.action === 'kakao_setup') return kakaoSetup_(p);
  return page_('규정집 검토 의견 승인 서버', '이 주소는 앱이 쓰는 서버입니다.');
}

function page_(title, msg) {
  return HtmlService.createHtmlOutput(`<meta name="viewport" content="width=device-width,initial-scale=1">
    <div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px;line-height:1.6">
    <h2 style="font-size:20px">${title}</h2><p>${msg}</p></div>`).setTitle(title);
}
const h = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function decide_(p) {
  const d = p.d === 'approve' ? 'approve' : p.d === 'reject' ? 'reject' : '';
  if (!d || p.sig !== sign(p.id, d)) return page_('처리할 수 없습니다', '링크가 올바르지 않습니다.');
  const r = findRow(p.id);
  if (!r) return page_('처리할 수 없습니다', '신청 내역이 없습니다.');
  const who = `${h(r.v[C['이름']])} (${h(r.v[C['부서']])}, ${h(r.v[C['이메일']])})`;
  if (r.v[C['상태']] !== ST.WAIT) return page_('이미 처리된 신청입니다', `${who}: ${h(r.v[C['상태']])} (${h(dstr(r.v[C['처리일시']]))})`);
  // 카카오톡 미리보기·링크 검사기가 주소를 먼저 열어도 처리되지 않도록, 한 번 더 눌러 확정합니다.
  if (p.confirm !== '1') {
    const url = `${webUrl()}?action=decide&id=${encodeURIComponent(p.id)}&d=${d}&sig=${p.sig}&confirm=1`;
    return page_(d === 'approve' ? '열람을 승인할까요?' : '신청을 거절할까요?',
      `${who}<br>사유: ${h(r.v[C['사유']]) || '-'}<br><br><a href="${url}" target="_top" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${d === 'approve' ? '#1a73e8' : '#d93025'};color:#fff;text-decoration:none">${d === 'approve' ? '승인 확정' : '거절 확정'}</a>`);
  }
  const days = Number(prop('APPROVAL_DAYS') || 365);
  const exp = Utilities.formatDate(new Date(Date.now() + days * 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
  r.sh.getRange(r.row, C['상태'] + 1, 1, 3).setValues([[d === 'approve' ? ST.OK : ST.NO, nowStr(), d === 'approve' ? exp : '']]);
  return page_(d === 'approve' ? '승인했습니다' : '거절했습니다', `${who}${d === 'approve' ? `<br>${exp}까지 열람할 수 있습니다. 회수하려면 시트에서 상태를 '회수'로 바꾸십시오.` : ''}`);
}

/* ---------- 카카오 '나에게 보내기' ---------- */
function redirectUri_() { return webUrl(); }

function kakaoSetup_(p) {
  if (!prop('ADMIN_SETUP_CODE') || p.code_word !== prop('ADMIN_SETUP_CODE')) return page_('접근할 수 없습니다', '관리자 연결 문구가 맞지 않습니다.');
  const state = Utilities.getUuid();
  CacheService.getScriptCache().put('kakao.state.' + state, '1', 600);
  const url = 'https://kauth.kakao.com/oauth/authorize?response_type=code&scope=talk_message'
    + '&client_id=' + encodeURIComponent(prop('KAKAO_REST_KEY')) + '&redirect_uri=' + encodeURIComponent(redirectUri_()) + '&state=' + state;
  return page_('관리자 카카오 연결', `관리자 본인 카카오 계정으로 로그인하고 '카카오톡 메시지 전송'에 동의해 주십시오.<br><br>
    <a href="${url}" target="_top" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#fee500;color:#000;text-decoration:none">카카오로 연결</a>`);
}

function kakaoCallback_(p) {
  const cache = CacheService.getScriptCache();
  if (!cache.get('kakao.state.' + p.state)) return page_('연결하지 못했습니다', '연결 시간이 지났습니다. 처음부터 다시 해 주십시오.');
  cache.remove('kakao.state.' + p.state);
  const tok = kakaoToken_({ grant_type: 'authorization_code', code: p.code, redirect_uri: redirectUri_() });
  if (!tok.refresh_token) return page_('연결하지 못했습니다', h(JSON.stringify(tok)));
  props().setProperty('KAKAO_REFRESH_TOKEN', tok.refresh_token);
  cache.put('kakao.access', tok.access_token, Math.max(60, (tok.expires_in || 3600) - 300));
  sendKakao_('규정집 승인 서버가 카카오톡과 연결되었습니다. 앞으로 열람 신청이 오면 여기로 알려 드립니다.', webUrl(), '서버 열기');
  return page_('연결했습니다', '카카오톡 나와의 채팅에 확인 메시지를 보냈습니다.');
}

function kakaoToken_(params) {
  const payload = Object.assign({ client_id: prop('KAKAO_REST_KEY') }, params);
  if (prop('KAKAO_CLIENT_SECRET')) payload.client_secret = prop('KAKAO_CLIENT_SECRET');
  const res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', { method: 'post', payload, muteHttpExceptions: true });
  return JSON.parse(res.getContentText() || '{}');
}

function accessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('kakao.access');
  if (cached) return cached;
  const rt = prop('KAKAO_REFRESH_TOKEN');
  if (!rt) throw new Error('관리자 카카오 연결이 안 되어 있습니다.');
  const tok = kakaoToken_({ grant_type: 'refresh_token', refresh_token: rt });
  if (!tok.access_token) throw new Error('카카오 토큰 갱신 실패: ' + JSON.stringify(tok));
  if (tok.refresh_token) props().setProperty('KAKAO_REFRESH_TOKEN', tok.refresh_token); // 만료 1개월 전부터 새로 발급됩니다
  cache.put('kakao.access', tok.access_token, Math.max(60, (tok.expires_in || 3600) - 300));
  return tok.access_token;
}

function sendKakao_(text, url, buttonTitle, buttons) {
  const tmpl = { object_type: 'text', text: text.slice(0, 200), link: { web_url: url, mobile_web_url: url } };
  if (buttons) tmpl.buttons = buttons;
  else if (buttonTitle) tmpl.button_title = buttonTitle;
  const res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'post', headers: { Authorization: 'Bearer ' + accessToken_() },
    payload: { template_object: JSON.stringify(tmpl) }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('카카오 전송 실패: ' + res.getContentText());
}

function notifyAdmin_(id, name, dept, email, reason) {
  const link = d => ({ web_url: `${webUrl()}?action=decide&id=${encodeURIComponent(id)}&d=${d}&sig=${sign(id, d)}`,
    mobile_web_url: `${webUrl()}?action=decide&id=${encodeURIComponent(id)}&d=${d}&sig=${sign(id, d)}` });
  sendKakao_(`[규정집 검토 의견 열람 신청]\n${name} / ${dept}\n${email}\n사유: ${reason || '-'}\n신청번호 ${id}`,
    link('approve').web_url, null,
    [{ title: '승인', link: link('approve') }, { title: '거절', link: link('reject') }]);
}

/* ---------- 관리자 편의 ---------- */
// 매주 실행 트리거로 걸어 두면 카카오 갱신 토큰(유효 2개월)이 끊기지 않습니다.
function keepKakaoAlive() {
  CacheService.getScriptCache().remove('kakao.access');
  accessToken_();
}
// 편집기에서 한 번 실행: 시트 만들기, 주간 토큰 갱신 트리거 설치
function setup() {
  sheet();
  signSecret();
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'keepKakaoAlive'))
    ScriptApp.newTrigger('keepKakaoAlive').timeBased().everyWeeks(1).create();
}
// 편집기에서 실행해 카카오 알림이 오는지 시험합니다.
function testKakao() {
  sendKakao_('규정집 승인 서버 시험 메시지입니다.', webUrl(), '서버 열기');
}
