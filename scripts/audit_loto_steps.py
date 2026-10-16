"""Rule-based audit of Snak King LOTO energy steps (OSHA 29 CFR 1910.147).

    python scripts/audit_loto_steps.py <data-dir> <findings.json>

Every finding names the machine, the step it concerns (if any), the rule it
breaks, and what to do about it. Severity is about worker risk, not tidiness:

  CRITICAL  the placard would mislead or leave a worker without a procedure
  HIGH      a required element (1910.147(c)(4)(ii), (d)) is missing/unfinished
  MEDIUM    the Spanish page or the data needs correction, but the English
            procedure is complete
  LOW       housekeeping
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

VALID_CODES = {"E", "G", "H", "P", "M", "T", "W", "S", "V", "CG", "CP", "GR", "N"}
VALID_PHASES = {"shutdown", "isolate", "release_stored_energy", "lockout", "verify_zero_energy"}
STORED_ENERGY_CODES = {"P", "H", "G", "CG", "T", "S", "W", "GR"}
RELEASE_WORDS = re.compile(
    r"\b(bleed|bled|vent|exhaust|drain|dump|release|relieve|discharge|depressur|"
    r"cool|block|pin|chock|lower|purge|bleed-?off|zero)", re.IGNORECASE)
VERIFY_WORDS = re.compile(
    r"\b(try-?out|attempt to (re)?start|verify|confirm|test|gauge|meter|reads? 0|"
    r"zero|no response|absence of voltage)", re.IGNORECASE)
PLACEHOLDER = re.compile(r"\[VERIFY ON SITE[^\]]*\]|\bTBD\b|\bTODO\b|\?\?\?|\bXXX\b", re.IGNORECASE)
NOT_IMPLEMENTED = re.compile(r"not yet implemented|no implementad|sin implementar", re.IGNORECASE)
TEMPLATE_ARTIFACT = re.compile(
    r"detail pending|detalle pendiente|TAG_BODY(_ES)?|loto_templates(_es)?|"
    r"\(\s*[A-Z]+(?:_[A-Z]+)+/[A-Z]+\s*\)")
GRAVITY_TEXT = re.compile(r"\bgravity\b|\bgravedad\b", re.IGNORECASE)
TEXT_FIELDS = ("tag_description", "isolation_procedure", "method_of_verification")

# Words in a machine's own notes that name an energy source, and the codes
# that would cover it. A note that warns of steam on a machine with no S/T
# step is a placard that warns about a hazard it never tells you to isolate.
NOTE_ENERGY = {
    r"\bsteam\b": {"S", "T"},
    r"\bhydraulic": {"H"},
    r"\b(natural gas|gas valve|burner|propane)\b": {"G"},
    r"\b(compressed air|pneumatic|air supply)\b": {"P", "CG"},
    r"\b(hot oil|fryer oil|thermal fluid)\b": {"T"},
    r"\bammonia\b": {"CG", "G"},
}


def text(value) -> str:
    return (value or "").strip()


def finding(severity, equipment, check, detail, action, step=None, field=None):
    return {
        "severity": severity,
        "equipment_id": equipment["equipment_id"],
        "description": text(equipment.get("description")),
        "department": text(equipment.get("department")),
        "step_number": step.get("step_number") if step else None,
        "energy_type": step.get("energy_type") if step else None,
        "step_type": step.get("step_type") if step else None,
        "field": field,
        "check": check,
        "detail": detail,
        "action": action,
    }


def audit_step(eq, step, machine_has_verify) -> list[dict]:
    out = []
    code, phase = step.get("energy_type"), step.get("step_type")
    joined_en = " ".join(text(step.get(f)) for f in TEXT_FIELDS)

    if code not in VALID_CODES:
        out.append(finding("HIGH", eq, "Unknown energy code",
                           f"energy_type '{code}' is not in the placard colour legend.",
                           "Set a valid energy code.", step))
    if phase not in VALID_PHASES:
        out.append(finding("HIGH", eq, "Unknown step phase",
                           f"step_type '{phase}' is not an OSHA procedure phase.",
                           "Set the step to shutdown/isolate/release/lockout/verify.", step))

    if code == "CG" and GRAVITY_TEXT.search(joined_en):
        out.append(finding(
            "HIGH", eq, "Gravity hazard coded as Compressed Gas",
            "Step text describes a GRAVITY hazard but energy_type is CG, which the placard "
            "legend prints as 'CG = Compressed Gas' (teal). Snak King's original sheet used "
            "CG for 'Control Gravity'; the app re-assigned gravity to GR in migration 023 "
            "but this row was never re-coded.",
            "Change energy_type to GR (Gravity) and the tag header '(CG)' to '(GR)'.", step))

    for field in TEXT_FIELDS:
        for language, key in (("EN", field), ("ES", f"{field}_es")):
            value = text(step.get(key))
            if NOT_IMPLEMENTED.search(value):
                out.append(finding(
                    "CRITICAL", eq, "Procedure not written",
                    f"{language} {field} prints '{value.splitlines()[-1][:90]}' — there is no "
                    f"procedure for this {code} energy source.",
                    "Write the isolation procedure and verification for this source before "
                    "the placard is used (1910.147(c)(4)(ii)).", step, key))
            elif TEMPLATE_ARTIFACT.search(value):
                out.append(finding(
                    "HIGH", eq, "Template text printed instead of hazard description",
                    f"{language} {field} prints '{TEMPLATE_ARTIFACT.search(value).group(0)}…' "
                    "(unfilled template) instead of describing the energy source.",
                    "Replace with the real energy-source description (what, where, magnitude).",
                    step, key))
            for match in PLACEHOLDER.findall(text(step.get(key))):
                out.append(finding(
                    "HIGH", eq, "Unfinished field-verification placeholder",
                    f"{language} {field} prints '{match}' on the placard.",
                    "Walk down the machine, fill in the real value, remove the bracket.",
                    step, key))

    if phase == "isolate" and not text(step.get("method_of_verification")) \
            and not machine_has_verify:
        out.append(finding(
            "HIGH", eq, "Isolation step has no verification method",
            "No 'Method of Verification' for this energy source and the machine has no "
            "verify-zero-energy step, so the placard never says how to prove isolation "
            "(1910.147(d)(6)).",
            "Add a verification method (try-out, gauge reads 0, voltage test).", step,
            "method_of_verification"))

    for field in TEXT_FIELDS:
        english, spanish = text(step.get(field)), text(step.get(f"{field}_es"))
        if english and not spanish:
            out.append(finding(
                "MEDIUM", eq, "Spanish text missing",
                f"{field}_es is blank, so the Spanish page prints the English text.",
                "Add the Spanish translation.", step, f"{field}_es"))
        elif english and spanish and english.casefold() == spanish.casefold() \
                and len(english) > 25:
            out.append(finding(
                "MEDIUM", eq, "Spanish text is untranslated English",
                f"{field}_es is identical to the English.",
                "Translate.", step, f"{field}_es"))
    return out


def audit_machine(eq, steps) -> list[dict]:
    out = []
    if not steps:
        return [finding("CRITICAL", eq, "No energy steps",
                        "The placard prints 'No energy steps defined for this equipment.'",
                        "Write the machine-specific procedure before this placard is posted "
                        "(1910.147(c)(4)).")]

    codes = {s.get("energy_type") for s in steps}
    phases = Counter(s.get("step_type") for s in steps)
    has_verify = (phases["verify_zero_energy"] > 0
                  or any(s.get("tryout_required") for s in steps))
    all_text = " ".join(text(s.get(f)) for s in steps for f in TEXT_FIELDS)

    for step in steps:
        out.extend(audit_step(eq, step, has_verify))

    if "E" not in codes:
        manual = re.search(r"manual|table|tank", text(eq.get("description")), re.IGNORECASE)
        out.append(finding(
            "LOW" if manual else "HIGH", eq, "No electrical isolation step",
            f"Energy codes on this placard: {', '.join(sorted(c for c in codes if c))}. "
            "Almost every production machine has an electrical source.",
            "Confirm the machine truly has no electrical supply, or add the electrical step."))

    if not has_verify and not any(text(s.get("method_of_verification")) for s in steps):
        out.append(finding(
            "HIGH", eq, "No verification of isolation anywhere on placard",
            "No verify step, no try-out flag and no verification text on any step.",
            "Add a try-out / zero-energy verification step (1910.147(d)(6))."))

    stored = codes & STORED_ENERGY_CODES
    if stored and phases["release_stored_energy"] == 0 and not RELEASE_WORDS.search(all_text):
        out.append(finding(
            "HIGH", eq, "Stored energy never released",
            f"Placard isolates {', '.join(sorted(stored))} but no step bleeds, vents, "
            "drains, blocks or cools it.",
            "Add a release-stored-energy step (1910.147(d)(5))."))

    seen = Counter((s.get("energy_type"), text(s.get("isolation_procedure")).casefold())
                   for s in steps if text(s.get("isolation_procedure")))
    for (code, _), count in seen.items():
        if count > 1:
            out.append(finding("LOW", eq, "Duplicate step",
                               f"{count} identical '{code}' steps print on the placard.",
                               "Delete the duplicate."))

    notes = f"{text(eq.get('notes'))} {text(eq.get('description'))}".lower()
    for pattern, covering in NOTE_ENERGY.items():
        if re.search(pattern, notes) and not (codes & covering):
            word = re.search(pattern, notes).group(0)
            severe = covering & {"S", "T"}
            out.append(finding(
                "CRITICAL" if severe else "MEDIUM", eq, "Hazard named in warning has no isolation step",
                f"Notes/description mention '{word}' but no "
                f"{'/'.join(sorted(covering))} step exists.",
                "Add the step, or correct the note."))
    return out


def main() -> int:
    data, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    equipment = json.loads((data / "equipment.json").read_text("utf-8"))
    steps = json.loads((data / "steps.json").read_text("utf-8"))
    by_machine = defaultdict(list)
    for s in steps:
        by_machine[s["equipment_id"]].append(s)

    findings = []
    for eq in sorted(equipment, key=lambda e: e["equipment_id"]):
        findings.extend(audit_machine(eq, by_machine.get(eq["equipment_id"], [])))

    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    findings.sort(key=lambda f: (order[f["severity"]], f["equipment_id"],
                                 f["step_number"] or 0))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(findings, ensure_ascii=False, indent=1), "utf-8")

    by_sev = Counter(f["severity"] for f in findings)
    machines = {s: len({f["equipment_id"] for f in findings if f["severity"] == s})
                for s in order}
    print(f"{len(findings)} findings: " + ", ".join(
        f"{s} {by_sev[s]} ({machines[s]} machines)" for s in order))
    for (sev, check), n in sorted(Counter((f["severity"], f["check"]) for f in findings).items(),
                                  key=lambda kv: (order[kv[0][0]], -kv[1])):
        print(f"  {sev:8} {n:5}  {check}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
