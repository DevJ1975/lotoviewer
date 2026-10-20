import httpx
import pytest
from django.urls import reverse


@pytest.fixture
def auth_mock(supabase_mock, db):
    def configure(*, password_ok=True, role="admin", email="tech@snakking.example"):
        supabase_mock.route(method="POST", host="test.supabase.co", path="/auth/v1/token").mock(
            return_value=httpx.Response(200, json={"user": {"id": "u-1", "email": email}})
            if password_ok else httpx.Response(400, json={"error": "invalid_grant"}))
        supabase_mock.route(method="GET", host="test.supabase.co", path="/rest/v1/tenant_memberships").mock(
            return_value=httpx.Response(200, json=[{"role": role}] if role else []))
    return configure


def sign_in(client, email="tech@snakking.example", password="pw"):
    return client.post(reverse("login"), {"email": email, "password": password})


def test_everything_else_redirects_to_login(client, db):
    response = client.get(reverse("departments"))
    assert response.status_code == 302 and response["Location"].startswith("/login/")


def test_login_page_and_pwa_files_are_public(client, db):
    for name in ("login", "offline", "manifest", "service_worker", "healthz"):
        assert client.get(reverse(name)).status_code == 200


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_tenant_owner_or_admin_can_sign_in(client, auth_mock, role):
    auth_mock(role=role)
    assert sign_in(client).status_code == 302
    assert client.get(reverse("departments")).status_code == 200


def test_member_without_admin_rights_is_refused(client, auth_mock):
    auth_mock(role="member")
    response = sign_in(client)
    assert response.status_code == 200 and "not set up" in response.content.decode()
    assert client.get(reverse("departments")).status_code == 302


def test_user_with_no_membership_is_refused(client, auth_mock):
    auth_mock(role=None)
    assert "not set up" in sign_in(client).content.decode()


def test_superadmin_email_needs_no_membership(client, auth_mock):
    auth_mock(role=None, email="root@example.com")
    assert sign_in(client, "root@example.com").status_code == 302


def test_wrong_password_is_refused_and_locks_out_after_five(client, auth_mock):
    auth_mock(password_ok=False)
    for _ in range(5):
        assert "incorrect" in sign_in(client).content.decode()
    assert "Too many attempts" in sign_in(client).content.decode()


def test_supabase_outage_gives_a_retry_message(client, supabase_mock):
    supabase_mock.route(method="POST", host="test.supabase.co", path="/auth/v1/token").mock(
        return_value=httpx.Response(503))
    assert "Could not reach" in sign_in(client).content.decode()


def test_login_never_redirects_off_site(client, auth_mock):
    auth_mock()
    response = client.post(reverse("login") + "?next=https://evil.example/", {"email": "a@b.c", "password": "x"})
    assert response["Location"] == reverse("departments")


def test_no_password_is_stored_locally(client, auth_mock, django_user_model):
    auth_mock()
    sign_in(client)
    assert not django_user_model.objects.get(username="tech@snakking.example").has_usable_password()
