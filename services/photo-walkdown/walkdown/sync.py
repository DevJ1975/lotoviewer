"""Applying a capture from the phone to Supabase.

Order matters and is chosen so every failure is retryable:
  1. upload a new storage object (never overwrites, so nothing is lost)
  2. patch loto_equipment — the moment the placard changes
  3. record the Capture locally (the idempotency key)
  4. write the loto_hygiene_log audit row
A failure before step 3 returns an error, the phone keeps the capture
queued and retries with the same client_capture_id; at worst step 1 leaves
an unreferenced object behind. Step 4 failing does not undo a placard that
is already correct; it is left unflagged on the Capture so it can be re-sent.
"""
import logging
import uuid
from datetime import datetime

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from . import supabase
from .annotations import COLUMN as ANNOTATION_COLUMN
from .models import Capture, CaptureKind, Machine, Slot, photo_version
from .photo_status import compute_photo_status
from .storage_paths import equipment_photo_path

log = logging.getLogger(__name__)

# Flags that make the platform's regenerate-loto-placards cron rebuild the
# stored placard PDF on its next 5-minute run.
REGENERATE_PLACARD = {"placard_url": None, "placard_qr_backfilled": False}


class CaptureRejected(ValueError):
    """The request can never succeed as sent; the phone should not retry it."""


def _photo_changes(slot: Slot, url: str | None, current: dict, annotations: list[dict]) -> dict:
    """loto_equipment columns for putting `url` (or no photo) in `slot`.

    Arrows belong to one specific picture, so they are always replaced with
    the ones drawn for this photo (possibly none). Provenance and the
    placeholder flag are reset because no platform upload path does it, and
    trigger 217 would otherwise keep a row with a placeholder isolation photo
    from ever reaching "complete".
    """
    urls = {"equip": current.get("equip_photo_url"), "iso": current.get("iso_photo_url"),
            slot.value: url}
    changes = {
        f"{slot.value}_photo_url": url,
        f"has_{slot.value}_photo": bool(url),
        f"{slot.value}_photo_provenance": "field",
        ANNOTATION_COLUMN[slot]: annotations,
        "photo_status": compute_photo_status(urls["equip"], urls["iso"],
                                             current.get("needs_equip_photo"),
                                             current.get("needs_iso_photo")),
        "updated_at": timezone.now().isoformat(),
        **REGENERATE_PLACARD,
    }
    if slot == Slot.ISO:
        changes["iso_photo_is_placeholder"] = False
    return changes


def _annotation_changes(slot: Slot, annotations: list[dict]) -> dict:
    return {ANNOTATION_COLUMN[slot]: annotations, "updated_at": timezone.now().isoformat(),
            **REGENERATE_PLACARD}


def _previous_state(slot: Slot, current: dict) -> dict:
    state = {"provenance": current.get(f"{slot.value}_photo_provenance")}
    if slot == Slot.ISO:
        state["placeholder"] = bool(current.get("iso_photo_is_placeholder"))
    return state


def _current_row(machine: Machine) -> dict:
    rows = supabase.get_equipment(settings.WALKDOWN_TENANT_ID, [machine.equipment_id])
    if machine.equipment_id not in rows:
        raise CaptureRejected(f"{machine.equipment_id} is not in this tenant's equipment")
    return rows[machine.equipment_id]


def _record(machine: Machine, **fields) -> tuple[Capture, bool]:
    """Save the Capture; a concurrent duplicate returns the winner instead."""
    try:
        with transaction.atomic():
            return Capture.objects.create(machine=machine, **fields), True
    except IntegrityError:
        return Capture.objects.get(client_capture_id=fields["client_capture_id"]), False


def _audit(capture: Capture, action: str, user_email: str) -> None:
    try:
        supabase.log_hygiene(
            capture.machine.equipment_id, action,
            f"Photo walkdown by {user_email} at {capture.captured_at.isoformat()}",
            {"slot": capture.slot, "old_url": capture.old_url, "new_url": capture.new_url,
             "old_annotations": capture.old_annotations,
             "new_annotations": capture.new_annotations,
             "confirmed_at_machine": capture.confirmed_at_machine,
             "client_capture_id": str(capture.client_capture_id)})
    except (supabase.SupabaseError, supabase.httpx.HTTPError):
        log.exception("Audit log write failed for capture %s", capture.client_capture_id)
        return
    Capture.objects.filter(pk=capture.pk).update(hygiene_logged=True)
    capture.hygiene_logged = True


def _existing(client_capture_id: uuid.UUID) -> Capture | None:
    return Capture.objects.filter(client_capture_id=client_capture_id).first()


def apply_photo(*, machine: Machine, slot: Slot, jpeg: bytes, annotations: list[dict],
                confirmed: bool, client_capture_id: uuid.UUID, captured_at: datetime,
                user) -> Capture:
    if existing := _existing(client_capture_id):
        return existing
    current = _current_row(machine)
    path = equipment_photo_path(settings.WALKDOWN_TENANT_ID, machine.equipment_id, slot,
                                int(timezone.now().timestamp() * 1000))
    new_url = supabase.upload_photo(path, jpeg)
    row = supabase.patch_equipment(settings.WALKDOWN_TENANT_ID, machine.equipment_id,
                                   _photo_changes(slot, new_url, current, annotations))
    capture, created = _record(
        machine, client_capture_id=client_capture_id, slot=slot, kind=CaptureKind.PHOTO,
        confirmed_at_machine=confirmed, old_url=current.get(f"{slot.value}_photo_url") or "",
        new_url=new_url, old_annotations=current.get(ANNOTATION_COLUMN[slot]) or [],
        new_annotations=annotations, old_state=_previous_state(slot, current),
        photo_status_after=row["photo_status"], captured_at=captured_at, user=user)
    if created:
        mirror_equipment(machine, row)
        _audit(capture, "photo_reshoot", user.email)
    return capture


def apply_confirmation(*, machine: Machine, slot: Slot, annotations: list[dict] | None,
                       client_capture_id: uuid.UUID, captured_at: datetime, user) -> Capture:
    """The photo already on the placard was checked at the machine and is right.

    `annotations` of None leaves the placard's arrows alone.
    """
    if existing := _existing(client_capture_id):
        return existing
    if not machine.can_confirm(slot):
        raise CaptureRejected("The audit found this photo shows another machine, or it is "
                              "already confirmed. Take a new photo instead.")
    current = _current_row(machine)
    url = _usable_photo_url(slot, current)
    old_annotations = current.get(ANNOTATION_COLUMN[slot]) or []
    if annotations is not None:
        row = supabase.patch_equipment(settings.WALKDOWN_TENANT_ID, machine.equipment_id,
                                       _annotation_changes(slot, annotations))
    else:
        row = current
    capture, created = _record(
        machine, client_capture_id=client_capture_id, slot=slot, kind=CaptureKind.CONFIRM,
        confirmed_at_machine=True, old_url=url, new_url=url, old_annotations=old_annotations,
        new_annotations=old_annotations if annotations is None else annotations,
        photo_status_after="", captured_at=captured_at, user=user)
    if created:
        mirror_equipment(machine, row)
        _audit(capture, "photo_confirmed", user.email)
    return capture


def _arrow_target_url(machine: Machine, slot: Slot, current_url: str,
                      expect_version: str, for_capture: uuid.UUID | None) -> None:
    """Refuse arrows that would land on a different picture than the one drawn on.

    An arrow is a position on one specific photo. It is tied either to a photo
    this tool just uploaded (`for_capture`, used when the arrow was drawn on a
    new photo, which may have uploaded while the editor was open) or to the
    version the phone saw on the placard (`expect_version`).
    """
    if for_capture is not None:
        photo = Capture.objects.filter(client_capture_id=for_capture, machine=machine,
                                       slot=slot, kind=CaptureKind.PHOTO,
                                       reverted_at__isnull=True).first()
        if photo is None:
            raise CaptureRejected("The photo this arrow was drawn on did not upload. "
                                  "Take the photo again and mark the arrow.")
        if photo.new_url != current_url:
            raise CaptureRejected("The photo changed after you marked it. Open the machine "
                                  "and mark the arrow again.")
    elif photo_version(current_url) != expect_version:
        raise CaptureRejected("The photo changed after you marked it. Open the machine and "
                              "mark the arrow again.")


def apply_annotation(*, machine: Machine, slot: Slot, annotations: list[dict],
                     expect_version: str, for_capture: uuid.UUID | None,
                     client_capture_id: uuid.UUID, captured_at: datetime, user) -> Capture:
    """Arrows drawn on the photo that is already on the placard."""
    if existing := _existing(client_capture_id):
        return existing
    if not machine.can_mark(slot):
        raise CaptureRejected("The audit found this photo shows another machine. Take a new "
                              "photo first, then mark the arrow on it.")
    current = _current_row(machine)
    url = _usable_photo_url(slot, current)
    _arrow_target_url(machine, slot, url, expect_version, for_capture)
    old_annotations = current.get(ANNOTATION_COLUMN[slot]) or []
    row = supabase.patch_equipment(settings.WALKDOWN_TENANT_ID, machine.equipment_id,
                                   _annotation_changes(slot, annotations))
    capture, created = _record(
        machine, client_capture_id=client_capture_id, slot=slot, kind=CaptureKind.ANNOTATE,
        confirmed_at_machine=True, old_url=url, new_url=url, old_annotations=old_annotations,
        new_annotations=annotations, photo_status_after="", captured_at=captured_at, user=user)
    if created:
        mirror_equipment(machine, row)
        _audit(capture, "isolation_point_marked", user.email)
    return capture


def _usable_photo_url(slot: Slot, current: dict) -> str:
    url = current.get(f"{slot.value}_photo_url") or ""
    if not url:
        raise CaptureRejected("There is no photo on file; take one instead.")
    if slot == Slot.ISO and current.get("iso_photo_is_placeholder"):
        raise CaptureRejected("The isolation photo is a reference placeholder; take a real one.")
    return url


def revert(capture: Capture, user_email: str) -> None:
    """Put the previous photo and arrows back on the placard.

    Storage objects are kept, and the previous provenance and placeholder
    flag are restored so a reference placeholder is never promoted to a
    field photo by an undo.
    """
    if capture.kind == CaptureKind.CONFIRM or capture.reverted_at:
        raise CaptureRejected("Only an applied photo or arrow change can be reverted.")
    machine = capture.machine
    slot = Slot(capture.slot)
    current = _current_row(machine)
    changes = _annotation_changes(slot, capture.old_annotations)
    if capture.kind == CaptureKind.PHOTO:
        changes = _photo_changes(slot, capture.old_url or None, current, capture.old_annotations)
        old = capture.old_state or {}
        changes[f"{slot.value}_photo_provenance"] = old.get("provenance") or "field"
        if slot == Slot.ISO:
            changes["iso_photo_is_placeholder"] = bool(old.get("placeholder"))
    row = supabase.patch_equipment(settings.WALKDOWN_TENANT_ID, machine.equipment_id, changes)
    capture.reverted_at = timezone.now()
    capture.save(update_fields=["reverted_at"])
    mirror_equipment(machine, row)
    supabase.log_hygiene(machine.equipment_id, "photo_reshoot_reverted", f"Reverted by {user_email}",
                         {"slot": slot.value, "restored_url": capture.old_url,
                          "removed_url": capture.new_url,
                          "restored_annotations": capture.old_annotations,
                          "client_capture_id": str(capture.client_capture_id)})


def mirror_equipment(machine: Machine, row: dict) -> None:
    """Copy the live photo and arrow columns onto the local worklist row."""
    machine.equip_photo_url = row.get("equip_photo_url") or ""
    machine.iso_photo_url = row.get("iso_photo_url") or ""
    machine.iso_photo_is_placeholder = bool(row.get("iso_photo_is_placeholder"))
    machine.equip_annotations = row.get("annotations") or []
    machine.iso_annotations = row.get("iso_annotations") or []
    machine.qr_token = row.get("qr_token") or machine.qr_token
    machine.save(update_fields=["equip_photo_url", "iso_photo_url", "iso_photo_is_placeholder",
                                "equip_annotations", "iso_annotations", "qr_token"])


def refresh_from_supabase(machines: list[Machine]) -> None:
    """Best effort: a department page still renders from the last mirror
    when Supabase is unreachable."""
    try:
        rows = supabase.get_equipment(settings.WALKDOWN_TENANT_ID,
                                      [m.equipment_id for m in machines])
    except (supabase.SupabaseError, supabase.httpx.HTTPError):
        log.warning("Could not refresh photo URLs from Supabase", exc_info=True)
        return
    for machine in machines:
        if machine.equipment_id in rows:
            mirror_equipment(machine, rows[machine.equipment_id])
