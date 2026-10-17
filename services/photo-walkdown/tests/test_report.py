import json
from datetime import timedelta

from django.core import signing
from django.urls import reverse
from django.utils import timezone

from tests.test_api import ARROWS, post
from walkdown import sync
from walkdown.exporting import build_photo_audit
from walkdown.models import Capture
from walkdown.reporting import build_report, report_csv


def test_report_counts_and_links_to_each_updated_placard(logged_in, machine, fake):
    post(logged_in, machine, annotations=json.dumps(ARROWS))                 # iso photo + arrow
    post(logged_in, machine, slot="equip", confirmed="0")                    # equip photo, unconfirmed
    report = build_report()
    assert (report.machines_updated, report.new_photos, report.arrows_marked) == (1, 2, 1)
    [item] = report.updated
    assert item.placard_url == "https://soteriafield.app/qr/tok-sk-001"
    assert "New isolation photo" in item.actions and "Isolation point marked with an arrow" in item.actions
    assert "New equipment photo (awaiting confirmation)" in item.actions


def test_reverted_captures_are_not_reported(logged_in, machine, fake):
    post(logged_in, machine)
    sync.revert(Capture.objects.get(), "jamil")
    assert build_report().machines_updated == 0


def test_date_range_filters_updates(logged_in, machine, fake):
    post(logged_in, machine)
    today = timezone.localdate()
    assert build_report(since=today, until=today).machines_updated == 1
    assert build_report(until=today - timedelta(days=1)).machines_updated == 0
    assert build_report(since=today + timedelta(days=1)).machines_updated == 0


def test_department_progress_counts_a_machine_once_both_photos_are_done(logged_in, machine, fake):
    machine.equip_verdict = machine.iso_verdict = "low_confidence"
    machine.save()
    fake.rows["SK-001"]["iso_photo_is_placeholder"] = False
    post(logged_in, machine, kind="confirm", slot="equip")
    assert build_report().departments[0].done == 0            # isolation still to do
    post(logged_in, machine, kind="confirm", slot="iso")
    [dept] = build_report().departments
    assert (dept.total, dept.done, dept.remaining) == (1, 1, 0)


def test_csv_has_one_row_per_machine_with_link(logged_in, machine, fake):
    post(logged_in, machine)
    rows = report_csv(build_report()).strip().splitlines()
    assert rows[0].startswith("Equipment ID,Description") and len(rows) == 2
    assert "https://soteriafield.app/qr/tok-sk-001" in rows[1]


def test_internal_report_shows_the_client_link(logged_in, machine, fake):
    post(logged_in, machine)
    html = logged_in.get(reverse("report")).content.decode()
    assert "/r/" in html and "Download report" in html and "tok-sk-001" in html


def test_client_link_works_without_login_and_hides_staff_details(client, logged_in, machine, fake, user):
    post(logged_in, machine)
    token = signing.dumps({"since": "", "until": ""}, salt="client-report")
    from django.test import Client
    anonymous = Client()
    page = anonymous.get(reverse("client_report", args=[token]))
    html = page.content.decode()
    assert page.status_code == 200 and "View placard" in html and "SK-001" in html
    assert user.email not in html and "Back to the walkdown" not in html
    assert page["X-Robots-Tag"] == "noindex, nofollow"


def test_client_link_rejects_tampered_and_expired_tokens(client, db):
    good = signing.dumps({"since": "", "until": ""}, salt="client-report")
    assert client.get(reverse("client_report", args=[good + "x"])).status_code == 404
    wrong_salt = signing.dumps({"since": "", "until": ""}, salt="other")
    assert client.get(reverse("client_report", args=[wrong_salt])).status_code == 404
    from unittest import mock
    with mock.patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 91 * 86400):
        assert client.get(reverse("client_report", args=[good])).status_code == 404


def test_report_download_is_self_contained(logged_in, machine, fake):
    post(logged_in, machine)
    html = logged_in.get(reverse("report_download", args=["html"])).content.decode()
    assert "<style>" in html and 'rel="stylesheet"' not in html and "attachment" in logged_in.get(
        reverse("report_download", args=["html"]))["Content-Disposition"]
    assert logged_in.get(reverse("report_download", args=["pdf"])).status_code == 404


def test_report_requires_sign_in_but_client_page_does_not(client, db):
    assert client.get(reverse("report")).status_code == 302
    assert client.get(reverse("report_download", args=["csv"])).status_code == 302


def test_photo_audit_export_marks_confirmed_slots_clean(logged_in, machine, fake):
    [before] = build_photo_audit()
    assert before["merged_iso_verdict"] == "mismatch" and "reshot_on" not in before
    post(logged_in, machine)                                          # iso photo, confirmed at machine
    post(logged_in, machine, slot="equip", confirmed="0")             # equip photo, not confirmed
    [after] = build_photo_audit()
    assert after["merged_iso_verdict"] == "match" and after["iso_photo"]["verdict"] == "match"
    assert after["iso_photo"]["consistent_with_energy_steps"] is True
    assert after["reshot_on"] == timezone.localdate().isoformat()
    assert after["equip_photo"]["verdict"] == "low_confidence"        # still yellow until confirmed
    assert "@" not in after["iso_photo"]["notes"]                     # no staff emails in client files


def test_export_command_writes_the_audit_json(logged_in, machine, fake, tmp_path):
    from django.core.management import call_command
    post(logged_in, machine)
    target = tmp_path / "audit.json"
    call_command("export_photo_audit", str(target))
    [item] = json.loads(target.read_text())
    assert item["equipment_id"] == "SK-001" and item["reshot_on"]


def test_load_deltas_is_repeatable_and_keeps_captures(logged_in, machine, fake):
    from django.core.management import call_command
    post(logged_in, machine)
    call_command("load_deltas", "--no-refresh")
    call_command("load_deltas", "--no-refresh")
    assert Capture.objects.count() == 1
    from walkdown.models import Machine
    assert Machine.objects.count() == 498   # 497 seeded + the fixture machine
