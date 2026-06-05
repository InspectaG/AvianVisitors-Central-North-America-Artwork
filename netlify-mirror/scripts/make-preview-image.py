#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "avian-visitors-preview-20260605-v1.png"
ASSETS = ROOT / "public" / "avian" / "assets" / "illustrations"
IOWAN = "/System/Library/Fonts/Supplemental/Iowan Old Style.ttc"


def font(size, face=0):
    return ImageFont.truetype(IOWAN, size, index=face)


def center_text(draw, y, text, face, fill):
    box = draw.textbbox((0, 0), text, font=face)
    x = (1200 - (box[2] - box[0])) // 2
    draw.text((x, y), text, font=face, fill=fill)


def trimmed(path):
    im = Image.open(path).convert("RGBA")
    alpha_box = im.getchannel("A").getbbox()
    return im.crop(alpha_box) if alpha_box else im


def fit_width(im, width):
    scale = width / im.width
    return im.resize((width, round(im.height * scale)), Image.Resampling.LANCZOS)


def fit_height(im, height):
    scale = height / im.height
    return im.resize((round(im.width * scale), height), Image.Resampling.LANCZOS)


def paste_bird(canvas, slug, size, xy, mode="width", rotate=0):
    src = trimmed(ASSETS / f"{slug}.png")
    src = fit_height(src, size) if mode == "height" else fit_width(src, size)
    if rotate:
        src = src.rotate(rotate, expand=True, resample=Image.Resampling.BICUBIC)
    x, y = xy

    canvas.alpha_composite(src, (x, y))


def main():
    canvas = Image.new("RGBA", (1200, 630), (252, 252, 251, 255))
    draw = ImageDraw.Draw(canvas)

    draw.rectangle((20, 20, 1180, 610), outline=(226, 222, 211, 255), width=2)

    center_text(draw, 56, "Avian Visitors", font(82, 1), (26, 22, 18, 255))

    paste_bird(canvas, "elanoides-forficatus", 392, (34, 142), rotate=-7)
    paste_bird(canvas, "eudocimus-albus", 318, (392, 314))
    paste_bird(canvas, "cyanocitta-cristata", 214, (700, 188))
    paste_bird(canvas, "egretta-tricolor", 350, (878, 168), mode="height")

    center_text(draw, 540, "See what birds are around", font(39, 0), (74, 63, 49, 255))

    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
