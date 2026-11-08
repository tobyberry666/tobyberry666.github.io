"""Generate web-ready assets from the user's two original photos.

Source photos are read-only inputs under assets/images/source/ and are never modified.
Output: cropped, colour-graded, compressed JPEG/WebP pairs in assets/images/.

Run: python tools/make-assets.py
"""
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "images" / "source"
OUT = ROOT / "assets" / "images"

# crop boxes were chosen by inspecting the originals; see docs/superpowers/specs
TEA_CROP = (790, 300, 1860, 1773)      # portrait: head, torso, both arms and the pour
MASK_CROP = (150, 60, 1300, 1800)      # face close-up, keeps the eyes centred


def grade(img: Image.Image) -> Image.Image:
    """Warm-neutral grade that sits with the #F1EDE5 / #C74432 palette."""
    img = ImageEnhance.Color(img).enhance(0.88)
    img = ImageEnhance.Contrast(img).enhance(1.06)
    img = ImageEnhance.Brightness(img).enhance(1.02)
    return img


def export(img: Image.Image, name: str, widths: list[int], quality: int = 82) -> list[str]:
    made = []
    for width in widths:
        ratio = width / img.width
        size = (width, round(img.height * ratio))
        resized = img.resize(size, Image.LANCZOS)
        for suffix, fmt, kw in (
            (".jpg", "JPEG", {"quality": quality, "optimize": True, "progressive": True}),
            (".webp", "WEBP", {"quality": quality, "method": 6}),
        ):
            path = OUT / f"{name}-{width}{suffix}"
            resized.save(path, fmt, **kw)
            made.append(f"{path.name} {path.stat().st_size // 1024}KB {size[0]}x{size[1]}")
    return made


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report = []

    tea = Image.open(SRC / "tea-pour.jpg").convert("RGB")
    report.append(f"source tea-pour.jpg {tea.width}x{tea.height}")
    tea_crop = grade(tea.crop(TEA_CROP))
    report += export(tea_crop, "portrait", [560, 900, 1400], quality=80)

    mask = Image.open(SRC / "mask-selfie.jpg").convert("RGB")
    report.append(f"source mask-selfie.jpg {mask.width}x{mask.height}")
    mask_crop = grade(mask.crop(MASK_CROP))
    report += export(mask_crop, "easter-egg", [420, 760], quality=78)

    print("\n".join(report))


if __name__ == "__main__":
    main()
