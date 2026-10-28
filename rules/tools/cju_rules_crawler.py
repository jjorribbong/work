#!/usr/bin/env python3
"""청주대학교 규정관리시스템(rule.cju.ac.kr) 규정 전문 수집기.

규정관리시스템(lmxsrv)은 다른 도메인의 웹앱에서 직접 읽을 수 없으므로(CORS),
이 스크립트로 규정 전문을 모아 rules/data/rules.json 으로 저장하면
모바일 앱(rules/index.html)이 그 파일을 읽어 검색·위임·중복 검증을 한다.

사용법
    pip install requests beautifulsoup4
    python rules/tools/cju_rules_crawler.py                 # 자동 탐색 + SEQ 범위 스캔
    python rules/tools/cju_rules_crawler.py --scan 1-2000   # SEQ 범위를 직접 지정
    python rules/tools/cju_rules_crawler.py --from-dir 저장한_HTML_폴더   # 브라우저로 저장한 파일에서 추출

동작 방식
    1. 메인 화면과 /lmxsrv/ 아래 목록 페이지를 따라가며 링크·스크립트에 들어 있는
       규정 번호(SEQ)를 모은다.
    2. 규정 보기 주소(--viewer 또는 자동 감지한 형식)로 각 SEQ의 전문을 받아
       "제1조(목적)" 형식의 조문이 있는 페이지만 규정으로 저장한다.
    3. 목록에서 SEQ를 찾지 못하면 SEQ 번호를 차례로 시도한다(연속 실패가
       --max-miss 회를 넘으면 중단).
학교 서버에 부담을 주지 않도록 요청 사이에 --delay 초(기본 0.5초) 쉰다.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from collections import deque
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover
    sys.exit('필요한 패키지가 없습니다: pip install requests beautifulsoup4')

DEFAULT_BASE = 'https://rule.cju.ac.kr'
START_PATH = '/lmxsrv/main/main.srv'

# lmxsrv 계열 규정관리시스템에서 쓰이는 규정 보기 주소 형식들 (앞에서부터 자동 감지)
VIEWER_TEMPLATES = [
    '/lmxsrv/law/lawFullView.srv?SEQ={seq}',
    '/lmxsrv/law/lawFullContent.srv?SEQ={seq}',
    '/lmxsrv/law/lawviewer.srv?SEQ={seq}',
    '/lmxsrv/law/lawView.srv?SEQ={seq}',
    '/lmxsrv/law/twoView.srv?SEQ={seq}',
    '/lmxsrv/law/lawFullView.do?SEQ={seq}',
    '/lmxsrv/law/twoView.do?SEQ={seq}',
]

# 조문 머리: "제1조(목적)" 또는 제목 없이 "제1조 이 규정은…"
ART_LINE_RE = re.compile(r'^\s*제\s*(\d+)\s*조(?:\s*의\s*\d+)?(?:\s*[(【]|\s+(?!에|의|및|또는|부터|까지)\S)', re.M)
SEQ_RES = [
    re.compile(r'[?&]SEQ=(\d+)', re.I),
    re.compile(r'''\bSEQ['"]?\s*[:=,]\s*['"]?(\d+)''', re.I),
    re.compile(r'''(?:fn|go|open)\w*(?:View|Law|Rule)\w*\(\s*['"]?(\d+)''', re.I),
]
CATEGORY_RE = re.compile(r'^\s*제\s*\d+\s*(편|장|부)\s*\S.{0,30}$')
TITLE_SUFFIX_RE = re.compile(r'(규정|학칙|세칙|규칙|지침|정관|요령|기준|내규|준칙|강령|운영방침|회칙|규약|요강|수칙|헌장|약관|규범)$')
GENERIC_TITLES = ('규정관리시스템', '규정정보시스템', 'LawMaker')  # 이 말이 들어가면 규정명이 아님
GENERIC_EXACT = {'청주대학교', '규정집', '법규', '규정', '현행규정', '전체규정', '규정정보'}  # 이것만 단독이면 규정명이 아님
BLOCK_TAGS = ['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'dd', 'dt', 'pre', 'section', 'article']


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class Client:
    def __init__(self, base, delay, verify=True, timeout=20):
        self.base = base.rstrip('/')
        self.host = urlparse(self.base).netloc
        self.delay = delay
        self.s = requests.Session()
        self.s.headers['User-Agent'] = 'Mozilla/5.0 (CJU-rules-mobile crawler; +https://github.com/)'
        self.s.verify = verify
        self.timeout = timeout
        self._last = 0.0

    def get(self, url):
        url = urljoin(self.base + '/', url)
        wait = self.delay - (time.time() - self._last)
        if wait > 0:
            time.sleep(wait)
        for attempt in range(3):
            try:
                r = self.s.get(url, timeout=self.timeout)
                self._last = time.time()
                if r.encoding is None or r.encoding.lower() in ('iso-8859-1', 'ascii'):
                    r.encoding = r.apparent_encoding or 'utf-8'
                return r
            except requests.RequestException as e:
                if attempt == 2:
                    log(f'  ! 요청 실패 {url}: {e}')
                    return None
                time.sleep(2 ** attempt)

    def same_host(self, url):
        return urlparse(urljoin(self.base + '/', url)).netloc == self.host


def html_to_text(node):
    for t in node.find_all(['script', 'style', 'noscript']):
        t.decompose()
    for t in node.find_all(BLOCK_TAGS):
        t.insert_before('\n')
        t.insert_after('\n')
    text = node.get_text('')
    lines = [re.sub(r'[ \t 　]+', ' ', l).strip() for l in text.split('\n')]
    out, blank = [], False
    for l in lines:
        if not l:
            blank = True
            continue
        if blank and out:
            out.append('')
        out.append(l)
        blank = False
    return '\n'.join(out)


def content_node(soup):
    """조문 머리("제N조(")를 대부분 담고 있는 가장 안쪽 요소를 본문으로 본다."""
    total = len(ART_LINE_RE.findall(html_to_text(BeautifulSoup(str(soup), 'html.parser'))))
    if total == 0:
        return None, 0
    best = soup.body or soup
    for el in soup.find_all(['div', 'td', 'section', 'article', 'main', 'form']):
        txt = el.get_text('\n')
        n = len(ART_LINE_RE.findall(txt))
        if n >= max(1, int(total * 0.8)):
            best = el  # find_all은 문서 순서(바깥→안쪽)이므로 마지막 조건 충족 요소가 가장 안쪽
    return best, total


def _clean(c):
    c = re.sub(r'^\s*(제\s*목|규정명|법규명)\s*[:：]?\s*', '', c or '')  # 표의 '제목' 칸 이름이 붙은 줄
    return re.sub(r'\s*[(\[<].*$', '', c).strip()


NOT_TITLE_RE = re.compile(r'^(제\s*정|개\s*정|전부\s*개정|일부\s*개정|시행|공포|\d|제\s*\d+\s*(편|장|절|관)(\s|$))'
                          r'|별표|서식|부\s*칙|목\s*차|연\s*혁|신구|대비표|^전\s*문|인쇄|닫기|조문|본문|검색|^Home|^홈')


def _plausible(c):
    return 2 <= len(c) <= 60 and not any(g in c for g in GENERIC_TITLES) and c.replace(' ', '') not in GENERIC_EXACT \
        and not NOT_TITLE_RE.search(c)


TITLE_LABELS = ('제목', '규정명', '법규명')


def _label_values(soup):
    """'제목 | 학교법인청석학원정관 [개정]'처럼 표의 이름 칸 옆 값을 찾는다."""
    out = []
    for cell in soup.find_all(['th', 'td', 'dt', 'span', 'strong', 'label']):
        if re.sub(r'\s+', '', cell.get_text()) in TITLE_LABELS:
            nxt = cell.find_next_sibling(['td', 'dd', 'span', 'div'])
            if nxt:
                out.append(nxt.get_text(' ', strip=True))
    return out


SCRIPT_TITLE_RE = re.compile(r"(?:law_?nm|law_?name|lawTitle|rule_?nm|title)\s*[=:]\s*['\"]([^'\"\n]{2,60})['\"]", re.I)


def _lines_before_article(text):
    head = (text or '').split('\n')
    first_art = next((i for i, l in enumerate(head) if ART_LINE_RE.match(l)), 0)
    return list(reversed(head[:first_art]))  # 제1조에 가까운 줄부터


def title_candidates(soup, text, hint='', page_text=''):
    """규정명 후보를 믿을 만한 순서대로 [(구분, 후보)] 로 돌려준다."""
    c = [('표 제목칸', v) for v in _label_values(soup)]
    for el in soup.find_all(attrs={'class': re.compile(r'(law|rule|reg|kyu).?(name|title|nm|tit)', re.I)}):
        c.append(('규정명 요소', el.get_text(' ', strip=True)))
    for el in soup.find_all(attrs={'id': re.compile(r'(law|rule|reg|kyu).?(name|title|nm|tit)', re.I)}):
        c.append(('규정명 요소', el.get_text(' ', strip=True)))
    if hint:
        c.append(('목록 링크', hint))
    c += [('본문 앞줄', l) for l in _lines_before_article(text)]
    c += [('페이지 앞줄', l) for l in _lines_before_article(page_text)]
    c += [('머리글', h.get_text(' ', strip=True)) for h in soup.find_all(['h1', 'h2', 'h3', 'h4', 'strong', 'b'])]
    for sc in soup.find_all('script'):
        c += [('스크립트', m.group(1)) for m in SCRIPT_TITLE_RE.finditer(sc.get_text())]
    # 화면 글자가 아닌 곳(숨은 입력값, 버튼의 onclick 인자, 스크립트 문자열)에 규정명이 있는 경우
    for inp in soup.find_all('input'):
        if inp.get('value'):
            c.append(('입력값', inp['value']))
    for el in soup.find_all(True):
        for k, v in el.attrs.items():
            if k in ('onclick', 'href', 'title', 'alt', 'data-title', 'data-name') and isinstance(v, str):
                c += [('속성 ' + k, m) for m in re.findall(r"['\"]([^'\"\n]{2,60})['\"]", v)] + ([('속성 ' + k, v)] if k in ('title', 'alt', 'data-title', 'data-name') else [])
    for sc in soup.find_all('script'):
        c += [('스크립트 문자열', m) for m in re.findall(r"['\"]([^'\"\n<>]{2,60})['\"]", sc.get_text())]
    if soup.title:
        c.append(('<title>', re.split(r'\s*[-|:]\s*', soup.title.get_text(strip=True))[0]))
    return [(k, _clean(v)) for k, v in c if _clean(v)]


def guess_title(soup, text, hint='', page_text=''):
    cands = title_candidates(soup, text, hint, page_text)
    # 목록 링크·바깥 화면에서 받은 규정명이 이름 꼴이면 가장 믿는다.
    if hint and _plausible(_clean(hint)) and TITLE_SUFFIX_RE.search(_clean(hint)):
        return _clean(hint)
    # 1순위: 규정 이름 꼴(…규정/학칙/정관 등)로 끝나는 후보
    for _, v in cands:
        if _plausible(v) and TITLE_SUFFIX_RE.search(v):
            return v
    # 2순위: 표 제목칸·규정명 요소·목록 링크는 이름 꼴이 아니어도 믿는다
    for k, v in cands:
        if k in ('표 제목칸', '규정명 요소', '목록 링크') and _plausible(v):
            return v
    return ''


# 왼쪽 메뉴의 편 이름 (규정 화면에는 "[제3편]"처럼 번호만 나온다)
PART_NAMES = {
    1: '학교법인', 2: '학칙 및 학위수여 규정', 3: '일반행정', 4: '교무행정', 5: '학생행정', 6: '부속기관',
    7: '부설연구기관', 8: '각종위원회', 9: '대학원', 10: '기타', 11: '부록',
}


def outer_info(html):
    """규정 보기 화면 바깥쪽(본문 iframe을 감싼 페이지)에 있는 규정명과 편 번호."""
    page_text = html_to_text(BeautifulSoup(html, 'html.parser'))
    title, cat, after_part = '', '', ''
    lines = [l.strip() for l in page_text.split('\n') if l.strip()][:80]
    for i, raw in enumerate(lines):
        m = re.match(r'^\[?\s*제\s*(\d+)\s*편\s*\]?$', raw)
        if m and not cat:
            n = int(m.group(1))
            cat = f'제{n}편' + (f' {PART_NAMES[n]}' if n in PART_NAMES else '')
            # 화면 구조상 "[제3편]" 바로 다음 줄이 규정명이다.
            if i + 1 < len(lines) and _plausible(_clean(lines[i + 1])):
                after_part = _clean(lines[i + 1])
            continue
        c = _clean(raw)
        if not title and _plausible(c) and TITLE_SUFFIX_RE.search(c):
            title = c
    return after_part or title, cat


HEADING_LINE_RE = re.compile(r'^\s*(제\s*\d+\s*(조|장|절|관|편)(\s*의\s*\d+)?\s*(\([^)]*\))?\s*$|부\s*칙|내용\s*보기|별표|별지|.*\.(hwp|hwpx|pdf|docx?)$)')


def body_score(text):
    """조 제목만 늘어놓은 목차가 아니라 실제 조문 글이 얼마나 있는지(글자 수)."""
    return sum(len(l.strip()) for l in (text or '').split('\n') if l.strip() and not HEADING_LINE_RE.match(l))


ATTACH_NAME_RE = re.compile(r'\.(hwp|hwpx|pdf|docx?|xlsx?|zip)\s*$', re.I)
JS_PATH_RE = re.compile(r"""['"]((?:https?://|/)[^'"\s]+)['"]""")


def find_attachments(soup, page_url):
    """별표·서식 파일 링크 → [{'name', 'url'?, 'link'?}].
    href가 주소면 url로, 자바스크립트(onclick 등)면 원문을 link에 남긴다(받기 주소 형식 확인용)."""
    out = []
    for el in soup.find_all(True):
        name = _clean(el.get_text(' ', strip=True))
        if not name or len(name) > 120 or not ATTACH_NAME_RE.search(name):
            continue
        if el.find(lambda c: c is not el and ATTACH_NAME_RE.search(_clean(c.get_text(' ', strip=True)) or '')):
            continue  # 안쪽 요소에서 처리
        a = el if el.name == 'a' else el.find_parent('a') or el
        if not a.get('href') and not a.get('onclick'):
            a = next((p for p in [a] + list(a.parents)[:3] if p.get('onclick')), a)
        href = (a.get('href') or '').strip()
        js = ' '.join(v for v in (a.get('onclick'), href if href.lower().startswith('javascript') else '') if v).strip()
        item = {'name': name}
        if href and not href.lower().startswith(('javascript', '#')):
            item['url'] = urljoin(page_url, href)
        elif js:
            m = JS_PATH_RE.search(js)
            if m:
                item['url'] = urljoin(page_url, m.group(1))
            item['link'] = js[:300]
        out.append(item)
    return out


def merge_attachments(*lists):
    seen = {}
    for lst in lists:
        for a in lst or []:
            k = re.sub(r'\s+', '', a['name'])
            if k not in seen:
                seen[k] = dict(a)
            else:
                for key in ('url', 'link'):
                    if a.get(key) and not seen[k].get(key):
                        seen[k][key] = a[key]
    return list(seen.values())


def extract_rule(client, html, url, hint_title='', depth=0, category='', trace=None):
    """규정 보기 페이지 HTML → {title, category, text}.
    본문이 iframe에 있으면 모든 iframe을 따라가, 조 제목만 있는 목차가 아니라
    조문 글이 가장 많은 페이지를 본문으로 고른다."""
    soup = BeautifulSoup(html, 'html.parser')
    node, n = content_node(soup)
    o_title, o_cat = outer_info(html)
    category = category or o_cat
    hint = hint_title or o_title
    results = []
    attachments = find_attachments(soup, url)
    if n:
        page_text = html_to_text(BeautifulSoup(html, 'html.parser'))
        text = html_to_text(node)
        title = guess_title(BeautifulSoup(html, 'html.parser'), text, hint, page_text)
        results.append({'title': title, 'text_title': title_from_text(text), 'text': text, 'category': category})
    if trace is not None:
        trace.append((depth, url, n, body_score(results[0]['text']) if results else 0, html))
    if depth < 2 and client is not None:
        for fr in soup.find_all(['iframe', 'frame']):
            src = fr.get('src')
            if not src or src.startswith(('javascript', 'about:')) or not client.same_host(src):
                continue
            r = client.get(urljoin(url, src))
            if r is not None and r.ok:
                got = extract_rule(client, r.text, r.url, hint, depth + 1, category, trace)
                if got:
                    results.append(got)
                    attachments = merge_attachments(attachments, got.get('attachments'))
    if results:
        best = max(results, key=lambda g: (body_score(g['text']), len(g['text'])))
        if not best['title'] and hint:
            best['title'] = hint
        best['attachments'] = merge_attachments(attachments, best.get('attachments'))
        return best
    got = extract_without_articles(html, hint)
    if got:
        got['category'] = category
        got['attachments'] = attachments
    return got


def extract_without_articles(html, hint_title=''):
    """조문(제N조) 형식이 아닌 규정(번호 목록으로 된 요령·기준 등)은 규정명 줄 아래 글 전체를 본문으로 쓴다."""
    page_text = html_to_text(BeautifulSoup(html, 'html.parser'))
    title = guess_title(BeautifulSoup(html, 'html.parser'), '', hint_title, '')
    lines = page_text.split('\n')
    if not title or not TITLE_SUFFIX_RE.search(title):
        title = next((_clean(l) for l in lines if _plausible(_clean(l)) and TITLE_SUFFIX_RE.search(_clean(l))), '')
    if not title:
        return None
    start = next((i for i, l in enumerate(lines) if _clean(l) == title), None)
    if start is None:
        return None
    body = '\n'.join(lines[start + 1:]).strip()
    if len(re.sub(r'\s', '', body)) < 200:
        return None
    return {'title': title, 'text_title': '', 'text': body, 'no_articles': True}


def title_from_text(text, loose=False):
    """본문에서 제1조 앞에 있는 규정명 줄을 찾는다. loose면 이름 꼴이 아니어도 첫 후보를 쓴다."""
    head = text.split('\n')
    first_art = next((i for i, l in enumerate(head) if ART_LINE_RE.match(l)), len(head))
    cands = [_clean(l) for l in head[:first_art]]
    for c in reversed(cands):
        if _plausible(c) and TITLE_SUFFIX_RE.search(c):
            return c
    if loose:
        return next((c for c in cands if _plausible(c)), '')
    return ''


def discover(client, max_pages):
    """메인·목록 페이지를 따라가며 SEQ 번호와 (가능하면) 규정명·분류를 모은다."""
    found = {}
    seen = set()
    q = deque([START_PATH])
    while q and len(seen) < max_pages:
        path = q.popleft()
        if path in seen:
            continue
        seen.add(path)
        r = client.get(path)
        if r is None or not r.ok or 'html' not in r.headers.get('Content-Type', 'html'):
            continue
        log(f'  목록 탐색: {path}')
        soup = BeautifulSoup(r.text, 'html.parser')
        category = ''
        for el in soup.find_all(True):
            own = el.find(string=True, recursive=False)
            if own and CATEGORY_RE.match(own.strip()):
                category = own.strip()
            attrs = ' '.join(str(v) for k, v in el.attrs.items() if k in ('href', 'onclick', 'data-seq', 'value'))
            for rx in SEQ_RES:
                for m in rx.finditer(attrs):
                    seq = int(m.group(1))
                    label = el.get_text(' ', strip=True)
                    if seq not in found or (not found[seq]['title'] and label):
                        found[seq] = {'title': label if 0 < len(label) <= 60 else '', 'category': category}
            href = el.get('href') if el.name == 'a' else None
            if href and not href.startswith(('javascript', '#', 'mailto')) and client.same_host(href):
                p = urlparse(urljoin(r.url, href))
                nxt = p.path + ('?' + p.query if p.query else '')
                if p.path.startswith('/lmxsrv/') and not re.search(r'SEQ=', p.query, re.I) and \
                        not re.search(r'\.(hwp|pdf|zip|doc|xls|jpg|png|gif)$', p.path, re.I):
                    q.append(nxt)
        for script in soup.find_all('script'):
            for rx in SEQ_RES[1:]:
                for m in rx.finditer(script.get_text()):
                    found.setdefault(int(m.group(1)), {'title': '', 'category': ''})
    return found


def detect_viewer(client, seqs, forced):
    if forced:
        return forced, 0
    # 목록에서 찾은 번호가 없으면 앞 번호와 듬성듬성한 번호를 시험한다.
    probe = sorted(seqs)[:5] or list(range(1, 30)) + list(range(30, 1001, 10))
    for tpl in VIEWER_TEMPLATES:
        for seq in probe:
            r = client.get(tpl.format(seq=seq))
            if r is not None and r.ok and extract_rule(client, r.text, r.url):
                log(f'  규정 보기 주소 형식: {tpl}')
                return tpl, seq
    return None, 0


def parse_range(s):
    a, _, b = s.partition('-')
    return range(int(a), int(b or a) + 1)


def crawl(args):
    client = Client(args.base, args.delay, verify=not args.insecure)
    log(f'[1/3] 규정 목록 탐색: {args.base}{START_PATH}')
    found = {} if args.no_discover else discover(client, args.max_pages)
    log(f'  → 목록에서 찾은 SEQ {len(found)}개')

    log('[2/3] 규정 보기 주소 형식 확인')
    tpl, first_seq = detect_viewer(client, found.keys(), args.viewer)
    if not tpl:
        sys.exit('규정 보기 주소를 찾지 못했습니다. 브라우저에서 규정 하나를 연 뒤 주소창의 형식을 '
                 '--viewer "/lmxsrv/law/....srv?SEQ={seq}" 로 지정해 주세요.')

    if args.scan:
        seqs = list(parse_range(args.scan))
        last_known = 0
    else:
        # 목록 화면에는 일부 규정만 보이는 경우가 많으므로, 찾은 번호와 관계없이
        # 1번부터 차례로 시도하고 마지막으로 확인된 번호 뒤로 빈 번호가 --max-miss 회
        # 이어지면 멈춘다.
        seqs = None
        last_known = max([first_seq] + list(found))

    log('[3/3] 규정 전문 수집' + ('' if args.scan else f' (SEQ 1번부터, {last_known}번 이후 빈 번호 {args.max_miss}회 연속이면 종료)'))
    pages, misses, seq, tried = [], 0, 0, 0
    it = iter(seqs) if seqs is not None else None
    try:
        while True:
            if it is not None:
                seq = next(it, None)
                if seq is None:
                    break
            else:
                seq += 1
                if misses >= args.max_miss and seq > last_known:
                    break
            tried += 1
            if tried % 100 == 0:
                log(f'  … SEQ {seq}까지 확인, 규정 페이지 {len(pages)}개')
            url = urljoin(client.base + '/', tpl.format(seq=seq))
            r = client.get(url)
            got = extract_rule(client, r.text, r.url, found.get(seq, {}).get('title', '')) if r is not None and r.ok else None
            if not got:
                misses += 1
                continue
            misses = 0
            last_known = max(last_known, seq)
            got.update(seq=seq, url=url, category=got.get('category') or found.get(seq, {}).get('category', ''))
            pages.append(got)
            log(f'  [{len(pages):>4}] SEQ {seq}: {got["title"] or got["text_title"] or "(규정명 미확인)"}'
                + (' ※ 조문 형식 아님(본문 전체 저장)' if got.get('no_articles') else '')
                + (' ※ 조 제목만 있고 조문 글 없음' if not got.get('no_articles') and body_score(got['text']) < 50 else ''))
            if args.limit and len(pages) >= args.limit:
                break
    except KeyboardInterrupt:
        log(f'\n  중단됨(Ctrl+C) — SEQ {seq}까지 받은 규정 {len(pages)}개를 저장합니다.')
    return finalize(pages)


def finalize(pages):
    """페이지 목록 → 규정 목록. 같은 본문만 중복으로 보고, 이름이 겹치면 SEQ를 붙여 구분한다."""
    seen_text = set()
    kept = []
    for p in sorted(pages, key=lambda p: p.get('seq') or 0):
        if p['text'] in seen_text:
            continue
        seen_text.add(p['text'])
        p['title'] = p['title'] or p.get('text_title') or (f"규정(SEQ {p['seq']})" if p.get('seq') else '(제목 없음)')
        kept.append(p)
    count = {}
    for p in kept:
        k = re.sub(r'\s+', '', p['title'])
        count[k] = count.get(k, 0) + 1
    for p in kept:
        if count[re.sub(r'\s+', '', p['title'])] > 1 and p.get('seq'):
            p['title'] = f"{p['title']} (SEQ {p['seq']})"

    rules = []
    for i, p in enumerate(kept, 1):
        text = p['text']
        # 본문 맨 앞에 규정명이 없으면 붙여 둔다(앱의 파서가 첫 줄을 제목 후보로 쓴다).
        if not text.lstrip().startswith(p['title']):
            text = p['title'] + '\n' + text
        rules.append({
            'id': f"seq{p['seq']}" if p.get('seq') else f'f{i}',
            'seq': p.get('seq'),
            'title': p['title'],
            'category': p.get('category', ''),
            'url': p.get('url', ''),
            'text': text,
        })
        if p.get('no_articles'):
            rules[-1]['noArticles'] = True
        if p.get('attachments'):
            rules[-1]['attachments'] = p['attachments']
    log(f'  → 규정 페이지 {len(pages)}개 중 중복 제외 {len(rules)}건'
        + (f" (조문 형식이 아닌 규정 {sum(1 for r in rules if r.get('noArticles'))}건 포함)" if any(r.get('noArticles') for r in rules) else ''))
    return rules


def from_dir(path):
    pages = []
    for root, _, files in os.walk(path):
        for fn in sorted(files):
            fp = os.path.join(root, fn)
            ext = fn.lower().rsplit('.', 1)[-1]
            if ext not in ('html', 'htm', 'txt'):
                continue
            raw = open(fp, 'rb').read()
            for enc in ('utf-8', 'cp949'):
                try:
                    content = raw.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                content = raw.decode('utf-8', 'replace')
            if ext == 'txt':
                got = {'title': '', 'text_title': title_from_text(content), 'text': content} if ART_LINE_RE.search(content) else None
            else:
                got = extract_rule(None, content, fp, os.path.splitext(fn)[0])
            if not got or not (got['title'] or got['text_title']):
                log(f'  - 건너뜀(조문 없음): {fp}')
                continue
            pages.append(got)
            log(f'  [{len(pages):>4}] {got["title"] or got["text_title"]}')
    return finalize(pages)


def debug_page(args):
    client = Client(args.base, 0, verify=not args.insecure)
    tpl = args.viewer or VIEWER_TEMPLATES[0]
    r = client.get(tpl.format(seq=args.debug))
    if r is None:
        sys.exit('페이지를 받지 못했습니다.')
    print(f'주소: {r.url}  상태: {r.status_code}  인코딩: {r.encoding}')
    o_title, o_cat = outer_info(r.text)
    print(f'바깥 페이지 규정명: {o_title or "(없음)"}  /  편: {o_cat or "(없음)"}')
    trace = []
    got = extract_rule(client, r.text, r.url, trace=trace)
    print('--- 받은 페이지 (깊이, 조문 머리 수, 조문 글자 수, 주소) ---')
    for i, (depth, url, n, score, html) in enumerate(trace):
        out = f'debug_{args.debug}_{i}.html'
        with open(out, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f'  [{i}] 깊이 {depth}  조문머리 {n:>3}  조문글자 {score:>6}  {url}  → {out}')
    print('--- 수집 결과 ---')
    if not got:
        print('규정으로 인식하지 못함')
    else:
        print(f'규정명: {got["title"] or "(없음)"}  /  분류: {got.get("category") or "(없음)"}  /  조문 글자 수: {body_score(got["text"])}'
              + ('  /  조문 형식 아님' if got.get('no_articles') else ''))
        print('\n'.join([l for l in got['text'].split('\n') if l.strip()][:12]))
        print(f'--- 별표·서식 {len(got.get("attachments") or [])}개 ---')
        for a in (got.get('attachments') or [])[:10]:
            print(f"  {a['name']}  주소: {a.get('url') or '(없음)'}" + (f"  링크: {a['link']}" if a.get('link') else ''))


def main():
    ap = argparse.ArgumentParser(description='청주대학교 규정관리시스템 규정 전문 수집기')
    ap.add_argument('--base', default=DEFAULT_BASE, help='규정관리시스템 주소 (기본: %(default)s)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'rules.json'),
                    help='저장할 JSON 경로 (기본: rules/data/rules.json)')
    ap.add_argument('--viewer', help='규정 보기 주소 형식. 예: "/lmxsrv/law/lawFullView.srv?SEQ={seq}"')
    ap.add_argument('--scan', help='수집할 SEQ 범위. 예: 1-2000')
    ap.add_argument('--no-discover', action='store_true', help='목록 탐색을 건너뛰고 SEQ 스캔만')
    ap.add_argument('--max-pages', type=int, default=200, help='목록 탐색 최대 페이지 수')
    ap.add_argument('--max-miss', type=int, default=300, help='범위 미지정 스캔 시 연속 실패 허용 횟수')
    ap.add_argument('--limit', type=int, default=0, help='최대 수집 규정 수 (시험용)')
    ap.add_argument('--delay', type=float, default=0.5, help='요청 간 대기(초)')
    ap.add_argument('--insecure', action='store_true', help='서버 인증서 검증 생략 (인증서 오류가 날 때만)')
    ap.add_argument('--debug', type=int, metavar='SEQ', help='해당 SEQ 페이지의 규정명 후보와 본문 앞부분만 출력 (문제 확인용)')
    ap.add_argument('--from-dir', help='브라우저로 저장한 규정 HTML/TXT 파일 폴더에서 추출')
    args = ap.parse_args()

    if args.debug:
        return debug_page(args)

    if args.from_dir:
        rules = from_dir(args.from_dir)
        source = f'저장한 파일 ({os.path.basename(os.path.abspath(args.from_dir))})'
    else:
        rules = crawl(args)
        source = f'{args.base}{START_PATH}'

    if not rules:
        sys.exit('수집된 규정이 없습니다. --viewer, --scan 옵션 또는 --from-dir 방식을 시도해 주세요.')

    rules.sort(key=lambda r: (r['category'], r['title']))
    data = {
        'source': source,
        'fetchedAt': dt.datetime.now().astimezone().isoformat(timespec='seconds'),
        'rules': rules,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    log(f'완료: 규정 {len(rules)}건 → {os.path.abspath(args.out)}')
    if len(rules) < 30 and not args.from_dir and not args.limit:
        log('※ 수집된 규정이 예상보다 적습니다. 브라우저로 규정 하나를 열어 주소창의 SEQ 번호를 확인한 뒤\n'
            '  --scan 1-5000 처럼 범위를 넓히거나, 그 주소 형식을 --viewer 로 지정해 다시 실행해 보세요.')


if __name__ == '__main__':
    main()
