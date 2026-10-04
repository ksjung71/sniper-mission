"""친구에게 보낼 PC용 단일 파일을 만든다 (Python 표준 라이브러리만 사용).

사용법:  python tools/build_share.py
결과:    dist/SniperMission_PC.html  — 더블클릭하면 브라우저에서 바로 실행(설치·서버 불필요)
         dist/SniperMission_PC.zip   — 위 HTML + README.txt (메신저·메일 전송용)

원리
  - 게임은 여러 ES 모듈로 나뉘어 있다. 파일을 더블클릭해 연 페이지(file://)에서는 브라우저가
    다른 파일의 모듈을 불러오지 못하므로, 모든 모듈을 data: URL로 HTML 안에 넣고 import map으로 연결한다.
  - 각 모듈의 상대경로 import('../bus.js')를 'sm/js/bus.js' 같은 고정 이름으로 바꾼다.
  - CSS는 <style>로, 파비콘은 data: URL로 넣는다. manifest·서비스워커(PWA)는 폰 설치용이라 뺀다.
  - 원본(docs/)은 건드리지 않는다. docs/를 고친 뒤 이 스크립트를 다시 실행하면 된다.
"""
import base64
import json
import os
import posixpath
import re
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
DIST = os.path.join(ROOT, "dist")
OUT_HTML = "SniperMission_PC.html"
IMPORT_RE = re.compile(r"""(\bfrom\s*)(["'])(\.{1,2}/[^"']+)\2""")
PREFIX = "sm/"

README = """스나이퍼 미션 (PC 테스트 버전) v{version}

[실행 방법]
1. SniperMission_PC.html 파일을 더블클릭하세요.
   (Chrome 또는 Edge 권장. 설치나 인터넷 연결이 필요 없습니다)
2. "탭하여 시작"을 클릭 → 작전을 고르고 "작전 시작".

[PC 조작]
- 화면 클릭: 마우스 잠금 (첫 클릭은 발사되지 않아요)
- 마우스 이동: 조준        - 좌클릭: 발사 (또는 Space)
- 우클릭: 스코프 (또는 E)  - 휠: 줌 확대/축소 (또는 Q)
- Shift 누르고 있기: 숨 참기(흔들림 감소, 최대 3초)
- R: 재장전   - N: 야간투시(4스테이지)   - Esc: 일시정지

[팁]
- 탄은 초속 850m로 날아가요. 걷는 표적은 진행 방향으로 살짝 앞을 겨누세요.
- 4·5스테이지는 탄이 떨어지고 바람에 밀립니다. 스코프의 점 간격과 거리 표시를 참고하세요.
- 3스테이지부터는 민간인을 맞히면 바로 실패합니다.

[문제가 있으면]
- 화면이 안 나오면 다른 브라우저(Chrome/Edge 최신)로 파일을 열어 보세요.
- 테스트 모드(모든 스테이지 열림 + FPS 표시): 주소창 끝에 ?debug 를 붙여 Enter
- 플레이 소감(난이도, 조작감, 버그)을 알려 주세요!
"""


def read(rel):
    with open(os.path.join(DOCS, rel), encoding="utf-8") as f:
        return f.read()


def collect(entry):
    """entry부터 import를 따라가며 {경로: 바꾼 소스}를 만든다."""
    mods, todo = {}, [entry]
    while todo:
        rel = todo.pop()
        if rel in mods:
            continue
        src = read(rel)
        base = posixpath.dirname(rel)

        def repl(m):
            dep = posixpath.normpath(posixpath.join(base, m.group(3)))
            todo.append(dep)
            return f'{m.group(1)}"{PREFIX}{dep}"'

        mods[rel] = IMPORT_RE.sub(repl, src)
    return mods


def data_url(mime, raw):
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def main():
    version = re.search(r"APP_VERSION\s*=\s*'([^']+)'", read("js/config.js")).group(1)
    html = read("index.html")
    mods = collect("js/main.js")
    imports = {PREFIX + rel: data_url("text/javascript", src.encode("utf-8")) for rel, src in sorted(mods.items())}

    with open(os.path.join(DOCS, "icons", "icon-192.png"), "rb") as f:
        icon = data_url("image/png", f.read())

    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', "", html)
    html = re.sub(r'<link rel="icon"[^>]*>', f'<link rel="icon" type="image/png" href="{icon}">', html)
    html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + read("css/style.css") + "\n</style>")
    boot = (
        '<script type="importmap">' + json.dumps({"imports": imports}) + "</script>\n"
        f'<script type="module">import "{PREFIX}js/main.js";</script>'
    )
    script_tag = '<script type="module" src="js/main.js"></script>'
    if script_tag not in html or "css/style.css" in html:
        raise SystemExit("index.html 구조가 예상과 다릅니다(스크립트/스타일 태그). 스크립트를 확인하세요.")
    html = html.replace(script_tag, boot)
    html = html.replace("<title>스나이퍼 미션</title>", f"<title>스나이퍼 미션 v{version} (PC)</title>")

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, OUT_HTML)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    readme = README.format(version=version).replace("\n", "\r\n")  # 메모장에서도 줄바꿈 유지
    with zipfile.ZipFile(os.path.join(DIST, "SniperMission_PC.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.write(out, OUT_HTML)
        z.writestr("README.txt", "﻿" + readme)  # BOM: 메모장 한글 인코딩 인식용

    print(f"모듈 {len(mods)}개 → {OUT_HTML} ({os.path.getsize(out) / 1024:.0f} KB)")
    print(f"zip: {os.path.getsize(os.path.join(DIST, 'SniperMission_PC.zip')) / 1024:.0f} KB  (dist/)")


if __name__ == "__main__":
    main()
