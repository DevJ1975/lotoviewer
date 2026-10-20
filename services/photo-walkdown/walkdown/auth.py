"""Sign-in against the platform's own Supabase users.

Nobody gets a separate password for this tool: credentials are checked by
Supabase Auth, then the user must be an owner/admin of the Snak King tenant
(or a platform superadmin). A local Django user is only a session handle.
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache

from . import supabase

ALLOWED_ROLES = {"owner", "admin"}
MAX_FAILURES = 5          # per email + address
MAX_FAILURES_PER_ADDRESS = 20  # across any emails, so rotating usernames does not help
LOCKOUT_SECONDS = 15 * 60


class NotAuthorized(Exception):
    pass


class TooManyAttempts(Exception):
    pass


def _failure_key(email: str, client_ip: str) -> str:
    return f"login-failures:{client_ip}:{email.lower()}"


def _address_key(client_ip: str) -> str:
    return f"login-failures-address:{client_ip}"


def _count_failure(email: str, client_ip: str) -> None:
    for key in (_failure_key(email, client_ip), _address_key(client_ip)):
        cache.set(key, cache.get(key, 0) + 1, LOCKOUT_SECONDS)


def authenticate_supabase_user(email: str, password: str, client_ip: str):
    """Return the Django user for these credentials, or raise.

    Raises InvalidCredentials, NotAuthorized or TooManyAttempts; a
    SupabaseError (outage) propagates so the view can say "try again".
    """
    key = _failure_key(email, client_ip)
    if (cache.get(key, 0) >= MAX_FAILURES
            or cache.get(_address_key(client_ip), 0) >= MAX_FAILURES_PER_ADDRESS):
        raise TooManyAttempts()
    try:
        signed_in = supabase.sign_in(email.strip(), password)
    except supabase.InvalidCredentials:
        _count_failure(email, client_ip)
        raise
    cache.delete(key)

    if not still_authorised(signed_in.user_id, signed_in.email):
        raise NotAuthorized()

    user, _ = get_user_model().objects.get_or_create(
        username=signed_in.email, defaults={"email": signed_in.email})
    if user.has_usable_password():
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user, signed_in.user_id


def still_authorised(user_id: str, email: str) -> bool:
    """Owner/admin of the tenant, or a platform superadmin. Used at sign-in and
    again periodically so a removed user loses access without waiting 30 days."""
    if email.lower() in settings.SUPERADMIN_EMAILS:
        return True
    return supabase.membership_role(user_id, settings.WALKDOWN_TENANT_ID) in ALLOWED_ROLES
