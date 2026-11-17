#!/usr/bin/env python3
"""Generates the photo fixtures in web/e2e/fixtures/ (documented in web/e2e/fixtures/SOURCES.md).

    pip install pillow
    python3 web/scripts/make-fixtures.py

The outputs are committed, so CI and other developers never need Python. Source images (public domain /
CC0 only) are downloaded from GitHub at pinned commits into node_modules/.cache/photosorting-fixtures/.
Every JPEG gets an EXIF capture time on a realistic shoot timeline (near-duplicates seconds apart,
other shots minutes apart), except scene-hubble.jpg, which deliberately has no EXIF date.
"""

from __future__ import annotations

import io
import math
import random
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageStat

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "e2e" / "fixtures"
CACHE = WEB / "node_modules" / ".cache" / "photosorting-fixtures"

CONGRESS = "https://raw.githubusercontent.com/unitedstates/images/aec3e4a88af843b282c0576f420b930f6a9a46ad/congress/original/{}.jpg"
SKIMAGE = "https://raw.githubusercontent.com/scikit-image/scikit-image/6a1a73f5b64cb7a0ba83367f30ee612b1d70d98c/src/_skimage2/data/{}"

JPEG_QUALITY = 85
SHOOT_START = datetime(2025, 6, 14, 14, 0, 0)
SHOOT_UTC_OFFSET = "-04:00"


def fetch(url: str) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / url.rsplit("/", 1)[-1]
    if not path.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    return Image.open(path).convert("RGB")


def congress(bioguide: str) -> Image.Image:
    return fetch(CONGRESS.format(bioguide))


def skimage(name: str) -> Image.Image:
    return fetch(SKIMAGE.format(name))


def at(minutes: int, seconds: int = 0) -> datetime:
    return SHOOT_START + timedelta(minutes=minutes, seconds=seconds)


def exif_block(taken: datetime | None, orientation: int | None = None) -> bytes:
    exif = Image.Exif()
    if orientation is not None:
        exif[0x0112] = orientation  # Orientation
    if taken is not None:
        stamp = taken.strftime("%Y:%m:%d %H:%M:%S")
        exif[0x0132] = stamp  # DateTime (last modified)
        sub = exif.get_ifd(0x8769)  # Exif IFD
        sub[0x9003] = stamp  # DateTimeOriginal
        sub[0x9004] = stamp  # DateTimeDigitized ("CreateDate")
        sub[0x9011] = SHOOT_UTC_OFFSET  # OffsetTimeOriginal
    return exif.tobytes()


def save_jpeg(image: Image.Image, name: str, taken: datetime | None, orientation: int | None = None) -> None:
    longest = max(image.size)
    assert longest <= 1600, f"{name}: long edge {longest} > 1600"
    image.save(OUT / name, "JPEG", quality=JPEG_QUALITY, optimize=True, exif=exif_block(taken, orientation))
    print(f"  {name:36} {image.width}x{image.height}")


def save_png(image: Image.Image, name: str) -> None:
    image.save(OUT / name, "PNG", optimize=True)
    print(f"  {name:36} {image.width}x{image.height}")


# --- Derivations ------------------------------------------------------------------------------------


def blurred(image: Image.Image, radius_fraction: float) -> Image.Image:
    """Gaussian blur with a radius relative to the long edge, so it reads the same at any size."""
    return image.filter(ImageFilter.GaussianBlur(radius_fraction * max(image.size)))


def exposure(image: Image.Image, factor: float) -> Image.Image:
    return ImageEnhance.Brightness(image).enhance(factor)


def near_duplicate(image: Image.Image, dx: float, dy: float, zoom: float, brightness: float) -> Image.Image:
    """Same moment, camera moved slightly: shift + slight zoom, then a small exposure change."""
    w, h = image.size
    cw, ch = w * (1 - zoom), h * (1 - zoom)
    left = (w - cw) / 2 + dx * w
    top = (h - ch) / 2 + dy * h
    crop = image.crop((round(left), round(top), round(left + cw), round(top + ch)))
    return exposure(crop.resize((w, h), Image.Resampling.LANCZOS), brightness)


def ellipse_mask(size: tuple[int, int], box: tuple[float, float, float, float], feather: float) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(feather))


def head_and_shoulders(portrait: Image.Image, width: int) -> tuple[Image.Image, Image.Image]:
    """Scales an official portrait to `width` and returns it with a soft rounded mask (for collages)."""
    height = round(portrait.height * width / portrait.width)
    person = portrait.resize((width, height), Image.Resampling.LANCZOS)
    mask = Image.new("L", (width, height), 0)
    inset = 0.04 * width
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, width - inset, height + width), radius=width * 0.45, fill=255)
    return person, mask.filter(ImageFilter.GaussianBlur(0.03 * width))


# Official portraits are framed consistently: the face is ~40% of the image width.
FACE_WIDTH_IN_PORTRAIT = 0.40


def collage(background: Image.Image, people: list[tuple[Image.Image, float, float, float]]) -> Image.Image:
    """Pastes people (portrait, face width as a fraction of the canvas width, center x, top y as fractions)."""
    canvas = background.copy()
    cw, ch = canvas.size
    for portrait, face_fraction, cx, top in people:
        width = round(face_fraction * cw / FACE_WIDTH_IN_PORTRAIT)
        person, mask = head_and_shoulders(portrait, width)
        canvas.paste(person, (round(cx * cw - width / 2), round(top * ch)), mask)
    return canvas


def outdoor_backdrop(size: tuple[int, int], seed: int) -> Image.Image:
    """Synthetic out-of-focus outdoor background: pale sky over foliage with soft colour blotches."""
    rng = random.Random(seed)
    columns, rows = 12, 8
    cells = []
    for row in range(rows):
        sky = row < rows * 0.35
        for _ in range(columns):
            if sky:
                cells.append((rng.randint(170, 205), rng.randint(195, 220), rng.randint(215, 240)))
            else:
                cells.append((rng.randint(40, 110), rng.randint(80, 140), rng.randint(30, 80)))
    grid = Image.new("RGB", (columns, rows))
    grid.putdata(cells)
    return grid.resize(size, Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(0.01 * max(size)))


def cover(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Covers `size` with `source`: scaled to fill, center crop."""
    scale = max(size[0] / source.width, size[1] / source.height)
    scaled = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    left, top = (scaled.width - size[0]) // 2, (scaled.height - size[1]) // 2
    return scaled.crop((left, top, left + size[0], top + size[1]))


def backdrop(source: Image.Image, size: tuple[int, int], blur_fraction: float) -> Image.Image:
    """Covers `size` with `source` (center crop) and blurs it like an out-of-focus background."""
    return blurred(cover(source, size), blur_fraction)


Point = tuple[float, float]


def sunglasses(image: Image.Image, eyes: list[tuple[Point, Point]]) -> Image.Image:
    """Draws opaque dark sunglasses (lenses, frame, bridge, temples) over eyes given by their (outer, inner) corners."""
    image = image.copy()
    draw = ImageDraw.Draw(image)
    eye_width = sum(math.dist(outer, inner) for outer, inner in eyes) / len(eyes)
    lens_width, lens_height = 1.9 * eye_width, 1.45 * eye_width
    frame = max(2, round(0.09 * eye_width))
    black = (5, 5, 6)
    lenses = []
    for outer, inner in eyes:
        cx, cy = (outer[0] + inner[0]) / 2, (outer[1] + inner[1]) / 2
        lens = (cx - lens_width / 2, cy - 0.55 * lens_height, cx + lens_width / 2, cy + 0.45 * lens_height)
        lenses.append(lens)
        draw.rounded_rectangle(lens, radius=0.42 * lens_height, fill=(18, 20, 24), outline=black, width=frame)
        reflection = (lens[0] + 0.15 * lens_width, lens[1] + 0.12 * lens_height, lens[2] - 0.2 * lens_width, lens[1] + 0.55 * lens_height)
        draw.chord(reflection, 200, 300, fill=(48, 52, 60))
    left, right = sorted(lenses, key=lambda lens: lens[0])
    bar = sum(outer[1] + inner[1] for outer, inner in eyes) / (2 * len(eyes)) - 0.3 * lens_height
    draw.line(((left[2] - frame, bar), (right[0] + frame, bar)), fill=black, width=frame + 1)
    draw.line(((left[0], bar), (left[0] - 0.9 * eye_width, bar - 0.05 * eye_width)), fill=black, width=frame)
    draw.line(((right[2], bar), (right[2] + 0.9 * eye_width, bar - 0.05 * eye_width)), fill=black, width=frame)
    return image


def closed_eyes(image: Image.Image, eyes: list[list[Point]]) -> Image.Image:
    """
    Paints eyes shut. Each eye is the outline of its opening, 16 points: the outer corner, along the lower lid to the
    inner corner (index 8), then back along the upper lid. The opening is filled with the skin color below the eye,
    then a lash line is drawn along the lower lid and a lid crease above it.
    """
    for outline in eyes:
        outer, inner = outline[0], outline[8]
        eye_width = math.dist(outer, inner)
        cx, cy = (outer[0] + inner[0]) / 2, (outer[1] + inner[1]) / 2
        cheek = (int(cx - 0.2 * eye_width), int(cy + 0.45 * eye_width), int(cx + 0.2 * eye_width), int(cy + 0.6 * eye_width))
        skin = tuple(ImageStat.Stat(image.crop(cheek)).median)
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).polygon(outline, fill=255)
        mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(0.06 * eye_width))
        image = Image.composite(Image.new("RGB", image.size, skin), image, mask)
        draw = ImageDraw.Draw(image)
        draw.line(outline[:9], fill=(40, 28, 24), width=max(2, round(0.07 * eye_width)), joint="curve")
        crease = [outer] + [(x, y - 0.18 * eye_width) for x, y in outline[14:9:-1]] + [inner]
        draw.line(crease, fill=tuple(max(0, c - 35) for c in skin), width=max(1, round(0.03 * eye_width)), joint="curve")
    return image


# --- Fixtures ---------------------------------------------------------------------------------------


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Writing fixtures to {OUT}")

    # Single portraits: broad toothy smiles vs. neutral, closed-mouth expressions.
    smiles = {"a": "C001067", "b": "C001131", "c": "F000476", "d": "B001287"}
    neutrals = {"a": "P000603", "b": "F000448", "c": "B001291", "d": "R000588"}
    for i, (key, bioguide) in enumerate(smiles.items()):
        save_jpeg(congress(bioguide), f"portrait-smile-{key}.jpg", at(2 + 4 * i, 10))
    for i, (key, bioguide) in enumerate(neutrals.items()):
        save_jpeg(congress(bioguide), f"portrait-neutral-{key}.jpg", at(20 + 4 * i, 30))
    save_jpeg(skimage("astronaut.png"), "portrait-astronaut.jpg", at(37, 5))

    # Eyes: sunglasses drawn over open eyes, and eyes painted shut in a smile (a blink). Eye landmarks (MediaPipe Face
    # Landmarker, subject's left eye first) in the portraits as saved.
    shades = congress("A000376")
    shades = shades.resize((round(shades.width * 825 / shades.height), 825), Image.Resampling.LANCZOS)
    corners = [((370.1, 216.8), (331.7, 216.8)), ((245.5, 211.5), (280.9, 214.6))]
    save_jpeg(sunglasses(shades, corners), "portrait-sunglasses.jpg", at(72, 40))
    outlines = [
        [(455.6, 345.4), (449.9, 348.4), (444.0, 350.4), (435.9, 351.9), (424.1, 352.6), (411.4, 351.6), (399.9, 350.2),
         (392.4, 349.4), (388.7, 348.6), (393.4, 344.1), (403.0, 337.9), (416.1, 333.7), (428.9, 333.4), (440.4, 336.0),
         (448.1, 339.9), (452.4, 342.9)],
        [(242.9, 345.0), (248.9, 347.4), (254.6, 349.1), (262.5, 350.8), (274.4, 351.5), (286.2, 350.6), (297.8, 349.2),
         (305.8, 348.7), (309.1, 347.8), (304.6, 343.6), (295.0, 337.2), (282.3, 332.9), (270.2, 332.6), (258.3, 335.4),
         (250.8, 339.2), (246.4, 342.3)],
    ]
    save_jpeg(closed_eyes(congress("A000374"), outlines), "portrait-eyes-closed.jpg", at(75, 10))

    # Scenery and details without people.
    rocket, coffee = skimage("rocket.jpg"), skimage("coffee.png")
    save_jpeg(rocket, "scene-rocket.jpg", at(40, 0))
    save_jpeg(coffee, "scene-coffee.jpg", at(44, 20))
    save_jpeg(skimage("hubble_deep_field.jpg"), "scene-hubble.jpg", None)  # no EXIF date on purpose
    save_png(skimage("chelsea.png"), "scene-cat.png")

    # Focus: mild and strong blur of a portrait and a scene (shot seconds after the sharp frame).
    smile_a, neutral_a, smile_b = congress(smiles["a"]), congress(neutrals["a"]), congress(smiles["b"])
    save_jpeg(blurred(smile_a, 0.0025), "portrait-smile-a-blur-mild.jpg", at(2, 12))
    save_jpeg(blurred(smile_a, 0.009), "portrait-smile-a-blur-strong.jpg", at(2, 14))
    save_jpeg(blurred(coffee, 0.0025), "scene-coffee-blur-mild.jpg", at(44, 23))
    save_jpeg(blurred(coffee, 0.009), "scene-coffee-blur-strong.jpg", at(44, 26))

    # Exposure: under- and over-exposed frames of a well-exposed portrait.
    save_jpeg(exposure(neutral_a, 0.35), "portrait-neutral-a-under.jpg", at(20, 34))
    save_jpeg(exposure(neutral_a, 1.9), "portrait-neutral-a-over.jpg", at(20, 37))

    # Near-duplicates: same moment, slightly shifted/zoomed and brighter/darker, 2-3 s apart.
    save_jpeg(near_duplicate(smile_b, 0.02, 0.01, 0.03, 1.05), "portrait-smile-b-dup.jpg", at(6, 12))
    save_jpeg(near_duplicate(rocket, -0.025, 0.0, 0.02, 0.95), "scene-rocket-dup.jpg", at(40, 3))

    # Groups: six people with small faces (4-11% of the image width) and a closer three-person group.
    size = (1600, 1067)
    small = [
        (congress("A000381"), 0.035, 0.10, 0.30),
        (congress("B001313"), 0.045, 0.27, 0.12),
        (congress("M001218"), 0.050, 0.50, 0.30),  # straddles the 2x2 tile seams
        (congress("M001229"), 0.060, 0.70, 0.12),
        (congress("S001221"), 0.070, 0.88, 0.32),
        (congress("J000137"), 0.080, 0.36, 0.55),
    ]
    save_jpeg(collage(backdrop(coffee, size, 0.01), small), "group-small-faces.jpg", at(50, 0))
    three = [
        (congress("K000388"), 0.125, 0.20, 0.22),
        (congress("B001286"), 0.120, 0.50, 0.18),
        (congress("M001235"), 0.130, 0.80, 0.24),
    ]
    save_jpeg(collage(backdrop(rocket, size, 0.006), three), "group-three.jpg", at(53, 30))

    # A crowd at the detection limit: ten faces at 2.7-3.8% of the image width (landmark box) in two rows.
    crowd = [
        (congress(bioguide), fraction, 0.1 + 0.2 * i if i < 5 else 0.2 + 0.15 * (i - 5), 0.28 if i < 5 else 0.5)
        for i, (bioguide, fraction) in enumerate(
            [("A000358", 0.023), ("B001289", 0.024), ("C001068", 0.023), ("D000628", 0.024), ("F000474", 0.023),
             ("H001058", 0.026), ("L000550", 0.025), ("M000309", 0.026), ("P000523", 0.025), ("T000461", 0.026)]
        )
    ]
    save_jpeg(collage(outdoor_backdrop(size, seed=7), crowd), "group-crowd.jpg", at(66, 30))

    # Back focus: two people in front of a sharp, detailed scene, then the same frame with the people (and only
    # them) out of focus, as when the camera focuses on the background behind them.
    duo = [(congress("H001062"), 0.15, 0.30, 0.25), (congress("R000601"), 0.15, 0.70, 0.22)]
    in_focus = collage(cover(rocket, (1200, 800)), duo)
    silhouettes = [(Image.new("RGB", portrait.size, "white"), *placement) for portrait, *placement in duo]
    people = collage(Image.new("RGB", in_focus.size), silhouettes).convert("L")
    save_jpeg(in_focus, "duo.jpg", at(69, 0))
    save_jpeg(Image.composite(blurred(in_focus, 0.003), in_focus, people), "duo-back-focus.jpg", at(69, 2))

    # Bokeh: sharp face on a heavily blurred scene (everything but an ellipse around the face is blurred).
    person = [(congress("A000382"), 0.20, 0.5, 0.06)]
    sharp = collage(backdrop(coffee, (1200, 1500), 0.004), person)
    soft = blurred(sharp, 0.012)
    w, h = sharp.size
    face = (0.38 * w, 0.13 * h, 0.62 * w, 0.43 * h)
    save_jpeg(Image.composite(sharp, soft, ellipse_mask(sharp.size, face, 0.01 * w)), "portrait-bokeh.jpg", at(57, 45))

    # Orientation: pixels stored rotated 90 degrees counter-clockwise with EXIF Orientation=6
    # ("rotate 90 CW to display"), so the photo only looks upright when orientation is applied.
    upright = congress("L000602")
    save_jpeg(upright.transpose(Image.Transpose.ROTATE_90), "portrait-rotated-exif6.jpg", at(61, 15), orientation=6)

    # A truncated JPEG (header only, no image data) for failure handling.
    buffer = io.BytesIO()
    upright.save(buffer, "JPEG", quality=JPEG_QUALITY, exif=exif_block(at(63, 0)))
    (OUT / "corrupt.jpg").write_bytes(buffer.getvalue()[:400])
    print(f"  {'corrupt.jpg':36} truncated to 400 bytes")

    total = sum(p.stat().st_size for p in OUT.iterdir() if p.suffix in {".jpg", ".png"})
    print(f"Total fixture size: {total / 1e6:.2f} MB")
    assert total < 4e6, "fixtures must stay under 4 MB"


if __name__ == "__main__":
    main()
