"""Security checks: access control, CSRF, throttling, limits, headers, injection."""
import json
import uuid

import httpx
import pytest
from django.test import Client
from django.urls import reverse
from django.utils import timezone

from tests.conftest import jpeg_bytes
from tests.test_api import post
from walkdown import middleware

PUBLIC = {"login", "offline", "manifest", "service_worker", "healthz"}


# ── access control ─────────────────────────────────────────────────────────

def protected_urls(machine):
    return [
        reverse("departments"), reverse("department", args=["fryers"]),
        reverse("machine", args=[machine.pk]), reverse("machine_status", args=[machine.pk]),
        reverse("thumb", args=[machine.pk, "iso"]), reverse("search") + "?q=sk",
        reverse("sync"), reverse("precache", args=["fryers"]), reverse("export_photo_audit"),
        reverse("report"), reverse("report_download", args=["csv"]),
        reverse("report_download", args=["html"]),
    ]


def test_every_page_and_data_route_needs_a_session(client, machine):
    for url in protected_urls(machine):
        response = client.get(url)
        assert response.status_code == 302 and response["Location"].startswith("/login/"), url
        assert b"SK-001" not in response.content, url


def test_api_and_logout_refuse_the_wrong_method_and_anonymous_callers(client, machine):
    assert client.post(reverse("api_capture")).status_code == 401
    assert client.get(reverse("api_capture")).status_code == 401
    assert client.get(reverse("logout")).status_code == 302       # anonymous: sent to sign in


def test_signed_in_api_and_logout_are_post_only(logged_in):
    assert logged_in.get(reverse("api_capture")).status_code == 405
    assert logged_in.get(reverse("logout")).status_code == 405


def test_only_the_documented_routes_are_public(client, db):
    for name in PUBLIC:
        assert client.get(reverse(name)).status_code == 200, name


def test_public_pages_leak_no_machine_data(client, machine):
    for name in ("login", "offline"):
        assert b"SK-001" not in client.get(reverse(name)).content


# ── CSRF ───────────────────────────────────────────────────────────────────

def test_capture_api_rejects_a_forged_cross_site_post(user, machine):
    strict = Client(enforce_csrf_checks=True)
    strict.force_login(user)
    session = strict.session
    session["membership_checked_at"] = timezone.now().timestamp()
    session.save()
    response = strict.post(reverse("api_capture"), {"client_capture_id": str(uuid.uuid4())})
    assert response.status_code == 403


def test_login_and_logout_forms_enforce_csrf(user):
    strict = Client(enforce_csrf_checks=True)
    assert strict.post(reverse("login"), {"email": "a@b.c", "password": "x"}).status_code == 403
    strict.force_login(user)
    assert strict.post(reverse("logout")).status_code == 403


# ── sign-in abuse ──────────────────────────────────────────────────────────

@pytest.fixture
def bad_password(supabase_mock):
    supabase_mock.route(method="POST", host="test.supabase.co", path="/auth/v1/token").mock(
        return_value=httpx.Response(400, json={"error": "invalid_grant"}))


def attempt(client, email, forwarded_for=None):
    extra = {"HTTP_X_FORWARDED_FOR": forwarded_for} if forwarded_for else {}
    return client.post(reverse("login"), {"email": email, "password": "x"}, **extra)


def test_spoofed_forwarded_for_does_not_dodge_the_lockout(client, bad_password):
    # The proxy appends the real address last; a client can only invent what precedes it.
    for index in range(5):
        attempt(client, "target@example.com", f"10.0.0.{index}, 203.0.113.9")
    assert "Too many attempts" in attempt(client, "target@example.com", "10.9.9.9, 203.0.113.9").content.decode()


def test_rotating_usernames_from_one_address_is_throttled_too(client, bad_password):
    for index in range(20):
        attempt(client, f"user{index}@example.com", "203.0.113.50")
    assert "Too many attempts" in attempt(client, "fresh@example.com", "203.0.113.50").content.decode()


def test_other_addresses_are_not_locked_out_by_one_offender(client, bad_password):
    for index in range(20):
        attempt(client, f"user{index}@example.com", "203.0.113.50")
    assert "incorrect" in attempt(client, "someone@example.com", "198.51.100.7").content.decode()


@pytest.mark.parametrize("target", ["https://evil.example/", "//evil.example", "/\\evil.example",
                                    "javascript:alert(1)", "http:evil.example"])
def test_login_never_redirects_off_site(client, supabase_mock, db, target):
    supabase_mock.route(method="POST", host="test.supabase.co", path="/auth/v1/token").mock(
        return_value=httpx.Response(200, json={"user": {"id": "u", "email": "root@example.com"}}))
    response = client.post(reverse("login") + f"?next={target}", {"email": "root@example.com", "password": "x"})
    assert response.status_code == 302 and response["Location"] == reverse("departments")


# ── request limits ─────────────────────────────────────────────────────────

def test_oversize_bodies_are_refused_before_they_are_read(logged_in):
    huge = logged_in.generic("POST", reverse("api_capture"), b"x", CONTENT_LENGTH=str(50 * 1024 * 1024))
    assert huge.status_code == 413
    form = logged_in.generic("POST", reverse("logout"), b"x", CONTENT_LENGTH=str(10 * 1024 * 1024))
    assert form.status_code == 413


def test_a_post_without_a_content_length_is_refused(logged_in):
    assert logged_in.generic("POST", reverse("api_capture"), b"", CONTENT_LENGTH="").status_code == 411


def test_capture_api_is_rate_limited_per_user(logged_in, machine, fake, monkeypatch):
    monkeypatch.setattr(middleware, "API_REQUESTS_PER_MINUTE", 3)
    codes = [post(logged_in, machine, slot="bogus").status_code for _ in range(5)]
    assert codes == [400, 400, 400, 429, 429]


# ── headers and cookies ────────────────────────────────────────────────────

def test_security_headers_on_every_kind_of_response(logged_in, client, machine, fake):
    for response in (logged_in.get(reverse("departments")), client.get(reverse("login")),
                     logged_in.get(reverse("thumb", args=[machine.pk, "iso"])),
                     client.get("/definitely-not-a-page/")):
        assert "frame-ancestors 'none'" in response["Content-Security-Policy"]
        assert "object-src 'none'" in response["Content-Security-Policy"]
        assert "unsafe-inline" not in response["Content-Security-Policy"]
        assert "unsafe-eval" not in response["Content-Security-Policy"]
        assert response["X-Content-Type-Options"] == "nosniff"
        assert response["X-Frame-Options"] == "DENY"
        assert response["Referrer-Policy"] == "same-origin"
        assert "camera=(self)" in response["Permissions-Policy"] and "geolocation=()" in response["Permissions-Policy"]
        assert response["Cross-Origin-Opener-Policy"] == "same-origin"


def test_session_cookie_is_secure_httponly_and_samesite(client, supabase_mock, db):
    supabase_mock.route(method="POST", host="test.supabase.co", path="/auth/v1/token").mock(
        return_value=httpx.Response(200, json={"user": {"id": "u", "email": "root@example.com"}}))
    response = client.post(reverse("login"), {"email": "root@example.com", "password": "x"})
    cookie = response.cookies["sessionid"]
    assert cookie["secure"] and cookie["httponly"] and cookie["samesite"] == "Lax"


def test_hsts_is_sent_over_https(client, db):
    response = client.get(reverse("login"), secure=True)
    assert int(response["Strict-Transport-Security"].split("=")[1].split(";")[0]) >= 31536000


def test_error_pages_do_not_leak_internals(client, db):
    body = client.get("/no/such/page/").content.decode()
    assert "Traceback" not in body and "settings" not in body.lower() and "/srv/" not in body


# ── a session must not outlive someone's access ────────────────────────────

def stale_session(client, user, user_id="u-1"):
    client.force_login(user)
    session = client.session
    session["supabase_user_id"] = user_id
    session["membership_checked_at"] = timezone.now().timestamp() - 13 * 3600
    session.save()


def memberships(supabase_mock, **kwargs):
    supabase_mock.route(method="GET", host="test.supabase.co", path="/rest/v1/tenant_memberships").mock(**kwargs)


def test_removed_user_is_signed_out_at_the_next_check(client, user, supabase_mock):
    stale_session(client, user)
    memberships(supabase_mock, return_value=httpx.Response(200, json=[]))
    assert client.get(reverse("departments")).status_code == 302
    assert client.get(reverse("departments")).status_code == 302      # and stays signed out


def test_demoted_user_is_signed_out(client, user, supabase_mock):
    stale_session(client, user)
    memberships(supabase_mock, return_value=httpx.Response(200, json=[{"role": "member"}]))
    assert client.get(reverse("departments")).status_code == 302


def test_removed_user_gets_401_json_on_the_api_not_a_redirect(client, user, supabase_mock):
    stale_session(client, user)
    memberships(supabase_mock, return_value=httpx.Response(200, json=[]))
    assert client.post(reverse("api_capture"), {}).status_code == 401


def test_admin_stays_signed_in_and_the_check_is_not_repeated(client, user, supabase_mock, db):
    stale_session(client, user)
    route = supabase_mock.route(method="GET", host="test.supabase.co", path="/rest/v1/tenant_memberships")
    route.mock(return_value=httpx.Response(200, json=[{"role": "admin"}]))
    assert client.get(reverse("departments")).status_code == 200
    assert client.get(reverse("departments")).status_code == 200
    assert route.call_count == 1


def test_signal_loss_never_signs_anyone_out(client, user, supabase_mock, db):
    stale_session(client, user)
    memberships(supabase_mock, side_effect=httpx.ConnectError("no signal"))
    assert client.get(reverse("departments")).status_code == 200
    memberships(supabase_mock, return_value=httpx.Response(503))
    assert client.get(reverse("departments")).status_code == 200


def test_superadmin_needs_no_membership_row(client, django_user_model, supabase_mock, db):
    root = django_user_model.objects.create_user("root@example.com", "root@example.com")
    stale_session(client, root)
    memberships(supabase_mock, return_value=httpx.Response(200, json=[]))
    assert client.get(reverse("departments")).status_code == 200


# ── injection ──────────────────────────────────────────────────────────────

XSS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'-alert(1)-'"]


@pytest.mark.parametrize("payload", XSS)
def test_machine_text_is_escaped_everywhere_it_is_shown(logged_in, machine, fake, payload):
    machine.description = payload
    machine.department = f"Fryers {payload}"
    machine.recommended_fix = payload
    machine.iso_photo_note = machine.equip_photo_note = payload
    machine.save()
    post(logged_in, machine, confirmed="0")
    pages = [reverse("departments"), reverse("machine", args=[machine.pk]), reverse("search") + "?q=sk-0",
             reverse("report")]
    from django.utils.text import slugify as slug
    pages.append(reverse("department", args=[slug(machine.department)]))
    for url in pages:
        html = logged_in.get(url).content.decode()
        assert payload not in html, url


def test_client_report_escapes_machine_text(client, logged_in, machine, fake):
    machine.description = "<img src=x onerror=alert(1)>"
    machine.save()
    post(logged_in, machine)
    from django.core import signing
    token = signing.dumps({"since": "", "until": ""}, salt="client-report")
    assert "<img src=x" not in client.get(reverse("client_report", args=[token])).content.decode()


def test_arrow_labels_cannot_carry_markup_into_the_page_data(logged_in, machine, fake):
    evil = [{"type": "arrow", "x1": .1, "y1": .1, "x2": .5, "y2": .5, "label": "<script>x</script>"}]
    post(logged_in, machine, annotations=json.dumps(evil))
    machine.refresh_from_db()
    html = logged_in.get(reverse("machine", args=[machine.pk])).content.decode()
    assert "<script>x</script>" not in html            # in the data-annotations attribute, escaped


def test_equipment_ids_cannot_break_out_of_the_supabase_filter(supabase_mock, settings):
    from walkdown import supabase
    seen = {}

    def capture(request):
        seen["equipment_id"] = request.url.params["equipment_id"]
        seen["tenant_id"] = request.url.params["tenant_id"]
        return httpx.Response(200, json=[])
    supabase_mock.route(method="GET", host="test.supabase.co", path="/rest/v1/loto_equipment").mock(side_effect=capture)
    supabase.get_equipment(settings.WALKDOWN_TENANT_ID, ['A"),equipment_id.neq.("B'])
    assert seen["tenant_id"] == f"eq.{settings.WALKDOWN_TENANT_ID}"        # tenant filter untouched
    assert seen["equipment_id"] == 'in.("A""),equipment_id.neq.(""B")'     # one quoted literal


def test_patch_pins_the_tenant_even_for_hostile_ids(supabase_mock, settings):
    from walkdown import supabase
    seen = {}

    def capture(request):
        seen.update(dict(request.url.params))
        return httpx.Response(200, json=[{"equipment_id": "x"}])
    supabase_mock.route(method="PATCH", host="test.supabase.co", path="/rest/v1/loto_equipment").mock(side_effect=capture)
    supabase.patch_equipment(settings.WALKDOWN_TENANT_ID, "X&tenant_id=eq.other", {"photo_status": "missing"})
    assert seen["tenant_id"] == f"eq.{settings.WALKDOWN_TENANT_ID}"
    assert seen["equipment_id"] == "eq.X&tenant_id=eq.other"               # data, not a second filter


def test_unknown_fields_cannot_reach_supabase_columns(logged_in, machine, fake):
    post(logged_in, machine, verified="true", placard_url="https://evil.example/x.pdf",
         iso_photo_is_placeholder="true", tenant_id="other")
    allowed = {"iso_photo_url", "has_iso_photo", "iso_photo_provenance", "iso_annotations", "photo_status",
               "updated_at", "placard_url", "placard_qr_backfilled", "iso_photo_is_placeholder"}
    assert set(fake.patches[0]) <= allowed
    assert fake.patches[0]["placard_url"] is None and fake.patches[0]["iso_photo_is_placeholder"] is False


def test_uploads_must_really_be_jpegs(logged_in, machine, fake):
    from django.core.files.uploadedfile import SimpleUploadedFile
    polyglot = SimpleUploadedFile("p.jpg", b"<?php system($_GET[0]); ?>" + jpeg_bytes()[:0], content_type="image/jpeg")
    assert post(logged_in, machine, photo=polyglot).status_code == 400
    html_in_jpg = SimpleUploadedFile("p.jpg", b"<html><script>alert(1)</script></html>", content_type="image/jpeg")
    assert post(logged_in, machine, photo=html_in_jpg).status_code == 400
    assert not fake.uploads


def test_signed_report_token_cannot_open_anything_else(client, machine, db):
    from django.core import signing
    token = signing.dumps({"since": "", "until": ""}, salt="client-report")
    for url in protected_urls(machine):
        assert client.get(url, HTTP_AUTHORIZATION=f"Bearer {token}").status_code == 302
    html = client.get(reverse("client_report", args=[token])).content.decode()
    assert "/api/" not in html and "Back to the walkdown" not in html and "client-link" not in html


def test_host_header_attacks_are_rejected(client, db):
    assert client.get(reverse("login"), HTTP_HOST="evil.example").status_code == 400
    assert client.get(reverse("login"), HTTP_HOST="testserver:8000@evil.example").status_code == 400
