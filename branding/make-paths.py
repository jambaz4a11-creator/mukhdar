"""Temporary logo: shapes the Arabic name with HarfBuzz and writes SVGs with the text already converted to
outline paths (no font dependency at render time). Run once; the generated SVGs are committed.

  python -m pip install fonttools uharfbuzz
  python branding/make-paths.py <path-to-Cairo[slnt,wght].ttf>      (Cairo, SIL OFL)

Replace the whole branding/ folder's SVGs with the real logo later and rerun `pnpm brand:icons`.
"""
import sys
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

GREEN, CREAM = "#1F6B3A", "#F7F8F3"
font_path = sys.argv[1]
blob = hb.Blob.from_file_path(font_path)
face = hb.Face(blob)
font = hb.Font(face)
font.set_variations({"wght": 800})


def line_paths(text):
    """Return (svg path d, (xmin, ymin, xmax, ymax)) for one shaped line, y down, origin at baseline-left."""
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    x = 0
    pen_d = []
    bp = BoundsPen(None)
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        sp = SVGPathPen(None)
        # flip y; translate to the glyph's pen position
        t = (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)
        font.draw_glyph_with_pen(info.codepoint, TransformPen(sp, t))
        font.draw_glyph_with_pen(info.codepoint, TransformPen(bp, t))
        pen_d.append(sp.getCommands())
        x += pos.x_advance
    return " ".join(d for d in pen_d if d), bp.bounds


def place(d, bounds, cx, baseline, target_h=None, scale=1.0):
    xmin, ymin, xmax, ymax = bounds
    w = xmax - xmin
    tx = cx - (xmin + w / 2) * scale
    return f'<path transform="translate({tx:.2f} {baseline:.2f}) scale({scale:.5f})" d="{d}"/>', w * scale


souq_d, souq_b = line_paths("سوق")
bas_d, bas_b = line_paths("بسماوي")
both_d, both_b = line_paths("سوق بسماوي")

# 1) wordmark: one line, green, tight viewBox with padding
pad = 40
xmin, ymin, xmax, ymax = both_b
vw, vh = (xmax - xmin) + 2 * pad, (ymax - ymin) + 2 * pad
open("branding/logo-wordmark.svg", "w", encoding="utf-8").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw:.0f} {vh:.0f}" role="img" aria-label="سوق بسماوي · Souq Basmawi">'
    f'<g fill="{GREEN}"><path transform="translate({pad - xmin:.2f} {pad - ymin:.2f})" d="{both_d}"/></g></svg>\n'
)


def stacked(fill, size=1024, cx=None, top=None, height=None):
    """Two lines (سوق big / بسماوي smaller) centred in a size x size box occupying `height` of it."""
    cx = size / 2 if cx is None else cx
    # scale so the wider line is ~ 62% of the box (kept inside the 66% adaptive-icon safe zone)
    s_big = (size * 0.56) / (souq_b[2] - souq_b[0])
    s_small = (size * 0.60) / (bas_b[2] - bas_b[0])
    h_big = (souq_b[3] - souq_b[1]) * s_big
    h_small = (bas_b[3] - bas_b[1]) * s_small
    gap = size * 0.07
    total = h_big + gap + h_small
    y0 = (size - total) / 2
    base1 = y0 - souq_b[1] * s_big
    base2 = y0 + h_big + gap - bas_b[1] * s_small
    p1, _ = place(souq_d, souq_b, cx, base1, scale=s_big)
    p2, _ = place(bas_d, bas_b, cx, base2, scale=s_small)
    return f'<g fill="{fill}">{p1}{p2}</g>'


def svg(inner, size=1024):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{inner}</svg>\n'


W = f'<rect width="1024" height="1024" fill="{GREEN}"/>'
# full-bleed square (iOS / maskable / adaptive-background source: the OS applies its own mask)
open("branding/logo-icon.svg", "w", encoding="utf-8").write(svg(W + stacked(CREAM)))
# foreground only (transparent) for the Android adaptive icon + monochrome (single colour, black)
open("branding/logo-foreground.svg", "w", encoding="utf-8").write(svg(stacked(CREAM)))
open("branding/logo-monochrome.svg", "w", encoding="utf-8").write(svg(stacked("#000000")))
# splash mark: green text on the cream splash background
open("branding/logo-splash.svg", "w", encoding="utf-8").write(svg(stacked(GREEN)))
print("ok")
