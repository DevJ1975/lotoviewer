import pytest

from studio.models import AssetApproval

from .conftest import TENANT, scene_content, sign_in_as

pytestmark = pytest.mark.django_db
IMAGE = "global/loto-101/v1/s1.png"


def test_healthz_is_public(client):
    assert client.get("/healthz").content == b"ok"


def test_pages_require_a_session(client):
    response = client.get("/")
    assert response.status_code == 302 and response["Location"].startswith("/login/")


def test_superadmin_sign_in_needs_both_the_email_list_and_the_profile_flag(client, fake):
    response = client.post("/login/", {"email": "root@example.com", "password": "pw"})
    assert response.status_code == 302
    assert client.session["access"] == {"superadmin": True, "tenants": []}

    client.logout()
    fake.superadmins.clear()
    response = client.post("/login/", {"email": "root@example.com", "password": "pw"})
    assert b"limited to platform superadmins" in response.content


def test_studio_tenant_admin_may_sign_in_but_plain_members_may_not(client, fake):
    fake.users["admin@plant.example"] = ("user-a", "pw")
    fake.users["member@plant.example"] = ("user-m", "pw")
    fake.memberships += [{"user_id": "user-a", "tenant_id": TENANT, "role": "admin"},
                         {"user_id": "user-m", "tenant_id": TENANT, "role": "member"}]
    response = client.post("/login/", {"email": "member@plant.example", "password": "pw"})
    assert b"limited to platform superadmins" in response.content
    client.post("/login/", {"email": "admin@plant.example", "password": "pw"})
    assert client.session["access"] == {"superadmin": False, "tenants": [TENANT]}


def test_bad_password_is_rejected_and_rate_limited(client, fake):
    for _ in range(5):
        response = client.post("/login/", {"email": "root@example.com", "password": "wrong"})
        assert b"incorrect" in response.content
    response = client.post("/login/", {"email": "root@example.com", "password": "pw"})
    assert b"Too many attempts" in response.content


def test_login_ignores_offsite_next(client, fake):
    response = client.post("/login/", {"email": "root@example.com", "password": "pw",
                                       "next": "https://evil.example/"})
    assert response["Location"] == "/"


def test_module_list_and_board_render_signed_previews(superadmin_client, fake):
    module, _ = fake.add_module(content=scene_content(), download_path="global/loto-101/v1/module.mp4")
    listing = superadmin_client.get("/")
    assert b"LOTO 101" in listing.content and b"2 awaiting approval" in listing.content
    board = superadmin_client.get(f"/modules/{module['id']}/")
    assert board.status_code == 200
    assert b"/storage/v1/object/sign/strike-media/global/loto-101/v1/s1.png" in board.content
    assert b"module.mp4" in board.content


def test_approve_stamps_the_draft_content_and_records_the_decision(superadmin_client, fake):
    module, version = fake.add_module(content=scene_content())
    response = superadmin_client.post(f"/modules/{module['id']}/decide/", {
        "asset_path": IMAGE, "kind": "image", "decision": "approved"})
    assert response.status_code == 302
    image = version["content"]["blocks"][0]["image"]
    assert image["approved_by"] == "root@example.com" and image["approved_at"]
    record = AssetApproval.objects.get()
    assert record.decision == "approved" and record.asset_path == IMAGE


def test_reject_requires_notes_and_clears_a_prior_approval(superadmin_client, fake):
    module, version = fake.add_module(content=scene_content(approved_by="x", approved_at="T"))
    superadmin_client.post(f"/modules/{module['id']}/decide/", {
        "asset_path": IMAGE, "kind": "image", "decision": "rejected"})
    assert AssetApproval.objects.count() == 0
    superadmin_client.post(f"/modules/{module['id']}/decide/", {
        "asset_path": IMAGE, "kind": "image", "decision": "rejected", "notes": "Wrong lock placement"})
    assert version["content"]["blocks"][0]["image"]["approved_by"] is None
    assert AssetApproval.objects.get().notes == "Wrong lock placement"


def test_published_versions_cannot_be_approved_into(superadmin_client, fake):
    module, version = fake.add_module(status="published", version_status="published",
                                      content=scene_content())
    response = superadmin_client.post(f"/modules/{module['id']}/decide/", {
        "asset_path": IMAGE, "kind": "image", "decision": "approved"}, follow=True)
    assert b"published and can no longer change" in response.content
    assert version["content"]["blocks"][0]["image"]["approved_by"] is None
    assert AssetApproval.objects.count() == 0


def test_unknown_asset_is_rejected(superadmin_client, fake):
    module, _ = fake.add_module(content=scene_content())
    response = superadmin_client.post(f"/modules/{module['id']}/decide/", {
        "asset_path": "global/other.png", "kind": "image", "decision": "approved"})
    assert response.status_code == 400


def test_tenant_admins_cannot_review_global_modules(client, fake):
    sign_in_as(client, "admin@plant.example", superadmin=False, tenants=[TENANT])
    module, version = fake.add_module(content=scene_content())
    assert client.get(f"/modules/{module['id']}/").status_code == 403
    response = client.post(f"/modules/{module['id']}/decide/", {
        "asset_path": IMAGE, "kind": "image", "decision": "approved"})
    assert response.status_code == 403
    assert version["content"]["blocks"][0]["image"]["approved_by"] is None


def test_tenant_admins_can_review_their_own_tenant_module(client, fake):
    sign_in_as(client, "admin@plant.example", superadmin=False, tenants=[TENANT])
    module, _ = fake.add_module(scope="tenant", tenant_id=TENANT, content=scene_content())
    assert client.get(f"/modules/{module['id']}/").status_code == 200
    assert b"LOTO 101" in client.get("/").content


def test_jobs_page_lists_jobs(superadmin_client):
    from studio.models import MediaJob

    MediaJob.objects.create(module_slug="loto-101", kind="render", status="succeeded", log="ok")
    assert b"loto-101" in superadmin_client.get("/jobs/").content


def test_csp_allows_storage_media_only(superadmin_client):
    policy = superadmin_client.get("/jobs/")["Content-Security-Policy"]
    assert "media-src 'self' https://test.supabase.co" in policy
    assert "script-src 'self'" in policy
