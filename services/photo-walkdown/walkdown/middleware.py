from django.http import JsonResponse
from django.shortcuts import redirect

# Reachable without a session: the login page, the files a phone needs in
# order to install the PWA and show the offline page, and the health probe.
PUBLIC_PATHS = {"/login/", "/healthz", "/sw.js", "/manifest.webmanifest", "/offline/"}
# /r/<signed token>/ is the read-only client report: the signature is its
# access control, so it needs no login.
PUBLIC_PREFIXES = ("/static/", "/r/")


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


DIRECTIVES = (
    "default-src 'self'",
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

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.setdefault("Content-Security-Policy", self.POLICY)
        return response
