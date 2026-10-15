import logging

from django.db import DatabaseError, connection
from django.http import HttpRequest, JsonResponse

logger = logging.getLogger(__name__)


def healthz(_request: HttpRequest) -> JsonResponse:
    """Liveness + DB reachability probe for Fly health checks."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("select 1")
    except DatabaseError:
        logger.exception("healthz: database unreachable")
        return JsonResponse({"status": "degraded", "database": "unreachable"}, status=503)
    return JsonResponse({"status": "ok"})
