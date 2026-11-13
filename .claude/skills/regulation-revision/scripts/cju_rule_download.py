"""청주대학교 규정집(rule.cju.ac.kr) 규정 검색·전문 다운로드
사용: python3 -I cju_rule_download.py "직원보수규정" [저장폴더]
 - 제목 검색 결과를 모두 출력하고, 제목이 정확히 일치하는 규정(없으면 첫 결과)의 전문(.hwp)을 저장한다.
"""
import sys, re, os, urllib.parse, urllib.request
BASE = "https://rule.cju.ac.kr"
def post(path, data):
    req = urllib.request.Request(BASE + path, data=urllib.parse.urlencode(data).encode(), method="POST")
    return urllib.request.urlopen(req, timeout=60)
name = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else "."
html = post("/lmxsrv/search/lawSerach.srv",
            {"SEARCH_TEXT": name, "SEARCH_TYPE": "LAWNAME", "PAGE": 1, "PAGE_SHOW": 50}).read().decode("utf-8", "replace")
html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
rows = []
for blk in html.split("lawSearchFullViewSrv(")[1:]:
    m = re.search(r"^'(\d+)',\s*'(\d+)'.*?showSearchText\(\"([^\"]+)\".*?showDate\('(\d+)'(?:(?!lawSearchFullViewSrv).)*?fileDown\('(\d+)',\s*'(\w+)'\)", blk, re.S)
    if m: rows.append(m.groups())
if not rows: sys.exit(f"검색 결과 없음: {name}")
for seq, hseq, title, date, fseq, ftype in rows:
    print(f"{title}\t최종개정 {date}\tSEQ={seq}\tFILE_SEQ={fseq}")
pick = next((r for r in rows if r[2].replace(" ", "") == name.replace(" ", "")), rows[0])
r = post("/lmxsrv/fileDown.srv", {"FILE_SEQ": pick[4], "FILE_TYPE": pick[5]})
m = re.search(r'fileName="([^"]+)"', r.headers.get("Content-Disposition", ""))
fn = urllib.parse.unquote(m.group(1)) if m else f"{pick[3]}_{pick[2]}.hwp"
os.makedirs(out, exist_ok=True); p = os.path.join(out, fn)
open(p, "wb").write(r.read()); print("저장:", p)
