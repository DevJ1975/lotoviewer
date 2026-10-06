"""Build tiny PDFs in memory so tests need no binary fixtures.

``text_layer_pdf`` writes a digitally-authored PDF (real text objects, like an
SDS exported from Word). ``scanned_pdf`` draws text onto images and wraps them
in a PDF with no text layer at all — exactly what a scanner produces.
"""

from __future__ import annotations

import io

LETTER_POINTS = (612, 792)


def text_layer_pdf(lines: list[str]) -> bytes:
    """A one-page PDF whose text lives in the text layer (Helvetica, WinAnsi)."""
    escaped = [line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines]
    content = "BT /F1 8 Tf 10 TL 40 770 Td " + " ".join(f"({line}) Tj T*" for line in escaped) + " ET"
    stream = content.encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            b"/Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % number + body + b"\nendobj\n")
    xref_at = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref_at))
    return out.getvalue()


def scanned_pdf(lines: list[str], lines_per_page: int = 45, dpi: int = 200) -> bytes:
    """An image-only PDF: each page is a picture of the text, like a scan."""
    from PIL import Image, ImageDraw, ImageFont

    width, height = (round(points * dpi / 72) for points in LETTER_POINTS)
    font = ImageFont.load_default(size=round(dpi / 72 * 10))  # ~10 pt body text
    line_height = round(font.size * 1.4)
    margin = round(dpi * 0.75)

    pages = []
    for start in range(0, len(lines), lines_per_page):
        page = Image.new("L", (width, height), color=255)
        draw = ImageDraw.Draw(page)
        for row, line in enumerate(lines[start:start + lines_per_page]):
            draw.text((margin, margin + row * line_height), line, fill=0, font=font)
        pages.append(page)

    out = io.BytesIO()
    pages[0].save(out, format="PDF", save_all=True, append_images=pages[1:], resolution=dpi)
    return out.getvalue()
