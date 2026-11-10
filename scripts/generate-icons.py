#!/usr/bin/env python3
"""Regenerate CourseVault's app icons (src-tauri/icons/).

The icon is a blue rounded square with a white open book, grey text lines
and a blue bookmark. The PNG/ICO files themselves are binary, so they are
not included in snapshot pushes of this branch — run this script after a
fresh clone (before `npx tauri build`) to recreate them:

    python3 scripts/generate-icons.py

Requires Pillow: pip install Pillow
"""

from pathlib import Path

from PIL import Image, ImageDraw

BLUE = (37, 99, 235)       # #2563eb — the app's brand blue
LIGHT_BLUE = (147, 197, 253)  # #93c5fd — spine
PAGE_RIGHT = (219, 234, 254)  # #dbeafe — right page
WHITE = (255, 255, 255)
GREY = (100, 116, 139)     # #64748b — text lines

BASE = 1024  # draw big, then downscale for crisp edges


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / BASE  # scale factor for all coordinates below

    def R(v: float) -> float:
        return v * s

    # Blue rounded-square background.
    d.rounded_rectangle(
        [R(8), R(8), R(1016), R(1016)], radius=R(220), fill=BLUE + (255,)
    )

    # Open book: left page white, right page light blue, spine between.
    book_top, book_bottom = R(330), R(850)
    book_left, book_right = R(232), R(792)
    mid = (book_left + book_right) / 2
    spine_w = R(28)
    d.rounded_rectangle(
        [book_left, book_top, mid - spine_w / 2, book_bottom],
        radius=R(28),
        fill=WHITE + (255,),
    )
    d.rounded_rectangle(
        [mid + spine_w / 2, book_top, book_right, book_bottom],
        radius=R(28),
        fill=PAGE_RIGHT + (255,),
    )
    # Square off the inner edges so the two pages meet cleanly.
    d.rectangle(
        [mid - spine_w / 2 - R(28), book_top, mid + spine_w / 2, book_bottom],
        fill=LIGHT_BLUE + (255,),
    )
    d.rectangle(
        [mid - spine_w / 2, book_top, mid + spine_w / 2, book_bottom],
        fill=LIGHT_BLUE + (255,),
    )

    # Grey text lines, three per page.
    line_h = R(36)
    line_w = R(196)
    for i, y in enumerate((R(430), R(540), R(650))):
        d.rounded_rectangle(
            [R(268), y, R(268) + line_w, y + line_h],
            radius=R(18),
            fill=GREY + (255,),
        )
        d.rounded_rectangle(
            [R(560), y, R(560) + line_w, y + line_h],
            radius=R(18),
            fill=GREY + (255,),
        )

    # Blue bookmark on the right page.
    bm_left, bm_right = R(676), R(756)
    bm_top, bm_bottom = book_top, R(540)
    d.rectangle([bm_left, bm_top, bm_right, bm_bottom], fill=BLUE + (255,))
    d.polygon(
        [
            (bm_left, bm_bottom),
            (bm_right, bm_bottom),
            ((bm_left + bm_right) / 2, bm_bottom - R(40)),
        ],
        fill=PAGE_RIGHT + (255,),
    )
    return img


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
    out.mkdir(parents=True, exist_ok=True)

    icon512 = draw_icon(512)
    icon512.save(out / "icon.png")

    for name, size in (("128x128@2x.png", 256), ("128x128.png", 128), ("32x32.png", 32)):
        draw_icon(size).save(out / name)

    # .ico with several sizes inside.
    icon512.save(
        out / "icon.ico",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    print(f"Wrote icons to {out}")


if __name__ == "__main__":
    main()
