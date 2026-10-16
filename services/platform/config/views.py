from django.http import HttpRequest, JsonResponse

from config.health import database_health


def healthz(_request: HttpRequest) -> JsonResponse:
    """Liveness + DB reachability probe for Fly health checks."""
    status_code, payload = database_health()
    return JsonResponse(payload, status=status_code)
