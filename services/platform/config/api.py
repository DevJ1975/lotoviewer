from typing import Any

from django.http import HttpRequest
from ninja import NinjaAPI, Status
from ninja.security import HttpBearer

from config.health import database_health
from tenancy.auth import InvalidSupabaseTokenError, verify_supabase_jwt


class SupabaseBearerAuth(HttpBearer):
    def authenticate(self, request: HttpRequest, token: str) -> dict[str, Any] | None:
        try:
            return verify_supabase_jwt(token)
        except InvalidSupabaseTokenError:
            return None


api = NinjaAPI(
    title="Soteria Platform API",
    version="1.0.0",
    auth=SupabaseBearerAuth(),
)


@api.get(
    "/health",
    auth=None,
    response={200: dict[str, str], 503: dict[str, str]},
    tags=["health"],
)
def health(request: HttpRequest) -> Status[dict[str, str]]:
    status_code, payload = database_health()
    return Status(status_code, payload)
