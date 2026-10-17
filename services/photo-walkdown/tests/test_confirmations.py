import json
import re
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from django.core import signing
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from tests.test_api import ARROWS
from walkdown import confirmations, mailer
from walkdown.models import ConfirmationRequest, Decision
from walkdown.reporting import build_report, report_csv


@pytest.fixture
def resend(supabase_mock, settings):
    """Resend configured and accepting mail; records what was sent."""
    settings.RESEND_API_KEY = "re_test_key"
    sent = []
    supabase_mock.route(method="POST", host="api.resend.com", path="/emails").mock(
        side_effect=lambda request: (sent.append(json.loads(request.content)),
                                     httpx.Response(200, json={"id": "email-1"}))[1])
    return sent


def ask(client, machine, **fields):
    data = {"to_email": "super@snakking.example", "to_name": "Maria", "slots": ["equip", "iso"], "message": ""}
    data.update(fields)
    return client.post(reverse("request_confirmation", args=[machine.pk]), data)


def link_from(response) -> str:
    return re.search(r'value="(http[^"]+/c/[^"]+)"', response.content.decode()).group(1)


def path_of(link: str) -> str:
    return urlparse(link).path


# ── asking ─────────────────────────────────────────────────────────────────

def test_request_sends_an_email_with_the_link_and_reply_to(logged_in, machine, fake, resend, user):
    response = ask(logged_in, machine, message="Please check the guard door too")
    assert response.status_code == 200 and "Request sent" in response.content.decode()
    [mail] = resend
    assert mail["to"] == ["super@snakking.example"] and mail["reply_to"] == user.email
    assert mail["subject"] == "Please confirm the LOTO photos for SK-001"
    link = link_from(response)
    assert link in mail["text"] and f'<a href="{link}">' in mail["html"]
    assert "Hello Maria" in mail["text"] and "guard door" in mail["text"]
    assert "equipment photo and the isolation point photo" in mail["text"]
    saved = ConfirmationRequest.objects.get()
    assert saved.sent_at is not None and saved.send_error == "" and saved.slots == ["equip", "iso"]


def test_no_email_key_gives_a_prefilled_mailto_instead(logged_in, machine, settings):
    settings.RESEND_API_KEY = ""
    response = ask(logged_in, machine)
    html = response.content.decode()
    assert "Not sent yet" in html and "not set up" in html
    mailto = re.search(r'href="(mailto:[^"]+)"', html).group(1).replace("&amp;", "&")
    parts = urlparse(mailto)
    assert parts.path == "super%40snakking.example" or parts.path == "super@snakking.example"
    query = parse_qs(parts.query)
    assert query["subject"] == ["Please confirm the LOTO photos for SK-001"]
    assert "/c/" in query["body"][0]
    assert ConfirmationRequest.objects.get().sent_at is None


def test_email_service_failure_falls_back_and_is_recorded(logged_in, machine, supabase_mock, settings):
    settings.RESEND_API_KEY = "re_test_key"
    supabase_mock.route(method="POST", host="api.resend.com", path="/emails").mock(
        return_value=httpx.Response(422, json={"message": "domain not verified"}))
    response = ask(logged_in, machine)
    assert "Not sent yet" in response.content.decode() and "refused" in response.content.decode()
    assert "domain not verified" not in response.content.decode()      # provider text is not echoed
    assert "refused" in ConfirmationRequest.objects.get().send_error
    supabase_mock.route(method="POST", host="api.resend.com", path="/emails").mock(side_effect=httpx.ConnectError("x"))
    assert "could not be reached" in ask(logged_in, machine, to_email="b@snakking.example").content.decode()


def test_the_api_key_never_appears_in_pages_or_logs(logged_in, machine, resend, caplog):
    html = ask(logged_in, machine).content.decode()
    assert "re_test_key" not in html and "re_test_key" not in caplog.text


@pytest.mark.parametrize("bad", ["not-an-email", "a@b", "a b@c.com", "x@y.com\nBcc: evil@z.com",
                                 "x@y.com\r\nSubject: hi", "", "a@" + "b" * 300 + ".com"])
def test_bad_addresses_and_header_injection_are_refused(logged_in, machine, resend, bad):
    response = ask(logged_in, machine, to_email=bad)
    assert response.status_code == 400 and not resend and not ConfirmationRequest.objects.exists()


def test_names_with_line_breaks_are_refused(logged_in, machine, resend):
    assert ask(logged_in, machine, to_name="Maria\nBcc: evil@z.com").status_code == 400
    assert ask(logged_in, machine, to_name="x" * 101).status_code == 400
    assert not resend


def test_must_choose_a_photo_and_stay_within_length_limits(logged_in, machine, resend):
    assert ask(logged_in, machine, slots=[]).status_code == 400
    assert ask(logged_in, machine, slots=["bogus"]).status_code == 400
    assert ask(logged_in, machine, message="x" * 1001).status_code == 400


def test_the_subject_cannot_be_steered_by_what_a_user_types(logged_in, machine, resend):
    ask(logged_in, machine, to_name="Hello, send money", message="Subject: pwned")
    assert resend[0]["subject"] == "Please confirm the LOTO photos for SK-001"


def test_sending_is_limited_per_user_and_per_recipient(logged_in, machine, resend):
    for _ in range(confirmations.REQUESTS_PER_RECIPIENT_PER_DAY):
        assert ask(logged_in, machine).status_code == 200
    blocked = ask(logged_in, machine)
    assert blocked.status_code == 400 and "already been asked" in blocked.content.decode()
    for index in range(confirmations.REQUESTS_PER_USER_PER_HOUR):
        ConfirmationRequest.objects.create(
            machine=machine, requested_by=ConfirmationRequest.objects.first().requested_by,
            to_email=f"p{index}@x.com", slots=["iso"], expires_at=timezone.now() + timedelta(days=1))
    assert "a lot of requests" in ask(logged_in, machine, to_email="new@x.com").content.decode()


def test_only_signed_in_staff_can_ask(client, machine, resend):
    assert client.post(reverse("request_confirmation", args=[machine.pk]), {"to_email": "a@b.co"}).status_code == 302
    assert not resend


# ── answering ──────────────────────────────────────────────────────────────

@pytest.fixture
def asked(logged_in, machine, fake, resend):
    fake.rows["SK-001"]["iso_annotations"] = ARROWS
    machine.iso_annotations = ARROWS
    machine.save()
    return link_from(ask(logged_in, machine))


def test_supervisor_sees_the_machine_photos_and_arrow_without_signing_in(asked, machine, fake):
    anonymous = Client()
    page = anonymous.get(path_of(asked))
    html = page.content.decode()
    assert page.status_code == 200 and "SK-001" in html and "Equipment photo" in html
    assert 'data-annotations="[{&quot;type&quot;: &quot;arrow&quot;' in html
    assert "Back to the walkdown" not in html and "/api/" not in html
    token = path_of(asked).split("/")[2]
    photo = anonymous.get(reverse("confirm_photo", args=[token, "iso"]))
    assert photo.status_code == 200 and photo["Content-Type"] == "image/jpeg"
    assert page["X-Robots-Tag"] == "noindex, nofollow" and "no-store" in page["Cache-Control"]
    assert photo["X-Robots-Tag"] == "noindex, nofollow"


def answer(client, asked, **fields):
    data = {"name": "Maria Lopez", "equip_decision": "confirmed", "iso_decision": "confirmed"}
    data.update(fields)
    return client.post(path_of(asked), data)


def test_supervisor_confirms_and_it_is_recorded(asked, machine):
    response = answer(Client(), asked)
    assert response.status_code == 200 and "Thank you, Maria Lopez" in response.content.decode()
    saved = ConfirmationRequest.objects.get()
    assert saved.is_answered and saved.all_confirmed and saved.responder_name == "Maria Lopez"
    assert saved.equip_decision == saved.iso_decision == Decision.CONFIRMED


def test_supervisor_can_flag_a_photo_but_must_say_why(asked):
    missing = answer(Client(), asked, iso_decision="rejected")
    assert missing.status_code == 400 and "what is wrong" in missing.content.decode()
    assert not ConfirmationRequest.objects.get().is_answered
    ok = answer(Client(), asked, iso_decision="rejected", iso_note="That is the line 2 disconnect")
    assert ok.status_code == 200
    saved = ConfirmationRequest.objects.get()
    assert saved.iso_decision == Decision.REJECTED and "line 2" in saved.iso_note and not saved.all_confirmed
    assert "flagged as not right" in saved.summary


def test_a_mistake_keeps_what_was_already_chosen(asked):
    response = answer(Client(), asked, name="", iso_decision="rejected", iso_note="Wrong valve")
    html = response.content.decode()
    assert response.status_code == 400 and "Please enter your name" in html and "Wrong valve" in html


@pytest.mark.parametrize("fields", [{"equip_decision": "maybe"}, {"iso_decision": ""}, {"name": "A\nB"},
                                    {"name": "x" * 101}, {"equip_decision": "rejected", "equip_note": "x" * 501}])
def test_invalid_answers_are_refused_and_nothing_is_saved(asked, fields):
    assert answer(Client(), asked, **fields).status_code == 400
    assert not ConfirmationRequest.objects.get().is_answered


def test_a_request_can_only_be_answered_once(asked):
    assert answer(Client(), asked).status_code == 200
    again = answer(Client(), asked, iso_decision="rejected", iso_note="changed my mind")
    assert again.status_code == 409
    assert ConfirmationRequest.objects.get().iso_decision == Decision.CONFIRMED       # unchanged


def test_only_the_requested_photos_are_asked_and_served(logged_in, machine, fake, resend):
    link = link_from(ask(logged_in, machine, slots=["iso"]))
    page = Client().get(path_of(link)).content.decode()
    assert "Isolation photo" in page and "Equipment photo" not in page
    token = path_of(link).split("/")[2]
    assert Client().get(reverse("confirm_photo", args=[token, "equip"])).status_code == 404
    # Answering a photo that was not asked about is ignored, not recorded.
    Client().post(path_of(link), {"name": "M", "iso_decision": "confirmed", "equip_decision": "rejected",
                                  "equip_note": "x"})
    assert ConfirmationRequest.objects.get().equip_decision == ""


def test_forged_expired_and_foreign_links_are_rejected(asked, machine):
    token = path_of(asked).split("/")[2]
    client = Client()
    assert client.get(reverse("confirm_page", args=[token + "x"])).status_code == 404
    assert client.get(reverse("confirm_page", args=["garbage"])).status_code == 404
    other_salt = signing.dumps({"r": str(ConfirmationRequest.objects.get().public_id)}, salt="client-report")
    assert client.get(reverse("confirm_page", args=[other_salt])).status_code == 404
    unknown = signing.dumps({"r": str(uuid.uuid4())}, salt=confirmations.TOKEN_SALT)
    assert client.get(reverse("confirm_page", args=[unknown])).status_code == 404
    ConfirmationRequest.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
    assert client.get(path_of(asked)).status_code == 404
    assert answer(client, asked).status_code == 404


def test_a_link_for_one_machine_cannot_reach_another(asked, machine, django_user_model):
    from walkdown.models import Machine
    other = Machine.objects.create(
        equipment_id="SK-002", department="Fryers", description="Secret machine", energy_codes=["E"],
        equip_verdict="mismatch", iso_verdict="mismatch", walk_order=2, audit={})
    token = path_of(asked).split("/")[2]
    page = Client().get(reverse("confirm_page", args=[token])).content.decode()
    assert "Secret machine" not in page and "SK-002" not in page
    assert "SK-001" in page and other.pk


def test_confirmation_page_is_csrf_protected_and_rate_limited(asked, monkeypatch):
    strict = Client(enforce_csrf_checks=True)
    assert strict.post(path_of(asked), {"name": "M"}).status_code == 403
    monkeypatch.setattr(confirmations, "ANSWERS_PER_LINK_PER_HOUR", 2)
    codes = [answer(Client(), asked, name="").status_code for _ in range(4)]
    assert codes == [400, 400, 429, 429]


def test_supervisor_text_is_escaped_where_staff_and_the_client_read_it(asked, logged_in, machine, client):
    evil = "<script>alert(1)</script>"
    answer(Client(), asked, name=evil, iso_decision="rejected", iso_note=evil)
    assert evil not in logged_in.get(reverse("machine", args=[machine.pk])).content.decode()
    assert evil not in logged_in.get(reverse("report")).content.decode()
    token = signing.dumps({"since": "", "until": ""}, salt="client-report")
    assert evil not in client.get(reverse("client_report", args=[token])).content.decode()
    assert evil not in Client().get(path_of(asked)).content.decode()
    assert evil not in ask(logged_in, machine).content.decode()


def test_public_page_carries_the_standard_protections(asked):
    page = Client().get(path_of(asked))
    assert "frame-ancestors 'none'" in page["Content-Security-Policy"]
    assert "unsafe-inline" not in page["Content-Security-Policy"]
    assert 'name="robots"' in page.content.decode()


# ── what staff and the client see ──────────────────────────────────────────

def test_machine_page_shows_who_was_asked_and_what_they_said(asked, logged_in, machine):
    html = logged_in.get(reverse("machine", args=[machine.pk])).content.decode()
    assert "Waiting for Maria" in html and "Ask a maintenance supervisor" in html
    answer(Client(), asked)
    html = logged_in.get(reverse("machine", args=[machine.pk])).content.decode()
    assert "Maria Lopez: equipment photo confirmed; isolation photo confirmed" in html


def test_report_lists_maintenance_confirmation_for_the_client(asked, logged_in, machine, fake):
    answer(Client(), asked)
    report = build_report()
    [item] = report.updated                     # no photo was taken: the confirmation alone counts
    assert report.confirmed_by_maintenance == 1 and "Maria Lopez" in item.confirmation
    csv_text = report_csv(report)
    assert "Maintenance confirmation" in csv_text and "Maria Lopez" in csv_text


def test_report_flags_a_rejection_without_counting_it_as_confirmed(asked, logged_in, machine):
    answer(Client(), asked, iso_decision="rejected", iso_note="wrong valve")
    report = build_report()
    assert report.confirmed_by_maintenance == 0 and "not right" in report.updated[0].confirmation


def test_unanswered_requests_do_not_appear_in_the_client_report(asked):
    assert build_report().machines_updated == 0


def test_mail_helpers_escape_and_build_safe_content():
    assert mailer.subject_for("A-1") == "Please confirm the LOTO photos for A-1"
    html = mailer.html_for("a <b> & c https://x.test/c/tok", "https://x.test/c/tok")
    assert "&lt;b&gt;" in html and '<a href="https://x.test/c/tok">' in html and "<b>" not in html
