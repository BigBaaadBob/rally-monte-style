"""Draw the app icons (run once; the PNGs are committed). Usage: python3 tools/make_icons.py"""
import pathlib
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'icons'
BLUE, WHITE, AMBER = (11, 92, 173), (255, 255, 255), (255, 196, 40)

def icon(size, safe):
    """safe = fraction of the canvas the artwork may use (maskable icons need ~0.8)."""
    S = 4 * size                                   # draw large, then downsample for smooth edges
    im = Image.new('RGB', (S, S), BLUE)
    d = ImageDraw.Draw(im)
    m = S * (1 - safe) / 2                          # margin
    w = S - 2 * m
    P = lambda x, y: (m + x * w, m + y * w)
    # winding road: a smooth S built from straight segments
    import math
    pts = [P(0.18 + 0.64 * t, 0.86 - 0.72 * t + 0.16 * math.sin(t * 2 * math.pi)) for t in [i / 600 for i in range(601)]]
    r = w * 0.055                                   # a thick, smooth line: overlapping discs
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)
    # checkpoint markers along the road
    for i in (120, 300, 480):
        x, y = pts[i]; r = w * 0.075
        d.ellipse([x - r, y - r, x + r, y + r], fill=AMBER, outline=BLUE, width=int(w * 0.02))
    return im.resize((size, size), Image.LANCZOS)

OUT.mkdir(parents=True, exist_ok=True)
icon(192, 0.86).save(OUT / 'icon-192.png')
icon(512, 0.86).save(OUT / 'icon-512.png')
icon(512, 0.66).save(OUT / 'maskable-512.png')
icon(180, 0.86).save(OUT / 'apple-touch-icon.png')
print('icons written to', OUT)
