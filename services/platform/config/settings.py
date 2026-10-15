"""Settings for the Soteria platform service.

Configuration comes from the environment only (12-factor). A missing
required variable fails at import time with a clear message, never at
the first request.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

DEBUG = env.bool("DJANGO_DEBUG", default=False)
SECRET_KEY = env.str(
    "DJANGO_SECRET_KEY", default="insecure-dev-key" if DEBUG else environ.Env.NOTSET
)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

# The Django admin stays unmounted until Phase 1 puts SSO + 2FA in front of
# it. A password-only admin on the public internet is not an acceptable
# interim state for a service whose DB role can read every tenant.
ADMIN_ENABLED = env.bool("DJANGO_ADMIN_ENABLED", default=False)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "tenancy",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"
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
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# Connect through Supavisor in SESSION mode (port 5432). Transaction mode
# (6543) drops the startup `options` below and breaks SET LOCAL ROLE
# semantics the RLS helper relies on.
#
# search_path puts `platform` first so every Django-managed table lands in
# the schema Django owns; unmanaged models resolve to `public` through the
# second entry. Migration 294 creates the schema and the platform_svc role.
DATABASES = {"default": env.db_url("DATABASE_URL")}
DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"]["options"] = "-c search_path=platform,public"
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DATABASE_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Supabase Auth. Projects on asymmetric signing keys verify against the
# JWKS endpoint; legacy projects use the shared HS256 secret. Configure one.
SUPABASE_URL = env.str("SUPABASE_URL", default="")
SUPABASE_JWT_SECRET = env.str("SUPABASE_JWT_SECRET", default="")
SUPABASE_JWT_AUDIENCE = env.str("SUPABASE_JWT_AUDIENCE", default="authenticated")

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = not DEBUG
# Fly's internal health checks speak plain HTTP; a redirect would fail them.
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=0 if DEBUG else 31_536_000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
# HSTS preload is a decision for the whole soteriafield.app domain, owned by
# the web app's hosting, not something this one subdomain can opt into.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "stdout": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["stdout"], "level": env.str("LOG_LEVEL", default="INFO")},
}

SENTRY_DSN = env.str("SENTRY_DSN", default="")
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=env.str("SENTRY_ENVIRONMENT", default="production"),
        traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0),
        send_default_pii=False,
    )
