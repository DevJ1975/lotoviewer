import logging

from django.conf import settings
from django.contrib.auth import logout
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone

log = logging.getLogger(__name__)

# Reachable without a session: the login page, the files a phone needs in
# order to install the PWA and show the offline page, and the health probe.
PUBLIC_PATHS = {"/login/", "/healthz", "/sw.js", "/manifest.webmanifest", "/offline/"}
# /r/<signed token>/ is the read-only client report and /c/<signed token>/ is the
# supervisor's confirmation page: the signature is their access control, so they
# need no login.
PUBLIC_PREFIXES = ("/static/", "/r/", "/c/")


class LoginRequiredMiddleware:
    """Everything needs a session. API calls get a 401 (so the phone keeps
    its queue and asks the user to sign in again) instead of a redirect to
    an HTML page that fetch() would follow and mistake for success."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if (request.user.is_authenticated or path in PUBLIC_PATHS
                or path.startswith(PUBLIC_PREFIXES)):
            return self.get_response(request)
        if path.startswith("/api/"):
            return JsonResponse({"error": "Sign in again to continue."}, status=401)
        return redirect(f"/login/?next={path}")


# A photo is compressed to ~1 MB on the phone; forms are tiny. Anything bigger
# is refused from its Content-Length, before any of it is read or written to disk.
BODY_LIMIT_API = settings.MAX_UPLOAD_BYTES + 256 * 1024
BODY_LIMIT_FORM = 64 * 1024
API_REQUESTS_PER_MINUTE = 240
MEMBERSHIP_RECHECK_SECONDS = 12 * 60 * 60


class RequestLimitsMiddleware:
    """Cheap refusals first: oversize or length-less bodies, and API floods."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in {"POST", "PUT", "PATCH"}:
            try:
                length = int(request.META.get("CONTENT_LENGTH") or -1)
            except ValueError:
                length = -1
            if length < 0:
                return HttpResponse("Length required", status=411)
            limit = BODY_LIMIT_API if request.path.startswith("/api/") else BODY_LIMIT_FORM
            if length > limit:
                return JsonResponse({"error": "That upload is too large."}, status=413)
        if request.path.startswith("/api/") and request.user.is_authenticated:
            key = f"api-rate:{request.user.pk}:{timezone.now():%Y%m%d%H%M}"
            cache.add(key, 0, 90)
            if cache.incr(key) > API_REQUESTS_PER_MINUTE:
                return JsonResponse({"error": "Too many requests; slow down."}, status=429)
        return self.get_response(request)


class MembershipRecheckMiddleware:
    """A 30-day session must not outlive someone's access.

    Every 12 hours (when online) the signed-in user's tenant role is looked up
    again; if it is gone the session ends. When Supabase cannot be reached the
    session is kept, so a day without signal never strands queued photos.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated and not request.path.startswith(PUBLIC_PREFIXES):
            from . import auth, supabase  # local: avoids an import cycle at startup

            checked = request.session.get("membership_checked_at", 0)
            if timezone.now().timestamp() - checked > MEMBERSHIP_RECHECK_SECONDS:
                try:
                    allowed = auth.still_authorised(request.session.get("supabase_user_id", ""),
                                                    request.user.email)
                except (supabase.SupabaseError, supabase.httpx.HTTPError):
                    allowed = None  # unknown: keep the session, try again next request
                if allowed is False:
                    log.warning("Ending session: %s no longer has access", request.user.email)
                    logout(request)
                    if request.path.startswith("/api/"):
                        return JsonResponse({"error": "Sign in again to continue."}, status=401)
                    return redirect("/login/")
                if allowed:
                    request.session["membership_checked_at"] = timezone.now().timestamp()
        return self.get_response(request)


DIRECTIVES = (
    "default-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
)


class ContentSecurityPolicyMiddleware:
    """Strict CSP: all scripts, styles and images are same-origin (photos
    reach the page through the thumbnail proxy, never straight from Supabase)."""

    POLICY = "; ".join(DIRECTIVES)

    def __init__(self, get_response):
        self.get_response = get_response

    # camera is the whole point of the app; everything else is switched off.
    EXTRA_HEADERS = {
        "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
    }

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.setdefault("Content-Security-Policy", self.POLICY)
        for name, value in self.EXTRA_HEADERS.items():
            response.headers.setdefault(name, value)
        return response
