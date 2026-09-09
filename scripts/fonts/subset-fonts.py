#!/usr/bin/env python3
"""Build the reading faces the EPUB pages are set in (docs/64).

Page numbers have to agree across devices, so the page layout may not depend on
whatever fonts a device happens to have: the faces ship with the app. Noto
Serif for Latin (regular, bold, italic) and one weight of Noto Serif CJK SC,
subset to the characters a Chinese book uses (GB 2312 plus CJK punctuation and
fullwidth forms). A character outside the subset falls back to the system's
CJK face, which costs that glyph its shape and nothing else.

Input is the Debian fonts-noto-core / fonts-noto-cjk packages; output goes to
public/fonts/ as WOFF2 with the OFL beside it. Re-run when the subset changes.

usage: python3 scripts/fonts/subset-fonts.py
"""
import gzip, os, pathlib, sys
from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "fonts"
LATIN_DIR = pathlib.Path("/usr/share/fonts/truetype/noto")
CJK_TTC = pathlib.Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc")
CJK_FACE = "Noto Serif CJK SC"

# Latin, Latin Extended, Greek, Cyrillic, general punctuation, currency,
# letterlike, arrows, math operators, box drawing, geometric shapes.
LATIN_UNICODES = (
    "U+0000-024F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,"
    "U+2100-214F,U+2190-21FF,U+2200-22FF,U+2500-259F,U+25A0-25FF,U+2600-26FF,"
    "U+FB00-FB06,U+FEFF,U+FFFD"
)


def gb2312_chars() -> set[str]:
    chars = set()
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return chars


def cjk_unicodes() -> str:
    codes = sorted({ord(c) for c in gb2312_chars()})
    ranges = ["U+3000-303F", "U+FF00-FFEF", "U+2E80-2EFF", "U+2F00-2FDF", "U+3040-30FF"]
    ranges += [f"U+{c:04X}" for c in codes]
    return ",".join(ranges)


def run(font_path: str, unicodes: str, out: pathlib.Path, font_number: int | None = None):
    args = [
        font_path,
        f"--unicodes={unicodes}",
        "--flavor=woff2",
        f"--output-file={out}",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        "--name-IDs=*",
        "--notdef-outline",
    ]
    if font_number is not None:
        args.append(f"--font-number={font_number}")
    subset.main(args)
    print(f"{out.name}: {out.stat().st_size / 1e6:.2f} MB")


def cjk_face_index() -> int:
    for i, f in enumerate(TTCollection(str(CJK_TTC)).fonts):
        if f["name"].getDebugName(1) == CJK_FACE:
            return i
    sys.exit(f"{CJK_FACE} not in {CJK_TTC}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for style in ("Regular", "Bold", "Italic", "BoldItalic"):
        run(str(LATIN_DIR / f"NotoSerif-{style}.ttf"), LATIN_UNICODES, OUT / f"NotoSerif-{style}.woff2")
    run(str(CJK_TTC), cjk_unicodes(), OUT / "NotoSerifCJKsc-Regular.woff2", cjk_face_index())
    # The OFL as shipped with the Debian package; both families are under it.
    copyright = pathlib.Path("/usr/share/doc/fonts-noto-cjk/copyright").read_text()
    (OUT / "LICENSE-OFL.txt").write_text(copyright)
    total = sum(p.stat().st_size for p in OUT.glob("*.woff2"))
    print(f"total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
