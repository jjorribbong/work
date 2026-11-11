#!/usr/bin/env python3
"""남서울대학교 전자규정집(규정관리시스템, https://law.nsu.ac.kr) 수집기.

남서울대 규정관리시스템(lmxsrv)은 다른 주소의 웹앱이 직접 읽을 수 없으므로(CORS),
이 스크립트가 규정 전문을 모아 rules.json(청주대·서원대 규정집 앱과 같은 형식)으로 저장합니다.

  1) 분류 트리(lawTreeNodes.do)를 따라 편·장·규정번호와 규정 목록을 모으고
  2) 규정마다 상세 화면(lawDetail_areaC.do)에서 담당부서와 제·개정 연혁(판 번호·날짜)을 읽고
  3) 현행 판 본문(lawFullContent.do)을 텍스트로 바꾸고 별표·서식 파일 목록을 모읍니다.
  4) 현행 판의 개정정보(lawRevisionInfo.do)에서 원문(전문)·신구대비표 HWP 받기 번호를 붙입니다.

  python nsu_rules_crawler.py                                   # → ../data/rules.json
  python nsu_rules_crawler.py --changes ../data/changes.json --history-days 120   # 최근 개정 이력도 생성
  python nsu_rules_crawler.py --limit 5 --out /tmp/t.json        # 시험용(5건만)

필요: pip install requests beautifulsoup4
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover
    sys.exit('필요한 패키지가 없습니다: pip install requests beautifulsoup4')

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://law.nsu.ac.kr'
LAWGROUP = 1          # 규정
ROOT_KEY = 1          # 규정 대메뉴
UA = 'Mozilla/5.0 (NSU-rules-mobile crawler)'
KST = dt.timezone(dt.timedelta(hours=9))
# 규정관리시스템의 첨부 받기 함수(fileDown). 앱이 이 action 주소로 받기 링크를 만든다.
FILE_DOWN = {
    'function': 'fileDown',
    'source': BASE + '/lmxmng/javascript/link.js',
    'code': "function fileDown(seq, type) { ... <form id='fileForm' action='/lmxsrv/fileDown.do' method='post'> "
            "FILE_SEQ=seq, FILE_TYPE=type ... }",
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class Client:
    def __init__(self, delay=0.4, timeout=40):
        self.delay, self.timeout, self._last = delay, timeout, 0.0
        self.s = requests.Session()
        self.s.headers['User-Agent'] = UA

    def get(self, path, **params):
        url = path if path.startswith('http') else BASE + path
        for i in range(4):
            wait = self.delay - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            try:
                r = self.s.get(url, params=params or None, timeout=self.timeout)
                self._last = time.time()
                r.raise_for_status()
                r.encoding = 'utf-8'
                return r
            except requests.RequestException as e:
                self._last = time.time()
                if i == 3:
                    raise
                log(f'  다시 시도({i + 1}): {url} — {e}')
                time.sleep(2 ** i)

    def start(self):
        self.get('/lmxsrv/main/main.do')  # 세션 쿠키


# ---------------- 목록(분류 트리) ----------------

CODE_RE = re.compile(r'^\s*(\d+(?:-\d+)+)\s+(.*)$')


def walk_tree(c):
    """[{key, title, code, part, chapter}] — 폐지 규정 폴더는 뺀다."""
    out = []

    def walk(parent, depth, path):
        nodes = c.get('/lmxsrv/law/lawTreeNodes.do', LAWGROUP=LAWGROUP, PARENT=parent, TREEDEPTH=depth).json()
        for n in nodes:
            title = re.sub(r'\s+', ' ', n.get('title') or '').strip()
            if '[폐지]' in title:
                continue
            if str(n.get('folder')) == '1':
                walk(n['key'], depth + 1, path + [title])
                continue
            if str(n.get('lawType')) != '1':  # 링크(URL)형 항목 등
                continue
            part = next((p for p in path if re.match(r'^제\s*\d+\s*편', p)), '')
            chapter = next((p for p in path if re.match(r'^제\s*\d+\s*장', p)), '')
            code = ''
            for p in reversed(path):
                m = CODE_RE.match(p)
                if m:
                    code = m.group(1)
                    break
            out.append({'key': n['key'], 'title': title, 'code': code, 'part': part, 'chapter': chapter})
    walk(ROOT_KEY, 1, [])
    return out


# ---------------- 상세(담당부서·연혁) ----------------

VER_RE = re.compile(r'<option[^>]*value="(\d+)"[^>]*>\s*<script[^>]*>\s*showDate_new\(\s*\'(\d{8})\'[^<]*</script>\s*</option>'
                    r'(?:\s*<script[^>]*>\s*\$\("#dateVal"\s*\+\s*\d+\)\.append\(\'\s*([^\']*)\'\);\s*</script>)?', re.S)


def fmt8(d):
    return f'{d[:4]}.{d[4:6]}.{d[6:8]}' if d and len(d) == 8 else ''


def rule_detail(c, key):
    html = c.get('/lmxsrv/law/lawDetail_areaC.do', SEQ=key, LAWGROUP=LAWGROUP).text
    versions = [{'seq': int(m.group(1)), 'date': fmt8(m.group(2)), 'kind': (m.group(3) or '').strip()} for m in VER_RE.finditer(html)]
    sel = re.search(r'<option[^>]*value="(\d+)"[^>]*selected', html)
    cur = int(sel.group(1)) if sel else (versions[0]['seq'] if versions else None)
    if cur is None:
        m = re.search(r'lawFullContent\.do\?SEQ=\d+&(?:amp;)?SEQ_HISTORY=(\d+)', html)
        cur = int(m.group(1)) if m else None
    dept = ''
    m = re.search(r'담당부서\s*:\s*([^<\n]+)', html)
    if m:
        dept = re.sub(r'\s+', ' ', m.group(1)).strip()
    return cur, versions, dept


# ---------------- 본문 ----------------

ART_HEAD_RE = re.compile(r'^제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?$')
STRUCT_RE = re.compile(r'^(제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\(|$)|제\s*\d+\s*(장|절|관|편)(?:\s|$)|부\s*칙|[①-⑳]|\d+\.\s|[가-하]\.\s|\[별)')
DROP_LINES = {'연혁숨기기', '연혁보기', '별지서식다운로드', '미리보기', '[별표/서식 파일]'}


def content_text(html):
    """lawFullContent.do HTML → (규정명, 본문 텍스트, 첨부 목록)"""
    soup = BeautifulSoup(html, 'html.parser')
    for t in soup(['script', 'style', 'noscript']):
        t.decompose()
    for t in soup.select('.doc_btn, #btnY, #btnN'):
        t.decompose()
    attachments = []
    for a in soup.select('a[href*="fileDown("]'):
        row = a.find_parent('tr') or a.parent
        name = ''
        if row is not None:
            cell = row.find(['td', 'span', 'div'], class_=re.compile('article|attach|name|tit'))
            name = (cell or row).get_text(' ', strip=True)
        name = re.sub(r'\s*(별지서식다운로드|미리보기|다운받기)\s*', ' ', name).strip()
        m = re.search(r'[^\s].*?\.(?:hwp|hwpx|pdf|docx?|xlsx?|zip)', name, re.I)
        if m:
            name = m.group(0).strip()
        if name and not any(x['name'] == name for x in attachments):
            attachments.append({'name': name, 'link': a['href'].strip()})
    for t in soup.select('.attach_file'):
        t.decompose()
    for t in soup.find_all(['div', 'p', 'br', 'tr', 'li', 'table', 'h1', 'h2', 'h3', 'h4']):
        t.insert_before('\n')
        t.insert_after('\n')
    # 표는 셀을 | 로 구분한 한 줄로
    for tr in soup.find_all('tr'):
        cells = [td.get_text(' ', strip=True).replace('|', '｜') for td in tr.find_all(['td', 'th'])]
        if all(x in ('', '미리보기', '별지서식다운로드', '다운받기') for x in cells):
            tr.decompose()
        elif len(cells) > 1:
            tr.replace_with('\n| ' + ' | '.join(cells) + ' |\n')
    raw = soup.get_text('')
    lines = []
    for l in raw.split('\n'):
        l = re.sub(r'[ \t 　]+', ' ', l).strip()
        if not l or l in DROP_LINES:
            continue
        lines.append(l)
    # "제1조(목적)" 줄과 다음 본문 줄을 합친다(서원대 데이터와 같은 모양)
    merged = []
    for l in lines:
        if merged and ART_HEAD_RE.match(merged[-1]) and not STRUCT_RE.match(l) and not l.startswith('|'):
            merged[-1] += ' ' + l
        else:
            merged.append(l)
    title = ''
    ln = soup.select_one('.lawname')
    if ln:
        title = re.sub(r'\s+', ' ', ln.get_text(' ', strip=True))
    # 장·부칙·조 사이에 빈 줄을 넣어 읽기 쉽게
    out = []
    for l in merged:
        if out and re.match(r'^(제\s*\d+\s*(장|절|조)|부\s*칙)', l):
            out.append('')
        out.append(l)
    return title, '\n'.join(out).strip(), attachments


def fetch_content(c, key, hseq, cache=None):
    path = os.path.join(cache, f'{key}_{hseq}.html') if cache else None
    if path and os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            html = f.read()
    else:
        html = c.get('/lmxsrv/law/lawFullContent.do', SEQ=key, SEQ_HISTORY=hseq).text
        if path:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(html)
    return content_text(html)


REV_FILE_RE = re.compile(r"fileDown\(\s*'(\d+)'\s*,\s*'(\w+)'\s*\);?\"?>\s*([^<]+?)\s*</a>")


def revision_files(c, hseq):
    """개정정보 화면의 원문(ori)·신구대비표(oldnew) 파일 → 첨부 목록"""
    try:
        html = c.get('/lmxsrv/law/lawRevisionInfo.do', SEQ_HISTORY=hseq).text
    except Exception as e:
        log(f'  개정정보 실패({hseq}): {e}')
        return []
    out = []
    for seq, typ, name in REV_FILE_RE.findall(html):
        if typ in ('ori', 'oldnew'):
            label = '현행 규정(전문)' if typ == 'ori' else '신구조문대비표'
            out.append({'name': name.strip() or f'{label}.hwp', 'link': f"javascript:fileDown('{seq}', '{typ}');"})
    return out


# ---------------- 실행 ----------------

def code_key(code):
    return [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', code or 'zz')]


def crawl(args):
    c = Client(delay=args.delay)
    c.start()
    log('분류 트리 읽는 중...')
    nodes = walk_tree(c)
    log(f'  규정 {len(nodes)}개')
    if args.limit:
        nodes = nodes[:args.limit]
    if args.cache:
        os.makedirs(args.cache, exist_ok=True)
    rules, failed = [], []
    for i, n in enumerate(nodes, 1):
        try:
            cur, versions, dept = rule_detail(c, n['key'])
            if not cur:
                raise ValueError('현행 판 번호를 찾지 못함')
            title, text, atts = fetch_content(c, n['key'], cur, args.cache)
            atts = revision_files(c, cur) + atts
        except Exception as e:
            failed.append(n['title'])
            log(f'  [{i}/{len(nodes)}] {n["title"]}: 실패 — {e}')
            continue
        title = n['title'] or title
        if re.sub(r'\s+', '', text.split('\n', 1)[0]) != re.sub(r'\s+', '', title):
            text = title + '\n' + text
        top = next((v for v in versions if v['seq'] == cur), versions[0] if versions else {})
        rules.append({
            'id': f'nsu{n["key"]}',
            'seq': cur,
            'title': title,
            'code': n['code'],
            'category': n['part'],
            'chapter': n['chapter'],
            'dept': dept,
            'revised': top.get('date', ''),
            'url': f'{BASE}/lmxsrv/law/lawFullView.do?SEQ={n["key"]}&SEQ_HISTORY={cur}',
            'text': text,
            'attachments': atts,
            'versions': [{'seq': v['seq'], 'date': v['date'], 'kind': v['kind']} for v in versions[:40]],
            'key': n['key'],
        })
        if i % 20 == 0 or args.limit:
            log(f'  본문 {i}/{len(nodes)} — {title}')

    rules.sort(key=lambda r: code_key(r['code']))
    data = {
        'source': BASE + '/lmxsrv/main/main.do',
        'fetchedAt': dt.datetime.now(KST).isoformat(timespec='seconds'),
        'fileDown': FILE_DOWN,
        'rules': rules,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=0)
    log(f'저장: {args.out} (규정 {len(rules)}건, 실패 {len(failed)}건)')
    if failed:
        log('  실패: ' + ', '.join(failed))
    if args.changes:
        build_changes(c, rules, args)


def build_changes(c, rules, args):
    """최근 개정된 규정의 직전 판을 받아 개정 이력(changes.json)을 만든다(앱의 '최근 개정'·'개정 비교')."""
    since = (dt.date.today() - dt.timedelta(days=args.history_days)).strftime('%Y.%m.%d')
    by_date = {}
    for r in rules:
        vs = r.get('versions') or []
        if len(vs) < 2 or not r['revised'] or r['revised'] < since:
            continue
        prev = next((v for v in vs if v['seq'] != r['seq'] and v['date'] < r['revised']), None)
        if not prev:
            continue
        try:
            _, before, _ = fetch_content(c, r['key'], prev['seq'], args.cache)
        except Exception as e:
            log(f'  직전 판 실패: {r["title"]} — {e}')
            continue
        if re.sub(r'\s+', '', before.split('\n', 1)[0]) != re.sub(r'\s+', '', r['title']):
            before = r['title'] + '\n' + before
        by_date.setdefault(r['revised'], []).append({'title': r['title'], 'kind': 'changed', 'before': before, 'after': r['text']})
    events = []
    for d in sorted(by_date, reverse=True)[:30]:
        y, m, dd = d.split('.')
        events.append({'at': f'{y}-{m}-{dd}T00:00:00+09:00', 'added': 0, 'removed': 0,
                       'changed': len(by_date[d]), 'rules': by_date[d]})
    with open(args.changes, 'w', encoding='utf-8') as f:
        json.dump({'events': events}, f, ensure_ascii=False, indent=0)
    log(f'개정 이력 저장: {args.changes} ({len(events)}회, 규정 {sum(len(e["rules"]) for e in events)}건)')


def main():
    ap = argparse.ArgumentParser(description='남서울대학교 전자규정집 수집기')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'data', 'rules.json'))
    ap.add_argument('--delay', type=float, default=0.4, help='요청 사이 쉬는 시간(초)')
    ap.add_argument('--cache', default='', help='받은 본문 HTML을 저장해 다시 쓰는 폴더')
    ap.add_argument('--changes', default='', help='최근 개정 이력(changes.json)도 만들 경로')
    ap.add_argument('--history-days', type=int, default=120, help='--changes: 최근 며칠 안의 개정을 담을지')
    ap.add_argument('--limit', type=int, default=0, help='최대 수집 규정 수(시험용)')
    args = ap.parse_args()
    crawl(args)


if __name__ == '__main__':
    main()
