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
MAX_FAILURES = 5
LOCKOUT_SECONDS = 15 * 60


class NotAuthorized(Exception):
    pass


class TooManyAttempts(Exception):
    pass


def _failure_key(email: str, client_ip: str) -> str:
    return f"login-failures:{client_ip}:{email.lower()}"


def authenticate_supabase_user(email: str, password: str, client_ip: str):
    """Return the Django user for these credentials, or raise.

    Raises InvalidCredentials, NotAuthorized or TooManyAttempts; a
    SupabaseError (outage) propagates so the view can say "try again".
    """
    key = _failure_key(email, client_ip)
    if cache.get(key, 0) >= MAX_FAILURES:
        raise TooManyAttempts()
    try:
        signed_in = supabase.sign_in(email.strip(), password)
    except supabase.InvalidCredentials:
        cache.set(key, cache.get(key, 0) + 1, LOCKOUT_SECONDS)
        raise
    cache.delete(key)

    is_superadmin = signed_in.email in settings.SUPERADMIN_EMAILS
    role = supabase.membership_role(signed_in.user_id, settings.WALKDOWN_TENANT_ID)
    if not is_superadmin and role not in ALLOWED_ROLES:
        raise NotAuthorized()

    user, _ = get_user_model().objects.get_or_create(
        username=signed_in.email, defaults={"email": signed_in.email})
    if user.has_usable_password():
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user
