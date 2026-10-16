import logging

from django.db import DatabaseError, connection

logger = logging.getLogger(__name__)


def database_health() -> tuple[int, dict[str, str]]:
    try:
        with connection.cursor() as cursor:
            cursor.execute("select 1")
    except DatabaseError:
        logger.exception("healthz: database unreachable")
        return 503, {"status": "degraded", "database": "unreachable"}
    return 200, {"status": "ok"}
