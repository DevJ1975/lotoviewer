"""Sign-in against the platform's own Supabase users.

Global library content is superadmin-only (both the SUPERADMIN_EMAILS list and
profiles.is_superadmin, the same double check the web app uses). Owners and
admins of tenants listed in STUDIO_TENANT_IDS may produce their own tenant's
modules. A local Django user is only a session handle.
"""
from dataclasses import dataclass

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache

from . import supabase

MAX_FAILURES = 5
MAX_FAILURES_PER_ADDRESS = 20
LOCKOUT_SECONDS = 15 * 60


class NotAuthorized(Exception):
    pass


class TooManyAttempts(Exception):
    pass


@dataclass(frozen=True)
class Access:
    superadmin: bool
    admin_tenant_ids: frozenset[str]

    @property
    def allowed(self) -> bool:
        return self.superadmin or bool(self.admin_tenant_ids)

    def can_edit(self, module: dict) -> bool:
        if module.get("library_scope") == "global":
            return self.superadmin
        return self.superadmin or module.get("tenant_id") in self.admin_tenant_ids

    def to_session(self) -> dict:
        return {"superadmin": self.superadmin, "tenants": sorted(self.admin_tenant_ids)}

    @classmethod
    def from_session(cls, data: dict | None) -> "Access":
        data = data or {}
        return cls(bool(data.get("superadmin")), frozenset(data.get("tenants") or []))


def access_for(user_id: str, email: str) -> Access:
    superadmin = (email.lower() in settings.SUPERADMIN_EMAILS
                  and supabase.profile_is_superadmin(user_id))
    tenants = supabase.admin_tenant_ids(user_id, settings.STUDIO_TENANT_IDS)
    return Access(superadmin, frozenset(tenants))


def _keys(email: str, client_ip: str) -> tuple[str, str]:
    return f"login-failures:{client_ip}:{email.lower()}", f"login-failures-address:{client_ip}"


def authenticate_supabase_user(email: str, password: str, client_ip: str):
    """Return (django user, supabase user id, Access) or raise
    InvalidCredentials / NotAuthorized / TooManyAttempts."""
    key, address_key = _keys(email, client_ip)
    if cache.get(key, 0) >= MAX_FAILURES or cache.get(address_key, 0) >= MAX_FAILURES_PER_ADDRESS:
        raise TooManyAttempts()
    try:
        signed_in = supabase.sign_in(email.strip(), password)
    except supabase.InvalidCredentials:
        for k in (key, address_key):
            cache.set(k, cache.get(k, 0) + 1, LOCKOUT_SECONDS)
        raise
    cache.delete(key)

    access = access_for(signed_in.user_id, signed_in.email)
    if not access.allowed:
        raise NotAuthorized()

    user, _ = get_user_model().objects.get_or_create(
        username=signed_in.email, defaults={"email": signed_in.email})
    if user.has_usable_password():
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user, signed_in.user_id, access
