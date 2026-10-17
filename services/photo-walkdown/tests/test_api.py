import json
import uuid
from datetime import UTC, datetime

import pytest
from django.urls import reverse

from tests.conftest import BASE, TENANT, jpeg_bytes, live_row
from walkdown import sync
from walkdown.models import Capture, photo_version

ARROWS = [{"type": "arrow", "x1": 0.1, "y1": 0.1, "x2": 0.6, "y2": 0.5, "label": "Electrical disconnect"}]


def post(client, item, **fields):
    payload = {"client_capture_id": str(uuid.uuid4()), "machine": item.pk, "slot": "iso",
               "kind": "photo", "confirmed": "1", "captured_at": datetime.now(UTC).isoformat()}
    payload.update(fields)
    if payload.get("kind") == "photo" and "photo" not in payload:
        from django.core.files.uploadedfile import SimpleUploadedFile
        payload["photo"] = SimpleUploadedFile("p.jpg", jpeg_bytes(), content_type="image/jpeg")
    return client.post(reverse("api_capture"), payload)


def test_requires_sign_in(client, machine):
    response = client.post(reverse("api_capture"), {})
    assert response.status_code == 401
    assert response.json()["error"]


def test_new_isolation_photo_updates_the_placard_exactly(logged_in, machine, fake):
    response = post(logged_in, machine, annotations=json.dumps(ARROWS))

    assert response.status_code == 200
    [path] = fake.uploads
    assert path.startswith(f"/storage/v1/object/loto-photos/{TENANT}/SK-001/SK-001_ISO_")
    [patch] = fake.patches
    assert patch["iso_photo_url"].startswith(f"{BASE}/storage/v1/object/public/loto-photos/{TENANT}/SK-001/")
    assert patch["has_iso_photo"] is True
    assert patch["iso_photo_provenance"] == "field"
    assert patch["iso_photo_is_placeholder"] is False          # trigger 217 would block "complete"
    assert patch["iso_annotations"] == ARROWS                  # arrows travel with their photo
    assert patch["photo_status"] == "complete"
    assert patch["placard_url"] is None                        # makes the cron rebuild the stored PDF
    assert patch["placard_qr_backfilled"] is False
    assert "annotations" not in patch                          # the equipment photo is untouched


def test_replacing_a_photo_drops_arrows_drawn_on_the_old_one(logged_in, machine, fake):
    post(logged_in, machine)  # no arrows supplied
    assert fake.patches[0]["iso_annotations"] == []


def test_equipment_photo_does_not_touch_isolation_columns(logged_in, machine, fake):
    post(logged_in, machine, slot="equip")
    [patch] = fake.patches
    assert "equip_photo_url" in patch and "iso_photo_url" not in patch
    assert "iso_photo_is_placeholder" not in patch
    assert patch["annotations"] == []


def test_audit_row_names_who_and_what(logged_in, machine, fake, user):
    post(logged_in, machine, annotations=json.dumps(ARROWS))
    [row] = fake.hygiene
    assert row["section"] == "photo_walkdown_2026" and row["action"] == "photo_reshoot"
    assert row["tenant_id"] == TENANT                          # NOT NULL in production
    assert user.email in row["reason"]
    assert row["detail"]["old_url"].endswith("old_iso.jpg")
    assert row["detail"]["new_annotations"] == ARROWS


def test_retry_with_same_capture_id_does_not_upload_twice(logged_in, machine, fake):
    capture_id = str(uuid.uuid4())
    assert post(logged_in, machine, client_capture_id=capture_id).status_code == 200
    assert post(logged_in, machine, client_capture_id=capture_id).status_code == 200
    assert len(fake.uploads) == 1 and len(fake.patches) == 1
    assert Capture.objects.count() == 1


def test_supabase_failure_is_retryable_and_leaves_no_capture(logged_in, machine, fake):
    fake.patch_status = 500
    capture_id = str(uuid.uuid4())
    assert post(logged_in, machine, client_capture_id=capture_id).status_code == 503
    assert Capture.objects.count() == 0
    fake.patch_status = 200
    assert post(logged_in, machine, client_capture_id=capture_id).status_code == 200
    assert Capture.objects.count() == 1


@pytest.mark.parametrize("fields,message", [
    ({"slot": "bogus"}, "slot"),
    ({"kind": "bogus"}, "kind"),
    ({"client_capture_id": "nope"}, "capture id"),
    ({"machine": 99999}, "worklist"),
    ({"annotations": "[1]"}, "arrow"),
])
def test_bad_requests_are_rejected_without_touching_supabase(logged_in, machine, fake, fields, message):
    response = post(logged_in, machine, **fields)
    assert response.status_code == 400 and message in response.json()["error"].lower()
    assert not fake.uploads and not fake.patches


def test_rejects_non_jpeg_and_oversize_photos(logged_in, machine, fake, settings):
    from django.core.files.uploadedfile import SimpleUploadedFile
    png = SimpleUploadedFile("p.png", b"\x89PNG\r\n\x1a\n" + b"0" * 50, content_type="image/png")
    assert post(logged_in, machine, photo=png).status_code == 400
    settings.MAX_UPLOAD_BYTES = 100
    big = SimpleUploadedFile("p.jpg", jpeg_bytes((400, 400)), content_type="image/jpeg")
    assert post(logged_in, machine, photo=big).status_code == 400
    assert not fake.uploads


def test_machine_not_in_tenant_is_rejected(logged_in, machine, supabase_mock):
    from tests.conftest import FakeSupabase
    fake = FakeSupabase(supabase_mock, {})
    assert post(logged_in, machine).status_code == 400
    assert not fake.uploads


# ── confirm and annotate ──────────────────────────────────────────────────

def test_confirming_a_real_photo_only_records_the_confirmation(logged_in, machine, fake):
    machine.iso_verdict = "low_confidence"          # audit could not rule the photo out
    machine.save()
    fake.rows["SK-001"] = live_row(iso_photo_is_placeholder=False)
    assert post(logged_in, machine, kind="confirm").status_code == 200
    assert not fake.uploads and not fake.patches
    assert fake.hygiene[0]["action"] == "photo_confirmed"


def test_cannot_confirm_a_placeholder_or_missing_photo(logged_in, machine, fake):
    assert post(logged_in, machine, kind="confirm").status_code == 400          # placeholder
    fake.rows["SK-001"] = live_row(iso_photo_url=None, iso_photo_is_placeholder=False)
    assert post(logged_in, machine, kind="confirm").status_code == 400          # nothing on file


def test_confirm_with_arrows_updates_only_arrows(logged_in, machine, fake):
    machine.iso_verdict = "low_confidence"          # audit could not rule the photo out
    machine.save()
    fake.rows["SK-001"] = live_row(iso_photo_is_placeholder=False)
    post(logged_in, machine, kind="confirm", annotations=json.dumps(ARROWS))
    [patch] = fake.patches
    assert patch["iso_annotations"] == ARROWS and "iso_photo_url" not in patch
    assert patch["placard_qr_backfilled"] is False


def test_arrow_on_existing_photo_requires_the_photo_to_be_unchanged(logged_in, machine, fake):
    machine.iso_verdict = "low_confidence"          # audit could not rule the photo out
    machine.save()
    fake.rows["SK-001"] = live_row(iso_photo_is_placeholder=False)
    from walkdown.models import photo_version
    stale = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS), expect_version="deadbeef00")
    assert stale.status_code == 400 and "changed" in stale.json()["error"]
    ok = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
              expect_version=photo_version(live_row()["iso_photo_url"]))
    assert ok.status_code == 200
    assert fake.patches[-1]["iso_annotations"] == ARROWS


def test_annotate_without_arrow_data_is_rejected(logged_in, machine, fake):
    assert post(logged_in, machine, kind="annotate", expect_version="x").status_code == 400


# ── revert ────────────────────────────────────────────────────────────────

def test_revert_restores_photo_arrows_and_placeholder_state(logged_in, machine, fake, user):
    old_arrows = fake.rows["SK-001"]["iso_annotations"]
    post(logged_in, machine, annotations=json.dumps(ARROWS))
    capture = Capture.objects.get()
    sync.revert(capture, "jamil")
    restore = fake.patches[-1]
    assert restore["iso_photo_url"].endswith("old_iso.jpg")
    assert restore["iso_annotations"] == old_arrows
    assert restore["iso_photo_is_placeholder"] is True          # an undo must not promote a placeholder
    assert restore["iso_photo_provenance"] == "reference_placeholder"
    assert restore["placard_url"] is None and restore["placard_qr_backfilled"] is False
    assert fake.hygiene[-1]["action"] == "photo_reshoot_reverted"
    capture.refresh_from_db()
    assert capture.reverted_at is not None
    with pytest.raises(sync.CaptureRejected):
        sync.revert(capture, "jamil")


# ── server-side rules the screen also follows ─────────────────────────────

def test_a_photo_the_audit_found_wrong_cannot_be_confirmed(logged_in, machine, fake):
    fake.rows["SK-001"] = live_row(iso_photo_is_placeholder=False)
    response = post(logged_in, machine, kind="confirm")           # iso verdict is "mismatch"
    assert response.status_code == 400 and "new photo" in response.json()["error"]
    assert not fake.hygiene


def test_arrows_cannot_go_on_a_photo_the_audit_found_wrong(logged_in, machine, fake):
    fake.rows["SK-001"] = live_row(iso_photo_is_placeholder=False)
    from walkdown.models import photo_version
    response = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
                    expect_version=photo_version(live_row()["iso_photo_url"]))
    assert response.status_code == 400 and not fake.patches


def test_arrow_after_a_new_photo_is_accepted_and_does_not_confirm_it(logged_in, machine, fake):
    post(logged_in, machine, confirmed="0")                       # re-shot, not yet confirmed at the machine
    from walkdown.models import photo_version
    new_url = fake.rows["SK-001"]["iso_photo_url"]
    ok = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
              expect_version=photo_version(new_url))
    assert ok.status_code == 200 and fake.patches[-1]["iso_annotations"] == ARROWS
    machine.refresh_from_db()
    assert machine.slot_state(__import__("walkdown.models", fromlist=["Slot"]).Slot.ISO).tone == "confirm"


def test_an_unconfirmed_reshot_can_be_confirmed_later(logged_in, machine, fake):
    post(logged_in, machine, confirmed="0")
    assert post(logged_in, machine, kind="confirm").status_code == 200
    from walkdown.models import Slot
    machine.refresh_from_db()
    assert machine.slot_state(Slot.ISO).tone == "done"


def test_audit_row_is_written_for_every_kind_of_change(logged_in, machine, fake):
    """The audit trail silently went missing once; assert it is always flagged written."""
    post(logged_in, machine, confirmed="0")                         # re-shot, to be confirmed
    post(logged_in, machine, kind="confirm")                        # confirmed at the machine
    post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
         expect_version=photo_version(fake.rows["SK-001"]["iso_photo_url"]))
    assert len(fake.hygiene) == 3
    assert not Capture.objects.filter(hygiene_logged=False).exists()


# ── arrows tied to the photo they were drawn on ───────────────────────────

def test_arrow_follows_a_photo_that_uploaded_while_the_editor_was_open(logged_in, machine, fake):
    photo_id = str(uuid.uuid4())
    post(logged_in, machine, client_capture_id=photo_id, confirmed="0")
    ok = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
              for_capture=photo_id)                         # no version: the phone never saw it
    assert ok.status_code == 200 and fake.patches[-1]["iso_annotations"] == ARROWS


def test_arrow_for_a_photo_that_never_uploaded_is_refused(logged_in, machine, fake):
    machine.iso_verdict = "low_confidence"          # arrows allowed on this photo, so the link is what fails
    machine.save()
    fake.rows["SK-001"] = live_row(iso_photo_is_placeholder=False)
    response = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
                    for_capture=str(uuid.uuid4()))
    assert response.status_code == 400 and "did not upload" in response.json()["error"]


def test_arrow_for_a_photo_since_replaced_is_refused(logged_in, machine, fake):
    first = str(uuid.uuid4())
    post(logged_in, machine, client_capture_id=first)
    post(logged_in, machine)                                 # a newer photo replaces it
    response = post(logged_in, machine, kind="annotate", annotations=json.dumps(ARROWS),
                    for_capture=first)
    assert response.status_code == 400 and "changed" in response.json()["error"]


def test_malformed_photo_reference_is_rejected(logged_in, machine, fake):
    assert post(logged_in, machine, kind="annotate", annotations="[]",
                for_capture="nope").status_code == 400
