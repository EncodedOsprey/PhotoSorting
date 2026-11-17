# Test fixtures

Photos used by the browser tests (`e2e/`). Every file is public domain or CC0, or derived from such files by
[`scripts/make-fixtures.py`](../../scripts/make-fixtures.py) (Pillow), which downloads the sources at pinned commits
and writes all files below. The generated files are committed so CI doesn't need Python. To regenerate:

```sh
pip install pillow
python3 web/scripts/make-fixtures.py
```

All JPEGs are quality 85 with an EXIF `DateTimeOriginal`/`CreateDate` (+ `OffsetTimeOriginal` `-04:00`) on a
shoot timeline starting 2025-06-14 14:00 local time, except `scene-hubble.jpg`, which deliberately has **no EXIF
date**. Near-duplicates and focus variants are seconds after their original; other photos are minutes apart.
Long edges are ≤ 1600 px.

## Sources

| Source | License |
| --- | --- |
| **unitedstates/images** — official photos of members of the US Congress from the Government Printing Office, `https://raw.githubusercontent.com/unitedstates/images/aec3e4a88af843b282c0576f420b930f6a9a46ad/congress/original/<bioguide>.jpg` | Public domain / [CC0 1.0](https://github.com/unitedstates/images/blob/gh-pages/LICENSE) ("Public domain images of members of the US Congress", see the repository README) |
| **scikit-image** sample data, `https://raw.githubusercontent.com/scikit-image/scikit-image/6a1a73f5b64cb7a0ba83367f30ee612b1d70d98c/src/_skimage2/data/<file>` | Per the docstrings in `src/_skimage2/data/_fetchers.py`: `astronaut.png` NASA, public domain; `rocket.jpg` SpaceX, released into the public domain; `coffee.png` CC0 (Rachel Michetti); `chelsea.png` CC0 (Stefan van der Walt); `hubble_deep_field.jpg` NASA, public domain |

## Files

Capture times are local wall-clock times on 2025-06-14 (UTC−4).

| File | Size | Made from | How | EXIF time |
| --- | --- | --- | --- | --- |
| `portrait-smile-a.jpg` | 675×825 | congress `C001067` | re-encoded | 14:02:10 |
| `portrait-smile-a-blur-mild.jpg` | 675×825 | `C001067` | Gaussian blur, radius 0.25% of the long edge | 14:02:12 |
| `portrait-smile-a-blur-strong.jpg` | 675×825 | `C001067` | Gaussian blur, radius 0.9% of the long edge | 14:02:14 |
| `portrait-smile-b.jpg` | 450×550 | congress `C001131` | re-encoded | 14:06:10 |
| `portrait-smile-b-dup.jpg` | 450×550 | `C001131` | near-duplicate: 3% zoom, shifted 2% right / 1% down, brightness ×1.05 | 14:06:12 |
| `portrait-smile-c.jpg` | 450×550 | congress `F000476` | re-encoded | 14:10:10 |
| `portrait-smile-d.jpg` | 675×825 | congress `B001287` | re-encoded | 14:14:10 |
| `portrait-neutral-a.jpg` | 675×825 | congress `P000603` | re-encoded | 14:20:30 |
| `portrait-neutral-a-under.jpg` | 675×825 | `P000603` | brightness ×0.35 (underexposed) | 14:20:34 |
| `portrait-neutral-a-over.jpg` | 675×825 | `P000603` | brightness ×1.9 (overexposed, clipped highlights) | 14:20:37 |
| `portrait-neutral-b.jpg` | 675×825 | congress `F000448` | re-encoded | 14:24:30 |
| `portrait-neutral-c.jpg` | 675×825 | congress `B001291` | re-encoded | 14:28:30 |
| `portrait-neutral-d.jpg` | 675×825 | congress `R000588` | re-encoded | 14:32:30 |
| `portrait-astronaut.jpg` | 512×512 | scikit-image `astronaut.png` | re-encoded as JPEG | 14:37:05 |
| `scene-rocket.jpg` | 640×427 | scikit-image `rocket.jpg` | re-encoded | 14:40:00 |
| `scene-rocket-dup.jpg` | 640×427 | `rocket.jpg` | near-duplicate: 2% zoom, shifted 2.5% left, brightness ×0.95 | 14:40:03 |
| `scene-coffee.jpg` | 600×400 | scikit-image `coffee.png` | re-encoded as JPEG | 14:44:20 |
| `scene-coffee-blur-mild.jpg` | 600×400 | `coffee.png` | Gaussian blur, radius 0.25% of the long edge | 14:44:23 |
| `scene-coffee-blur-strong.jpg` | 600×400 | `coffee.png` | Gaussian blur, radius 0.9% of the long edge | 14:44:26 |
| `scene-hubble.jpg` | 1000×872 | scikit-image `hubble_deep_field.jpg` | re-encoded, **no EXIF date** | — |
| `scene-cat.png` | 451×300 | scikit-image `chelsea.png` | re-saved as PNG (no EXIF) | — |
| `group-small-faces.jpg` | 1600×1067 | congress `A000381`, `B001313`, `M001218`, `M001229`, `S001221`, `J000137` on a blurred `coffee.png` | collage: six people, faces 4–11% of the image width (MediaPipe landmark box; one straddles the image center) | 14:50:00 |
| `group-three.jpg` | 1600×1067 | congress `K000388`, `B001286`, `M001235` on a blurred `rocket.jpg` | collage: three people, faces 14–16% of the image width | 14:53:30 |
| `portrait-bokeh.jpg` | 1200×1500 | congress `A000382` on `coffee.png` | collage, then everything except an ellipse around the face blurred (radius 1.2% of the long edge): sharp face, creamy background | 14:57:45 |
| `portrait-rotated-exif6.jpg` | stored 550×450, displays 450×550 | congress `L000602` | pixels rotated 90° counter-clockwise + EXIF `Orientation=6`, so it is only upright when orientation is applied | 15:01:15 |
| `corrupt.jpg` | — | `L000602` | the first 400 bytes of a JPEG (headers only, no image data): cannot be decoded | — |
| `group-crowd.jpg` | 1600×1067 | congress `A000358`, `B001289`, `C001068`, `D000628`, `F000474`, `H001058`, `L000550`, `M000309`, `P000523`, `T000461` on a synthetic backdrop (smooth random sky/foliage colours, seeded) | collage: ten people in two rows, faces 2.7–3.8% of the image width (the detection limit) | 15:06:30 |
| `duo.jpg` | 1200×800 | congress `H001062`, `R000601` on a sharp `rocket.jpg` (scaled to fill, center crop) | collage: two people, faces 18–19% of the image width, all in focus | 15:09:00 |
| `duo-back-focus.jpg` | 1200×800 | `duo.jpg` | back focus: only the two people Gaussian-blurred (radius 0.3% of the long edge), the background stays sharp | 15:09:02 |
| `portrait-sunglasses.jpg` | 628×825 | congress `A000376`, scaled to 825 px high | opaque dark sunglasses (lenses, frame, bridge, temples) drawn over the open eyes | 15:12:40 |
| `portrait-eyes-closed.jpg` | 675×825 | congress `A000374` | eyes painted shut mid-smile (a blink): openings filled with cheek skin colour, lash line and lid crease drawn | 15:15:10 |

## Expectations used by the tests

- Smiles: `portrait-smile-*` show broad, toothy smiles; `portrait-neutral-*` closed-mouth, neutral expressions.
- Eyes: everybody has their eyes open, except `portrait-eyes-closed` (shut) and `portrait-sunglasses` (hidden).
  `portrait-smile-c`'s broad smile narrows the eyes, and two `group-crowd` faces smile narrowly behind glasses with
  eyes only ~10 px wide: open, but less clearly so.
- No people: `scene-*` (the cat is a cat).
- Near-duplicate pairs: `portrait-smile-b` / `portrait-smile-b-dup`, `scene-rocket` / `scene-rocket-dup`.
  The focus and exposure variants (and `duo-back-focus` of `duo`) are also the same moment as their original.
- Faces: `group-crowd` 10, `group-small-faces` 6, `group-three` 3, `duo*` 2, each `portrait-*` 1, `scene-*` 0.
- Focus: `portrait-bokeh` has a sharp face on a blurred background, so it is sharp; `duo-back-focus` has soft faces
  on a sharp background (whole-image sharpness above the blurry threshold), so it is blurry, unlike `duo`.
- `group-small-faces` and `portrait-bokeh` sit on a blurred `coffee.png`, so `group-small-faces` has a colour layout
  close to `scene-coffee` (descriptor distance ≈ 0.06). They are 5m40s apart, beyond the near-duplicate time window.
