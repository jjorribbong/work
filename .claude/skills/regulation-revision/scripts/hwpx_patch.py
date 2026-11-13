"""원본 서식 보존 개정: 규정집 원본(.hwp)을 hwpx로 변환한 뒤 개정되는 문단만 고친다.
표·별표·별지·문단 간격·글자 모양은 원본 그대로 유지된다.

    from hwpx_patch import Doc
    d = Doc.from_hwp('원본.hwp')                 # python-hwpx 로 변환 (pip install python-hwpx)
    d.replace_block(old_text, new_text)          # 연속 문단 블록 치환(줄 = 문단). 추가 줄은 같은 종류 문단을 복제해 삽입
    d.set_cell('표 안 식별 글자', 행, 열, [줄...])  # 표 셀 내용만 교체(셀 크기·테두리 유지)
    d.set_revision_date('변경 2026. ○. ○.')      # 머리의 제정/변경 줄
    d.add_buchik('이 개정 규정은 …부터 시행한다.')  # 마지막 부칙 뒤(별표·별지 앞)에 부칙 추가
    d.save('출력.hwpx')

문단 비교는 공백을 무시한다. old 블록이 문서에서 정확히 1번 나오지 않으면 예외를 낸다.
"""
import re, copy, zipfile, random, difflib, io
from lxml import etree

HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph'
NS = {'hp': HP}
Q = lambda t: f'{{{HP}}}{t}'
norm = lambda s: re.sub(r'\s+', '', s or '')
ART = re.compile(r'^\s*제\s*\d+\s*조(?:의\s*\d+|\d+)?\s*')


def own_runs(p):
    return p.findall('hp:run', NS)


def text_runs(p):
    """hp:t 를 가진(=본문 글자) run 목록. 표·컨트롤만 있는 run 은 제외."""
    return [r for r in own_runs(p) if r.find('hp:t', NS) is not None]


def ptext(p):
    return ''.join(''.join(t.itertext()) for r in own_runs(p) for t in r.findall('hp:t', NS))


def kind(s):
    s = s.strip()
    if ART.match(s): return 'art'
    if re.match(r'^[①-⑳]', s): return 'hang'
    if re.match(r'^\d+\.', s): return 'ho'
    if re.match(r'^[가-하]\.', s): return 'mok'
    if re.fullmatch(r'부\s*칙', s): return 'buchik'
    return 'other'


def set_runs_text(run, text):
    ts = run.findall('hp:t', NS)
    for t in ts[1:]: run.remove(t)
    t = ts[0]
    for c in list(t): t.remove(c)
    t.text = text


def drop_lineseg(p):
    for ls in p.findall('hp:linesegarray', NS): p.remove(ls)


def set_ptext(p, new):
    """문단 글자만 바꾼다. 조 제목 run(진하게 등)과 본문 run 의 글자모양은 유지."""
    runs = text_runs(p)
    if not runs:
        r = etree.SubElement(p, Q('run')); r.set('charPrIDRef', '0'); etree.SubElement(r, Q('t')); runs = [r]
    old = ptext(p)
    m_old, m_new = ART.match(old), ART.match(new)
    first = ''.join(''.join(t.itertext()) for t in runs[0].findall('hp:t', NS))
    if m_new and m_old and len(runs) >= 2 and norm(first) == norm(m_old.group(0)):
        # 첫 run = '제○조 ' 머리 → 머리/나머지로 나눠 넣음
        set_runs_text(runs[0], m_new.group(0)); set_runs_text(runs[1], new[m_new.end():])
        for r in runs[2:]:
            if r.find('hp:t', NS) is not None: p.remove(r)
    else:
        # 공통 앞부분이 끝나는 run 까지 유지하고 나머지 글자는 그 run 에 넣음
        k, acc = 0, 0
        pre = len(__import__('os').path.commonprefix([old, new]))
        for i, r in enumerate(runs):
            seg = ''.join(''.join(t.itertext()) for t in r.findall('hp:t', NS))
            if acc + len(seg) >= pre and (seg or i == len(runs) - 1):
                k = i; break
            acc += len(seg); k = i
        set_runs_text(runs[k], new[acc:])
        for i, r in enumerate(runs):
            if i < k:
                pass
            elif i > k:
                p.remove(r)
    drop_lineseg(p)


class Doc:
    def __init__(self, files):
        self.files = files                          # name -> bytes
        self.secs = sorted(n for n in files if re.match(r'Contents/section\d+\.xml$', n))
        self.roots = {n: etree.fromstring(files[n]) for n in self.secs}

    @classmethod
    def from_hwp(cls, path):
        from hwpx import HwpxDocument
        buf = io.BytesIO(); HwpxDocument.open(path).save_to_stream(buf)
        z = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
        return cls({n: z.read(n) for n in z.namelist()})

    @classmethod
    def from_hwpx(cls, path):
        z = zipfile.ZipFile(path); return cls({n: z.read(n) for n in z.namelist()})

    # ---- 문단 목록 (문서 순서, 글자 있는 문단만)
    def paras(self, include_cells=True):
        out = []
        for n in self.secs:
            for p in self.roots[n].iter(Q('p')):
                if not include_cells and p.getparent().tag == Q('subList'): continue
                if norm(ptext(p)): out.append(p)
        return out

    def _new_id(self, p):
        p.set('id', str(random.randint(10 ** 9, 2 ** 31 - 1)))

    def clone(self, template, text, after):
        q = copy.deepcopy(template)
        for r in own_runs(q):                      # 표·컨트롤 run 은 복제하지 않음
            if r.find('hp:t', NS) is None: q.remove(r)
        q.set('pageBreak', '0'); q.set('columnBreak', '0'); self._new_id(q)
        set_ptext(q, text)
        after.addnext(q)
        return q

    def template_for(self, line, near):
        """삽입할 줄과 같은 종류의 문단을 near 부터 거슬러 올라가며 찾는다."""
        k = kind(line)
        ps = self.paras(include_cells=False)
        idx = ps.index(near) if near in ps else len(ps) - 1
        for p in reversed(ps[:idx + 1]):
            if kind(ptext(p)) == k: return p
        for p in ps[idx + 1:]:
            if kind(ptext(p)) == k: return p
        return near

    # ---- 블록 치환
    def replace_block(self, old, new):
        ol = [l for l in old.split('\n') if l.strip()]
        nl = [l for l in new.split('\n') if l.strip()]
        ps = self.paras()
        keys = [norm(ptext(p)) for p in ps]
        ok = [norm(l) for l in ol]
        hits = [i for i in range(len(ps) - len(ok) + 1) if keys[i:i + len(ok)] == ok]
        if len(hits) != 1:
            raise ValueError(f'원문 블록 일치 {len(hits)}회: {ol[0][:50]}')
        blk = ps[hits[0]:hits[0] + len(ok)]
        sm = difflib.SequenceMatcher(None, ok, [norm(l) for l in nl], autojunk=False)
        last = None                                 # 마지막으로 처리된(남아 있는) 문단
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == 'equal':
                last = blk[i2 - 1]; continue
            olds, news = list(range(i1, i2)), list(range(j1, j2))
            # 옛 줄마다 가장 비슷한 새 줄을 순서대로 짝지음
            pairs, jstart = {}, 0
            for i in olds:
                best, bj = 0.35, None
                for j in news[jstart:]:
                    r = difflib.SequenceMatcher(None, ok[i], norm(nl[j])).ratio()
                    if r > best: best, bj = r, j
                if bj is not None:
                    pairs[i] = bj; jstart = news.index(bj) + 1
            jp = j1
            for i in olds:
                p = blk[i]
                if i in pairs:
                    j = pairs[i]
                    anchor = last if last is not None else None
                    for jj in range(jp, j):          # 짝 앞에 끼어드는 새 줄 → p 앞에 삽입
                        t = self.template_for(nl[jj], p)
                        if anchor is None:
                            q = self.clone(t, nl[jj], p); p.addprevious(q)
                        else:
                            q = self.clone(t, nl[jj], anchor)
                        anchor = q
                    set_ptext(p, nl[j]); last = p; jp = j + 1
                else:
                    p.getparent().remove(p)
            anchor = last if last is not None else blk[0]
            for jj in range(jp, j2):
                t = self.template_for(nl[jj], anchor)
                anchor = self.clone(t, nl[jj], anchor); last = anchor

    # ---- 표 셀
    def set_cell(self, table_has, row, col, lines):
        tbls = [t for n in self.secs for t in self.roots[n].iter(Q('tbl'))
                if norm(table_has) in norm(''.join(ptext(p) for p in t.iter(Q('p'))))]
        # 표 안에 표가 있으면(바깥 틀 표) 가장 안쪽 표를 고른다
        tbls = [t for t in tbls if not any(u in tbls for u in t.iter(Q('tbl')) if u is not t)]
        if len(tbls) != 1: raise ValueError(f'표 일치 {len(tbls)}개: {table_has}')
        for tc in tbls[0].iter(Q('tc')):
            a = tc.find('hp:cellAddr', NS)
            if int(a.get('rowAddr')) == row and int(a.get('colAddr')) == col:
                sub = tc.find('hp:subList', NS); ps = sub.findall('hp:p', NS)
                for i, line in enumerate(lines):
                    if i < len(ps): set_ptext(ps[i], line)
                    else: ps.append(self.clone(ps[-1], line, ps[-1]))
                for p in ps[len(lines):]: sub.remove(p)
                return
        raise ValueError(f'셀 없음 {row},{col}')

    # ---- 머리 변경일
    def set_revision_date(self, line):
        top = self.paras(include_cells=False)[:8]
        for p in top:
            if re.match(r'^\s*(변경|개정)\s*\d{4}', ptext(p)):
                set_ptext(p, re.match(r'^\s*', ptext(p)).group(0) + line); return
        for p in top:
            if re.match(r'^\s*제정\s*\d{4}', ptext(p)):
                self.clone(p, re.match(r'^\s*', ptext(p)).group(0) + line, p); return
        raise ValueError('제정/변경 줄 없음')

    # ---- 부칙 추가
    def add_buchik(self, sentence):
        ps = self.paras(include_cells=False)
        annex = next((i for i, p in enumerate(ps) if re.match(r'^\s*[【\[<]\s*(별표|별지)', ptext(p))), len(ps))
        heads = [i for i in range(annex) if kind(ptext(ps[i])) == 'buchik']
        h = ps[heads[-1]]
        body = [p for p in ps[heads[-1] + 1:annex]]
        tail = body[-1] if body else h
        # 원본의 부칙 사이 빈 문단 간격을 그대로 복제
        prev = h.getprevious()
        if prev is not None and prev.tag == Q('p') and not norm(ptext(prev)) and prev.find('.//hp:tbl', NS) is None:
            e = copy.deepcopy(prev); self._new_id(e); drop_lineseg(e); tail.addnext(e); tail = e
        nh = copy.deepcopy(h); self._new_id(nh); nh.set('pageBreak', '0'); drop_lineseg(nh); tail.addnext(nh)
        tmpl = body[0] if body else h
        lead = re.match(r'^\s*', ptext(tmpl)).group(0)
        self.clone(tmpl, lead + sentence, nh)

    def save(self, path, preview_text=None):
        files = dict(self.files)
        for n in self.secs:
            files[n] = etree.tostring(self.roots[n], xml_declaration=True, encoding='UTF-8', standalone=True)
        if preview_text is not None and 'Preview/PrvText.txt' in files:
            files['Preview/PrvText.txt'] = preview_text.encode('utf-8')
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr(zipfile.ZipInfo('mimetype'), files.pop('mimetype', b'application/hwp+zip'), compress_type=zipfile.ZIP_STORED)
            for n, b in files.items():
                z.writestr(n, b, compress_type=zipfile.ZIP_DEFLATED)

    def plain(self):
        return '\n'.join(ptext(p) for p in self.paras())
