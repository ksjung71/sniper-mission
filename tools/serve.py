"""스나이퍼 미션 로컬 개발 서버 (Python 표준 라이브러리만 사용).

사용법:  python tools/serve.py [--port 8123] [--lan] [--quiet]
  - 저장소 루트를 서빙한다. 게임 주소: http://localhost:8123/docs/
    (GitHub Pages의 https://<아이디>.github.io/<저장소>/ 와 같은 '하위 경로' 구조라 절대경로 버그를 미리 잡는다)
  - Windows 레지스트리 설정 때문에 .js가 text/plain으로 나가면 ES 모듈이 로딩되지 않는다 → MIME을 직접 지정.
  - Cache-Control: no-store → 파일을 고치면 새로고침만으로 바로 반영.
  - 기본은 127.0.0.1(이 PC에서만 접속, 방화벽 경고 없음). --lan 이면 같은 Wi-Fi의 폰에서도 접속 가능.
"""
import argparse
import http.server
import os
import socket
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    quiet = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        return MIME.get(os.path.splitext(path)[1].lower()) or super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)


def lan_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    # 사설망 주소(192.168.x, 172.16-31.x, 10.x)를 우선 표시. VPN 주소가 섞여 있을 수 있다.
    return sorted((ip for ip in ips if not ip.startswith("127.")), key=lambda ip: (not ip.startswith("192.168."), ip))


def main():
    ap = argparse.ArgumentParser(description="스나이퍼 미션 로컬 서버")
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--lan", action="store_true", help="같은 Wi-Fi의 다른 기기(폰)에서도 접속 허용")
    ap.add_argument("--quiet", action="store_true", help="요청 로그 숨기기")
    a = ap.parse_args()
    Handler.quiet = a.quiet
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    try:
        srv = http.server.ThreadingHTTPServer((host, a.port), Handler)
    except OSError as e:
        print(f"[오류] 포트 {a.port}을 열 수 없습니다. 이미 서버가 실행 중일 수 있습니다. ({e})")
        sys.exit(1)
    print(f"스나이퍼 미션 서버 실행 중 (루트: {ROOT})")
    print(f"  PC에서:  http://localhost:{a.port}/docs/")
    print(f"  테스트 모드: http://localhost:{a.port}/docs/?debug")
    if a.lan:
        for ip in lan_ips():
            print(f"  폰(같은 Wi-Fi)에서:  http://{ip}:{a.port}/docs/")
        print("  * Windows 방화벽 창이 뜨면 '개인 네트워크' 허용을 눌러 주세요.")
    print("종료: 이 창을 닫거나 Ctrl+C", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
