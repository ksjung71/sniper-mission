"""스나이퍼 미션 앱 아이콘 생성기 (Pillow).

사용법:  python tools/make_icons.py
출력:    docs/icons/{apple-touch-icon-180, icon-192, icon-512, icon-512-maskable}.png
  - 모두 불투명 배경(iOS 홈 화면 아이콘은 투명 영역이 검게 보이므로)
  - maskable은 안드로이드 원형/물방울 마스크에 잘리지 않도록 로고를 안전 영역(지름 80%) 안으로 줄인다.
  - 4배 크기로 그린 뒤 축소해 가장자리를 부드럽게 만든다.
"""
import math
import os

from PIL import Image, ImageDraw, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "icons")
SS = 4  # 슈퍼샘플링 배율

CYAN = (34, 211, 238)
ORANGE = (255, 138, 31)
RED = (255, 59, 59)
WHITE = (240, 246, 252)


def ring(d, c, r, w, color):
    d.ellipse([c - r, c - r, c + r, c + r], outline=color, width=int(w))


def draw_icon(size, scale):
    """size: 최종 픽셀, scale: 로고 크기 비율(1 = 가득 참)"""
    S = size * SS
    c = S / 2
    # 배경: 남색 방사형 그라디언트 + 오른쪽 아래 주황 노을빛
    g = Image.radial_gradient("L").resize((S, S), Image.BICUBIC)
    img = ImageOps.colorize(g, black=(22, 49, 79), white=(3, 6, 11)).convert("RGB")
    # 2배 크기 그라디언트에서 잘라 내 빛의 중심을 (0.8, 0.85) 지점에 둔다
    glow = Image.radial_gradient("L").resize((S * 2, S * 2), Image.BICUBIC)
    x0, y0 = int(S * 0.2), int(S * 0.15)
    glow = glow.crop((x0, y0, x0 + S, y0 + S))
    warm = Image.new("RGB", (S, S), (150, 60, 16))
    img = Image.composite(img, warm, glow.point(lambda v: min(255, 110 + v)))

    d = ImageDraw.Draw(img)
    R = S * 0.36 * scale
    # 바깥 시안 링
    ring(d, c, R, S * 0.05 * scale, CYAN)
    # 안쪽 주황 점선 링
    r2 = R * 0.56
    for i in range(12):
        a0 = i * 30 + 6
        d.arc([c - r2, c - r2, c + r2, c + r2], a0, a0 + 18, fill=ORANGE, width=int(S * 0.028 * scale))
    # 십자선(가운데는 비움) + 굵은 바깥 기둥
    gap, inner, outer = R * 0.2, R * 0.62, R * 1.22
    lw, pw = S * 0.016 * scale, S * 0.045 * scale
    for ang in (0, 90, 180, 270):
        dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        d.line([c + dx * gap, c + dy * gap, c + dx * inner, c + dy * inner], fill=WHITE, width=int(lw))
        d.line([c + dx * inner, c + dy * inner, c + dx * outer, c + dy * outer], fill=WHITE, width=int(pw))
    # 밀도트
    for k in (0.33, 0.47):
        for ang in (0, 90, 180, 270):
            x, y = c + math.cos(math.radians(ang)) * R * k, c + math.sin(math.radians(ang)) * R * k
            rr = S * 0.012 * scale
            d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=WHITE)
    # 가운데 빨간 점
    rd = S * 0.04 * scale
    d.ellipse([c - rd, c - rd, c + rd, c + rd], fill=RED)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("apple-touch-icon-180.png", 180, 1.0),
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("icon-512-maskable.png", 512, 0.74),
    ]
    for name, size, scale in jobs:
        path = os.path.join(OUT, name)
        draw_icon(size, scale).save(path, optimize=True)
        print(f"생성: {os.path.relpath(path, ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
