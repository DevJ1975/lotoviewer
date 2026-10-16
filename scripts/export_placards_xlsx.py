#!/usr/bin/env python3
"""Export LOTO placards to an Excel workbook that mirrors the printed PDF.

Each placard page is its own worksheet — English, then Spanish, per
machine — laid out band for band against `apps/web/lib/pdfPlacard.ts`:
yellow title band, blue equipment bar, red warning block, purpose +
application columns, colour codes grid, photo slots, energy-steps table,
removal process, signature bar. Every page is scaled to exactly one sheet
of paper, so printing the workbook double-sided puts each machine's
English placard on the front and its Spanish placard on the back.

The placard workbooks hold nothing but placards, so "Print Entire
Workbook" cannot slip a stray page in and flip every back side after it.
The filterable data, per-department counts and inspection tracking live in
a separate register workbook (placard_register.py), written alongside.

Two subcommands, because fetching and rendering fail for different
reasons and are usefully retried apart:

    fetch  --out data/            reads Supabase, caches JSON + photos
    build  --data data/ --out placards.xlsx    renders the workbook

`build` never touches the network: it embeds whatever photos `fetch`
cached and falls back to the PDF's own "-- No photo --" slot for the
rest, so an export still succeeds where egress is closed.

Environment (fetch only):
    SUPABASE_URL                 https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    service-role JWT (RLS-exempt; keep secret)
    SUPABASE_TENANT_NUMBER       4-digit tenant, default 0001
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.units import pixels_to_EMU
from openpyxl.worksheet.cell_range import CellRange
from openpyxl.worksheet.page import PageMargins

# ── Placard constants, mirrored from the TypeScript sources ─────────────────
# energyCodes.ts — code registry. 'N' is an app-side sentinel the placard
# legend filters out, so it is last and excluded from the grid.
ENERGY_CODES: list[tuple[str, str, str, str, str]] = [
    # code, label_en,          label_es,          fill,      text
    ("E",  "Electrical",       "Eléctrico",       "BF1414", "FFFFFF"),
    ("G",  "Gas",              "Gas",             "FFD900", "1A1A1A"),
    ("H",  "Hydraulic",        "Hidráulico",      "A67B5B", "FFFFFF"),
    ("P",  "Pneumatic",        "Neumático",       "1478C7", "FFFFFF"),
    ("M",  "Mechanical",       "Mecánico",        "7F4DB3", "FFFFFF"),
    ("T",  "Thermal",          "Térmico",         "000000", "FFFFFF"),
    ("W",  "Water",            "Agua",            "33993A", "FFFFFF"),
    ("S",  "Steam",            "Vapor",           "E07B00", "FFFFFF"),
    ("V",  "Valve",            "Válvula",         "888888", "FFFFFF"),
    ("CG", "Compressed Gas",   "Gas Comprimido",  "0E8A8A", "FFFFFF"),
    ("CP", "Control Panel",    "Panel Control",   "FFFFFF", "1A1A1A"),
    ("GR", "Gravity",          "Gravedad",        "8B0A1A", "FFFFFF"),
    ("N",  "None",             "Ninguno",         "555555", "FFFFFF"),
]
ENERGY_ALIASES = {"O": "M", "OG": "CG"}
_BY_CODE = {c[0]: c for c in ENERGY_CODES}

# The placard groups steps by phase in this order, then by sequence_order
# within each phase. This deliberately differs from LOTO_STEP_ORDER in
# lotoProcedureValidation.ts, which puts release before lockout: 1910.147
# (d)(4)–(d)(5)(i) relieves stored energy only after the locks are applied,
# and the placard's own printed application box says the same.
STEP_PHASE_ORDER = [
    "shutdown",
    "isolate",
    "lockout",
    "release_stored_energy",
    "verify_zero_energy",
]
PHASE_LABELS = {
    "en": {
        "shutdown": "SHUTDOWN",
        "isolate": "ISOLATE",
        "release_stored_energy": "RELEASE STORED ENERGY",
        "lockout": "LOCKOUT",
        "verify_zero_energy": "VERIFY ZERO ENERGY",
    },
    "es": {
        "shutdown": "APAGADO",
        "isolate": "AISLAR",
        "release_stored_energy": "LIBERAR ENERGIA ALMACENADA",
        "lockout": "BLOQUEO",
        "verify_zero_energy": "VERIFICAR ENERGIA CERO",
    },
}

# placardText.ts — every fixed string the placard prints.
TEXT = {
    "title": {
        "en": "LOCKOUT/TAGOUT PROCEDURE",
        "es": "PROCEDIMIENTO DE BLOQUEO/ETIQUETADO",
    },
    "equipment_label": {"en": "EQUIPMENT:", "es": "EQUIPO:"},
    "warning_header": {
        "en": "KEEP OUT! HAZARDOUS VOLTAGE AND MOVING PARTS",
        "es": "¡MANTÉNGASE ALEJADO! VOLTAJE PELIGROSO Y PIEZAS EN MOVIMIENTO",
    },
    "warning_fallback": {
        "en": "This equipment must be locked out and tagged out before servicing or "
              "maintenance. Follow the procedure below to isolate all energy sources.",
        "es": "Este equipo debe bloquearse y etiquetarse antes de darle servicio o "
              "mantenimiento. Siga el procedimiento a continuación para aislar "
              "todas las fuentes de energía.",
    },
    "purpose_header": {"en": "PURPOSE", "es": "PROPÓSITO"},
    "purpose_body": {
        "en": "This procedure establishes the minimum requirements for lockout of "
              "energy-isolating devices. It ensures equipment is stopped, isolated "
              "from all potentially hazardous energy sources, and locked out before "
              "any servicing or maintenance activities are performed.",
        "es": "Este procedimiento establece los requisitos mínimos para el bloqueo "
              "de los dispositivos de aislamiento de energía. Garantiza que el "
              "equipo se detenga, se aísle de todas las fuentes de energía "
              "potencialmente peligrosas y se bloquee antes de realizar actividades "
              "de servicio o mantenimiento.",
    },
    "application_header": {
        "en": "LOCKOUT APPLICATION PROCESS",
        "es": "PROCESO DE APLICACIÓN DE BLOQUEO",
    },
    "application_steps": {
        "en": [
            "Communicate to all AFFECTED employees",
            "Shut down the equipment using normal stopping procedures",
            "Isolate energy sources",
            "Apply lockout devices, locks, and tags",
            "Release all stored energy",
            "Verify equipment is de-energized by attempting to start up",
            "After test, place controls in a neutral position",
        ],
        "es": [
            "Comunicar a todos los empleados AFECTADOS",
            "Apagar el equipo usando procedimientos normales de parada",
            "Aislar las fuentes de energía",
            "Aplicar dispositivos de bloqueo, candados y etiquetas",
            "Liberar toda la energía almacenada",
            "Verificar que el equipo esté desenergizado intentando arrancarlo",
            "Después de la prueba, colocar los controles en posición neutral",
        ],
    },
    "removal_header": {
        "en": "LOCKOUT REMOVAL PROCESS",
        "es": "PROCESO DE REMOCIÓN DE BLOQUEO",
    },
    "removal_steps": {
        "en": [
            "Notify all AFFECTED employees that lockout is being removed",
            "Inspect the work area to ensure tools and items have been removed",
            "Verify that all employees are clear of the equipment",
            "Verify that controls are in the neutral or off position",
            "Remove lockout devices, locks, and tags",
            "Re-energize the equipment",
            "Notify all AFFECTED employees that the equipment is back in service",
        ],
        "es": [
            "Notificar a todos los empleados AFECTADOS que se está retirando el bloqueo",
            "Inspeccionar el área de trabajo para asegurar que se hayan retirado "
            "herramientas y objetos",
            "Verificar que todos los empleados estén lejos del equipo",
            "Verificar que los controles estén en posición neutral o apagada",
            "Retirar los dispositivos de bloqueo, candados y etiquetas",
            "Volver a energizar el equipo",
            "Notificar a los empleados AFECTADOS que el equipo está de vuelta en servicio",
        ],
    },
    "color_codes_header": {"en": "COLOR CODES", "es": "CÓDIGOS DE COLOR"},
    "section_header": {
        "en": "EQUIPMENT IDENTIFICATION AND ENERGY ISOLATION PROCEDURE",
        "es": "IDENTIFICACIÓN DEL EQUIPO Y PROCEDIMIENTO DE AISLAMIENTO DE ENERGÍA",
    },
    "photo_captions": {
        "en": ("PHOTO OF EQUIPMENT", "PHOTO OF ISOLATION / DISCONNECT"),
        "es": ("FOTO DEL EQUIPO", "FOTO DE AISLAMIENTO / DESCONEXIÓN"),
    },
    "table_headers": {
        "en": ("Energy Tag & Description", "Isolation Procedure & Lockout Devices",
               "Method of Verification"),
        "es": ("Etiqueta y Descripción", "Procedimiento de Aislamiento y Dispositivos",
               "Método de Verificación"),
    },
    "signature": {
        "en": ("Signature", "Date", "Dept", "See PM Store in PT Folder"),
        "es": ("Firma", "Fecha", "Depto", "Ver PM Store en carpeta PT"),
    },
    "no_steps": {
        "en": "No energy steps defined for this equipment.",
        "es": "No hay pasos de energía definidos para este equipo.",
    },
    "no_photo": {"en": "— No photo —", "es": "— Sin foto —"},
    "print_note": {
        "en": "Spanish translation on reverse — print double-sided.",
        "es": "Traducción al inglés al reverso — imprimir a doble cara.",
    },
}

# Palette, from pdfPlacard.ts.
YELLOW_BAND = "FFD900"
BLUE_BAR = "D9E8FF"
RED_BLOCK = "BF1414"
NAVY_HEADER = "214488"
WHITE = "FFFFFF"
ROW_ALT = "F5F7FC"
TABLE_BORDER = "D1D9E6"
SLATE_TEXT = "262E3B"
PHOTO_SLOT = "F5F7FA"
SIG_BAR = "F7F7FA"
GREY_TEXT = "8C8C99"         # pdfPlacard rgb(0.55, 0.55, 0.6)
GREY_PLACEHOLDER = "9999A6"  # pdfPlacard rgb(0.6, 0.6, 0.65)
DRAFT_RED = "BF1A1A"         # the ES draft watermark
DRAFT_FILL = "FDECEC"
LINK_BLUE = "1155CC"

FONT_NAME = "Arial"
GRID_COLS = 12  # the placard's band grid; every band divides into these
# Character units. Each page is scaled to fit one portrait Letter sheet, so
# the column width sets the printed text size: wider columns are throttled
# by the paper's width, narrower ones wrap into pages throttled by its
# height. Measured across all 998 Snak King pages, 11 maximises the scale
# (median 0.81, i.e. 7.5pt step text prints at ~6pt) — 13 managed 0.70.
COLUMN_WIDTH = 11
PHOTO_ROWS = 7            # rows an empty photo slot occupies
PHOTO_ROWS_WITH_IMAGE = 14  # rows when a photo is actually embedded
PHOTO_ROW_POINTS = 14  # height of each of those rows
BODY_ROW_POINTS = 12   # height of a wrapped body row
# Excel's line pitch as a multiple of the font size. Its own autofit row
# heights for Arial run 1.275x at 10pt to 1.31x at 12pt, so 1.22 — the
# figure the font's own ascent+descent suggests — under-allocates every
# wrapped block by roughly a line in twelve. Over-allocating costs
# whitespace; under-allocating silently drops a line of isolation procedure.
LINE_SPACING = 1.32

# Excel sizes columns in character units and rows in points, but anchors
# images in pixels, so a slot's pixel box has to be derived from both.
PX_PER_CHAR, PX_CELL_PADDING, PX_PER_POINT = 7, 5, 4 / 3


def column_pixels(stored_width: float) -> int:
    """Rendered width of a column whose OOXML `width` attribute is given.

    ECMA-376 18.3.1.13. The stored width already includes the five pixels of
    cell padding — visible characters c are stored as
    trunc((c*MDW + 5)/MDW * 256)/256 — so the padding must not be added a
    second time here. Getting this wrong the other way makes every wrapping
    width about 5% too generous, which under-allocates rows and lets Excel
    clip the overflow with no other symptom.
    """
    return int(((256 * stored_width + int(128 / PX_PER_CHAR)) / 256) * PX_PER_CHAR)


COLUMN_PX = column_pixels(COLUMN_WIDTH)
COLUMN_POINTS = COLUMN_PX * 0.75
CELL_PADDING_POINTS = PX_CELL_PADDING * 0.75

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# Arial, or the metrically identical Liberation Sans. Row heights are derived
# from measured text, so the font used to measure has to match the font Excel
# will wrap with; anything else mis-sizes every band.
_ARIAL_PATHS = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
_ARIAL_BOLD_PATHS = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
_MEASURE_SIZE = 200  # measure big, scale down — avoids integer-pixel rounding


@lru_cache(maxsize=None)
def _measuring_font(bold: bool = False):
    """The face Excel will wrap with. Bold is measured with the bold face:
    it is materially wider, and the energy badge — the one wrapped band that
    is bold — would otherwise be sized for text narrower than it renders."""
    try:
        from PIL import ImageFont
    except ImportError:
        return None
    for path in (_ARIAL_BOLD_PATHS if bold else _ARIAL_PATHS):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, _MEASURE_SIZE)
            except OSError:
                continue
    return None if bold else None


@lru_cache(maxsize=16384)
def _text_width(text: str, points: float, bold: bool = False) -> float:
    """Width of `text` in points at `points` size, in the placard's font."""
    font = _measuring_font(bold) or _measuring_font(False)
    if font is None:
        # No font file to measure with. Arial's lowercase advance averages
        # about half an em but its uppercase runs nearer 0.68, and the badges
        # and phase labels are uppercase — so estimate at the wider end and
        # err toward a taller row rather than a clipped one.
        return len(text) * points * (0.75 if bold else 0.68)
    return font.getlength(text) * points / _MEASURE_SIZE


def wrapped_lines(text: str, points: float, width_points: float,
                  bold: bool = False) -> int:
    """How many lines Excel wraps `text` into within `width_points`."""
    if not text:
        return 1
    usable = max(width_points - CELL_PADDING_POINTS, points)
    total = 0
    for paragraph in str(text).split("\n"):
        words = paragraph.split()
        if not words:
            total += 1
            continue
        lines, current = 1, ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if _text_width(candidate, points, bold) <= usable or not current:
                current = candidate
            else:
                lines += 1
                current = word
            # A word wider than the cell wraps again mid-word. This runs for
            # the first word of a paragraph too, which is where an unbroken
            # token — a URL, a part number — would otherwise be under-counted.
            while _text_width(current, points, bold) > usable and len(current) > 1:
                cut = max(1, int(len(current) * usable / _text_width(current, points, bold)))
                current = current[cut:]
                lines += 1
        total += lines
    return total


def span_points(first_col: int, last_col: int) -> float:
    """Printable width of a merged column span, in points."""
    return (last_col - first_col + 1) * COLUMN_POINTS


def rows_for(text: str, points: float, first_col: int, last_col: int,
             row_points: float = BODY_ROW_POINTS, minimum: int = 1,
             maximum: int = 40, bold: bool = False) -> int:
    """Rows a wrapped block needs so Excel clips none of it.

    Excel never grows a merged cell to fit its contents — whatever overflows
    is simply not drawn. Every wrapped band therefore has to be sized from
    the text itself, or a placard quietly loses isolation steps.
    """
    lines = wrapped_lines(text, points, span_points(first_col, last_col), bold)
    needed = -(-int(lines * points * LINE_SPACING + 2) // int(row_points))
    return max(minimum, min(maximum, needed))


def clean(value) -> str:
    """Text safe for an XLSX cell. Excel rejects most C0 control chars."""
    if value is None:
        return ""
    return _CONTROL_CHARS.sub("", str(value))


_BLANK_LINES = re.compile(r"\n[ \t]*\n+")


def placard_text(value) -> str:
    """Cell text for a placard band.

    Collapses runs of blank lines: most tag_description values are stored as
    a heading, an empty line, then the body, and that empty line costs a
    wrapped line in the narrowest column of every step on every page. Only
    whitespace is touched — the flat data sheets still carry the raw value.
    """
    return _BLANK_LINES.sub("\n", clean(value)).strip()


# The notes column doubles as a data-maintenance log: alongside real hazard
# warnings ("all 3 boilers share a common steam header") it carries entries
# like "PHOTO_FIX 2026-05-13: Repointed from SKAP-1501 …". Those are
# segments tagged by the cleanup that wrote them, and they must not print in
# a placard's red KEEP OUT block. Only these known tags are dropped — an
# untagged or unfamiliar note still prints, because silently losing a real
# warning costs far more than printing an odd one.
_HOUSEKEEPING_NOTE = re.compile(
    r"^(Source sheet|Asset#|PHOTO_FIX|PHOTO_UPGRADE|DATA_FIX|DESC_NORMALIZED|DESC_FIX|"
    r"DESC_REPAIRED|ID_REPAIRED|CORRECTED|Added \d{4}-\d{2}-\d{2}|PLACARD-OWNER|"
    r"CORD-AND-PLUG-REVIEW|From Master Inventory)(?![A-Za-z])", re.IGNORECASE)
_NOTE_DATE = re.compile(r"^([A-Z][A-Z -]+?)\s+\d{4}-\d{2}-\d{2}(?:\s*\([^)]*\))?:")


def placard_warning(notes) -> str:
    """The hazard notes from `notes`, minus data-maintenance log entries.

    Segments are separated by " | " or line breaks. A kept segment loses its
    log date ("CROSS-REF LOTO 2026-04-27:" → "CROSS-REF LOTO:"), which says
    when the note was written, not anything a worker needs.
    """
    kept = []
    for segment in re.split(r"\s*\|\s*|\n+", placard_text(notes)):
        segment = segment.strip()
        if segment and not _HOUSEKEEPING_NOTE.match(segment):
            kept.append(_NOTE_DATE.sub(r"\1:", segment))
    return "\n".join(kept)


def energy_code(code: str | None) -> tuple[str, str, str, str, str]:
    raw = (code or "").strip().upper()
    return _BY_CODE.get(ENERGY_ALIASES.get(raw, raw)) or (
        raw or "?", raw or "Unknown", raw or "Desconocido", "888888", "FFFFFF"
    )


# ── Fetch ───────────────────────────────────────────────────────────────────
EQUIPMENT_COLUMNS = (
    "equipment_id,description,department,equipment_family,prefix,manufacturer,model,"
    "photo_status,has_equip_photo,has_iso_photo,needs_equip_photo,needs_iso_photo,"
    "needs_verification,verified,verified_date,verified_by,notes,notes_es,"
    "internal_notes,spanish_reviewed,equip_photo_url,iso_photo_url,placard_url,"
    "qr_token,readiness_status,last_pre_use_inspection_at,next_periodic_review_due_at,"
    "cad_drawing_tag,cad_sheet_ref,cad_grid_ref,facility_floor,flagged_for_review_at,"
    "flagged_for_review_by,flagged_for_review_via,flagged_for_review_note,"
    "equip_photo_provenance,iso_photo_provenance,iso_photo_is_placeholder,"
    "last_audit_verdict,last_audit_at,created_at,updated_at"
)
STEP_COLUMNS = (
    "equipment_id,step_number,sequence_order,step_type,energy_type,tryout_required,"
    "tag_description,isolation_procedure,method_of_verification,tag_description_es,"
    "isolation_procedure_es,method_of_verification_es,confidence"
)
PHOTO_MAX_PX = 900  # placard slots print ~370pt wide; 900px is generous at 300dpi
EMBED_MAX_PX = 720  # the slot prints at most ~4.8in wide; 720px is ~150 dpi there


def _rest(base: str, key: str, path: str, params: dict) -> list[dict]:
    """One PostgREST GET, paged by the caller via Range params."""
    url = f"{base}/rest/v1/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def _paged(base: str, key: str, path: str, params: dict, page: int = 1000) -> list[dict]:
    rows: list[dict] = []
    while True:
        batch = _rest(base, key, path, {**params, "offset": len(rows), "limit": page})
        rows.extend(batch)
        if len(batch) < page:
            return rows


def cmd_fetch(args: argparse.Namespace) -> int:
    out = Path(args.out)
    (out / "photos").mkdir(parents=True, exist_ok=True)

    # Placard photos are public storage objects, so refreshing them needs no
    # credentials — only the cached equipment rows that name their URLs.
    if args.photos_only:
        equipment = json.loads((out / "equipment.json").read_text("utf-8"))
        print(f"{_download_photos(equipment, out / 'photos')} photos cached "
              f"-> {out / 'photos'}")
        return 0

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    tenant_number = os.environ.get("SUPABASE_TENANT_NUMBER", "0001")
    if not base or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to fetch.")

    tenants = _rest(base, key, "tenants",
                    {"select": "id,name,tenant_number", "tenant_number": f"eq.{tenant_number}"})
    if not tenants:
        sys.exit(f"No tenant with tenant_number={tenant_number}.")
    tenant = tenants[0]

    equipment = _paged(base, key, "loto_equipment", {
        "select": EQUIPMENT_COLUMNS,
        "tenant_id": f"eq.{tenant['id']}",
        "decommissioned": "is.false",
        "order": "equipment_id.asc",
    })
    ids = {row["equipment_id"] for row in equipment}
    steps = [s for s in _paged(base, key, "loto_energy_steps", {
        "select": STEP_COLUMNS + ",id",
        "tenant_id": f"eq.{tenant['id']}",
        # id breaks ties: the other three columns are not unique together
        # (523 steps share equipment_id + sequence_order), and OFFSET
        # paging over a non-unique sort may repeat or skip tied rows.
        "order": "equipment_id.asc,sequence_order.asc,step_number.asc,id.asc",
    }) if s["equipment_id"] in ids]

    (out / "equipment.json").write_text(json.dumps(equipment, ensure_ascii=False), "utf-8")
    (out / "steps.json").write_text(json.dumps(steps, ensure_ascii=False), "utf-8")
    (out / "tenant.json").write_text(json.dumps(tenant, ensure_ascii=False), "utf-8")
    print(f"{len(equipment)} equipment, {len(steps)} steps -> {out}")

    if args.no_photos:
        return 0
    downloaded = _download_photos(equipment, out / "photos")
    print(f"{downloaded} photos cached -> {out / 'photos'}")
    return 0


def _download_photos(equipment: list[dict], into: Path) -> int:
    from PIL import Image, ImageOps

    count = 0
    for row in equipment:
        for kind in ("equip", "iso"):
            url = row.get(f"{kind}_photo_url")
            if not url:
                continue
            target = into / f"{row['equipment_id'].replace('/', '_')}_{kind}.jpg"
            if target.exists():
                count += 1
                continue
            # Download to a scratch name and rename only once the bytes have
            # been decoded. Writing to the final path directly means an
            # interrupted run — 996 photos over a slow link invites one —
            # leaves a truncated JPEG that the next run counts as cached and
            # the build later fails to open.
            partial = target.with_suffix(".part")
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    partial.write_bytes(response.read())
                # Downscale: 996 full-resolution photos would push the workbook
                # past 300 MB, and the placard slot is ~370pt wide.
                with Image.open(partial) as image:
                    # Apply the EXIF orientation before re-encoding drops it,
                    # or portrait phone photos land on the placard sideways.
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    image.thumbnail((PHOTO_MAX_PX, PHOTO_MAX_PX), Image.LANCZOS)
                    image.save(partial, "JPEG", quality=82, optimize=True)
                partial.replace(target)
                count += 1
            except Exception as error:  # one bad photo must not sink the export
                print(f"  photo failed {row['equipment_id']} {kind}: {error}", file=sys.stderr)
                partial.unlink(missing_ok=True)
    return count


# ── Build ───────────────────────────────────────────────────────────────────
@dataclass
class Style:
    """A cell's look, applied across a merged band in one call."""
    fill: str | None = None
    color: str = SLATE_TEXT
    size: float = 9
    bold: bool = False
    align: str = "left"
    valign: str = "center"
    wrap: bool = False
    border: bool = False


THIN = Side(style="thin", color=TABLE_BORDER)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


class PlacardSheet:
    """Writes placard pages onto one worksheet, band by band."""

    def __init__(self, worksheet, photos: Path):
        self.ws = worksheet
        self.photos = photos
        self.row = 1

    def merge(self, first_row: int, first_col: int, last_row: int, last_col: int) -> None:
        """Merge a band, skipping Worksheet.merge_cells.

        merge_cells tests the new range against every existing one before
        storing it, which is O(n) per call and quadratic over a workbook
        this size — around six minutes for 499 placards. The bands here are
        laid out row by row and never overlap, so the test only costs time.
        """
        self.ws.merged_cells.ranges.add(CellRange(
            min_col=first_col, min_row=first_row,
            max_col=last_col, max_row=last_row,
        ))

    def band(self, text, style: Style, height: float | None = None,
             span: tuple[int, int] = (1, GRID_COLS)) -> int:
        """Write one merged, styled band and advance to the next row."""
        row = self.row
        self.cell(row, span, text, style)
        if height is not None:
            self.ws.row_dimensions[row].height = height
        self.row += 1
        return row

    def cell(self, row: int, span: tuple[int, int], text, style: Style,
             merge: bool = True):
        """Write one single-row band. `merge=False` leaves the range to the
        caller, so a multi-row block does not also register a one-row merge
        over its own anchor — two ranges sharing a corner is a malformed
        workbook that Excel offers to repair on open."""
        first, last = span
        cell = self.ws.cell(row=row, column=first)
        cell.value = clean(text) if text != "" else None
        cell.font = Font(name=FONT_NAME, size=style.size, bold=style.bold, color=style.color)
        cell.alignment = Alignment(horizontal=style.align, vertical=style.valign,
                                   wrap_text=style.wrap)
        if style.fill:
            cell.fill = PatternFill("solid", fgColor=style.fill)
        if style.border:
            cell.border = BOX
        if last > first:
            if merge:
                self.merge(row, first, row, last)
            # Merged cells keep their own fill/border, so paint the tail too.
            for column in range(first + 1, last + 1):
                tail = self.ws.cell(row=row, column=column)
                if style.fill:
                    tail.fill = PatternFill("solid", fgColor=style.fill)
                if style.border:
                    tail.border = BOX
        return cell

    def block(self, rows: int, span: tuple[int, int], text, style: Style,
              start: int | None = None) -> int:
        """A band that spans several rows (wrapped body text, photo slots)."""
        row = self.row if start is None else start
        cell = self.cell(row, span, text, style, merge=False)
        if rows > 1 or span[1] > span[0]:
            self.merge(row, span[0], row + rows - 1, span[1])
        for r in range(row, row + rows):
            for c in range(span[0], span[1] + 1):
                tail = self.ws.cell(row=r, column=c)
                if style.fill:
                    tail.fill = PatternFill("solid", fgColor=style.fill)
                if style.border:
                    tail.border = BOX
        return cell


_PREREQUISITE = re.compile(r"\bAfter ([A-Za-z ,&/]+?) isolation", re.IGNORECASE)


def _prerequisite_count(step: dict) -> int:
    """How many other isolations this step says must already be done.

    Most placards number every step 1, so sequence alone leaves their order
    to chance — and 170 printed "After electrical isolation per the E
    procedure" above the E step itself. The steps state their own
    dependencies in that opening clause; counting them orders a tie so each
    step follows the ones it names.
    """
    match = _PREREQUISITE.search(step.get("isolation_procedure") or "")
    if not match:
        return 0
    return len([name for name in re.split(r",|\band\b|&|/", match.group(1)) if name.strip()])


def _step_order(step: dict) -> tuple[int, int, int]:
    return (step.get("sequence_order") or 0, step.get("step_number") or 0,
            _prerequisite_count(step))


def _grouped_steps(steps: list[dict]) -> list[dict]:
    """Steps in the order the placard prints them: OSHA phase, then sequence,
    then — where sequence ties — after the isolations each step depends on."""
    ordered: list[dict] = []
    for phase in STEP_PHASE_ORDER:
        ordered.extend(sorted((s for s in steps if s.get("step_type") == phase),
                              key=_step_order))
    known = set(STEP_PHASE_ORDER)
    return ordered + sorted((s for s in steps if s.get("step_type") not in known),
                            key=_step_order)


# Every procedure, verification and tag opens with a line restating its own
# column header — "ISOLATION PROCEDURE — PNEUMATIC:", "ENERGY TAG &
# DESCRIPTION — P:" — directly under that header and beside a badge naming
# the energy. In the narrow tag column that repetition decides the page's
# height, and so the size of every word on it.
_STEP_HEADING = re.compile(
    r"^\s*(ENERGY TAG & DESCRIPTION|ETIQUETA DE ENERG[IÍ]A Y DESCRIPCI[OÓ]N|"
    r"ISOLATION PROCEDURE(?: & LOCKOUT DEVICES)?|PROCEDIMIENTO DE AISLAMIENTO"
    r"(?: Y DISPOSITIVOS DE BLOQUEO)?|METHOD OF VERIFICATION|M[EÉ]TODO DE VERIFICACI[OÓ]N)"
    r"\s*[—–-]\s*[^:\n]{1,40}:[ \t]*\n?", re.IGNORECASE)


def _without_heading(text: str) -> str:
    return _STEP_HEADING.sub("", text, count=1).strip()


def _pick(step: dict, field: str, language: str) -> str:
    """Spanish text where present, English as the placard's own fallback."""
    if language == "en":
        return placard_text(step.get(field))
    spanish = placard_text(step.get(f"{field}_es"))
    return spanish or placard_text(step.get(field))


def draw_placard(sheet: PlacardSheet, equipment: dict, steps: list[dict],
                 language: str, generated: str, app_links: bool = True,
                 photo_verdicts: dict[str, str] | None = None) -> None:
    """One placard page: the same bands, in the same order, as the PDF.

    `app_links=False` drops every link into Soteria Field — the digital
    placard QR and the photo-storage URLs — for a client whose account is
    closing, where each one would dead-end on a posted placard.

    `photo_verdicts` maps "equip"/"iso" to the photo audit's verdict; when
    given, every photo not confirmed for this machine is stamped a warning.
    """
    ws, is_en = sheet.ws, language == "en"
    half = GRID_COLS // 2

    # 1. Yellow title band. The QR caption shares the date line rather than
    # taking a row of its own — vertical space is the scarce resource here.
    sheet.band(TEXT["title"][language],
               Style(fill=YELLOW_BAND, color="000000", size=14, bold=True, align="center"),
               height=24)
    date_label = f"{'Date' if is_en else 'Fecha'}: {generated}"
    row = sheet.row
    subtitle = sheet.cell(row, (1, GRID_COLS),
                          f"[{'EN' if is_en else 'ES'}]   {date_label}",
                          Style(fill=YELLOW_BAND, color="000000", size=8, align="center"))
    if app_links and equipment.get("qr_token"):
        target = f"https://soteriafield.app/qr/{equipment['qr_token']}"
        subtitle.value = (f"[{'EN' if is_en else 'ES'}]   {date_label}   ·   "
                          f"{'Scan for digital placard' if is_en else 'Escanee para placa digital'}")
        subtitle.hyperlink = target
    ws.row_dimensions[row].height = 12
    sheet.row += 1

    # 1b. Draft banner. The PDF stamps a rotated "BORRADOR — NO REVISADO"
    # watermark across any Spanish page whose translation is unreviewed. A
    # spreadsheet cannot rotate a watermark behind its cells, so the same
    # warning takes a band of its own — losing it would present an unreviewed
    # translation as an approved procedure.
    if not is_en and equipment.get("spanish_reviewed") is False:
        sheet.band("BORRADOR — NO REVISADO  ·  traducción sin revisar",
                   Style(fill=DRAFT_FILL, color=DRAFT_RED, size=9, bold=True,
                         align="center"), height=13)

    # 2. Blue equipment bar — description left, department right. A long
    # description wraps onto a second line rather than being cut at the
    # department column: the machine name is how a worker confirms they are
    # standing at the right placard.
    label = f"{TEXT['equipment_label'][language]} {clean(equipment.get('description'))}"
    department = clean(equipment.get("department"))
    bar_rows = max(rows_for(label, 10, 1, 8, row_points=16, maximum=3, bold=True),
                   rows_for(department, 10, 9, GRID_COLS, row_points=16, maximum=3, bold=True))
    start = sheet.row
    sheet.block(bar_rows, (1, 8), label,
                Style(fill=BLUE_BAR, color=NAVY_HEADER, size=10, bold=True, wrap=True),
                start=start)
    sheet.block(bar_rows, (9, GRID_COLS), department,
                Style(fill=BLUE_BAR, color=NAVY_HEADER, size=10, bold=True, align="right",
                      wrap=True), start=start)
    for r in range(start, start + bar_rows):
        ws.row_dimensions[r].height = 16
    sheet.row = start + bar_rows

    # 3. Red warning block. The PDF prints only the first wrapped line of the
    # note; here the whole note is shown, because the band is the one place a
    # machine-specific hazard is written down.
    sheet.band(TEXT["warning_header"][language],
               Style(fill=RED_BLOCK, color=WHITE, size=9.5, bold=True, align="center"),
               height=14)
    # The Spanish note falls back to the English one, not to boilerplate.
    # The PDF drops straight to generic Spanish text when notes_es is blank,
    # and on this data that is every machine that has a note at all — 286 of
    # them, including "all three boilers share a common steam header". A
    # Spanish-speaking worker was being shown generic wording exactly where
    # the English placard warns about a specific hazard. An untranslated
    # warning is worth more than none, and the step text already falls back
    # this way.
    notes = placard_warning(equipment.get("notes")) if is_en else (
        placard_warning(equipment.get("notes_es")) or placard_warning(equipment.get("notes")))
    warning = notes or TEXT["warning_fallback"][language]
    warning_rows = rows_for(warning, 8, 1, GRID_COLS, minimum=1, maximum=4)
    sheet.block(warning_rows, (1, GRID_COLS), warning,
                Style(fill=RED_BLOCK, color=WHITE, size=8, align="center", wrap=True))
    for r in range(sheet.row, sheet.row + warning_rows):
        ws.row_dimensions[r].height = BODY_ROW_POINTS
    sheet.row += warning_rows

    # 4. Purpose | Lockout application process.
    row = sheet.row
    sheet.cell(row, (1, 7), TEXT["purpose_header"][language],
               Style(color=NAVY_HEADER, size=9, bold=True))
    sheet.cell(row, (8, GRID_COLS), TEXT["application_header"][language],
               Style(color=NAVY_HEADER, size=9, bold=True))
    ws.row_dimensions[row].height = 12
    sheet.row += 1

    purpose = TEXT["purpose_body"][language]
    application = "\n".join(f"{i}. {s}" for i, s in
                            enumerate(TEXT["application_steps"][language], 1))
    body_rows = max(rows_for(purpose, 8, 1, 7),
                    rows_for(application, 8, 8, GRID_COLS))
    start = sheet.row
    sheet.block(body_rows, (1, 7), purpose,
                Style(size=8, wrap=True, valign="top"), start=start)
    sheet.block(body_rows, (8, GRID_COLS), application,
                Style(size=8, wrap=True, valign="top"), start=start)
    for r in range(start, start + body_rows):
        ws.row_dimensions[r].height = BODY_ROW_POINTS
    sheet.row = start + body_rows

    # 5. Colour codes — red strip over a 6x2 grid of the 12 real codes.
    sheet.band(TEXT["color_codes_header"][language],
               Style(fill=RED_BLOCK, color=WHITE, size=9, bold=True, align="center"), height=14)
    codes = [c for c in ENERGY_CODES if c[0] != "N"]
    per_row = 6
    for chunk_start in range(0, len(codes), per_row):
        row = sheet.row
        for offset, (code, label_en, label_es, fill, text_color) in enumerate(
                codes[chunk_start:chunk_start + per_row]):
            column = 1 + offset * 2
            sheet.cell(row, (column, column + 1),
                       f"{code} = {label_en if is_en else label_es}",
                       Style(fill=fill, color=text_color, size=7, bold=True,
                             align="center", border=True))
        ws.row_dimensions[row].height = 12
        sheet.row += 1

    # 6. Navy section header.
    sheet.band(TEXT["section_header"][language],
               Style(fill=NAVY_HEADER, color=WHITE, size=9, bold=True), height=14)

    # 7. Photo slots, side by side. A slot with a photo in it earns the taller
    # band: the isolation shot is what a worker matches against the machine,
    # and in the short band a 4:3 photo fills barely a third of the slot's
    # width. An empty slot keeps the compact height — reserving the space for
    # a placeholder would cost a page and show nothing.
    caption_en, caption_es = TEXT["photo_captions"][language]
    stem = equipment["equipment_id"].replace("/", "_")
    photo_paths = {kind: sheet.photos / f"{stem}_{kind}.jpg" for kind in ("equip", "iso")}
    photo_rows = (PHOTO_ROWS_WITH_IMAGE if any(p.exists() for p in photo_paths.values())
                  else PHOTO_ROWS)
    start = sheet.row
    for index, (kind, caption) in enumerate((("equip", caption_en), ("iso", caption_es))):
        span = (1, half) if index == 0 else (half + 1, GRID_COLS)
        path = photo_paths[kind]
        url = equipment.get(f"{kind}_photo_url") if app_links else None
        embedded = False
        if path.exists():
            sheet.block(photo_rows, span, "", Style(fill=PHOTO_SLOT, border=True), start=start)
            try:
                _embed(ws, path, start, span[0], photo_rows,
                       label=clean(equipment["equipment_id"]),
                       warning=(photo_warning(photo_verdicts.get(kind))
                                if photo_verdicts is not None else None))
                embedded = True
            except Exception as error:
                # An unreadable photo costs one slot, not the whole export.
                print(f"  photo unreadable {equipment['equipment_id']} {kind}: {error}",
                      file=sys.stderr)
        if not embedded:
            # The URL goes on the hyperlink, never into the cell text: it is one
            # unbreakable token, so Excel cannot wrap it and it would sprawl
            # across the neighbouring slot.
            label = TEXT["no_photo"][language]
            if url:
                label += "\n" + ("click to open the photo" if is_en
                                 else "haga clic para abrir la foto")
            cell = sheet.block(photo_rows, span, label,
                               Style(fill=PHOTO_SLOT, color=LINK_BLUE if url else GREY_PLACEHOLDER,
                                     size=8, align="center", wrap=True, border=True),
                               start=start)
            if url:
                cell.hyperlink = url
        sheet.cell(start + photo_rows, span, caption,
                   Style(fill=PHOTO_SLOT, color=NAVY_HEADER, size=7.5, bold=True, border=True))
    for r in range(start, start + photo_rows):
        ws.row_dimensions[r].height = PHOTO_ROW_POINTS
    ws.row_dimensions[start + photo_rows].height = 11
    sheet.row = start + photo_rows + 1

    # 8. Energy steps table.
    header = TEXT["table_headers"][language]
    row = sheet.row
    header_style = Style(fill=NAVY_HEADER, color=WHITE, size=8, bold=True, border=True)
    sheet.cell(row, (1, 2), header[0], header_style)
    sheet.cell(row, (3, 7), header[1], header_style)
    sheet.cell(row, (8, GRID_COLS), header[2], header_style)
    ws.row_dimensions[row].height = 14
    sheet.row += 1

    ordered = _grouped_steps(steps)
    if not ordered:
        sheet.band(TEXT["no_steps"][language],
                   Style(color=GREY_TEXT, size=9, align="center", border=True), height=20)
    for index, step in enumerate(ordered):
        code, label_en, label_es, fill, text_color = energy_code(step.get("energy_type"))
        tag = _without_heading(_pick(step, "tag_description", language))
        procedure = _without_heading(_pick(step, "isolation_procedure", language))
        verification = _without_heading(_pick(step, "method_of_verification", language))
        phase = PHASE_LABELS[language].get(step.get("step_type"), clean(step.get("step_type")))
        alt = ROW_ALT if index % 2 else None

        badge = f"{code} — {label_en if is_en else label_es}\n{phase}"
        if tag:
            badge += f"\n{tag}"
        # Sized to the tallest of the three columns — the badge carries three
        # lines of its own and used to be the one that clipped.
        rows_needed = max(
            rows_for(badge, 7, 1, 2, minimum=2, bold=True),
            rows_for(procedure, 7.5, 3, 7, minimum=2),
            rows_for(verification, 7.5, 8, GRID_COLS, minimum=2),
        )
        start = sheet.row
        sheet.block(rows_needed, (1, 2), badge,
                    Style(fill=fill, color=text_color, size=7, bold=True,
                          wrap=True, valign="top", border=True), start=start)
        sheet.block(rows_needed, (3, 7), procedure,
                    Style(fill=alt, size=7.5, wrap=True, valign="top", border=True), start=start)
        sheet.block(rows_needed, (8, GRID_COLS), verification,
                    Style(fill=alt, size=7.5, wrap=True, valign="top", border=True), start=start)
        for r in range(start, start + rows_needed):
            ws.row_dimensions[r].height = BODY_ROW_POINTS
        sheet.row = start + rows_needed

    # 9. Lockout removal process — red strip over two columns.
    sheet.band(TEXT["removal_header"][language],
               Style(fill=RED_BLOCK, color=WHITE, size=9, bold=True, align="center"), height=13)
    removal = TEXT["removal_steps"][language]
    split = -(-len(removal) // 2)
    left = "\n".join(f"{i}. {s}" for i, s in enumerate(removal[:split], 1))
    right = "\n".join(f"{i}. {s}" for i, s in enumerate(removal[split:], split + 1))
    removal_rows = max(rows_for(left, 7.5, 1, 6), rows_for(right, 7.5, 7, GRID_COLS))
    start = sheet.row
    sheet.block(removal_rows, (1, 6), left,
                Style(size=7.5, wrap=True, valign="top"), start=start)
    sheet.block(removal_rows, (7, GRID_COLS), right,
                Style(size=7.5, wrap=True, valign="top"), start=start)
    for r in range(start, start + removal_rows):
        ws.row_dimensions[r].height = BODY_ROW_POINTS
    sheet.row = start + removal_rows

    # 10. Print note.
    sheet.band(TEXT["print_note"][language], Style(color=GREY_TEXT, size=6.5), height=9)

    # 11. Signature bar.
    row = sheet.row
    for index, label in enumerate(TEXT["signature"][language]):
        column = 1 + index * 3
        sheet.cell(row, (column, column + 2), label,
                   Style(fill=SIG_BAR, color=NAVY_HEADER, size=8, bold=True, border=True))
    ws.row_dimensions[row].height = 18
    sheet.row += 1


# The photo audit's verdict on a placard photo, burned into the photo itself
# so the warning travels with it — onto the posted placard, and into any
# work pack the photo is cropped into. One bilingual band, because the
# English and Spanish pages share a single stored copy of each photo.
PHOTO_WARNINGS = {
    "mismatch": (("NOT THIS MACHINE — REFERENCE ONLY", "NO ES ESTA MÁQUINA — SOLO REFERENCIA"),
                 (191, 20, 20), (255, 255, 255)),
    "unverified": (("VERIFY AT MACHINE — NOT CONFIRMED", "VERIFICAR EN LA MÁQUINA — SIN CONFIRMAR"),
                   (255, 217, 0), (26, 26, 26)),
}


def photo_warning(verdict: str | None) -> str | None:
    """Which band a photo carries. Only a photo both auditors confirmed for
    this machine prints clean; a photo nobody has audited yet is unverified."""
    if verdict == "match":
        return None
    return "mismatch" if verdict == "mismatch" else "unverified"


def _stamp_label(path: Path, label: str, warning: str | None = None):
    """Burn the equipment name onto a copy of the photo, bottom-left.

    A placard photo travels: it gets cropped into a work pack, pasted into a
    report, or pulled out of the workbook on its own, and at that point
    nothing says which machine it shows. Stamping the identifier into the
    pixels keeps the two together. Returns a BytesIO of the stamped JPEG, or
    None to fall back to the file as it is.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    try:
        with Image.open(path) as source:
            image = source.convert("RGB")
        # Each photo is embedded twice (English and Spanish page), so its
        # size counts double toward whether a department's file can be
        # emailed. EMBED_MAX_PX still prints the slot at ~150 dpi.
        image.thumbnail((EMBED_MAX_PX, EMBED_MAX_PX), Image.LANCZOS)
        width, height = image.size
        # Sized against the image, so the label survives being scaled into the
        # placard slot and stays proportionate on any source resolution.
        bar_height = max(16, int(height * 0.075))
        text_size = max(11, int(bar_height * 0.68))
        font = None
        for candidate in _ARIAL_BOLD_PATHS:
            if os.path.exists(candidate):
                try:
                    font = ImageFont.truetype(candidate, text_size)
                    break
                except OSError:
                    continue
        if font is None:
            font = ImageFont.load_default()

        draw = ImageDraw.Draw(image, "RGBA")
        pad = max(4, bar_height // 5)
        text_width = int(draw.textlength(label, font=font))
        draw.rectangle(
            [0, height - bar_height, min(width, text_width + pad * 3), height],
            fill=(0, 0, 0, 168),
        )
        draw.text((pad, height - bar_height + (bar_height - text_size) // 2),
                  label, font=font, fill=(255, 255, 255))

        if warning:
            lines, fill, ink = PHOTO_WARNINGS[warning]
            line_height = max(14, int(height * 0.06))
            band_font = font
            for candidate in _ARIAL_BOLD_PATHS:
                if os.path.exists(candidate):
                    band_font = ImageFont.truetype(candidate, int(line_height * 0.72))
                    # Shrink until the longer line fits across the photo.
                    while (max(draw.textlength(line, font=band_font) for line in lines)
                           > width - 2 * pad and band_font.size > 8):
                        band_font = ImageFont.truetype(candidate, band_font.size - 1)
                    break
            draw.rectangle([0, 0, width, line_height * len(lines) + pad], fill=fill + (235,))
            for index, line in enumerate(lines):
                line_width = draw.textlength(line, font=band_font)
                draw.text(((width - line_width) / 2, pad // 2 + index * line_height),
                          line, font=band_font, fill=ink)

        stamped = io.BytesIO()
        image.save(stamped, "JPEG", quality=82, optimize=True)
        stamped.seek(0)
        return stamped
    except Exception:
        return None


def _embed(ws, path: Path, row: int, column: int, rows: int,
           label: str | None = None, warning: str | None = None) -> None:
    """Place a cached photo inside its slot, scaled to fit and centred."""
    from PIL import Image

    slot_width = (GRID_COLS // 2) * COLUMN_PX - 6      # 6px of breathing room
    slot_height = round(rows * PHOTO_ROW_POINTS * PX_PER_POINT) - 6
    with Image.open(path) as probe:
        width, height = probe.size
    scale = min(slot_width / width, slot_height / height, 1.0)
    drawn_width, drawn_height = int(width * scale), int(height * scale)

    stamped = _stamp_label(path, label, warning) if label else None
    image = XLImage(stamped if stamped is not None else str(path))
    image.width, image.height = drawn_width, drawn_height
    # A plain cell anchor pins the image to the slot's top-left corner; the
    # offsets recentre it the way the PDF centres its photo slots.
    image.anchor = OneCellAnchor(
        _from=AnchorMarker(
            col=column - 1, colOff=pixels_to_EMU((slot_width - drawn_width) // 2),
            row=row - 1, rowOff=pixels_to_EMU((slot_height - drawn_height) // 2),
        ),
        ext=XDRPositiveSize2D(pixels_to_EMU(drawn_width), pixels_to_EMU(drawn_height)),
    )
    ws.add_image(image)


_UNSAFE_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED = {"con", "prn", "aux", "nul",
                     *(f"com{n}" for n in range(1, 10)),
                     *(f"lpt{n}" for n in range(1, 10))}


def filename_for(label: str) -> str:
    """A department name as a filename that survives every OS.

    Windows rejects <>:"/\\|?*, reserved device names, and trailing dots or
    spaces. The name still has to be recognisable to whoever opens the
    folder, so characters are replaced rather than dropped.
    """
    safe = _UNSAFE_FILENAME.sub("-", label).strip().rstrip(". ")
    safe = (safe or "Unassigned")[:80].rstrip(". ") or "Unassigned"
    if safe.casefold() in _WINDOWS_RESERVED:
        safe = f"{safe} (dept)"
    return safe


def unique_filenames(labels: list[str]) -> dict[str, str]:
    """Map each department label to a distinct filename stem.

    Department names are free text an admin edits in the app, so two of them
    can sanitise to the same stem — "Line A/B" and "Line A-B" both become
    "Line A-B". Windows and macOS also treat names as case-insensitive, so
    "Shipping" and "SHIPPING" would collide there even though Linux keeps
    them apart. Either way one workbook would silently overwrite another and
    a whole department would vanish from the folder, so collisions are
    resolved rather than left to the filesystem.
    """
    assigned: dict[str, str] = {}
    taken: set[str] = set()
    for label in labels:
        stem = filename_for(label)
        candidate, suffix = stem, 2
        while candidate.casefold() in taken:
            candidate = f"{stem} ({suffix})"
            suffix += 1
        taken.add(candidate.casefold())
        assigned[label] = candidate
    return assigned


def group_by_department(equipment: list[dict]) -> list[tuple[str, list[dict]]]:
    """Departments as the workbook counts them: case-insensitively, each
    labelled with the spelling most of its rows use. "Shipping" and
    "SHIPPING" are one department with 18 placards, not two with 18 each."""
    groups: dict[str, list[dict]] = {}
    spellings: dict[str, Counter] = {}
    for row in equipment:
        name = clean(row.get("department")) or "Unassigned"
        key = name.casefold()
        groups.setdefault(key, []).append(row)
        spellings.setdefault(key, Counter())[name] += 1
    labelled = [(spellings[key].most_common(1)[0][0], rows)
                for key, rows in groups.items()]
    return sorted(labelled, key=lambda pair: pair[0].casefold())


@dataclass(frozen=True)
class PlacardPage:
    """Where one placard page landed, so the register can link to it."""
    equipment_id: str
    language: str
    workbook: str
    sheet: str


_SHEET_TITLE_UNSAFE = re.compile(r"[\\/?*\[\]:]")
SHEET_TITLE_MAX = 31  # Excel's hard limit on a worksheet name


def sheet_title(equipment_id: str, language: str, taken: set[str]) -> str:
    """A worksheet name naming the machine and the side of the sheet.

    The language suffix is what an operator matches against the printout,
    so it is kept whole and the equipment ID is the part shortened when the
    pair would pass Excel's 31-character limit. Excel compares sheet names
    case-insensitively, so collisions are checked the same way.
    """
    suffix = f" {language.upper()}"
    stem = _SHEET_TITLE_UNSAFE.sub("-", equipment_id).strip("' ") or "Placard"
    stem = stem[:SHEET_TITLE_MAX - len(suffix)]
    title, counter = f"{stem}{suffix}", 2
    while title.casefold() in taken:
        tag = f"~{counter}"
        title = f"{stem[:SHEET_TITLE_MAX - len(suffix) - len(tag)]}{tag}{suffix}"
        counter += 1
    taken.add(title.casefold())
    return title


def _placard_page_setup(ws, equipment_id: str, language: str) -> None:
    """One placard, one side of one sheet of paper.

    Fit-to-one-page is set per worksheet, so each placard is scaled on its
    own and a machine with fourteen energy steps shrinks only itself. That
    is the guarantee double-sided printing depends on: if any page spilled
    onto a second sheet, every back side after it would show the wrong
    placard. Excel ignores manual page breaks under fit-to-page, which is
    why each page is a worksheet rather than a break in a long sheet.
    """
    for column in range(1, GRID_COLS + 1):
        ws.column_dimensions[get_column_letter(column)].width = COLUMN_WIDTH
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_LETTER
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.page_margins = PageMargins(left=0.25, right=0.25, top=0.25, bottom=0.35,
                                  header=0.1, footer=0.12)
    side = "English — front" if language == "en" else "Español — reverso"
    ws.oddFooter.center.text = f"{equipment_id}   ·   {side}"
    ws.oddFooter.center.size = 7
    ws.oddFooter.center.font = FONT_NAME
    ws.sheet_view.showGridLines = False


def build_workbook(equipment: list[dict], steps: list[dict], photos: Path,
                   languages: list[str], date: str, out_path: Path,
                   app_links: bool = True,
                   photo_verdicts: dict[str, dict[str, str]] | None = None
                   ) -> list[PlacardPage]:
    """Write one placard workbook: a worksheet per placard page, each
    machine's languages adjacent, in equipment-ID order. Returns the pages."""
    by_equipment: dict[str, list[dict]] = {}
    for step in steps:
        by_equipment.setdefault(step["equipment_id"], []).append(step)
    equipment = sorted(equipment, key=lambda row: row["equipment_id"])

    workbook = Workbook()
    workbook.remove(workbook.active)
    taken: set[str] = set()
    pages: list[PlacardPage] = []
    for row in equipment:
        for language in languages:
            title = sheet_title(clean(row["equipment_id"]), language, taken)
            ws = workbook.create_sheet(title)
            _placard_page_setup(ws, clean(row["equipment_id"]), language)
            draw_placard(PlacardSheet(ws, photos), row,
                         by_equipment.get(row["equipment_id"], []), language, date,
                         app_links=app_links,
                         photo_verdicts=(photo_verdicts.get(row["equipment_id"], {})
                                         if photo_verdicts is not None else None))
            pages.append(PlacardPage(row["equipment_id"], language, out_path.name, title))

    if pages:
        workbook.active = 0
    workbook.save(out_path)
    _share_duplicate_media(out_path)
    return pages


_MEDIA_TARGET = re.compile(r'Target="/?(xl/media/[^"]+)"')


def _share_duplicate_media(path: Path) -> None:
    """Store each photo once, however many placard pages show it.

    openpyxl writes a separate copy of an image for every sheet it is placed
    on, so a machine's two photos are stored twice — once for the English
    page, once for the Spanish. OOXML lets any number of drawings point at
    one media part, which is what Excel itself does for a copied sheet, so
    duplicates are folded onto the first copy. That halves the file, and it
    is the difference between a department's placards fitting in an email
    attachment or not.
    """
    import hashlib
    import zipfile

    with zipfile.ZipFile(path) as source:
        entries = [(info, source.read(info.filename)) for info in source.infolist()]

    canonical: dict[str, str] = {}
    replace: dict[str, str] = {}
    for info, data in entries:
        if info.filename.startswith("xl/media/"):
            digest = hashlib.sha256(data).hexdigest()
            first = canonical.setdefault(digest, info.filename)
            if first != info.filename:
                replace[info.filename] = first
    if not replace:
        return

    def retarget(match: re.Match) -> str:
        return f'Target="/{replace.get(match.group(1), match.group(1))}"'

    scratch = path.with_suffix(".tmp")
    with zipfile.ZipFile(scratch, "w", zipfile.ZIP_DEFLATED) as target:
        for info, data in entries:
            if info.filename in replace:
                continue
            if info.filename.startswith("xl/drawings/_rels/"):
                data = _MEDIA_TARGET.sub(retarget, data.decode("utf-8")).encode("utf-8")
            target.writestr(info, data)
    scratch.replace(path)


def cmd_build(args: argparse.Namespace) -> int:
    from placard_readme import readme_lines
    from placard_register import build_register  # imports this module; avoid a cycle

    data = Path(args.data)
    equipment = json.loads((data / "equipment.json").read_text("utf-8"))
    steps = json.loads((data / "steps.json").read_text("utf-8"))
    findings = json.loads(Path(args.findings).read_text("utf-8")) if args.findings else []
    proposed = json.loads(Path(args.proposed).read_text("utf-8")) if args.proposed else []
    photo_audit = (json.loads(Path(args.photo_audit).read_text("utf-8"))
                   if args.photo_audit else [])
    corrections = (json.loads(Path(args.corrections).read_text("utf-8"))
                   if args.corrections else [])
    photo_verdicts = ({item["equipment_id"]: {"equip": item["equip_photo"]["verdict"],
                                              "iso": item["merged_iso_verdict"]}
                       for item in photo_audit} if photo_audit else None)
    photos = data / "photos"
    languages = ["en", "es"] if args.language == "both" else [args.language]
    app_links = not args.no_app_links
    steps_for = _steps_index(steps)

    if not args.by_department:
        out = Path(args.out)
        pages = build_workbook(equipment, steps, photos, languages, args.date, out, app_links,
                               photo_verdicts)
        register = Path(args.register) if args.register else out.with_name(
            f"{out.stem} - Register.xlsx")
        embedded, referenced = _photo_counts(equipment, photos)
        build_register(equipment, steps, pages, findings, photos, args.date, register,
                       out.parent, readme_lines(equipment, steps, findings, args.date,
                                                embedded, referenced, [out.name],
                                                photo_audit),
                       proposed, photo_audit, corrections)
        print(f"{len(equipment)} placards, {len(pages)} pages -> {out}; register -> {register}")
        return 0

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    groups = group_by_department(equipment)
    names = unique_filenames([label for label, _ in groups])
    expected_files = {f"{name}.xlsx" for name in names.values()}

    pages: list[PlacardPage] = []
    written, failed = 0, []
    for label, rows in groups:
        target = out_dir / f"{names[label]}.xlsx"
        try:
            department_pages = build_workbook(rows, steps_for(rows), photos, languages,
                                              args.date, target, app_links, photo_verdicts)
        except Exception as error:
            # One department must not cost the other twenty-eight, and the
            # folder must still get its register saying which one is missing.
            failed.append((names[label], error))
            print(f"  FAILED {target.name}: {error}", file=sys.stderr)
            continue
        pages.extend(department_pages)
        written += len(rows)
        print(f"  {len(rows):4d} placards, {len(department_pages):4d} pages -> {target.name}")

    # A department renamed or emptied since the last run leaves its old
    # workbook behind. Handing a client a folder containing a stale placard
    # set is worse than handing them a folder with one missing, and nothing
    # in the file itself would reveal it, so they are named and removed.
    stale = sorted(p for p in out_dir.glob("*.xlsx") if p.name not in expected_files)
    for path in stale:
        print(f"  removing stale workbook (no such department now): {path.name}",
              file=sys.stderr)
        path.unlink()

    register = Path(args.register) if args.register else out_dir.parent / "LOTO Register.xlsx"
    embedded, referenced = _photo_counts(equipment, photos)
    build_register(equipment, steps, pages, findings, photos, args.date, register, out_dir,
                   readme_lines(equipment, steps, findings, args.date, embedded, referenced,
                                [f"{names[label]}.xlsx" for label, _ in groups],
                                photo_audit),
                   proposed, photo_audit, corrections)
    print(f"{written} placards across {len(groups) - len(failed)} departments -> {out_dir}/")
    print(f"register -> {register}")
    if failed:
        print(f"  {len(failed)} department(s) failed to build: "
              f"{', '.join(name for name, _ in failed)}", file=sys.stderr)
        return 1
    return 0


def _steps_index(steps: list[dict]):
    """Return a function mapping equipment rows to their steps."""
    by_id: dict[str, list[dict]] = {}
    for step in steps:
        by_id.setdefault(step["equipment_id"], []).append(step)

    def for_rows(rows: list[dict]) -> list[dict]:
        collected: list[dict] = []
        for row in rows:
            collected.extend(by_id.get(row["equipment_id"], []))
        return collected

    return for_rows


def _photo_counts(equipment: list[dict], photos: Path) -> tuple[int, int]:
    """Photos embedded, and photos referenced, for THIS set of equipment.

    Counting every JPEG in the cache instead would make a 22-machine
    department report the whole site's 996 photos against its own 44, which
    reads as a surplus rather than the shortfall it is.
    """
    referenced = embedded = 0
    for row in equipment:
        stem = clean(row.get("equipment_id")).replace("/", "_")
        for kind in ("equip", "iso"):
            if not row.get(f"{kind}_photo_url"):
                continue
            referenced += 1
            if (photos / f"{stem}_{kind}.jpg").exists():
                embedded += 1
    return embedded, referenced


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    fetch = sub.add_parser("fetch", help="cache equipment, steps, and photos from Supabase")
    fetch.add_argument("--out", default="placard-data", help="directory to write the cache into")
    fetch.add_argument("--no-photos", action="store_true", help="skip photo download")
    fetch.add_argument("--photos-only", action="store_true",
                       help="download only the photos named by a cached equipment.json "
                            "(public objects; needs no credentials)")
    fetch.set_defaults(func=cmd_fetch)

    build = sub.add_parser("build", help="render the workbook from a cache directory")
    build.add_argument("--data", default="placard-data", help="directory fetch wrote")
    build.add_argument("--out", default="loto-placards.xlsx", help="workbook to write")
    build.add_argument("--by-department", action="store_true",
                       help="write one workbook per department into --out-dir")
    build.add_argument("--out-dir", default="placards-by-department",
                       help="folder for --by-department")
    build.add_argument("--language", choices=("en", "es", "both"), default="both")
    build.add_argument("--date", default="", help="date printed on each placard")
    build.add_argument("--register", default="",
                       help="register workbook path (default: beside the placard folder)")
    build.add_argument("--findings", default="",
                       help="audit findings JSON to carry into the register")
    build.add_argument("--proposed", default="",
                       help="drafted replacement steps JSON, carried as Draft Corrections")
    build.add_argument("--photo-audit", default="",
                       help="merged lotoauditors photo verdicts JSON, carried as Photo Audit")
    build.add_argument("--corrections", default="",
                       help="log of corrections applied to the data, carried as Corrections Log")
    build.add_argument("--no-app-links", action="store_true",
                       help="omit Soteria Field links (QR, photo URLs) — for a closed account")
    build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    if getattr(args, "date", None) == "":
        from datetime import date
        args.date = date.today().isoformat()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
