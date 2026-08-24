#!/usr/bin/env python3
"""Genera todos los iconos (PWA, favicon, apple-touch, AppIcon de iOS y badge de
notificaciones) a partir del monograma de BrunettiCutz.

    python3 scripts/brand/build-icons.py

Fuente: scripts/brand/monogram-source.webp — el monograma "B/cutz/W" original en
plata sobre fondo transparente, con el wordmark "BRUNETTICUTZ" abajo. El script
recorta solo el monograma, lo recolorea a dorado mapeando su luminancia contra
una rampa (bronce en sombras → champagne en los brillos) y lo compone sobre el
fondo oscuro de marca. Requiere Pillow + numpy.
"""
import base64, io, os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC  = os.path.join(ROOT, 'scripts/brand/monogram-source.webp')
WEB  = os.path.join(ROOT, 'public/assets')
IOS  = os.path.join(ROOT, 'ios/BrunettiCutz/BrunettiCutz/Assets.xcassets')

CROP        = (339, 179, 934, 1010)  # solo el monograma, sin divisor ni wordmark
HEIGHT      = 0.64   # alto del monograma sobre el lienzo: deja el safe zone maskable
RADIUS      = 0.21   # radio de esquina de las variantes redondeadas
ALPHA_GAIN  = 1.6    # el arte viene semitransparente; se sube para que quede sólido
ALPHA_GAMMA = 0.75
LUM_FLOOR   = 0.36   # luminancia que se mapea al extremo oscuro de la rampa

GOLD = [(0.00, (0x4a, 0x33, 0x12)), (0.22, (0x8a, 0x63, 0x27)),
        (0.45, (0xc0, 0x96, 0x40)), (0.68, (0xdc, 0xb8, 0x63)),
        (0.85, (0xf0, 0xdb, 0x9f)), (1.00, (0xfd, 0xf3, 0xd4))]


def gold_mark():
    """Monograma recortado y recoloreado a dorado, con fondo transparente."""
    a = np.asarray(Image.open(SRC).convert('RGBA').crop(CROP), np.float32) / 255.0
    rgb, al = a[..., :3], a[..., 3]
    flat = rgb * al[..., None] + (1.0 - al[..., None])   # recompone sobre blanco
    lum = 0.2126 * flat[..., 0] + 0.7152 * flat[..., 1] + 0.0722 * flat[..., 2]
    t = np.clip((lum - LUM_FLOOR) / (1.0 - LUM_FLOOR), 0, 1)

    out = np.zeros(t.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(GOLD, GOLD[1:]):
        m = (t >= p0) & (t <= p1)
        f = np.zeros_like(t); f[m] = (t[m] - p0) / (p1 - p0)
        for ch in range(3):
            out[..., ch][m] = c0[ch] + (c1[ch] - c0[ch]) * f[m]
    out /= 255.0

    alpha = np.clip(al * ALPHA_GAIN, 0, 1) ** ALPHA_GAMMA
    px = np.concatenate([out, alpha[..., None]], axis=2)
    return Image.fromarray((px * 255).astype(np.uint8))


def background(size, radius_ratio=None):
    """Fondo radial oscuro. Sin radius_ratio queda a sangre (para iconos enmascarados)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / max(size - 1, 1)
    d = np.clip(np.sqrt((xx - 0.35) ** 2 + (yy - 0.25) ** 2) / 0.95, 0, 1)[..., None]
    c0 = np.array([0x1f, 0x1f, 0x23], np.float32)
    c1 = np.array([0x10, 0x10, 0x12], np.float32)
    c2 = np.array([0x06, 0x06, 0x0a], np.float32)
    col = np.where(d < 0.45, c0 + (c1 - c0) * (d / 0.45),
                             c1 + (c2 - c1) * ((d - 0.45) / 0.55))
    img = Image.fromarray(col.astype(np.uint8)).convert('RGBA')
    if radius_ratio:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                            radius=int(size * radius_ratio), fill=255)
        img.putalpha(m)
    return img


def icon(size, mark, radius_ratio=None):
    bg = background(size, radius_ratio)
    h = int(size * HEIGHT)
    w = max(1, round(mark.width * h / mark.height))
    m = mark.resize((w, h), Image.LANCZOS)
    x, y = (size - w) // 2, (size - h) // 2

    halo = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    halo.paste(m, (x, y), m)
    ha = np.asarray(halo.filter(ImageFilter.GaussianBlur(size * 0.045)), np.float32)
    ha[..., 0], ha[..., 1], ha[..., 2] = 0xc9, 0xa1, 0x4e
    ha[..., 3] *= 0.30
    bg = Image.alpha_composite(bg, Image.fromarray(ha.astype(np.uint8)))
    bg.paste(m, (x, y), m)
    return bg


def save(img, path, keep_alpha=True):
    if not keep_alpha:                      # los AppIcon de iOS no admiten canal alfa
        flat = Image.new('RGB', img.size, (6, 6, 10))
        flat.paste(img, (0, 0), img)
        img = flat
    img.save(path, optimize=True)
    print(f'  {os.path.relpath(path, ROOT)}')


def main():
    mark = gold_mark()

    print('web / PWA')
    for size in (180, 192, 512):
        save(icon(size, mark), f'{WEB}/brunetti-logo-icon-{size}.png')

    print('favicon svg')
    mh = 196
    mw = round(mark.width * mh / mark.height)
    small = np.asarray(mark.resize((mw, mh), Image.LANCZOS), np.int16)
    small = np.clip((small // 8) * 8 + 4, 0, 255).astype(np.uint8)  # baja el peso del base64
    buf = io.BytesIO(); Image.fromarray(small).save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    sh = 512 * HEIGHT; sw = mw * sh / mh
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Brunetti Cutz icono">
  <defs>
    <radialGradient id="icBg" cx="35%" cy="25%" r="85%">
      <stop offset="0%" stop-color="#1f1f23"/>
      <stop offset="45%" stop-color="#101012"/>
      <stop offset="100%" stop-color="#06060a"/>
    </radialGradient>
    <linearGradient id="icBorder" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e7c87e" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#7a5e26" stop-opacity="0.25"/>
    </linearGradient>
    <filter id="icGlow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="0" stdDeviation="16" flood-color="#c9a14e" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="108" ry="108" fill="url(#icBg)"/>
  <rect x="1" y="1" width="510" height="510" rx="107.5" ry="107.5" fill="none" stroke="url(#icBorder)" stroke-width="2"/>
  <image x="{(512 - sw) / 2:.1f}" y="{(512 - sh) / 2:.1f}" width="{sw:.1f}" height="{sh:.1f}" filter="url(#icGlow)"
         href="data:image/png;base64,{b64}"/>
</svg>
'''
    with open(f'{WEB}/brunetti-logo-icon.svg', 'w') as f:
        f.write(svg)
    print(f'  {os.path.relpath(WEB, ROOT)}/brunetti-logo-icon.svg')

    print('badge de notificaciones (Android solo usa el alfa)')
    bh = 84; bw = round(mark.width * bh / mark.height)
    sil = np.asarray(mark.resize((bw, bh), Image.LANCZOS)).copy()
    sil[..., 0] = sil[..., 1] = sil[..., 2] = 255
    badge = Image.new('RGBA', (96, 96), (255, 255, 255, 0))
    badge.paste(Image.fromarray(sil), ((96 - bw) // 2, (96 - bh) // 2))
    save(badge, f'{WEB}/brunetti-badge.png')

    print('iOS AppIcon')
    for size in (40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 192, 512, 1024):
        save(icon(size, mark), f'{IOS}/AppIcon.appiconset/icon-{size}.png', keep_alpha=False)

    print('iOS LogoIcon')
    save(icon(512, mark, RADIUS), f'{IOS}/LogoIcon.imageset/brunetti-logo-icon-512.png')


if __name__ == '__main__':
    main()
