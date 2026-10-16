"""The bilingual Read Me carried in the register workbook.

Written for the person at the client who will print, post and maintain the
placards — not for us — so it says what to press, in English and Spanish,
and states plainly what has not been reviewed yet.
"""

from __future__ import annotations

from collections import Counter

Line = tuple[str, str]  # (style, text) — styles: title, heading, body, note, blank


def readme_lines(equipment: list[dict], steps: list[dict], findings: list[dict],
                 generated: str, photos_embedded: int, photos_referenced: int,
                 workbooks: list[str], photo_audit: list[dict] | None = None) -> list[Line]:
    severity = Counter(f["severity"] for f in findings)
    flagged = {sev: len({f["equipment_id"] for f in findings if f["severity"] == sev})
               for sev in ("CRITICAL", "HIGH")}
    unreviewed = sum(1 for row in equipment if not row.get("spanish_reviewed"))
    verified = sum(1 for row in equipment if row.get("verified"))
    missing_photos = photos_referenced - photos_embedded

    lines: list[Line] = [
        ("title", "LOTO Placards & Program Register — Placas LOTO y Registro del Programa"),
        ("note", f"Generated {generated}  ·  {len(equipment)} machines  ·  "
                 f"{len(steps)} energy isolation steps  ·  {len(workbooks)} placard workbooks"),
        ("blank", ""),
        ("heading", "What is in this package"),
        ("body", "• Placard workbooks (one per department). Every machine has two tabs: "
                 "'<ID> EN' (English) and '<ID> ES' (Spanish). Each tab prints on exactly one "
                 "Letter page, so printing double-sided puts English on the front and Spanish "
                 "on the back of the same sheet."),
        ("body", "• Print-ready PDFs of the same placards, already in front/back order."),
        ("body", "• This register: Dashboard, Register (one row per machine), Inspection Log, "
                 "Audit Findings, Energy Steps and Energy Codes. Counts and statuses are live "
                 "formulas — log an inspection or close a finding and everything updates."),
        ("body", "• Photos folder: every equipment and isolation-point photo, named by "
                 "equipment ID, for reprints, work packs and photo replacement."),
        ("body", "• Data export (CSV) of equipment and energy steps, for import into any "
                 "other system."),
        ("note", "Keep the folder together: the register links to the placard workbooks by "
                 "relative path."),
        ("blank", ""),
        ("heading", "Printing placards double-sided"),
        ("body", "From the PDF (simplest): open the department PDF → Print → 'Print on both "
                 "sides' → 'Flip on long edge' → Letter → Actual size / Fit. Every odd page is "
                 "English, the even page behind it is Spanish."),
        ("body", "From Excel: open the department workbook → File → Print → 'Print Entire "
                 "Workbook' → 'Print on Both Sides — Flip on long edge' → Letter. Do not add "
                 "other sheets to a placard workbook: one extra page shifts every back side."),
        ("body", "Test first: print one machine (click its EN tab, Ctrl-click its ES tab, "
                 "'Print Active Sheets'). Check the Spanish side is upright and belongs to the "
                 "same machine, then print the rest."),
        ("body", "Bigger text: placards are sized for Letter. On an 11×17 printer, right-click "
                 "any tab → Select All Sheets → Page Layout → Size → Tabloid, then right-click → "
                 "Ungroup Sheets. Each placard still fits one page, about 30% larger."),
        ("body", "Post the laminated placard at the machine's primary disconnect or operator "
                 "station. The footer of every page names the machine and the side."),
        ("blank", ""),
        ("heading", "Updating a photo"),
        ("body", "Click the photo on the placard → Picture Format → Change Picture → From a "
                 "File, and pick the new photo. Size and position are kept. Do it on both the "
                 "EN and ES tab of that machine. Original photos are in the Photos folder, "
                 "named '<Equipment ID> - Equipment.jpg' and '<Equipment ID> - Isolation "
                 "Point.jpg'."),
        ("body", f"Photos embedded: {photos_embedded} of {photos_referenced}."
                 + (f" {missing_photos} slot(s) show '— No photo —'; they are listed in the "
                    "Register (Photos on placard < 2)." if missing_photos else "")),
        ("blank", ""),
        ("heading", "Before you post these placards — read this"),
        ("body", f"A pre-delivery audit of every energy step found {severity['CRITICAL']} "
                 f"CRITICAL and {severity['HIGH']} HIGH findings, on {flagged['CRITICAL']} and "
                 f"{flagged['HIGH']} machines respectively. They are listed on the Audit "
                 "Findings sheet with the recommended correction, and each is linked to its "
                 "placard. Correct and re-verify every CRITICAL finding before that machine's "
                 "placard is relied on for lockout."),
        ("body", f"Spanish: {unreviewed} of {len(equipment)} Spanish placards have not been "
                 "reviewed by a qualified bilingual reviewer, so they carry a red 'BORRADOR — NO "
                 "REVISADO' banner. Where a Spanish field is blank the English text is printed in "
                 "its place. Have the translations reviewed before relying on them for "
                 "Spanish-speaking authorized employees."),
        *_photo_audit_lines(photo_audit, len(equipment)),
        ("body", f"Field verification: {verified} of {len(equipment)} procedures are marked "
                 "verified against the machine. Text in [VERIFY ON SITE: …] brackets is a value "
                 "that still has to be confirmed at the machine."),
        ("blank", ""),
        ("heading", "Keeping the program current (OSHA 1910.147 / Cal/OSHA T8 §3314)"),
        ("body", "Annual periodic inspection: each procedure must be inspected at least once a "
                 "year by an authorized employee other than the one using it. Log each one on "
                 "the Inspection Log sheet; the Register shows the next due date and flags "
                 "OVERDUE machines, and the Dashboard totals them by department."),
        ("body", "When a machine is modified, moved or replaced, update its procedure and "
                 "placard before it returns to service, and log the change."),
        ("body", "Audit Findings: set Status to In progress / Corrected / Not applicable as "
                 "you work through them, with an owner and date. Corrected rows grey out and "
                 "drop out of every open-finding count."),
        ("blank", ""),
        ("heading", "Resumen en español"),
        ("body", "• Libros de placas por departamento: cada máquina tiene dos pestañas, '<ID> EN' "
                 "(inglés) y '<ID> ES' (español). Cada pestaña imprime en una sola hoja carta; "
                 "al imprimir a doble cara, el inglés queda al frente y el español al reverso."),
        ("body", "• Imprimir: Archivo → Imprimir → 'Imprimir todo el libro' → 'Imprimir en ambas "
                 "caras — voltear por el borde largo' → Carta. Imprima primero una máquina de "
                 "prueba. Los PDF ya están en orden frente/reverso."),
        ("body", "• Cambiar una foto: clic en la foto → Formato de imagen → Cambiar imagen → "
                 "Desde un archivo. Hágalo en las pestañas EN y ES. Las fotos originales están en "
                 "la carpeta Fotos, nombradas por ID de equipo."),
        ("body", "• Antes de publicar: revise la hoja 'Audit Findings'. Corrija y verifique los "
                 "hallazgos CRÍTICOS antes de usar la placa de esa máquina. Las traducciones al "
                 "español llevan la marca 'BORRADOR — NO REVISADO' hasta que un revisor bilingüe "
                 "calificado las apruebe."),
        ("body", "• Fotos: la hoja 'Photo Audit' indica qué fotos de aislamiento no muestran el "
                 "punto de aislamiento de esa máquina. Hasta que se vuelvan a tomar, siga el "
                 "procedimiento escrito, no la foto."),
        ("body", "• Inspección periódica anual: registre cada inspección en la hoja 'Inspection "
                 "Log'. El Registro y el Tablero muestran la próxima fecha y las inspecciones "
                 "VENCIDAS (OVERDUE)."),
    ]
    return lines


def _photo_audit_lines(photo_audit: list[dict] | None, machines: int) -> list[Line]:
    if not photo_audit:
        return []
    verdicts = Counter(item["merged_iso_verdict"] for item in photo_audit)
    return [("body", f"Photos: every placard photo was inspected by computer vision and checked "
                     f"by two reviewers. Only {verdicts['match']} of {machines} isolation photos "
                     f"are confirmed to show that machine's own isolation point; "
                     f"{verdicts['mismatch']} show the wrong device or another machine's, and "
                     f"{verdicts['low_confidence'] + verdicts['missing']} are unverified or "
                     "missing. Many are shared, representative images. Until a photo is re-shot "
                     "and marked 'Re-shot & verified' on the Photo Audit sheet, the written "
                     "procedure — not the photo — identifies the isolation point.")]
