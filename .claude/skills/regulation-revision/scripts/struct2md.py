"""hwp2struct JSON → 편집용 원문 마크업(.reg.txt). 사용: python3 -I struct2md.py in.json > out.reg.txt
문단은 한 줄. 표는 [[표 R C]] … [[/표]], 셀은 {행,열,행병합,열병합} 내용 (셀 안 줄바꿈은 ⏎)."""
import json, sys
for b in json.load(open(sys.argv[1])):
    if b['t'] == 'p':
        print(b['text'].rstrip())
    else:
        print(f"[[표 {b['rows']} {b['cols']}]]")
        for c in b['cells']:
            print(f"{{{c['r']},{c['c']},{c['rs']},{c['cs']}}} " + c['text'].replace('\n', '⏎'))
        print("[[/표]]")
