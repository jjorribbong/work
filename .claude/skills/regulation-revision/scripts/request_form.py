"""개정요청서 + 신·구조문 대비표 hwpx 작성 (양식 파일의 서식을 그대로 쓰고 내용만 채움).

양식: regulation/templates/개정요청서_신구대비표_양식_직원보수규정예시.hwpx
 - section0: [요청서 표 11행×4열] + 제목 문단 '「규정명」 신·구조문 대비표' + [대비표 2열]
 - section1: 별표 대비용 가로 쪽 (keep_annex_page=False 이면 삭제)

    from request_form import build
    build(template, out, name='직원보수규정', request={...}, rows=[...])

rows: 대비표 행 목록. 한 행 = (왼쪽 문단들, 오른쪽 문단들), 문단 = [(글자, 표시여부), ...]
      표시여부 True 인 글자는 '진하게+밑줄'(양식 charPr 24)로 바뀐 부분 표시.
compare_rows(old_block, new_block, ...) 로 원문/개정문 블록에서 rows 를 자동 생성한다.
"""
import re, copy, difflib, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from hwpx_patch import Doc, Q, NS, ptext, set_ptext, norm, drop_lineseg
from lxml import etree

CP_NORMAL, CP_MARK = '20', '24'          # 양식의 본문 10pt / 진하게+밑줄 10pt
HIST = [re.compile(r'\((?:신설|변경|본조전문변경)\s*2026\.\s*○\.\s*○\.\)'),
        re.compile(r',\s*(?:변경\s*)?2026\.\s*○\.\s*○\.')]
TOKEN = re.compile(r'^\s*((?:제\d+조(?:의\d+)?\s*(?:\([^)]*\))?\s*)?(?:[①-⑳]|\d+\.|[가-하]\.)?)')


def strip_hist(s):
    for r in HIST: s = r.sub('', s)
    return s


def token(s):
    m = TOKEN.match(s); return (m.group(1) or '').strip()


def mark_diff(a, b):
    """a→b 단어 단위 비교. (왼쪽 segs, 오른쪽 segs, b 의 첫 변경 위치). 대부분 바뀌면 번호 뒤 전체를 표시."""
    ta, tb = re.findall(r'\S+|\s+', a), re.findall(r'\S+|\s+', b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    L, R, first, pos, nchg, chg_len = [], [], None, 0, 0, 0
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        sa, sb = ''.join(ta[i1:i2]), ''.join(tb[j1:j2])
        if op == 'equal':
            L.append((sa, False)); R.append((sb, False))
        else:
            if sa: L.append((sa, True))
            if sb: R.append((sb, True))
            if first is None: first = pos
            nchg += 1; chg_len += len(sb)
        pos += len(sb)
    if first is None:
        return [(a, False)], [(b, False)], None
    if nchg > 3 or chg_len > 0.6 * max(len(b), 1):
        ka, kb = len(token(a)), len(token(b))
        return [(a[:ka], False), (a[ka:], True)], [(b[:kb], False), (b[kb:], True)], kb
    def merge(segs):
        out = []
        for t, m in segs:
            if out and out[-1][1] == m: out[-1] = (out[-1][0] + t, m)
            else: out.append((t, m))
        return out
    return merge(L), merge(R), first


def abbreviate(new, segs, first):
    """개정안 칸: 앞부분이 현행과 같으면 '번호 -------' 로 줄인다(정관 예시 방식)."""
    tok = token(new)
    if first is None or first < len(tok) + 20: return segs
    cut = new.rfind(' ', 0, first)
    while cut > len(tok) and new[cut + 1:].count(')') > new[cut + 1:].count('('):
        op = new.rfind('(', 0, cut)
        cut = new.rfind(' ', 0, op) if op > 0 else -1
    if cut <= len(tok): return segs
    out, pos = [((tok + ' ' if tok else '') + '-' * 12 + ' ', False)], 0
    for t, m in segs:
        end = pos + len(t)
        if end > cut + 1:
            out.append((t[max(0, cut + 1 - pos):], m))
        pos = end
    return out


def compare_rows(old, new, article_prefix_rows=True, context_heading=None, seen=None):
    """원문 블록 / 개정문 블록(줄=문단) → 대비표 rows. 바뀐 조에 속한 줄만 싣는다."""
    ol = [l for l in old.split('\n') if l.strip()]
    nl = [x for x in (strip_hist(l) for l in new.split('\n') if l.strip()) if x.strip()]
    sm = difflib.SequenceMatcher(None, [norm(x) for x in ol], [norm(x) for x in nl], autojunk=False)
    items = []                                   # (kind, old, new)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal':
            items += [('eq', ol[i], nl[j]) for i, j in zip(range(i1, i2), range(j1, j2))]; continue
        olds, news, pairs, js = list(range(i1, i2)), list(range(j1, j2)), {}, 0
        for i in olds:
            best, bj = 0.35, None
            for j in news[js:]:
                r = difflib.SequenceMatcher(None, norm(ol[i]), norm(nl[j])).ratio()
                if r > best: best, bj = r, j
            if bj is not None: pairs[i] = bj; js = news.index(bj) + 1
        jp = j1
        for i in olds:
            if i in pairs:
                items += [('ins', None, nl[j]) for j in range(jp, pairs[i])]
                items.append(('chg', ol[i], nl[pairs[i]])); jp = pairs[i] + 1
            else:
                items.append(('del', ol[i], None))
        items += [('ins', None, nl[j]) for j in range(jp, j2)]
    # 조 단위 소속 판정
    # 삭제 바로 뒤 같은 번호 신설 → 한 행(통째 변경)으로
    merged = []
    for it in items:
        if merged and merged[-1][0] == 'del' and it[0] == 'ins' and token(merged[-1][1]) == token(it[2]):
            merged[-1] = ('chg', merged[-1][1], it[2])
        else:
            merged.append(it)
    items = merged
    heads = {}
    if context_heading:
        m0 = re.match(r'^\s*(제\d+조(?:의\d+)?)\s*(\([^)]*\))?', context_heading)
        heads[m0.group(1)] = (m0.group(1) + ' ' + (m0.group(2) or '')).strip()
    art, arts, changed = (re.match(r'^\s*(제\d+조(?:의\d+)?)', context_heading).group(1) if context_heading else None), [], set()
    for k, o, n in items:
        s = (o or n)
        m = re.match(r'^\s*(제\d+조(?:의\d+)?)\s*(\([^)]*\))?', s)
        if m: art = m.group(1); heads.setdefault(art, (m.group(1) + ' ' + (m.group(2) or '')).strip())
        if re.match(r'^\s*제\d+장', s): art = None
        arts.append(art)
        if k != 'eq': changed.add(art)
    in_block = {a for (k, o, n), a in zip(items, arts) if a and re.match(r'^\s*' + a + r'(?!\d|의)', o or n or '')}
    rows = []
    seen = set() if seen is None else seen      # 문서 전체에서 이미 머리 행을 낸 조
    for (k, o, n), a in zip(items, arts):
        if k == 'eq' and (a not in changed or a not in in_block or not token(o)): continue
        if a and a not in seen and article_prefix_rows:
            seen.add(a)
            s = (o or n)
            if a not in in_block and not re.match(r'^\s*' + a, s):     # 조 중간부터 바뀜 → 조 머리 생략 표시
                h = heads.get(a, a)
                rows.append(([[(h + ' (생 략)', False)]], [[(h + ' (현행과 같음)', False)]]))
        if k == 'eq':
            t = token(o)
            rows.append(([[(o.strip(), False)]], [[((t + ' ' if t else '') + '(현행과 같음)', False)]]))
        elif k == 'chg':
            L, R, first = mark_diff(o.strip(), n.strip())
            if first is None:                     # 이력 표시만 다름
                t = token(o); rows.append(([[(o.strip(), False)]], [[((t + ' ' if t else '') + '(현행과 같음)', False)]])); continue
            rows.append(([L], [abbreviate(n.strip(), R, first)]))
        elif k == 'ins':
            t = token(n)
            left = (t + ' <신 설>') if t and not re.match(r'^\s*제\d+조', n) else '<신 설>'
            rows.append(([[(left, False)]], [[(n.strip(), True)]]))
        else:
            t = token(o)
            rows.append(([[(o.strip(), True)]], [[((t + ' ' if t else '') + '<삭 제>', False)]]))
    return rows


def _fill_cell(tc, paras, tmpl_p):
    sub = tc.find('hp:subList', NS)
    for p in sub.findall('hp:p', NS): sub.remove(p)
    for segs in paras or [[('', False)]]:
        p = copy.deepcopy(tmpl_p)
        for r in p.findall('hp:run', NS): p.remove(r)
        drop_lineseg(p)
        for text, mark in segs or [('', False)]:
            r = etree.SubElement(p, Q('run')); r.set('charPrIDRef', CP_MARK if mark else CP_NORMAL)
            t = etree.SubElement(r, Q('t')); t.text = text
        sub.append(p)


def build(template, out, name, request, rows, keep_annex_page=False):
    d = Doc.from_hwpx(template)
    s0 = d.roots['Contents/section0.xml']
    tbls = [t for t in s0.iter(Q('tbl'))]
    req, cmp_ = tbls[0], tbls[1]

    # ---- 요청서
    def cell(r, c):
        for tc in req.iter(Q('tc')):
            a = tc.find('hp:cellAddr', NS)
            if int(a.get('rowAddr')) == r and int(a.get('colAddr')) == c: return tc
    def set_lines(r, c, lines):
        tc = cell(r, c); sub = tc.find('hp:subList', NS); ps = sub.findall('hp:p', NS)
        tmpl = next((p for p in ps if norm(ptext(p))), ps[0])
        for p in ps: sub.remove(p)
        for line in lines:
            q = copy.deepcopy(tmpl); set_ptext(q, line); sub.append(q)
    set_lines(1, 1, [f'「{name}」'])
    kinds = {'제정': (2, 1), '개정': (2, 2), '폐지': (2, 3)}
    for k, (r, c) in kinds.items():
        set_lines(r, c, [('■ ' if k == request.get('구분', '개정') else '□ ') + ' '.join(k)])
    set_lines(3, 1, [request['주무부서']]); set_lines(4, 1, [request['관련부서']])
    for row, key in ((5, '개정사유'), (6, '관련근거'), (7, '주요내용'), (8, '기대효과'), (9, '의견수렴'), (10, '첨부')):
        v = request.get(key) or ['-']
        set_lines(row, 1, [('• ' + x) if x != '-' else x for x in v])

    # ---- 제목
    title = next(p for p in s0.findall('hp:p', NS) if '대비표' in ptext(p))
    runs = [r for r in title.findall('hp:run', NS) if r.find('hp:t', NS) is not None]
    runs[0].find('hp:t', NS).text = f'「{name}」'
    for r in runs[1:]:
        for t in r.findall('hp:t', NS): t.text = ''
    runs[-1].find('hp:t', NS).text = ' 신·구조문 대비표'
    drop_lineseg(title)

    # ---- 대비표 행
    trs = cmp_.findall('hp:tr', NS)
    row_t = copy.deepcopy(trs[1])
    tmpl_p = copy.deepcopy(row_t.findall('hp:tc', NS)[1].find('hp:subList/hp:p', NS))
    for tr in trs[1:]: cmp_.remove(tr)
    for i, (L, R) in enumerate(rows, start=1):
        tr = copy.deepcopy(row_t)
        for tc, paras in zip(tr.findall('hp:tc', NS), (L, R)):
            tc.find('hp:cellAddr', NS).set('rowAddr', str(i))
            tc.find('hp:cellSz', NS).set('height', '1500')
            _fill_cell(tc, paras, tmpl_p)
        cmp_.append(tr)
    cmp_.set('rowCnt', str(len(rows) + 1))
    cmp_.find('hp:sz', NS).set('height', str(1500 * (len(rows) + 1)))

    # ---- 별표 가로 쪽 삭제
    if not keep_annex_page and 'Contents/section1.xml' in d.files:
        d.secs.remove('Contents/section1.xml'); d.roots.pop('Contents/section1.xml'); d.files.pop('Contents/section1.xml')
        hpf = d.files['Contents/content.hpf'].decode()
        hpf = re.sub(r'<opf:item id="section1"[^>]*/>', '', hpf); hpf = re.sub(r'<opf:itemref idref="section1"[^>]*/>', '', hpf)
        d.files['Contents/content.hpf'] = hpf.encode()
        h = d.files['Contents/header.xml'].decode()
        d.files['Contents/header.xml'] = re.sub(r'secCnt="\d+"', 'secCnt="1"', h, count=1).encode()
    d.save(out, preview_text=d.plain()[:1000])
    return out
