"""Feed the walkdown's results back into the Excel master.

The placard workbooks stamp every photo with the verdict from the photo
audit (red WRONG band, yellow VERIFY band, clean only when confirmed).
This rewrites that audit so a slot confirmed at the machine becomes
"match" and prints clean, and a slot photographed but not confirmed
stays yellow.
"""
import copy

from django.utils import timezone

from .models import Machine, Slot, Verdict


def _describe(capture) -> str:
    when = timezone.localtime(capture.captured_at).strftime("%Y-%m-%d")
    action = "Re-shot" if capture.kind == "photo" else "Confirmed"
    where = "at the machine" if capture.confirmed_at_machine else "(not yet confirmed at the machine)"
    return f"{action} {when} {where}."


def build_photo_audit() -> list[dict]:
    machines = Machine.objects.prefetch_related("captures")
    audit = []
    for machine in machines:
        item = copy.deepcopy(machine.audit)
        for slot in Slot:
            capture = machine.latest_capture(slot)
            if capture is None:
                continue
            verdict = Verdict.MATCH if capture.confirmed_at_machine else Verdict.LOW_CONFIDENCE
            if slot == Slot.ISO:
                item["merged_iso_verdict"] = item["iso_photo"]["verdict"] = verdict.value
                item["iso_photo"]["shows_isolation_point"] = True
                item["iso_photo"]["consistent_with_energy_steps"] = True
                item["iso_photo"]["notes"] = _describe(capture)
                if capture.confirmed_at_machine:
                    item["reshot_on"] = timezone.localtime(capture.captured_at).date().isoformat()
                    item["recommended_fix"] = "None — verified at the machine."
            else:
                item["equip_photo"]["verdict"] = verdict.value
                item["equip_photo"]["notes"] = _describe(capture)
        audit.append(item)
    return audit
