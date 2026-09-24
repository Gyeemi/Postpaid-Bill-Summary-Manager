#!/usr/bin/env python3
"""Generates build/icon.ico (multi-resolution) for the Windows installer/app."""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, 'build')
os.makedirs(OUT_DIR, exist_ok=True)

NAVY = (30, 58, 95, 255)       # brand dark blue
BLUE = (37, 99, 168, 255)      # lighter accent
WHITE = (255, 255, 255, 255)

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# rounded-square background with subtle vertical gradient
grad = Image.new('RGBA', (S, S), NAVY)
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    c = tuple(int(NAVY[i] + (BLUE[i] - NAVY[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (S, y)], fill=c)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([16, 16, S - 16, S - 16], radius=210, fill=255)
img.paste(grad, (0, 0), mask)

# white document sheet, slightly folded corner
d = ImageDraw.Draw(img)
x0, y0, x1, y1 = 268, 190, 756, 834
fold = 120
d.polygon(
    [(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)],
    fill=WHITE,
)
d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=(206, 220, 236, 255))

# gray text lines on the sheet
for i, wfrac in enumerate((0.62, 0.78, 0.5, 0.7)):
    ly = y0 + 90 + i * 74
    d.rounded_rectangle(
        [x0 + 64, ly, x0 + 64 + int((x1 - x0 - 128) * wfrac), ly + 30],
        radius=15,
        fill=(150, 170, 195, 255),
    )

# "Nu." badge across the bottom of the sheet
def font_of(size):
    for p in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

badge_font = font_of(190)
txt = 'Nu.'
tb = d.textbbox((0, 0), txt, font=badge_font)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
cx, cy = (x0 + x1) // 2, y1 - 150
d.rounded_rectangle(
    [cx - tw // 2 - 70, cy - th // 2 - 52, cx + tw // 2 + 70, cy + th // 2 + 42],
    radius=60,
    fill=NAVY,
)
d.text((cx - tb[0] - tw // 2, cy - tb[1] - th // 2), txt, font=badge_font, fill=WHITE)

# export .ico with all sizes
img.save(os.path.join(OUT_DIR, 'icon.ico'),
         sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48),
                (64, 64), (128, 128), (256, 256)])
# png for ico-less fallbacks / readme
img.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT_DIR, 'icon.png'))
print('wrote', os.path.join(OUT_DIR, 'icon.ico'))
