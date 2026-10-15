import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from tenancy.auth import InvalidSupabaseTokenError, verify_supabase_jwt

SECRET = "test-secret-at-least-32-bytes-long-xx"


def _token(**overrides):
    payload = {
        "sub": "11111111-0000-0000-0000-00000000a11c",
        "role": "authenticated",
        "aud": "authenticated",
        "exp": int(time.time()) + 60,
    }
    payload.update(overrides)
    return jwt.encode({k: v for k, v in payload.items() if v is not None}, SECRET, "HS256")


@pytest.fixture
def shared_secret_mode(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    settings.SUPABASE_URL = ""
    settings.SUPABASE_JWT_AUDIENCE = "authenticated"


@pytest.mark.usefixtures("shared_secret_mode")
def test_valid_token_returns_claims():
    assert verify_supabase_jwt(_token())["role"] == "authenticated"


@pytest.mark.usefixtures("shared_secret_mode")
@pytest.mark.parametrize(
    "token",
    [
        pytest.param("", id="empty"),
        pytest.param("not-a-jwt", id="garbage"),
        pytest.param(_token(exp=int(time.time()) - 10), id="expired"),
        pytest.param(_token(aud="anon"), id="wrong-audience"),
        pytest.param(_token(sub=None), id="missing-sub"),
        pytest.param(_token(role=None), id="missing-role"),
        pytest.param(jwt.encode({"sub": "x", "role": "authenticated"}, "", "none"), id="alg-none"),
    ],
)
def test_untrusted_tokens_are_rejected(token):
    with pytest.raises(InvalidSupabaseTokenError):
        verify_supabase_jwt(token)


@pytest.mark.usefixtures("shared_secret_mode")
def test_asymmetric_token_rejected_in_shared_secret_mode():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        {"sub": "x", "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 60},
        key,
        "RS256",
    )
    with pytest.raises(InvalidSupabaseTokenError):
        verify_supabase_jwt(token)


def test_unconfigured_service_rejects_everything(settings):
    settings.SUPABASE_JWT_SECRET = ""
    settings.SUPABASE_URL = ""
    with pytest.raises(InvalidSupabaseTokenError, match="configured"):
        verify_supabase_jwt(_token())
