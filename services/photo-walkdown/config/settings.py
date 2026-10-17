"""Settings for the Snak King photo walkdown.

Everything environment-specific comes from env vars so the same Docker image
runs locally (docker compose) and on Railway. Secrets are never defaulted:
a missing one fails at startup, not at the first upload in the field.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("WALKDOWN_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Environment variable {name} is required")
    return value


def _csv(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = os.environ.get("DJANGO_DEBUG", "") == "1"
SECRET_KEY = _required("DJANGO_SECRET_KEY")
# The container's own health check (Host: 127.0.0.1) and Railway's probe must
# pass whatever domain is configured; this app has no password-reset or other
# host-derived links, so allowing them costs nothing.
HEALTH_PROBE_HOSTS = ["127.0.0.1", "localhost", "healthcheck.railway.app"]
ALLOWED_HOSTS = _csv("ALLOWED_HOSTS") + HEALTH_PROBE_HOSTS
CSRF_TRUSTED_ORIGINS = _csv("CSRF_TRUSTED_ORIGINS")

SUPABASE_URL = _required("SUPABASE_URL").rstrip("/")
SUPABASE_ANON_KEY = _required("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = _required("SUPABASE_SERVICE_ROLE_KEY")
WALKDOWN_TENANT_ID = _required("WALKDOWN_TENANT_ID")
SUPERADMIN_EMAILS = {email.lower() for email in _csv("SUPERADMIN_EMAILS")}
# Where the placards live; the client report links to <this>/qr/<token>.
PLATFORM_URL = os.environ.get("PLATFORM_URL", "https://soteriafield.app").rstrip("/")
# Email to maintenance supervisors goes out over SMTP (Django's standard backend), so
# any provider works. Without EMAIL_HOST and a sender the request screen hands the
# user a pre-filled mailto: link instead, so the feature never depends on a secret.
EMAIL_HOST = os.environ.get("EMAIL_HOST", "").strip()
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "") == "1"  # port 465
EMAIL_USE_TLS = not EMAIL_USE_SSL and os.environ.get("EMAIL_USE_TLS", "1") == "1"  # STARTTLS, port 587
EMAIL_TIMEOUT = 20  # seconds; a request thread must not wait on a dead mail server
DEFAULT_FROM_EMAIL = os.environ.get("WALKDOWN_FROM_EMAIL", "").strip()
CONFIRM_LINK_DAYS = 14
PHOTO_BUCKET = "loto-photos"
# Same ceiling as the platform's review-portal upload route; the phone
# compresses to under 1 MB, so 2 MB only rejects something malformed.
MAX_UPLOAD_BYTES = 2_000_000
SEED_FILE = BASE_DIR / "seed" / "snak_king_photo_audit.json"

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "walkdown",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "walkdown.middleware.ContentSecurityPolicyMiddleware",
    "walkdown.middleware.LoginRequiredMiddleware",
    "walkdown.middleware.MembershipRecheckMiddleware",
    "walkdown.middleware.RequestLimitsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "walkdown.sqlite3",
        "OPTIONS": {
            "timeout": 20,
            # WAL lets readers and the one writer proceed together, and IMMEDIATE
            # takes the write lock up front so concurrent requests queue instead of
            # failing half-way. Eight threads share this file.
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
THUMBNAIL_DIR = DATA_DIR / "thumbnails"

LOGIN_URL = "/login/"
# Days can pass in the plant without signal; a short session would strand
# queued photos behind a login screen that cannot load offline. The session is
# only written when it changes: rewriting it on every request (thumbnails, sync
# polls) made every request a database write.
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
# Bounded request bodies: nothing here posts more than a ~1 MB photo.
DATA_UPLOAD_MAX_MEMORY_SIZE = 128 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
CSRF_COOKIE_SAMESITE = "Lax"

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SSL_REDIRECT", "1") == "1"
    SECURE_REDIRECT_EXEMPT = [r"^healthz$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# HSTS is on for this host. includeSubDomains and preload are deliberately left
# off: they would bind every soteriafield.app subdomain (the main platform, mail)
# to HTTPS-only indefinitely, which is the platform owner's decision, not this
# tool's.
SILENCED_SYSTEM_CHECKS = ["security.W005", "security.W021"]

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "America/Los_Angeles"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    # httpx logs every Supabase URL (machine ids, filters) at INFO: noise, and
    # not something to keep in a log stream.
    "loggers": {"httpx": {"level": "WARNING"}, "httpcore": {"level": "WARNING"}},
}
