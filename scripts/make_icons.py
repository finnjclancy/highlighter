"""Generate Highlighter extension icons (16, 32, 48, 128 PNG).

Design: rounded-square gradient tile (indigo -> pink) with a single bold
diagonal "highlighter swipe" — a thick rounded bar across the face. Reads
clearly at every size including the toolbar's 16px.
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

START = (99, 102, 241)   # #6366f1 indigo
END   = (236, 72, 153)   # #ec4899 pink

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def render(size: int) -> Image.Image:
    s = size * 8  # 8x supersample for very clean edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # 1) Rounded-square diagonal gradient
    radius = int(s * 0.235)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=radius, fill=255)

    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            r, g, b = lerp(START, END, t)
            px[x, y] = (r, g, b, 255)
    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)
    img.alpha_composite(tile)

    # 2) Subtle inner highlight (top-left → soft glow)
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gpx = glow.load()
    for y in range(s):
        for x in range(s):
            d = ((x / s) + (y / s)) / 2          # 0 (top-left) → 1 (bottom-right)
            a = int(max(0, (1 - d) ** 2 * 38))    # soft falloff
            gpx[x, y] = (255, 255, 255, a)
    glow_masked = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow_masked.paste(glow, (0, 0), mask)
    img.alpha_composite(glow_masked)

    # 3) The highlighter "swipe" — a thick rounded diagonal bar.
    # Build it horizontally then rotate.
    bar_w = int(s * 0.78)
    bar_h = int(s * 0.30)
    bar = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bx = (s - bar_w) // 2
    by = (s - bar_h) // 2
    ImageDraw.Draw(bar).rounded_rectangle(
        (bx, by, bx + bar_w, by + bar_h),
        radius=bar_h // 2,
        fill=(255, 255, 255, 245),
    )
    bar = bar.rotate(-32, resample=Image.BICUBIC, center=(s // 2, s // 2))
    img.alpha_composite(bar)

    # 4) Hairline rim for crispness against light backgrounds
    rim = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(
        (1, 1, s - 1, s - 1),
        radius=radius - 1,
        outline=(255, 255, 255, 55),
        width=max(2, s // 96),
    )
    img.alpha_composite(rim)

    return img.resize((size, size), Image.LANCZOS)


for size in (16, 32, 48, 128):
    out = os.path.join(OUT_DIR, f"icon-{size}.png")
    render(size).save(out, "PNG", optimize=True)
    print(f"wrote {out}")
