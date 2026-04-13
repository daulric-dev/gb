#!/usr/bin/env python3
"""Render the plain-text file size report as a PDF (monospace, UTF-8)."""

import sys
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
LINE_H = 4
FONT_PT = 8


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: file-size-report-to-pdf.py <input.txt> <output.pdf>", file=sys.stderr)
        sys.exit(2)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.add_font("Mono", "", FONT)
    pdf.set_font("Mono", size=FONT_PT)
    text = src.read_text(encoding="utf-8", errors="replace")
    # multi_cell defaults to new_x=RIGHT; the next line must start at LMARGIN or w=0 leaves no width.
    width = pdf.epw
    for line in text.splitlines():
        if line == "":
            pdf.set_x(pdf.l_margin)
            pdf.ln(LINE_H)
        else:
            pdf.multi_cell(
                w=width,
                h=LINE_H,
                text=line,
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
    pdf.output(str(dst))


if __name__ == "__main__":
    main()
