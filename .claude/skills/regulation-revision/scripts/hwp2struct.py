"""HWP5(.hwp) → 구조 JSON (문단 + 표). 사용: python3 -I hwp2struct.py 파일.hwp > 파일.json
블록: {"t":"p","text":...} 또는 {"t":"table","rows":R,"cols":C,"cells":[{"r","c","rs","cs","text"}]}"""
import sys, zlib, struct, json, olefile
CTRL16 = {1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23}
def text_of(rec):
    out, j = [], 0
    while j + 1 < len(rec):
        c = struct.unpack('<H', rec[j:j+2])[0]
        if c in CTRL16: j += 16; continue
        if c in (10, 13): j += 2; continue
        if c in (24, 30, 31): out.append(' '); j += 2; continue
        if c >= 32: out.append(chr(c))
        j += 2
    return ''.join(out).encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'replace')
def records(d):
    i = 0
    while i + 4 <= len(d):
        h = struct.unpack('<I', d[i:i+4])[0]; i += 4
        tag, lvl, size = h & 0x3FF, (h >> 10) & 0x3FF, (h >> 20) & 0xFFF
        if size == 0xFFF: size = struct.unpack('<I', d[i:i+4])[0]; i += 4
        yield tag, lvl, d[i:i+size]; i += size
def parse(d):
    blocks, stack = [], []   # stack of tables: dict(table, lh_level, cell)
    for tag, lvl, rec in records(d):
        while stack and tag == 66 and lvl < stack[-1]['lh']:
            t = stack.pop()['table']
            (stack[-1]['cell']['sub'] if stack and stack[-1]['cell'] else blocks).append(t) if False else None
            if stack and stack[-1]['cell'] is not None: stack[-1]['cell']['text'] += ' [표] '
            else: blocks.append(t)
        if tag == 77:  # TABLE
            rows, cols = struct.unpack('<HH', rec[4:8])
            stack.append({'table': {'t': 'table', 'rows': rows, 'cols': cols, 'cells': []}, 'lh': lvl, 'cell': None})
        elif tag == 72 and stack and lvl == stack[-1]['lh']:  # cell LIST_HEADER
            c, r, cs, rs = struct.unpack('<HHHH', rec[8:16])
            cell = {'r': r, 'c': c, 'rs': rs, 'cs': cs, 'text': ''}
            stack[-1]['table']['cells'].append(cell); stack[-1]['cell'] = cell
        elif tag == 67:
            t = text_of(rec)
            if stack and stack[-1]['cell'] is not None:
                cell = stack[-1]['cell']; cell['text'] = (cell['text'] + '\n' + t) if cell['text'] else t
            elif t.strip():
                blocks.append({'t': 'p', 'text': t})
    while stack:
        blocks.append(stack.pop()['table'])
    return blocks
f = olefile.OleFileIO(sys.argv[1])
comp = struct.unpack('<I', f.openstream('FileHeader').read()[36:40])[0] & 1
out = []
for e in sorted([e for e in f.listdir() if e[0] == 'BodyText'], key=lambda e: int(e[1][7:])):
    d = f.openstream(e).read()
    out += parse(zlib.decompress(d, -15) if comp else d)
json.dump(out, sys.stdout, ensure_ascii=False, indent=0)
