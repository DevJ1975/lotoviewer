"""The only code that talks to Supabase.

Uses the REST and Storage HTTP APIs directly (as scripts/export_placards_xlsx.py
does) with the service-role key, so it is server-side only. The service role
bypasses RLS, which is why every call here pins tenant_id explicitly.
"""
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from django.conf import settings

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
EQUIPMENT_COLUMNS = ("equipment_id,equip_photo_url,iso_photo_url,needs_equip_photo,"
                     "needs_iso_photo,iso_photo_is_placeholder,equip_photo_provenance,"
                     "iso_photo_provenance,annotations,iso_annotations,qr_token")


class SupabaseError(RuntimeError):
    """A Supabase call failed; the message is safe to show the user."""


class InvalidCredentials(SupabaseError):
    pass


@dataclass(frozen=True)
class SignedInUser:
    user_id: str
    email: str


def _service_headers(**extra: str) -> dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}", **extra}


def _check(response: httpx.Response, action: str) -> httpx.Response:
    if response.is_success:
        return response
    # Supabase error bodies are short JSON; they never echo the key.
    raise SupabaseError(f"{action} failed ({response.status_code}): {response.text[:300]}")


def public_url(path: str) -> str:
    return f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.PHOTO_BUCKET}/{path}"


def is_own_storage_url(url: str) -> bool:
    """True only for public objects in our bucket — the thumbnail proxy
    fetches nothing else, so it cannot be pointed at arbitrary hosts."""
    return url.startswith(public_url(""))


def sign_in(email: str, password: str) -> SignedInUser:
    response = httpx.post(
        f"{settings.SUPABASE_URL}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": settings.SUPABASE_ANON_KEY},
        json={"email": email, "password": password},
        timeout=TIMEOUT,
    )
    if response.status_code in (400, 401):
        raise InvalidCredentials("Email or password is incorrect.")
    user = _check(response, "Sign-in").json()["user"]
    return SignedInUser(user_id=user["id"], email=user["email"].lower())


def membership_role(user_id: str, tenant_id: str) -> str | None:
    response = httpx.get(
        f"{settings.SUPABASE_URL}/rest/v1/tenant_memberships",
        params={"select": "role", "user_id": f"eq.{user_id}", "tenant_id": f"eq.{tenant_id}"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    rows = _check(response, "Membership lookup").json()
    return rows[0]["role"] if rows else None


def get_equipment(tenant_id: str, equipment_ids: list[str]) -> dict[str, dict]:
    """Current photo columns for the given machines, keyed by equipment_id."""
    if not equipment_ids:
        return {}
    quoted = ",".join('"' + eid.replace('"', '""') + '"' for eid in equipment_ids)
    response = httpx.get(
        f"{settings.SUPABASE_URL}/rest/v1/loto_equipment",
        params={"select": EQUIPMENT_COLUMNS, "tenant_id": f"eq.{tenant_id}",
                "equipment_id": f"in.({quoted})"},
        headers=_service_headers(),
        timeout=TIMEOUT,
    )
    return {row["equipment_id"]: row for row in _check(response, "Equipment lookup").json()}


def upload_photo(path: str, jpeg: bytes) -> str:
    """Upload a new object (never overwrite) and return its public URL."""
    response = httpx.post(
        f"{settings.SUPABASE_URL}/storage/v1/object/{settings.PHOTO_BUCKET}/{quote(path)}",
        content=jpeg,
        headers=_service_headers(**{"Content-Type": "image/jpeg", "x-upsert": "false",
                                    "Cache-Control": "max-age=3600"}),
        timeout=TIMEOUT,
    )
    _check(response, "Photo upload")
    return public_url(path)


def patch_equipment(tenant_id: str, equipment_id: str, changes: dict) -> dict:
    response = httpx.patch(
        f"{settings.SUPABASE_URL}/rest/v1/loto_equipment",
        params={"tenant_id": f"eq.{tenant_id}", "equipment_id": f"eq.{equipment_id}"},
        json=changes,
        headers=_service_headers(Prefer="return=representation"),
        timeout=TIMEOUT,
    )
    rows = _check(response, "Equipment update").json()
    if len(rows) != 1:
        raise SupabaseError(f"Equipment update matched {len(rows)} rows for {equipment_id}")
    return rows[0]


def log_hygiene(equipment_id: str, action: str, reason: str, detail: dict) -> None:
    response = httpx.post(
        f"{settings.SUPABASE_URL}/rest/v1/loto_hygiene_log",
        json={"section": "photo_walkdown_2026", "equipment_id": equipment_id,
              "action": action, "reason": reason, "detail": detail},
        headers=_service_headers(Prefer="return=minimal"),
        timeout=TIMEOUT,
    )
    _check(response, "Audit log insert")


def download(url: str) -> bytes:
    if not is_own_storage_url(url):
        raise SupabaseError("Refusing to fetch a URL outside the photo bucket")
    response = httpx.get(url, timeout=TIMEOUT, follow_redirects=False)
    return _check(response, "Photo download").content
