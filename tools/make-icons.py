"""Build the ScoreShift icon set from the master mark (a rounded-square app icon, ink on paper).

    python tools/make-icons.py "C:/Users/Chris/Desktop/ss.png"

Writes dist/favicon.ico and dist/icons/*: PNG favicons, the Apple touch icon (opaque, iOS ignores
alpha), the web-manifest icons (a maskable one with safe padding), and mark.png, the glyph alone on
a transparent ground for use inline on paper surfaces.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(HERE, "dist")
ICONS = os.path.join(DIST, "icons")
PAPER = (247, 246, 241)


def square(im):
    side = max(im.size)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return out


def opaque(im, color=PAPER):
    out = Image.new("RGBA", im.size, color + (255,))
    out.alpha_composite(im)
    return out.convert("RGB")


def glyph_only(im):
    """Ink with alpha from darkness, so the mark sits on any paper tone without a visible tile."""
    px = im.convert("RGBA").load()
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    op = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = (r * 299 + g * 587 + b * 114) / 1000 / 255
            alpha = int(round(max(0.0, min(1.0, (0.97 - lum) / 0.85)) * 255 * a / 255))
            if alpha:
                op[x, y] = (20, 20, 20, alpha)
    return out


def maskable(im, size=512):
    """Icon content inside the 80% safe zone, on paper edge to edge."""
    out = Image.new("RGB", (size, size), PAPER)
    inner = int(size * 0.8)
    out.paste(opaque(im.resize((inner, inner), Image.LANCZOS)), ((size - inner) // 2, (size - inner) // 2))
    return out


def clean_tile(im, radius=0.22):
    """The master's ink on a fresh paper tile with rounded corners: the source tile carries a faint
    band and an off-tone ground, so every icon is rebuilt from the glyph instead of resampled."""
    from PIL import ImageDraw
    side = im.width
    tile = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, side - 1, side - 1), radius=int(side * radius), fill=PAPER + (255,))
    tile.alpha_composite(glyph_only(im))
    return tile


def main():
    src = sys.argv[1]
    master = clean_tile(square(Image.open(src).convert("RGBA")))
    os.makedirs(ICONS, exist_ok=True)
    fit = lambda n: master.resize((n, n), Image.LANCZOS)
    fit(32).save(os.path.join(ICONS, "favicon-32.png"))
    fit(16).save(os.path.join(ICONS, "favicon-16.png"))
    opaque(fit(180)).save(os.path.join(ICONS, "apple-touch-icon.png"))
    fit(192).save(os.path.join(ICONS, "icon-192.png"))
    fit(512).save(os.path.join(ICONS, "icon-512.png"))
    maskable(master).save(os.path.join(ICONS, "icon-maskable-512.png"))
    glyph = glyph_only(master)
    glyph = square(glyph.crop(glyph.getbbox()))
    glyph.resize((256, 256), Image.LANCZOS).save(os.path.join(ICONS, "mark.png"))
    fit(48).save(os.path.join(DIST, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    for name in sorted(os.listdir(ICONS)):
        print(name, os.path.getsize(os.path.join(ICONS, name)), "bytes")
    print("favicon.ico", os.path.getsize(os.path.join(DIST, "favicon.ico")), "bytes")


if __name__ == "__main__":
    main()
