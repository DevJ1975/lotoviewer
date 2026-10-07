"""The service-role Supabase client, opened lazily.

Importing it eagerly would pull the web stack's optional dependencies (pydantic,
the supabase client) into every module that only needs them when a job runs.
"""

from __future__ import annotations

from typing import Any


def open_client() -> Any:
    from .staging import service_client  # lazy: needs the web stack's optional dependencies

    return service_client()
