"""편집용 원문 마크업(.reg.txt) → 내부 작성기준 형식의 규정 hwpx.

사용: python3 -I md2hwpx.py 원문.reg.txt 출력.hwpx --skeleton 기준양식.hwpx [--title 규정명]

- skeleton: 한글에서 저장한 hwpx 아무 파일(글꼴 '한양신명조'가 header.xml에 있어야 함).
  regulation/reference/교무처_규정_제개정_체계_기준_2023.5.26.hwpx 사용 권장.
- 형식(drafting-standards.md Ⅰ-1): 여백 위20·머리말15·좌20·우20·꼬리말15·아래15mm,
  한양신명조 10pt 줄간격 160%, 제명 16pt 진하게 가운데, 장 12pt 진하게 가운데,
  조 번호·제목 진하게, 부칙 표제 '부      칙' 가운데 진하게.
- 마크업: 한 줄 = 한 문단. 표는 [[표 R C]] … [[/표]], 셀은 {행,열,행병합,열병합} 내용(⏎ = 셀 안 줄바꿈).
  줄 앞에 '@밑줄 ' 을 붙이면 그 문단을 밑줄로(별표 제목 등), '@쪽 ' 은 앞에서 쪽 나눔.
"""
import re, sys, zipfile, argparse, html

MM = 283.465
PAGE_W, PAGE_H = 59528, 84188
ML = MR = round(20 * MM); MT = round(20 * MM); MB = round(15 * MM)
MH = MF = round(15 * MM)
TEXT_W = PAGE_W - ML - MR

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out'); ap.add_argument('--skeleton', required=True)
ap.add_argument('--title')
a = ap.parse_args()
lines = open(a.src, encoding='utf-8').read().split('\n')

sk = zipfile.ZipFile(a.skeleton)
header = sk.read('Contents/header.xml').decode('utf-8')

# ---------- header.xml: 글자·문단·테두리 모양 추가 ----------
def count(tag):
    m = re.search(r'<hh:%s itemCnt="(\d+)"' % tag, header); return int(m.group(1))
fid = None
m = re.search(r'<hh:fontface lang="HANGUL"[^>]*>(.*?)</hh:fontface>', header, re.S)
for fm in re.finditer(r'<hh:font id="(\d+)" face="([^"]+)"', m.group(1)):
    if '신명조' in fm.group(2): fid = fm.group(1)
if fid is None: sys.exit('skeleton header.xml 에 신명조 글꼴이 없습니다')

nb = count('borderFills')
BF_NONE, BF_CELL, BF_HEAD = nb + 1, nb + 2, nb + 3
def bf(i, line, fill=None):
    side = lambda s: f'<hh:{s}Border type="{line}" width="0.12 mm" color="#000000"/>'
    f = (f'<hc:fillBrush><hc:winBrush faceColor="{fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>' if fill else '')
    return (f'<hh:borderFill id="{i}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">'
            '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
            + side('left') + side('right') + side('top') + side('bottom') +
            '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' + f + '</hh:borderFill>')
header = header.replace('</hh:borderFills>', bf(BF_NONE, 'NONE') + bf(BF_CELL, 'SOLID') + bf(BF_HEAD, 'SOLID', '#BFBFBF') + '</hh:borderFills>')
header = re.sub(r'<hh:borderFills itemCnt="\d+"', f'<hh:borderFills itemCnt="{nb + 3}"', header)

nc = count('charProperties')
def cp(i, size, bold=False, underline=False):
    langs = 'hangul="{0}" latin="{0}" hanja="{0}" japanese="{0}" other="{0}" symbol="{0}" user="{0}"'
    return (f'<hh:charPr id="{i}" height="{size * 100}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="{BF_NONE}">'
            f'<hh:fontRef {langs.format(fid)}/><hh:ratio {langs.format(100)}/><hh:spacing {langs.format(0)}/>'
            f'<hh:relSz {langs.format(100)}/><hh:offset {langs.format(0)}/>' + ('<hh:bold/>' if bold else '') +
            f'<hh:underline type="{"BOTTOM" if underline else "NONE"}" shape="SOLID" color="#000000"/>'
            '<hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/>'
            '<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/></hh:charPr>')
C = {}
specs = [('body', 10, 0, 0), ('bold', 10, 1, 0), ('title', 16, 1, 0), ('chap', 12, 1, 0), ('bold_u', 10, 1, 1), ('small', 9, 0, 0)]
add = ''
for k, (n, sz, b, u) in enumerate(specs):
    C[n] = nc + k; add += cp(nc + k, sz, b, u)
header = header.replace('</hh:charProperties>', add + '</hh:charProperties>')
header = re.sub(r'<hh:charProperties itemCnt="\d+"', f'<hh:charProperties itemCnt="{nc + len(specs)}"', header)

npp = count('paraProperties')
def pp(i, align, left=0, indent=0, spacing=160, prev=0, keep=0):
    mg = (f'<hh:margin><hc:intent value="{indent}" unit="HWPUNIT"/><hc:left value="{left}" unit="HWPUNIT"/>'
          f'<hc:right value="0" unit="HWPUNIT"/><hc:prev value="{prev}" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>'
          f'<hh:lineSpacing type="PERCENT" value="{spacing}" unit="HWPUNIT"/>')
    return (f'<hh:paraPr id="{i}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">'
            f'<hh:align horizontal="{align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>'
            f'<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="{keep}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
            '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
            f'<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">{mg}</hp:case><hp:default>{mg}</hp:default></hp:switch>'
            f'<hh:border borderFillIDRef="{BF_NONE}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>')
P = {}
pspecs = [('body', 'JUSTIFY', 0, 0, 160, 0, 0), ('center', 'CENTER', 0, 0, 160, 0, 1), ('right', 'RIGHT', 0, 0, 160, 0, 0),
          ('chap', 'CENTER', 0, 0, 160, 600, 1), ('title', 'CENTER', 0, 0, 160, 0, 0), ('cell', 'LEFT', 0, 0, 130, 0, 0),
          ('cellc', 'CENTER', 0, 0, 130, 0, 0), ('buchik', 'CENTER', 0, 0, 160, 600, 1)]
add = ''
for k, s in enumerate(pspecs):
    P[s[0]] = npp + k; add += pp(npp + k, *s[1:])
header = header.replace('</hh:paraProperties>', add + '</hh:paraProperties>')
header = re.sub(r'<hh:paraProperties itemCnt="\d+"', f'<hh:paraProperties itemCnt="{npp + len(pspecs)}"', header)

# ---------- 본문 ----------
_id = [1000]
def nid():
    _id[0] += 1; return str(_id[0])
def esc(t): return html.escape(t, quote=False)
def run(t, c): return f'<hp:run charPrIDRef="{c}"><hp:t>{esc(t)}</hp:t></hp:run>' if t else f'<hp:run charPrIDRef="{c}"/>'
def para(runs, p, pagebreak=False, extra=''):
    return (f'<hp:p id="{nid()}" paraPrIDRef="{p}" styleIDRef="0" pageBreak="{1 if pagebreak else 0}" columnBreak="0" merged="0">'
            + extra + ''.join(runs) + '</hp:p>')

HEAD_RE = re.compile(r'^제\s*\d+\s*편\s.*\d+-\d+-?\s*$')
ART_RE = re.compile(r'^(제\d+조(?:의\d+|\d+)?)\s*(\([^)]*\))?\s*')
reg_title = a.title
head_text = None
body = []
i = 0
first_title_done = False
def norm_indent(t):
    s = t.strip()
    if re.match(r'^[①-⑳]', s): return '  ' + s
    if re.match(r'^\d+\.\s', s) or re.match(r'^\d+\.\s*\(?삭', s): return '  ' + s
    if re.match(r'^[가-하]\.\s', s): return '    ' + s
    if re.match(r'^\d+\)\s', s): return '      ' + s
    if re.match(r'^[가-하]\)\s', s): return '        ' + s
    return t.rstrip()

def table_xml(rows, cols, cells, header_row=True):
    # 열 너비: 열별 최대 글자 수에 비례(최소 8%)
    lens = [1] * cols
    for c in cells:
        if c['cs'] == 1:
            ln = max((len(x.strip()) for x in c['text'].split('⏎')), default=1)
            lens[c['c']] = max(lens[c['c']], min(ln, 40))
    floor = max(lens) * 0.25
    wts = [max(l, floor) for l in lens]; tot = sum(wts)
    ws = [max(int(TEXT_W * w / tot), 600) for w in wts]
    ws[-1] = max(600, ws[-1] + TEXT_W - sum(ws))
    rowh = 1800
    # 열 단위 정렬: 본문 셀 중 긴 줄(13자 이상)이 있는 열은 왼쪽, 나머지는 가운데
    left_cols = {c['c'] for c in cells if c['r'] > 0 and c['cs'] == 1 and any(len(x.strip()) > 12 for x in c['text'].split('⏎'))}
    trs = []
    for r in range(rows):
        tcs = []
        for c in sorted([c for c in cells if c['r'] == r], key=lambda c: c['c']):
            w = sum(ws[c['c']:c['c'] + c['cs']])
            is_head = header_row and r == 0
            ps = []
            align = P['cellc'] if (is_head or c['c'] not in left_cols) else P['cell']
            for ln in c['text'].split('⏎'):
                ps.append(para([run(ln.strip(), C['bold'] if is_head else C['body'])], align))
            tcs.append(f'<hp:tc name="" header="{1 if is_head else 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{BF_HEAD if is_head else BF_CELL}">'
                       '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
                       + ''.join(ps) + '</hp:subList>'
                       f'<hp:cellAddr colAddr="{c["c"]}" rowAddr="{c["r"]}"/><hp:cellSpan colSpan="{c["cs"]}" rowSpan="{c["rs"]}"/>'
                       f'<hp:cellSz width="{w}" height="{rowh * c["rs"]}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>')
        trs.append('<hp:tr>' + ''.join(tcs) + '</hp:tr>')
    tbl = (f'<hp:tbl id="{nid()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="{rows}" colCnt="{cols}" cellSpacing="0" borderFillIDRef="{BF_CELL}" noAdjust="0">'
           f'<hp:sz width="{TEXT_W}" widthRelTo="ABSOLUTE" height="{rowh * rows}" heightRelTo="ABSOLUTE" protect="0"/>'
           '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
           '<hp:outMargin left="0" right="0" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>'
           + ''.join(trs) + '</hp:tbl>')
    return para([f'<hp:run charPrIDRef="{C["body"]}">{tbl}</hp:run>'], P['center'])

top_zone = True
while i < len(lines):
    raw = lines[i]; i += 1
    t = raw.rstrip()
    if not t.strip():
        continue
    if HEAD_RE.match(t.strip()):
        head_text = head_text or re.sub(r'\s+', ' ', t.strip()); continue
    if t.startswith('[[표'):
        rows, cols = map(int, t[3:-2].split())
        cells = []
        while not lines[i].startswith('[[/표]]'):
            m = re.match(r'^\{(\d+),(\d+),(\d+),(\d+)\} ?(.*)$', lines[i])
            cells.append({'r': int(m.group(1)), 'c': int(m.group(2)), 'rs': int(m.group(3)), 'cs': int(m.group(4)), 'text': m.group(5)})
            i += 1
        i += 1
        body.append(table_xml(rows, cols, cells)); continue
    pagebreak = False; underline = False
    while t.startswith('@'):
        if t.startswith('@쪽 '): pagebreak = True; t = t[3:]
        elif t.startswith('@밑줄 '): underline = True; t = t[4:]
        else: break
    s = t.strip()
    if not first_title_done and (reg_title is None or s.replace(' ', '') == reg_title.replace(' ', '')):
        reg_title = reg_title or s
        body.append(para([run(s, C['title'])], P['title'])); first_title_done = True; continue
    if top_zone and re.match(r'^(제정|변경|개정|전부개정)\s', s):
        body.append(para([run(re.sub(r'\s+', ' ', s), C['body'])], P['right'])); continue
    if re.match(r'^제\s*\d+\s*장\s', s) or re.fullmatch(r'제\s*\d+\s*장', s):
        top_zone = False
        body.append(para([run(s, C['chap'])], P['chap'], pagebreak)); continue
    if re.fullmatch(r'부\s*칙(\s*\(.*\))?', s):
        top_zone = False
        rest = re.sub(r'^부\s*칙', '', s).strip()
        body.append(para([run('부      칙' + (' ' + rest if rest else ''), C['bold'])], P['buchik'], pagebreak)); continue
    if re.match(r'^\[(별표|별지)', s) or re.match(r'^[【<](별표|별지)', s):
        s = re.sub(r'^[【<]\s*(별표|별지)\s*([^】>]*?)\s*[】>]', lambda m: '[' + m.group(1) + ' ' + re.sub(r'\s*서식', '서식', m.group(2).strip()) + ']', s)
        s = re.sub(r'^\[(별표|별지) (\d+)', r'[\1 \2', s)
        top_zone = False
        body.append(para([run(s, C['bold_u'] if underline else C['bold'])], P['body'], '삭' not in s)); continue  # 별표·별지는 새 쪽(삭제 표시만 있는 줄은 제외)
    m = ART_RE.match(s)
    if m:
        top_zone = False
        head = m.group(1) + (m.group(2) or '')
        rest = s[m.end():]
        runs = [run(head, C['bold_u'] if underline else C['bold'])]
        if rest: runs.append(run(' ' + rest, C['body']))
        body.append(para(runs, P['body'], pagebreak)); continue
    body.append(para([run(norm_indent(t), C['bold_u'] if underline else C['body'])], P['body'], pagebreak))

# 첫 문단에 구역 설정 + 머리말
secpr = (f'<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">'
         '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
         '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
         '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>'
         f'<hp:pagePr landscape="WIDELY" width="{PAGE_W}" height="{PAGE_H}" gutterType="LEFT_ONLY"><hp:margin header="{MH}" footer="{MF}" gutter="0" left="{ML}" right="{MR}" top="{MT}" bottom="{MB}"/></hp:pagePr>'
         '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>'
         '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>'
         + ''.join(f'<hp:pageBorderFill type="{t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>' for t in ('BOTH', 'EVEN', 'ODD'))
         + '</hp:secPr>')
ctrls = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>'
if head_text:
    hp = para([run(head_text, C['body']),
               f'<hp:run charPrIDRef="{C["body"]}"><hp:ctrl><hp:autoNum num="1" numType="PAGE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl></hp:run>'],
              P['body'])
    ctrls += ('<hp:ctrl><hp:header id="1" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" '
              f'textWidth="{TEXT_W}" textHeight="{MH}" hasTextRef="0" hasNumRef="0">{hp}</hp:subList></hp:header></hp:ctrl>')
first = para([f'<hp:run charPrIDRef="{C["body"]}">{secpr}{ctrls}</hp:run>'], P['body'])
NS = re.search(r'<hs:sec [^>]*>', sk.read('Contents/section0.xml').decode('utf-8')).group(0)
section = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + NS + first + ''.join(body) + '</hs:sec>'

plain = '\n'.join(re.sub(r'^@\S+ ', '', l) for l in lines if l.strip() and not l.startswith(('[[', '{')))[:1000]
hpf = sk.read('Contents/content.hpf').decode('utf-8')
hpf = re.sub(r'<opf:title>.*?</opf:title>', f'<opf:title>{esc(reg_title or "")}</opf:title>', hpf)
hpf = re.sub(r'(<opf:meta name="(?:creator|lastsaveby)" content="text">)[^<]*', r'\1', hpf)

with zipfile.ZipFile(a.out, 'w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'), 'application/hwp+zip', compress_type=zipfile.ZIP_STORED)
    for n in sk.namelist():
        if n in ('mimetype', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf', 'Preview/PrvText.txt', 'Preview/PrvImage.png'):
            continue
        z.writestr(n, sk.read(n), compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('Contents/content.hpf', hpf, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('Contents/header.xml', header, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('Contents/section0.xml', section, compress_type=zipfile.ZIP_DEFLATED)
    z.writestr('Preview/PrvText.txt', plain, compress_type=zipfile.ZIP_DEFLATED)
print('작성:', a.out, '문단', len(body))
