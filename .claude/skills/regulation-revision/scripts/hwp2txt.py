"""HWP5(.hwp) 본문 텍스트 추출: python3 -I hwp2txt.py 파일.hwp > 출력.txt"""
import sys, zlib, struct, olefile
def paras(data):
    i = 0
    while i + 4 <= len(data):
        h = struct.unpack('<I', data[i:i+4])[0]; i += 4
        tag, size = h & 0x3FF, (h >> 20) & 0xFFF
        if size == 0xFFF: size = struct.unpack('<I', data[i:i+4])[0]; i += 4
        rec = data[i:i+size]; i += size
        if tag == 67:  # HWPTAG_PARA_TEXT
            out, j = [], 0
            while j + 1 < len(rec):
                c = struct.unpack('<H', rec[j:j+2])[0]
                if c in (1,2,3,11,12,14,15,16,17,18,21,22,23): j += 16; continue  # extended ctrl
                if c in (4,5,6,7,8,9,19,20): j += 16; continue                    # inline ctrl
                if c == 13 or c == 10: j += 2; continue
                if c == 24 or c == 30 or c == 31: out.append(' '); j += 2; continue
                if c >= 32: out.append(chr(c))
                j += 2
            yield ''.join(out)
f = olefile.OleFileIO(sys.argv[1])
hdr = f.openstream('FileHeader').read()
compressed = struct.unpack('<I', hdr[36:40])[0] & 1
secs = sorted([e for e in f.listdir() if e[0] == 'BodyText'], key=lambda e: int(e[1][7:]))
for e in secs:
    d = f.openstream(e).read()
    if compressed: d = zlib.decompress(d, -15)
    for p in paras(d):
        if p.strip(): print(p)
