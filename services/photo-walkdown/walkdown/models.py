import hashlib
import uuid
from dataclasses import dataclass

from django.conf import settings
from django.db import models


class Slot(models.TextChoices):
    EQUIP = "equip", "Equipment photo"
    ISO = "iso", "Isolation photo"


class Verdict(models.TextChoices):
    """The consensus photo-audit verdict the worklist was seeded from."""

    MATCH = "match", "Confirmed"
    LOW_CONFIDENCE = "low_confidence", "Confirm at machine"
    MISMATCH = "mismatch", "Wrong machine"
    MISSING = "missing", "No photo"


class CaptureKind(models.TextChoices):
    PHOTO = "photo", "New photo"
    CONFIRM = "confirm", "Existing photo confirmed"
    ANNOTATE = "annotate", "Arrow added to existing photo"


def photo_version(url: str) -> str:
    """Short fingerprint of a photo URL. The URL changes whenever the photo
    does, so this tells the phone (cache busting) and the server (is the
    photo you marked still the one on the placard?) whether it is current."""
    return hashlib.sha256(url.encode()).hexdigest()[:10] if url else ""


@dataclass(frozen=True)
class SlotState:
    label: str
    tone: str  # "done" | "confirm" | "wrong" — drives the chip colour

    @property
    def is_done(self) -> bool:
        return self.tone == "done"


_VERDICT_STATE = {
    Verdict.MATCH: SlotState("OK", "done"),
    Verdict.LOW_CONFIDENCE: SlotState("Confirm", "confirm"),
    Verdict.MISMATCH: SlotState("Wrong", "wrong"),
    Verdict.MISSING: SlotState("Missing", "wrong"),
}


class Machine(models.Model):
    equipment_id = models.CharField(max_length=64, unique=True)
    department = models.CharField(max_length=128, db_index=True)
    description = models.CharField(max_length=512)
    energy_codes = models.JSONField(default=list)
    equip_verdict = models.CharField(max_length=16, choices=Verdict.choices)
    iso_verdict = models.CharField(max_length=16, choices=Verdict.choices)
    equip_photo_note = models.TextField(blank=True)
    iso_photo_note = models.TextField(blank=True)
    recommended_fix = models.TextField(blank=True)
    walk_order = models.PositiveIntegerField()
    # The untouched audit record, so the Excel master can be rebuilt from it.
    audit = models.JSONField()
    # Mirrors of loto_equipment, refreshed from Supabase while online.
    equip_photo_url = models.URLField(max_length=1024, blank=True)
    iso_photo_url = models.URLField(max_length=1024, blank=True)
    iso_photo_is_placeholder = models.BooleanField(default=False)
    # Public placard page token (loto_equipment.qr_token); the report links to it.
    qr_token = models.CharField(max_length=128, blank=True)
    equip_annotations = models.JSONField(default=list, blank=True)
    iso_annotations = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["walk_order"]

    def __str__(self) -> str:
        return self.equipment_id

    @property
    def has_delta(self) -> bool:
        return self.equip_verdict != Verdict.MATCH or self.iso_verdict != Verdict.MATCH

    def verdict(self, slot: Slot) -> str:
        return self.equip_verdict if slot == Slot.EQUIP else self.iso_verdict

    def photo_url(self, slot: Slot) -> str:
        return self.equip_photo_url if slot == Slot.EQUIP else self.iso_photo_url

    def annotations(self, slot: Slot) -> list:
        return self.equip_annotations if slot == Slot.EQUIP else self.iso_annotations

    def latest_capture(self, slot: Slot) -> "Capture | None":
        """The newest photo or confirmation for this slot. Arrow edits are
        deliberately ignored: drawing an arrow does not confirm a photo.
        Iterates the prefetched list when the view prefetched captures, so
        a department page costs one query, not one per machine."""
        captures = [c for c in self.captures.all()
                    if c.slot == slot and c.reverted_at is None and c.kind != CaptureKind.ANNOTATE]
        return max(captures, key=lambda c: c.synced_at, default=None)

    def has_new_photo(self, slot: Slot) -> bool:
        return any(c.slot == slot and c.kind == CaptureKind.PHOTO and c.reverted_at is None
                   for c in self.captures.all())

    def can_confirm(self, slot: Slot) -> bool:
        """"The photo on the placard is correct" is only meaningful for a
        photo the audit could not rule out, or a re-shot still awaiting
        confirmation. A photo the audit found to be another machine's must
        be replaced, never confirmed."""
        latest = self.latest_capture(slot)
        if latest is not None:
            return not latest.confirmed_at_machine
        return self.verdict(slot) == Verdict.LOW_CONFIDENCE

    def can_mark(self, slot: Slot) -> bool:
        """Arrows go on a photo that shows this machine."""
        return self.has_new_photo(slot) or self.verdict(slot) in (Verdict.MATCH,
                                                                   Verdict.LOW_CONFIDENCE)

    def slot_state(self, slot: Slot) -> SlotState:
        capture = self.latest_capture(slot)
        if capture is None:
            return _VERDICT_STATE[Verdict(self.verdict(slot))]
        if capture.confirmed_at_machine:
            return SlotState("Done", "done")
        return SlotState("Re-shot · confirm", "confirm")

    @property
    def equip_state(self) -> SlotState:
        return self.slot_state(Slot.EQUIP)

    @property
    def iso_state(self) -> SlotState:
        return self.slot_state(Slot.ISO)

    @property
    def is_done(self) -> bool:
        return all(self.slot_state(slot).is_done for slot in Slot)


class Capture(models.Model):
    """One photo (or confirmation) that reached Supabase.

    client_capture_id is minted on the phone when the photo is taken and is
    the idempotency key: a retry after a dropped response finds this row
    and returns it instead of uploading twice.
    """

    client_capture_id = models.UUIDField(unique=True)
    machine = models.ForeignKey(Machine, on_delete=models.PROTECT, related_name="captures")
    slot = models.CharField(max_length=8, choices=Slot.choices)
    kind = models.CharField(max_length=8, choices=CaptureKind.choices)
    confirmed_at_machine = models.BooleanField()
    old_url = models.URLField(max_length=1024, blank=True)
    new_url = models.URLField(max_length=1024, blank=True)
    # What the placard had before, so a revert restores it exactly.
    old_annotations = models.JSONField(default=list, blank=True)
    new_annotations = models.JSONField(default=list, blank=True)
    old_state = models.JSONField(default=dict, blank=True)
    photo_status_after = models.CharField(max_length=16, blank=True)
    captured_at = models.DateTimeField()
    synced_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    hygiene_logged = models.BooleanField(default=False)
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-synced_at"]

    def __str__(self) -> str:
        return f"{self.machine_id} {self.slot} {self.kind}"


class Decision(models.TextChoices):
    PENDING = "", "Waiting"
    CONFIRMED = "confirmed", "Confirmed"
    REJECTED = "rejected", "Not right"


class ConfirmationRequest(models.Model):
    """A maintenance supervisor asked to confirm what the photos show.

    The supervisor needs no account: the emailed link carries a signed token for
    this row, and answers are recorded on it (once).
    """

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    machine = models.ForeignKey(Machine, on_delete=models.CASCADE, related_name="confirmation_requests")
    slots = models.JSONField(default=list)  # which photos were put to them: "equip", "iso"
    to_email = models.EmailField()
    to_name = models.CharField(max_length=100, blank=True)
    message = models.TextField(blank=True, max_length=1000)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    sent_at = models.DateTimeField(null=True, blank=True)
    send_error = models.CharField(max_length=300, blank=True)
    # The answer.
    responded_at = models.DateTimeField(null=True, blank=True)
    responder_name = models.CharField(max_length=100, blank=True)
    equip_decision = models.CharField(max_length=16, choices=Decision.choices, blank=True)
    iso_decision = models.CharField(max_length=16, choices=Decision.choices, blank=True)
    equip_note = models.CharField(max_length=500, blank=True)
    iso_note = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.machine_id} -> {self.to_email}"

    @property
    def is_answered(self) -> bool:
        return self.responded_at is not None

    def decision(self, slot: Slot) -> str:
        return self.equip_decision if slot == Slot.EQUIP else self.iso_decision

    def note(self, slot: Slot) -> str:
        return self.equip_note if slot == Slot.EQUIP else self.iso_note

    @property
    def all_confirmed(self) -> bool:
        """Answered, and every photo put to them was confirmed."""
        decisions = [d for d in (self.equip_decision, self.iso_decision) if d]
        return self.is_answered and bool(decisions) and all(d == Decision.CONFIRMED for d in decisions)

    @property
    def summary(self) -> str:
        """One line for the machine page and the client report."""
        if not self.is_answered:
            return "Waiting for " + (self.to_name or self.to_email)
        parts = []
        for slot in Slot:
            decision = self.decision(slot)
            if decision:
                label = "confirmed" if decision == Decision.CONFIRMED else "flagged as not right"
                parts.append(f"{slot.label.lower()} {label}")
        return f"{self.responder_name}: " + "; ".join(parts)
