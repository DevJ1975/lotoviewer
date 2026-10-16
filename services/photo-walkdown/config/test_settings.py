"""Settings for the test suite: fake Supabase credentials, a throwaway data
directory, and no HTTPS redirect. Never used outside pytest."""
import os
import tempfile

os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-key")
os.environ.setdefault("WALKDOWN_TENANT_ID", "ae3f1973-4c3e-4b6e-b91f-9de5ff10529e")
os.environ.setdefault("SUPERADMIN_EMAILS", "root@example.com")
os.environ.setdefault("WALKDOWN_DATA_DIR", tempfile.mkdtemp(prefix="walkdown-test-"))

from .settings import *

SECURE_SSL_REDIRECT = False
ALLOWED_HOSTS = ["testserver"]
