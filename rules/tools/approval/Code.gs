/**
 * 청주대 규정집 앱 — 검토 의견 열람 승인 서버 (Google Apps Script)
 *
 * 하는 일
 *  1. 앱에서 받은 열람 신청(소속·교직원번호·성명·사유)을 이 스프레드시트의 '신청' 시트에 적습니다.
 *  2. 관리자 카카오톡 '나와의 채팅'으로 [승인] [거절] 버튼이 달린 알림을 보냅니다(카카오 '나에게 보내기' API).
 *  3. 승인된 사람은 교직원번호·성명으로 어느 기기에서든 접속합니다. 처음 보는 기기에서 접속하면
 *     관리자에게 [회수] 버튼이 달린 '새 기기 접속' 알림을 보냅니다.
 *  4. 승인된 사람에게만 검토 의견(reviews.json)을 내려줍니다.
 *     '설정' 시트 B1 칸이 '공개'이면 승인 없이 누구에게나 내려줍니다(열람 방식 전환 스위치).
 *  5. '접속기록' 시트에 신청·처리·접속·열람·실패를 남기고(1년 보관), 승인·거절·회수를 확정하면
 *     카카오톡으로 처리 결과를 알리며, 매일 아침 대기 중인 신청이 있으면 알려 줍니다. 원본은 비공개 GitHub 저장소에 두고
 *     이 스크립트만 읽기 전용 토큰으로 읽습니다.
 *
 * 설치 방법은 같은 폴더의 README.md를 보십시오. 비밀값은 모두 '스크립트 속성'에 넣고 코드에는 적지 않습니다.
 *
 * 스크립트 속성
 *  KAKAO_REST_KEY        카카오 앱 REST API 키
 *  KAKAO_CLIENT_SECRET   (선택) 카카오 앱에서 Client Secret을 켰을 때
 *  KAKAO_REFRESH_TOKEN   (자동 저장) 관리자 카카오 연결 후 저장됨
 *  ADMIN_SETUP_CODE      관리자 카카오 연결 페이지를 열 때 쓰는 비밀 문구(아무 문자열)
 *  SIGN_SECRET           (자동 생성) 승인·거절·회수 링크 서명용
 *  GITHUB_TOKEN          비공개 저장소 읽기 전용 토큰(fine-grained, Contents: Read-only)
 *  REVIEWS_REPO          예: jjorribbong/cju-rules-reviews
 *  REVIEWS_PATH          예: reviews.json
 *  REVIEWS_REF           (선택) 브랜치, 기본 main
 *  APPROVAL_DAYS         (선택) 승인 유효 기간(일), 기본 365
 *  LOG_DAYS              (선택) 접속기록 보관 기간(일), 기본 365
 */

const SHEET = '신청';
const COLS = ['신청번호', '신청일시', '소속', '교직원번호', '성명', '사유', '상태', '처리일시', '만료일', '기기수', '최근조회', '기기키'];
const C = Object.fromEntries(COLS.map((n, i) => [n, i]));
const ST = { WAIT: '대기', OK: '승인', NO: '거절', OFF: '회수' };
const MAX_DEVICES = 20;      // 한 사람이 등록할 수 있는 기기 수(넘으면 오래된 기기부터 지움)
const MAX_FAILS = 5;         // 교직원번호별 성명 불일치 허용 횟수(1시간)

const props = () => PropertiesService.getScriptProperties();
const prop = k => props().getProperty(k) || '';
const nowStr = () => Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
const today = () => nowStr().slice(0, 10);
const json = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const hex = bytes => bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
const sha256 = s => hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
// 시트가 날짜 문자열을 날짜로 바꿔 저장해도 'yyyy-MM-dd HH:mm' 글자로 다룹니다.
const dstr = v => v instanceof Date ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(v || '');
const clip = (s, n) => String(s || '').trim().slice(0, n);
const normNo = s => String(s || '').replace(/[\s-]/g, '').toUpperCase().slice(0, 20);
const normName = s => String(s || '').replace(/\s/g, '').slice(0, 30);
const webUrl = () => ScriptApp.getService().getUrl();

function signSecret() {
  let s = prop('SIGN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props().setProperty('SIGN_SECRET', s); }
  return s;
}
function sign(id, decision) {
  return hex(Utilities.computeHmacSha256Signature(id + '|' + decision, signSecret())).slice(0, 32);
}

// 열람 방식 전환 스위치: '설정' 시트 B1 칸. '공개'이면 승인 없이 누구나, 그 밖의 값이면 승인받은 사람만 봅니다.
const SETTING_SHEET = '설정';
function settingSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTING_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTING_SHEET);
    sh.getRange('A1:B1').setValues([['열람 방식', '승인']]);
    sh.getRange('B1').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['승인', '공개'], true).build());
    sh.getRange('A3').setValue("B1을 '공개'로 바꾸면 승인 없이 누구나 검증 메뉴와 검토 의견을 봅니다. '승인'이면 승인받은 사람만 봅니다. 바꾼 뒤 1분 안에 반영됩니다.");
  }
  return sh;
}
// 1분 동안 저장해 두고 씁니다(값을 모르면 안전하게 '승인'으로 봅니다).
function viewMode_() {
  const cache = CacheService.getScriptCache();
  let m = cache.get('viewMode');
  if (!m) {
    m = String(settingSheet().getRange('B1').getValue() || '').trim() === '공개' ? '공개' : '승인';
    cache.put('viewMode', m, 60);
  }
  return m;
}

// 접속기록: 누가 언제 접속·열람했는지와 실패한 시도를 남깁니다.
const LOG_SHEET = '접속기록';
const LOG_COLS = ['일시', '구분', '신청번호', '성명', '소속', '교직원번호', '기기', '비고'];
function logSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, sh.getMaxRows(), LOG_COLS.length).setNumberFormat('@');
    sh.appendRow(LOG_COLS);
    sh.setFrozenRows(1);
  }
  return sh;
}
const devTag = key => key ? sha256(String(key)).slice(0, 6) : '';
// r: 신청 행(없으면 null), info: {no, name, dept} 보충, key: 기기 키
function log_(kind, r, key, note, info) {
  try {
    const v = r ? r.v : [];
    const i = info || {};
    logSheet().appendRow([nowStr(), kind, r ? v[C['신청번호']] : '', r ? v[C['성명']] : (i.name || ''), r ? v[C['소속']] : (i.dept || ''),
      r ? v[C['교직원번호']] : (i.no || ''), devTag(key), note || '']);
  } catch (err) { console.error('접속기록 실패', err); }
}
// 같은 사람·같은 기기의 열람은 10분에 한 번만 남깁니다.
function logView_(r, key) {
  const c = CacheService.getScriptCache(), k = 'seen.' + r.v[C['신청번호']] + '.' + devTag(key);
  if (c.get(k)) return;
  c.put(k, '1', 600);
  log_('열람', r, key);
}
function purgeLogs_() {
  const sh = logSheet(), n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const days = Number(prop('LOG_DAYS') || 365);
  const cut = Utilities.formatDate(new Date(Date.now() - days * 864e5), 'Asia/Seoul', 'yyyy-MM-dd');
  const dates = sh.getRange(2, 1, n, 1).getValues().map(r => dstr(r[0]).slice(0, 10));
  let k = 0;
  while (k < dates.length && dates[k] && dates[k] < cut) k++;   // 오래된 기록은 위쪽에 모여 있습니다
  if (k) sh.deleteRows(2, k);
  return k;
}
// '신청' 시트 줄 색: 대기 노랑, 승인 초록, 거절·회수 회색
function colorRules_(sh) {
  const rng = sh.getRange(2, 1, sh.getMaxRows() - 1, COLS.length);
  const col = String.fromCharCode(65 + C['상태']);
  const rule = (v, bg) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$${col}2="${v}"`).setBackground(bg).setRanges([rng]).build();
  sh.setConditionalFormatRules([rule(ST.WAIT, '#fff3cd'), rule(ST.OK, '#d4edda'), rule(ST.NO, '#e2e3e5'), rule(ST.OFF, '#e2e3e5')]);
  return sh;
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, sh.getMaxRows(), COLS.length).setNumberFormat('@'); // 날짜·번호를 글자 그대로 저장
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
    sh.hideColumns(C['기기키'] + 1);
    colorRules_(sh);
  }
  return sh;
}
function allRows() {
  const sh = sheet();
  const n = sh.getLastRow() - 1;
  return { sh, rows: n > 0 ? sh.getRange(2, 1, n, COLS.length).getValues() : [] };
}
const rowObj = (sh, rows, i) => ({ sh, row: i + 2, v: rows[i] });
function findById(id) {
  const { sh, rows } = allRows();
  const i = rows.findIndex(r => String(r[C['신청번호']]) === String(id));
  return i < 0 ? null : rowObj(sh, rows, i);
}
// 교직원번호의 가장 최근 신청
function findByNo(no) {
  const { sh, rows } = allRows();
  for (let i = rows.length - 1; i >= 0; i--) if (normNo(rows[i][C['교직원번호']]) === no) return rowObj(sh, rows, i);
  return null;
}
function statusOf(r) {
  const s = r.v[C['상태']];
  const exp = dstr(r.v[C['만료일']]).slice(0, 10);
  return s === ST.OK && exp && exp < today() ? '만료' : s;
}
const devices = r => String(r.v[C['기기키']] || '').split(',').filter(Boolean);
function setDevices(r, list) {
  const keep = list.slice(-MAX_DEVICES);
  r.sh.getRange(r.row, C['기기수'] + 1).setValue(String(keep.length));
  r.sh.getRange(r.row, C['기기키'] + 1).setValue(keep.join(','));
  r.v[C['기기키']] = keep.join(',');
}
// 이 기기를 등록하고, 처음 보는 기기면 true
function addDevice(r, key) {
  const hk = sha256(key).slice(0, 32), list = devices(r);
  if (list.includes(hk)) return false;
  setDevices(r, list.concat(hk));
  return true;
}

// 같은 교직원번호로 성명을 계속 틀리면 1시간 막습니다(남의 번호로 이름 맞히기 방지).
function failed(no) {
  const c = CacheService.getScriptCache(), k = 'fail.' + no;
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 3600);
  return n;
}
const locked = no => Number(CacheService.getScriptCache().get('fail.' + no) || 0) >= MAX_FAILS;

/* ---------- 앱에서 오는 요청(POST, text/plain JSON) ---------- */
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json({ ok: false, error: '요청 형식이 잘못되었습니다.' }); }
  try {
    if (body.action === 'request') return json(withLock_(() => request_(body)));
    if (body.action === 'login') return json(withLock_(() => login_(body)));
    if (body.action === 'data') return json(data_(body));
    return json({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: '서버 오류: ' + err.message });
  }
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

const MSG = {
  [ST.WAIT]: '승인을 기다리고 있습니다.',
  [ST.NO]: '신청이 승인되지 않았습니다.',
  [ST.OFF]: '열람 권한이 회수되었습니다.',
  '만료': '승인 기간이 끝났습니다. 다시 신청해 주십시오.',
};
const answer = (r, extra) => Object.assign({ ok: true, id: r.v[C['신청번호']], status: statusOf(r), name: r.v[C['성명']],
  expires: dstr(r.v[C['만료일']]).slice(0, 10) }, extra || {});

function request_(b) {
  const dept = clip(b.dept, 40), no = normNo(b.no), name = normName(b.name), reason = clip(b.reason, 300), key = String(b.key || '');
  if (!dept || !no || !name) return { ok: false, error: '소속, 교직원번호, 성명을 모두 적어 주십시오.' };
  if (key.length < 32) return { ok: false, error: '앱을 새로고침한 뒤 다시 신청해 주십시오.' };
  if (locked(no)) return { ok: false, error: '입력이 여러 번 맞지 않아 잠시 막혔습니다. 1시간 뒤에 다시 시도해 주십시오.' };
  const prev = findByNo(no);
  if (prev && [ST.WAIT, ST.OK].includes(statusOf(prev))) {
    // 이미 대기·승인 중인 번호: 성명이 맞으면 이 기기를 붙이고 기존 신청으로 안내합니다.
    if (normName(prev.v[C['성명']]) !== name) { failed(no); log_('신청 실패', null, key, '이미 신청된 번호, 성명 불일치', { no, name, dept }); return { ok: false, error: '이미 신청된 교직원번호입니다. 교직원번호와 성명을 확인해 주십시오.' }; }
    const isNew = addDevice(prev, key);
    log_(isNew ? '새 기기 접속' : '접속', prev, key, '신청 화면에서 기존 신청에 연결(' + statusOf(prev) + ')');
    if (isNew && statusOf(prev) === ST.OK) { try { notifyNewDevice_(prev); } catch (err) { console.error('카카오 알림 실패', err); } }
    return answer(prev, { existing: true });
  }
  const { sh, rows } = allRows();
  if (rows.filter(r => normNo(r[C['교직원번호']]) === no && dstr(r[C['신청일시']]).slice(0, 10) === today()).length >= 3)
    return { ok: false, error: '오늘은 더 신청할 수 없습니다. 관리자에게 문의해 주십시오.' };
  const id = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6);
  const row = COLS.map(() => '');
  Object.assign(row, { [C['신청번호']]: id, [C['신청일시']]: nowStr(), [C['소속']]: dept, [C['교직원번호']]: no,
    [C['성명']]: name, [C['사유']]: reason, [C['상태']]: ST.WAIT, [C['기기수']]: '1', [C['기기키']]: sha256(key).slice(0, 32) });
  sh.appendRow(row);
  SpreadsheetApp.flush();
  log_('신청', { v: row }, key, reason);
  let notified = true;
  try { notifyRequest_(id, dept, no, name, reason); } catch (err) { notified = false; console.error('카카오 알림 실패', err); }
  return { ok: true, id, status: ST.WAIT, name, notified };
}

// 재접속·다른 기기: 교직원번호 + 성명
function login_(b) {
  const no = normNo(b.no), name = normName(b.name), key = String(b.key || '');
  if (!no || !name) return { ok: false, error: '교직원번호와 성명을 적어 주십시오.' };
  if (key.length < 32) return { ok: false, error: '앱을 새로고침한 뒤 다시 시도해 주십시오.' };
  if (locked(no)) { log_('접속 차단', null, key, '시도 횟수 초과(1시간)', { no, name }); return { ok: false, error: '입력이 여러 번 맞지 않아 잠시 막혔습니다. 1시간 뒤에 다시 시도해 주십시오.' }; }
  const r = findByNo(no);
  if (!r || normName(r.v[C['성명']]) !== name) {
    const n = failed(no);
    log_('접속 실패', null, key, (r ? '성명 불일치' : '신청 내역 없음') + ` (${n}회)`, { no, name });
    return { ok: false, error: `신청 내역이 없거나 교직원번호·성명이 맞지 않습니다.${n >= MAX_FAILS ? ' 1시간 동안 막힙니다.' : ''}` };
  }
  const st = statusOf(r);
  if (st !== ST.OK && st !== ST.WAIT) { log_('접속 거부', r, key, st); return { ok: false, status: st, error: MSG[st] || '열람 권한이 없습니다.' }; }
  const isNew = addDevice(r, key);
  log_(isNew ? '새 기기 접속' : '접속', r, key, st);
  if (isNew && st === ST.OK) {
    try { notifyNewDevice_(r); } catch (err) { console.error('카카오 알림 실패', err); }
  }
  return answer(r);
}

// 기기 확인: 신청번호 + 이 기기 키가 등록되어 있어야 합니다.
function data_(b) {
  if (viewMode_() === '공개') return { ok: true, mode: '공개', reviews: loadReviews_() };
  if (!b.id) return { ok: false, mode: '승인', reset: true, error: '' };
  const r = findById(b.id);
  if (!r || !devices(r).includes(sha256(String(b.key || '')).slice(0, 32)))
    return { ok: false, reset: true, error: '이 기기의 접속 정보가 없습니다. 교직원번호와 성명으로 다시 접속해 주십시오.' };
  const st = statusOf(r);
  if (st !== ST.OK) { if (st !== ST.WAIT) log_('열람 거부', r, b.key, st); return { ok: false, status: st, error: MSG[st] || '열람 권한이 없습니다.' }; }
  r.sh.getRange(r.row, C['최근조회'] + 1).setValue(nowStr());
  logView_(r, b.key);
  return { ok: true, mode: '승인', name: r.v[C['성명']], expires: dstr(r.v[C['만료일']]).slice(0, 10), reviews: loadReviews_() };
}

// 비공개 저장소의 reviews.json을 읽어 10분간 캐시합니다(캐시 한 칸 100KB 한도라 나눠 담습니다).
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
  if (p.action === 'pending') return pendingPage_(p);
  if (p.action === 'kakao_setup') return kakaoSetup_(p);
  return page_('규정집 검토 의견 승인 서버', '이 주소는 앱이 쓰는 서버입니다.');
}

function page_(title, msg) {
  return HtmlService.createHtmlOutput(`<meta name="viewport" content="width=device-width,initial-scale=1">
    <div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px;line-height:1.6">
    <h2 style="font-size:20px">${title}</h2><p>${msg}</p></div>`).setTitle(title);
}
const h = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DECIDE = {
  approve: { ask: '열람을 승인할까요?', btn: '승인 확정', color: '#1a73e8', from: [ST.WAIT], to: ST.OK, done: '승인했습니다' },
  reject: { ask: '신청을 거절할까요?', btn: '거절 확정', color: '#d93025', from: [ST.WAIT], to: ST.NO, done: '거절했습니다' },
  revoke: { ask: '열람 권한을 회수할까요?', btn: '회수 확정', color: '#d93025', from: [ST.OK], to: ST.OFF, done: '회수했습니다' },
};
function decide_(p) {
  const D = DECIDE[p.d];
  if (!D || p.sig !== sign(p.id, p.d)) return page_('처리할 수 없습니다', '링크가 올바르지 않습니다.');
  const r = findById(p.id);
  if (!r) return page_('처리할 수 없습니다', '신청 내역이 없습니다.');
  const who = `${h(r.v[C['성명']])} (${h(r.v[C['소속']])}, 교직원번호 ${h(r.v[C['교직원번호']])})`;
  const cur = r.v[C['상태']];
  if (!D.from.includes(cur)) return page_('처리할 수 없습니다', `${who}: 현재 상태 ${h(cur)} (${h(dstr(r.v[C['처리일시']]))})`);
  // 카카오톡 미리보기·링크 검사기가 주소를 먼저 열어도 처리되지 않도록, 한 번 더 눌러 확정합니다.
  if (p.confirm !== '1') {
    const url = `${webUrl()}?action=decide&id=${encodeURIComponent(p.id)}&d=${p.d}&sig=${p.sig}&confirm=1`;
    return page_(D.ask, `${who}<br>사유: ${h(r.v[C['사유']]) || '-'}<br>등록 기기 ${h(r.v[C['기기수']] || '0')}대<br><br>
      <a href="${url}" target="_top" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${D.color};color:#fff;text-decoration:none">${D.btn}</a>`);
  }
  const days = Number(prop('APPROVAL_DAYS') || 365);
  const exp = D.to === ST.OK ? Utilities.formatDate(new Date(Date.now() + days * 864e5), 'Asia/Seoul', 'yyyy-MM-dd') : dstr(r.v[C['만료일']]);
  r.sh.getRange(r.row, C['상태'] + 1, 1, 3).setValues([[D.to, nowStr(), exp]]);
  r.v[C['상태']] = D.to;
  log_(D.done.replace('했습니다', ' 처리'), r, '', '관리자');
  try {
    const mark = { [ST.OK]: '✅ 승인 완료', [ST.NO]: '❌ 거절', [ST.OFF]: '⛔ 회수' }[D.to];
    sendKakao_(`${mark}\n${r.v[C['성명']]} / ${r.v[C['소속']]}\n교직원번호 ${r.v[C['교직원번호']]}\n신청번호 ${p.id}${D.to === ST.OK ? `\n${exp}까지 열람` : ''}\n남은 대기 ${pendingRows_().length}건`,
      pendingUrl_(), '대기 목록');
  } catch (err) { console.error('처리 결과 알림 실패', err); }
  return page_(D.done, `${who}${D.to === ST.OK ? `<br>${exp}까지 열람할 수 있습니다.` : ''}`);
}

/* ---------- 대기 목록 (카카오톡 버튼으로 엶) ---------- */
function pendingRows_() {
  const { sh, rows } = allRows();
  return rows.map((v, i) => rowObj(sh, rows, i)).filter(r => r.v[C['상태']] === ST.WAIT);
}
const pendingUrl_ = () => `${webUrl()}?action=pending&sig=${sign('pending', 'list')}`;
function pendingPage_(p) {
  if (p.sig !== sign('pending', 'list')) return page_('열 수 없습니다', '링크가 올바르지 않습니다.');
  const list = pendingRows_();
  if (!list.length) return page_('대기 중인 신청 없음', '모든 신청을 처리했습니다.');
  const btn = (id, d, label, color) => `<a href="${webUrl()}?action=decide&id=${encodeURIComponent(id)}&d=${d}&sig=${sign(id, d)}" target="_top" style="display:inline-block;margin:6px 6px 0 0;padding:8px 14px;border-radius:8px;background:${color};color:#fff;text-decoration:none">${label}</a>`;
  return page_(`대기 중인 신청 ${list.length}건`, list.map(r => {
    const v = r.v, id = v[C['신청번호']];
    return `<div style="border:1px solid #ddd;border-radius:10px;padding:10px 12px;margin:10px 0"><b>${h(v[C['성명']])}</b> · ${h(v[C['소속']])} · 교직원번호 ${h(v[C['교직원번호']])}<br>
      <span style="color:#666;font-size:14px">신청 ${h(dstr(v[C['신청일시']]))} · 사유: ${h(v[C['사유']]) || '-'}</span><br>${btn(id, 'approve', '승인', '#1a73e8')}${btn(id, 'reject', '거절', '#d93025')}</div>`;
  }).join(''));
}
// 매일 아침 실행: 대기 중인 신청이 있을 때만 카카오톡으로 알립니다.
function remindPending() {
  const list = pendingRows_();
  if (!list.length) return;
  const names = list.slice(0, 5).map(r => `· ${r.v[C['성명']]} (${r.v[C['소속']]}, ${dstr(r.v[C['신청일시']]).slice(5, 10)})`).join('\n');
  sendKakao_(`[규정집 승인 대기 ${list.length}건]\n${names}${list.length > 5 ? `\n외 ${list.length - 5}건` : ''}`, pendingUrl_(), '대기 목록에서 처리');
}

/* ---------- 카카오 '나에게 보내기' ---------- */
function kakaoSetup_(p) {
  const code = prop('ADMIN_SETUP_CODE').trim();
  if (!code || String(p.code_word || '').trim() !== code) return page_('접근할 수 없습니다', '관리자 연결 문구가 맞지 않습니다.');
  const state = Utilities.getUuid();
  CacheService.getScriptCache().put('kakao.state.' + state, '1', 600);
  const url = 'https://kauth.kakao.com/oauth/authorize?response_type=code&scope=talk_message'
    + '&client_id=' + encodeURIComponent(prop('KAKAO_REST_KEY')) + '&redirect_uri=' + encodeURIComponent(webUrl()) + '&state=' + state;
  return page_('관리자 카카오 연결', `관리자 본인 카카오 계정으로 로그인하고 '카카오톡 메시지 전송'에 동의해 주십시오.<br><br>
    <a href="${url}" target="_top" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#fee500;color:#000;text-decoration:none">카카오로 연결</a>`);
}

function kakaoCallback_(p) {
  const cache = CacheService.getScriptCache();
  if (!cache.get('kakao.state.' + p.state)) return page_('연결하지 못했습니다', '연결 시간이 지났습니다. 처음부터 다시 해 주십시오.');
  cache.remove('kakao.state.' + p.state);
  const tok = kakaoToken_({ grant_type: 'authorization_code', code: p.code, redirect_uri: webUrl() });
  if (!tok.refresh_token) return page_('연결하지 못했습니다', h(JSON.stringify(tok)));
  props().setProperty('KAKAO_REFRESH_TOKEN', tok.refresh_token);
  cache.put('kakao.access', tok.access_token, Math.max(60, (tok.expires_in || 3600) - 300));
  sendKakao_('규정집 승인 서버가 카카오톡과 연결되었습니다. 앞으로 열람 신청과 새 기기 접속을 여기로 알려 드립니다.', webUrl(), '서버 열기');
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

function decideLink_(id, d) {
  const u = `${webUrl()}?action=decide&id=${encodeURIComponent(id)}&d=${d}&sig=${sign(id, d)}`;
  return { web_url: u, mobile_web_url: u };
}
function notifyRequest_(id, dept, no, name, reason) {
  sendKakao_(`[규정집 검토 의견 열람 신청]\n${name} / ${dept}\n교직원번호 ${no}\n사유: ${reason || '-'}\n신청번호 ${id}`,
    decideLink_(id, 'approve').web_url, null,
    [{ title: '승인', link: decideLink_(id, 'approve') }, { title: '거절', link: decideLink_(id, 'reject') }]);
}
function notifyNewDevice_(r) {
  const id = r.v[C['신청번호']];
  sendKakao_(`[규정집 새 기기 접속]\n${r.v[C['성명']]} / ${r.v[C['소속']]}\n교직원번호 ${r.v[C['교직원번호']]}\n${nowStr()} · 등록 기기 ${devices(r).length}대\n본인이 아니면 회수하십시오.`,
    decideLink_(id, 'revoke').web_url, null, [{ title: '회수', link: decideLink_(id, 'revoke') }]);
}

/* ---------- 관리자 편의 ---------- */
// 매주 실행 트리거로 걸어 두면 카카오 갱신 토큰(유효 2개월)이 끊기지 않습니다.
function keepKakaoAlive() {
  try { purgeLogs_(); } catch (err) { console.error('접속기록 정리 실패', err); }
  CacheService.getScriptCache().remove('kakao.access');
  accessToken_();
}
// 편집기에서 한 번 실행: 시트 만들기, 주간 토큰 갱신 트리거 설치
function setup() {
  colorRules_(sheet());
  settingSheet();
  logSheet();
  signSecret();
  const has = f => ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === f);
  if (!has('keepKakaoAlive'))
    ScriptApp.newTrigger('keepKakaoAlive').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone('Asia/Seoul').create();
  if (!has('remindPending'))
    ScriptApp.newTrigger('remindPending').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Seoul').create();
}
// 편집기에서 실행해 카카오 알림이 오는지 시험합니다.
function testKakao() {
  sendKakao_('규정집 승인 서버 시험 메시지입니다.', webUrl(), '서버 열기');
}
