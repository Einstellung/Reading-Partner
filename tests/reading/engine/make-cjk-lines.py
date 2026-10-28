# Writes cjk-lines.pdf, the fixture pdf-lines.test.ts reads with the real
# PDFium: a Chinese paragraph in Noto Sans CJK SC, whose loose glyph boxes are
# about twice the line pitch (docs/pitfall/embedpdf/678), then an English one
# in DejaVu Serif. Needs PyGObject with Pango and pycairo, and both fonts.
#   python3 -I tests/reading/engine/make-cjk-lines.py tests/reading/engine/cjk-lines.pdf
import sys

import cairo
import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402

ZH = (
    "人工智能的历史可以追溯到二十世纪中叶，当时的研究者相信机器很快就能像人一样思考。"
    "然而，事情远比他们想象的复杂：每一次乐观的预测之后，都跟着一段漫长的寒冬。"
)
EN = (
    "The second paragraph is English, set in a Latin face so the loose boxes "
    "keep to the line, and it runs to a third line to have neighbours above and below."
)

surface = cairo.PDFSurface(sys.argv[1], 400, 320)
cr = cairo.Context(surface)
y = 30
for text, font in ((ZH, "Noto Sans CJK SC 14"), (EN, "DejaVu Serif 12")):
    layout = PangoCairo.create_layout(cr)
    layout.set_font_description(Pango.FontDescription(font))
    layout.set_width(340 * Pango.SCALE)
    layout.set_wrap(Pango.WrapMode.WORD_CHAR)
    layout.set_text(text, -1)
    cr.move_to(30, y)
    PangoCairo.show_layout(cr, layout)
    y += layout.get_pixel_size()[1] + 24
surface.finish()
