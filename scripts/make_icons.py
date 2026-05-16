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


# -------- promotional tile for the Chrome Web Store (440 x 280) --------
def render_promo(width: int = 440, height: int = 280) -> Image.Image:
    """Branded promo card: gradient background, large icon, wordmark + tagline."""
    img = Image.new("RGBA", (width, height), (12, 12, 14, 255))
    draw = ImageDraw.Draw(img)

    # Soft diagonal gradient panel on the right ~half
    grad_w = int(width * 0.55)
    grad_x0 = width - grad_w
    grad = Image.new("RGBA", (grad_w, height), (0, 0, 0, 0))
    gpx = grad.load()
    for y in range(height):
        for x in range(grad_w):
            t = (x + y) / (grad_w + height)
            r, g, b = lerp(START, END, min(1.0, t))
            a = int(180 * max(0.0, 1.0 - abs(0.5 - t) * 1.4))
            gpx[x, y] = (r, g, b, a)
    img.alpha_composite(grad, (grad_x0, 0))

    # Big rounded-square icon on the left
    icon_size = 140
    icon = render(icon_size)
    img.alpha_composite(icon, (40, (height - icon_size) // 2))

    # Wordmark + tagline (Pillow's default font is fine for this size; the
    # store renders this image at 440x280 so legibility holds)
    try:
        from PIL import ImageFont
        # Try a system font; fall back to default
        font_title = None
        font_sub = None
        for cand in (
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNS.ttf",
            "/Library/Fonts/Arial Bold.ttf",
        ):
            if os.path.exists(cand):
                font_title = ImageFont.truetype(cand, 36)
                font_sub = ImageFont.truetype(cand, 16)
                break
        if not font_title:
            font_title = ImageFont.load_default()
            font_sub = ImageFont.load_default()
    except Exception:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    text_x = 40 + icon_size + 24
    draw.text((text_x, 92), "Highlighter", fill=(250, 250, 250, 255), font=font_title)
    draw.text((text_x, 142), "Highlight any page.", fill=(190, 190, 205, 255), font=font_sub)
    draw.text((text_x, 164), "Share what you read.", fill=(190, 190, 205, 255), font=font_sub)

    return img


promo_out = os.path.join(OUT_DIR, "promo-440x280.png")
render_promo().save(promo_out, "PNG", optimize=True)
print(f"wrote {promo_out}")
