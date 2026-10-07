"""The job kinds this service can run.

Each feature registers its kind here, so the HTTP endpoint (which validates and
queues) and the worker (which claims and runs) always agree on the same set.
Imports are lazy: a feature's heavy dependencies load only when jobs are on.
"""

from __future__ import annotations

from functools import lru_cache

from .service_jobs import JobRegistry


@lru_cache(maxsize=1)
def get_registry() -> JobRegistry:
    from .documents.job import DOCUMENT_EXTRACT_KIND

    registry = JobRegistry()
    registry.register(DOCUMENT_EXTRACT_KIND)
    return registry
