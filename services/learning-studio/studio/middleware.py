import logging

from django.conf import settings
from django.contrib.auth import logout
from django.shortcuts import redirect
from django.utils import timezone

log = logging.getLogger(__name__)

PUBLIC_PATHS = {"/login/", "/healthz"}
PUBLIC_PREFIXES = ("/static/",)
ACCESS_RECHECK_SECONDS = 60 * 60


class LoginRequiredMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if request.user.is_authenticated or path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES):
            return self.get_response(request)
        return redirect(f"/login/?next={path}")


class AccessRecheckMiddleware:
    """Hourly, re-derive the user's access from Supabase so removing someone's
    admin role ends their studio session promptly. An outage keeps the session."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated and not request.path.startswith(PUBLIC_PREFIXES):
            from . import auth, supabase  # local: avoids an import cycle at startup

            checked = request.session.get("access_checked_at", 0)
            if timezone.now().timestamp() - checked > ACCESS_RECHECK_SECONDS:
                try:
                    access = auth.access_for(request.session.get("supabase_user_id", ""),
                                             request.user.email)
                except (supabase.SupabaseError, supabase.httpx.HTTPError):
                    access = None
                if access is not None and not access.allowed:
                    log.warning("Ending session: %s no longer has studio access", request.user.email)
                    logout(request)
                    return redirect("/login/")
                if access is not None:
                    request.session["access"] = access.to_session()
                    request.session["access_checked_at"] = timezone.now().timestamp()
        return self.get_response(request)


class ContentSecurityPolicyMiddleware:
    """Same-origin scripts and styles; media previews load from signed
    Supabase Storage URLs, so that one origin is allowed for img/media."""

    def __init__(self, get_response):
        self.get_response = get_response
        storage = settings.SUPABASE_URL
        self.policy = "; ".join((
            "default-src 'self'",
            "object-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
            f"img-src 'self' data: {storage}",
            f"media-src 'self' {storage}",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "base-uri 'self'",
        ))

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.setdefault("Content-Security-Policy", self.policy)
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        return response
