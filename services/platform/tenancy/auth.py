"""Verify Supabase Auth access tokens at this service's trust boundary.

Supports both Supabase signing modes:
  * asymmetric keys (current default) — verified against the project's JWKS;
  * legacy shared secret (HS256) — verified with SUPABASE_JWT_SECRET.

The algorithm allow-list is pinned per mode so a token can never choose its
own verification path (e.g. an HS256 token "signed" with the public key).
"""

from __future__ import annotations

from functools import cache
from typing import Any

import jwt
from django.conf import settings
from jwt.types import Options

_ASYMMETRIC_ALGORITHMS = ["RS256", "ES256"]
_SHARED_SECRET_ALGORITHMS = ["HS256"]
_REQUIRED_CLAIMS = ["exp", "sub", "role"]


class InvalidSupabaseTokenError(Exception):
    """The bearer token is missing, malformed, expired or not trusted."""


@cache
def _jwks_client(supabase_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(
        f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
        lifespan=600,
    )


def verify_supabase_jwt(token: str) -> dict[str, Any]:
    if not token:
        raise InvalidSupabaseTokenError("missing token")

    options: Options = {"require": _REQUIRED_CLAIMS}
    try:
        if settings.SUPABASE_JWT_SECRET:
            claims: dict[str, Any] = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=_SHARED_SECRET_ALGORITHMS,
                audience=settings.SUPABASE_JWT_AUDIENCE,
                options=options,
            )
        elif settings.SUPABASE_URL:
            signing_key = _jwks_client(settings.SUPABASE_URL).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=_ASYMMETRIC_ALGORITHMS,
                audience=settings.SUPABASE_JWT_AUDIENCE,
                options=options,
            )
        else:
            raise InvalidSupabaseTokenError(
                "neither SUPABASE_JWT_SECRET nor SUPABASE_URL is configured"
            )
    except jwt.PyJWTError as exc:
        raise InvalidSupabaseTokenError(str(exc)) from exc

    return claims
