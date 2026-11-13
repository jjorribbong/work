"""규정 본문에만 내부 편집기준(교무처 규정 제·개정 체계 기준)을 적용한다. 별표·별지는 손대지 않는다.

    from hwpx_patch import Doc
    from format_body import apply_standard
    d = Doc.from_hwpx('개정안.hwpx'); apply_standard(d, '직원보수규정'); d.save('개정안.hwpx')

- 본문 = 첫 별표·별지 제목 문단 앞까지의 최상위 문단. 표가 든 문단(본문 속 표)은 그대로 둔다.
- 별표·별지는 새 구역(section)으로 옮겨 원래 용지 여백·머리말을 그대로 유지하고, 본문 구역만 기준 여백을 적용한다.
- 적용: 한양신명조, 10pt, 줄간격 160%, 제명 16pt 진하게 가운데, 장 12pt 진하게 가운데,
  조 번호·제목 '제○조(제목)' 진하게, 항 '  ②', 호 '  1.', 목 '    가.', 1) 6칸, 가) 8칸,
  부칙 표제 '부      칙' 10pt 진하게 가운데, 제정·변경 줄 오른쪽 정렬.
- 여백(mm): 위 20, 머리말 15, 왼쪽 20, 오른쪽 20, 꼬리말 15, 아래 15.
"""
import re, copy
from lxml import etree
from hwpx_patch import Q, NS, ptext, norm, drop_lineseg

HH = 'http://www.hancom.co.kr/hwpml/2011/head'
HC = 'http://www.hancom.co.kr/hwpml/2011/core'
H = lambda t: f'{{{HH}}}{t}'
HN = {'hh': HH, 'hc': HC, 'hp': NS['hp']}
MM = 283.465
MARGIN = dict(left=20, right=20, top=20, bottom=15, header=15, footer=15)
ANNEX = re.compile(r'^\s*[【\[<]\s*(별표|별지)')
FONT = '한양신명조'


def _ensure_font(head):
    ids = {}
    for ff in head.iter(H('fontface')):
        fonts = ff.findall('hh:font', HN)
        hit = [f for f in fonts if f.get('face') == FONT]
        if hit:
            ids[ff.get('lang')] = hit[0].get('id'); continue
        nid = str(max(int(f.get('id')) for f in fonts) + 1)
        f = etree.SubElement(ff, H('font')); f.set('id', nid); f.set('face', FONT); f.set('type', 'HFT'); f.set('isEmbedded', '0')
        ti = etree.SubElement(f, H('typeInfo'))
        for k, v in dict(familyType='FCAT_MYUNGJO', weight='0', proportion='0', contrast='0', strokeVariation='0',
                         armStyle='0', letterform='0', midline='0', xHeight='0').items(): ti.set(k, v)
        ff.set('fontCnt', str(len(ff.findall('hh:font', HN))))
        ids[ff.get('lang')] = nid
    return ids


def _add(parent, base, new_id):
    e = copy.deepcopy(base); e.set('id', str(new_id)); parent.append(e)
    parent.set('itemCnt', str(len(parent)))
    return e


def _styles(doc):
    head = etree.fromstring(doc.files['Contents/header.xml'])
    fid = _ensure_font(head)
    cps = head.find('.//hh:charProperties', HN); pps = head.find('.//hh:paraProperties', HN)
    cbase = cps.find('hh:charPr[@id="0"]', HN); pbase = pps.find('hh:paraPr[@id="0"]', HN)
    C, P = {}, {}
    nc = max(int(c.get('id')) for c in cps) + 1
    for k, (size, bold) in {'body': (10, 0), 'bold': (10, 1), 'title': (16, 1), 'chap': (12, 1)}.items():
        e = _add(cps, cbase, nc); nc += 1; C[k] = e.get('id')
        e.set('height', str(size * 100)); e.set('textColor', '#000000')
        fr = e.find('hh:fontRef', HN)
        for lang, a in (('HANGUL', 'hangul'), ('LATIN', 'latin'), ('HANJA', 'hanja'), ('JAPANESE', 'japanese'),
                        ('OTHER', 'other'), ('SYMBOL', 'symbol'), ('USER', 'user')):
            if lang in fid: fr.set(a, fid[lang])
        for tag in ('bold', 'italic'):
            for b in e.findall(f'hh:{tag}', HN): e.remove(b)
        if bold:
            ul = e.find('hh:underline', HN); b = etree.Element(H('bold'))
            (ul.addprevious(b) if ul is not None else e.append(b))
        ul = e.find('hh:underline', HN)
        if ul is not None: ul.set('type', 'NONE')
        for r in ('ratio', 'relSz'):
            x = e.find(f'hh:{r}', HN)
            if x is not None:
                for a in list(x.attrib): x.set(a, '100')
        for r in ('spacing', 'offset'):
            x = e.find(f'hh:{r}', HN)
            if x is not None:
                for a in list(x.attrib): x.set(a, '0')
    npid = max(int(p.get('id')) for p in pps) + 1
    for k, (align, prev, keep) in {'body': ('JUSTIFY', 0, 0), 'center': ('CENTER', 0, 0), 'right': ('RIGHT', 0, 0),
                                   'chap': ('CENTER', 0, 1), 'buchik': ('CENTER', 0, 1)}.items():
        e = _add(pps, pbase, npid); npid += 1; P[k] = e.get('id')
        e.find('hh:align', HN).set('horizontal', align)
        hd = e.find('hh:heading', HN)
        if hd is not None: hd.set('type', 'NONE'); hd.set('idRef', '0'); hd.set('level', '0')
        bs = e.find('hh:breakSetting', HN)
        if bs is not None: bs.set('keepWithNext', str(keep)); bs.set('breakNonLatinWord', 'BREAK_WORD')
        for mg in e.iter(H('margin')):
            for c in mg: c.set('value', '0')
        for ls in e.iter(H('lineSpacing')):
            ls.set('type', 'PERCENT'); ls.set('value', '160')
    doc.files['Contents/header.xml'] = etree.tostring(head, xml_declaration=True, encoding='UTF-8', standalone=True)
    return C, P


def _set_runs(p, segs):
    """문단의 글자를 segs=[(text, charPr)] 로 교체. secPr·머리말/꼬리말·표 등 컨트롤은 run 째로 유지(글자만 제거)."""
    for r in p.findall('hp:run', NS):
        ctrls = [c for c in r if c.tag != Q('t')]
        if ctrls:
            for t in r.findall('hp:t', NS): r.remove(t)
        else:
            p.remove(r)
    for t, c in segs:
        r = etree.SubElement(p, Q('run')); r.set('charPrIDRef', c)
        if t: etree.SubElement(r, Q('t')).text = t
    drop_lineseg(p)


def _indent(s):
    s = s.strip()
    if re.match(r'^[①-⑳]', s): return '  ' + s
    if re.match(r'^\d+\.', s): return '  ' + s
    if re.match(r'^[가-하]\.', s): return '    ' + s
    if re.match(r'^\d+\)', s): return '      ' + s
    if re.match(r'^[가-하]\)', s): return '        ' + s
    return None


def _split_annex(doc, sec, first_annex):
    """첫 별표·별지 문단부터 새 구역으로 옮긴다(원래 secPr·머리말 복사)."""
    root = doc.roots[sec]
    first_p = root.find('hp:p', NS)
    orig_runs = [copy.deepcopy(r) for r in first_p.findall('hp:run', NS) if any(c.tag != Q('t') for c in r)]
    new_root = etree.Element(root.tag, nsmap=root.nsmap)
    for k, v in root.attrib.items(): new_root.set(k, v)
    move, on = [], False
    for p in root.findall('hp:p', NS):
        if p is first_annex: on = True
        if on: move.append(p)
    for p in move: root.remove(p); new_root.append(p)
    # 새 구역 첫 문단 앞에 원래 구역 설정(여백·머리말) 문단 삽입
    lead = etree.Element(Q('p')); lead.set('id', '1'); lead.set('paraPrIDRef', first_annex.get('paraPrIDRef', '0'))
    lead.set('styleIDRef', '0'); lead.set('pageBreak', '0'); lead.set('columnBreak', '0'); lead.set('merged', '0')
    for r in orig_runs:
        for t in r.findall('hp:t', NS): r.remove(t)
        lead.append(r)
    new_root.insert(0, lead)
    name = 'Contents/section%d.xml' % len(doc.secs)
    doc.secs.append(name); doc.roots[name] = new_root; doc.files[name] = b''
    hpf = doc.files['Contents/content.hpf'].decode()
    sid = 'section%d' % (len(doc.secs) - 1)
    hpf = hpf.replace('</opf:manifest>', f'<opf:item id="{sid}" href="{name}" media-type="application/xml"/></opf:manifest>')
    hpf = hpf.replace('</opf:spine>', f'<opf:itemref idref="{sid}" linear="yes"/></opf:spine>')
    doc.files['Contents/content.hpf'] = hpf.encode()
    h = doc.files['Contents/header.xml'].decode()
    doc.files['Contents/header.xml'] = re.sub(r'secCnt="\d+"', f'secCnt="{len(doc.secs)}"', h, count=1).encode()


def apply_standard(doc, reg_name):
    C, P = _styles(doc)
    sec = doc.secs[0]; root = doc.roots[sec]
    tops = root.findall('hp:p', NS)
    first_annex = next((p for p in tops if ANNEX.match(ptext(p))), None)
    body = tops[:tops.index(first_annex)] if first_annex is not None else tops
    if first_annex is not None:
        _split_annex(doc, sec, first_annex)
    # 본문 구역 여백
    pg = root.find('.//hp:pagePr', NS); m = pg.find('hp:margin', NS)
    for k, v in MARGIN.items(): m.set(k, str(round(v * MM)))
    title_done = False
    for p in body:
        if p.find('.//hp:tbl', NS) is not None:      # 본문 속 표는 그대로
            continue
        s = ptext(p); st = s.strip()
        if not st:
            _set_runs(p, [('', C['body'])]); p.set('paraPrIDRef', P['body']); continue
        if not title_done and norm(st) == norm(reg_name):
            _set_runs(p, [(st, C['title'])]); p.set('paraPrIDRef', P['center']); title_done = True; continue
        if re.match(r'^(제정|변경|개정|전부개정)\s*\d{4}', st):
            _set_runs(p, [(re.sub(r'\s+', ' ', st), C['body'])]); p.set('paraPrIDRef', P['right']); continue
        if re.match(r'^제\s*\d+\s*장', st):
            _set_runs(p, [(st, C['chap'])]); p.set('paraPrIDRef', P['chap']); continue
        if re.fullmatch(r'부\s*칙', st):
            _set_runs(p, [('부      칙', C['bold'])]); p.set('paraPrIDRef', P['buchik']); continue
        m = re.match(r'^(제\d+조(?:의\d+|\d+)?)\s*(\([^)]*\))?\s*', st)
        if m:
            head = m.group(1) + (m.group(2) or '')
            rest = st[m.end():]
            _set_runs(p, [(head, C['bold'])] + ([(' ' + rest, C['body'])] if rest else []))
            p.set('paraPrIDRef', P['body']); continue
        ind = _indent(st)
        _set_runs(p, [(ind if ind is not None else s.rstrip(), C['body'])]); p.set('paraPrIDRef', P['body'])
