"""The only code that talks to Supabase.

REST and Storage HTTP APIs with the service-role key, server-side only. The
service role bypasses RLS, so every write here filters on status explicitly:
a published version is never patched, whatever the caller asked for.
"""
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from django.conf import settings

TIMEOUT = httpx.Timeout(60.0, connect=10.0)
EDITABLE_STATUSES = ("draft", "in_review")
MODULE_COLUMNS = ("id,slug,title,library_scope,tenant_id,status,estimated_minutes,updated_at,"
                  "strike_module_versions(id,version_number,status,content,download_path,"
                  "passing_score,published_at)")


class SupabaseError(RuntimeError):
    """A Supabase call failed; the message is safe to show the user."""


class InvalidCredentials(SupabaseError):
    pass


class PublishedVersionError(SupabaseError):
    """Refused: published versions are immutable (and frozen by DB trigger)."""


@dataclass(frozen=True)
class SignedInUser:
    user_id: str
    email: str


def _url(path: str) -> str:
    return f"{settings.SUPABASE_URL}{path}"


def _service_headers(**extra: str) -> dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}", **extra}


def _check(response: httpx.Response, action: str) -> httpx.Response:
    if response.is_success:
        return response
    raise SupabaseError(f"{action} failed ({response.status_code}): {response.text[:300]}")


# ── auth ────────────────────────────────────────────────────────────────────

def sign_in(email: str, password: str) -> SignedInUser:
    response = httpx.post(_url("/auth/v1/token"), params={"grant_type": "password"},
                          headers={"apikey": settings.SUPABASE_ANON_KEY},
                          json={"email": email, "password": password}, timeout=TIMEOUT)
    if response.status_code in (400, 401):
        raise InvalidCredentials("Email or password is incorrect.")
    user = _check(response, "Sign-in").json()["user"]
    return SignedInUser(user_id=user["id"], email=user["email"].lower())


def admin_tenant_ids(user_id: str, tenant_ids: set[str]) -> set[str]:
    if not tenant_ids:
        return set()
    response = httpx.get(_url("/rest/v1/tenant_memberships"), params={
        "select": "tenant_id,role", "user_id": f"eq.{user_id}",
        "tenant_id": f"in.({','.join(sorted(tenant_ids))})", "role": "in.(owner,admin)",
    }, headers=_service_headers(), timeout=TIMEOUT)
    return {row["tenant_id"] for row in _check(response, "Membership lookup").json()}


def profile_is_superadmin(user_id: str) -> bool:
    response = httpx.get(_url("/rest/v1/profiles"), params={
        "select": "is_superadmin", "id": f"eq.{user_id}"}, headers=_service_headers(),
        timeout=TIMEOUT)
    rows = _check(response, "Profile lookup").json()
    return bool(rows and rows[0].get("is_superadmin"))


# ── storage ─────────────────────────────────────────────────────────────────

def upload(path: str, data: bytes, content_type: str) -> None:
    response = httpx.post(
        _url(f"/storage/v1/object/{settings.MEDIA_BUCKET}/{quote(path)}"), content=data,
        headers=_service_headers(**{"Content-Type": content_type, "x-upsert": "true"}),
        timeout=TIMEOUT)
    _check(response, f"Upload of {path}")


def signed_url(path: str) -> str:
    response = httpx.post(
        _url(f"/storage/v1/object/sign/{settings.MEDIA_BUCKET}/{quote(path)}"),
        json={"expiresIn": settings.SIGNED_URL_SECONDS}, headers=_service_headers(),
        timeout=TIMEOUT)
    signed = _check(response, "Signed URL").json()["signedURL"]
    return _url(f"/storage/v1{signed}")


# ── modules / versions ──────────────────────────────────────────────────────

def list_modules(*, include_global: bool, tenant_ids: set[str]) -> list[dict]:
    filters = []
    if include_global:
        filters.append("library_scope.eq.global")
    if tenant_ids:
        filters.append(f"tenant_id.in.({','.join(sorted(tenant_ids))})")
    if not filters:
        return []
    response = httpx.get(_url("/rest/v1/strike_modules"), params={
        "select": MODULE_COLUMNS, "or": f"({','.join(filters)})", "order": "updated_at.desc",
    }, headers=_service_headers(), timeout=TIMEOUT)
    return _check(response, "Module list").json()


def get_module(module_id: str) -> dict | None:
    response = httpx.get(_url("/rest/v1/strike_modules"), params={
        "select": MODULE_COLUMNS, "id": f"eq.{module_id}"}, headers=_service_headers(),
        timeout=TIMEOUT)
    rows = _check(response, "Module lookup").json()
    return rows[0] if rows else None


def get_module_by_slug(slug: str, tenant_id: str | None = None) -> dict | None:
    """The global module with this slug, or the tenant's own when tenant_id is given."""
    scope = {"tenant_id": f"eq.{tenant_id}"} if tenant_id else {"library_scope": "eq.global"}
    response = httpx.get(_url("/rest/v1/strike_modules"), params={
        "select": MODULE_COLUMNS, "slug": f"eq.{slug}", **scope},
        headers=_service_headers(), timeout=TIMEOUT)
    rows = _check(response, "Module lookup").json()
    return rows[0] if rows else None


def insert_row(table: str, row: dict) -> dict:
    response = httpx.post(_url(f"/rest/v1/{table}"), json=row,
                          headers=_service_headers(Prefer="return=representation"), timeout=TIMEOUT)
    return _check(response, f"Insert into {table}").json()[0]


def insert_rows(table: str, rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    response = httpx.post(_url(f"/rest/v1/{table}"), json=rows,
                          headers=_service_headers(Prefer="return=representation"), timeout=TIMEOUT)
    return _check(response, f"Insert into {table}").json()


def update_module(module_id: str, changes: dict) -> None:
    response = httpx.patch(_url("/rest/v1/strike_modules"), params={"id": f"eq.{module_id}"},
                           json=changes, headers=_service_headers(Prefer="return=minimal"),
                           timeout=TIMEOUT)
    _check(response, "Module update")


def get_version(version_id: str) -> dict | None:
    response = httpx.get(_url("/rest/v1/strike_module_versions"), params={
        "select": "id,module_id,version_number,status,content,download_path",
        "id": f"eq.{version_id}"}, headers=_service_headers(), timeout=TIMEOUT)
    rows = _check(response, "Version lookup").json()
    return rows[0] if rows else None


def update_editable_version(version_id: str, changes: dict) -> dict:
    """Patch a draft/in-review version. Zero matched rows means the version is
    published (or gone), which callers must surface rather than ignore."""
    response = httpx.patch(_url("/rest/v1/strike_module_versions"), params={
        "id": f"eq.{version_id}", "status": f"in.({','.join(EDITABLE_STATUSES)})"},
        json=changes, headers=_service_headers(Prefer="return=representation"), timeout=TIMEOUT)
    rows = _check(response, "Version update").json()
    if len(rows) != 1:
        raise PublishedVersionError(
            "That version is published and can no longer change. Create a new version in the "
            "Soteria web studio to edit it.")
    return rows[0]


def delete_questions(version_id: str) -> None:
    response = httpx.delete(_url("/rest/v1/strike_quiz_questions"), params={
        "module_version_id": f"eq.{version_id}"}, headers=_service_headers(), timeout=TIMEOUT)
    _check(response, "Question delete")
