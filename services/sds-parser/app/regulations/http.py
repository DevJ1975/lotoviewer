"""HTTP with retries, for the two flaky things this package calls (eCFR, Voyage)."""

from __future__ import annotations

import time
from typing import Any, Callable

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_ATTEMPTS = 4
BACKOFF_BASE_SECONDS = 2.0
MAX_WAIT_SECONDS = 60.0


class HttpFailure(RuntimeError):
    """A request kept failing, or failed in a way retrying cannot fix.

    ``retryable`` says whether trying the whole job again later could help (a
    rate limit that outlasted our patience, an outage) or not (bad credentials, a
    malformed request).
    """

    def __init__(self, message: str, *, status: int | None = None, retryable: bool) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def request_with_retry(
    client: Any, method: str, url: str, *,
    sleep: Callable[[float], None] = time.sleep, **kwargs: Any,
) -> Any:
    """Send a request, retrying rate limits, server errors and network faults.

    Waits as long as the server asks (``Retry-After``, capped), else backs off
    exponentially. A response below 400 is returned; any other 4xx fails at once
    because the same request would fail the same way.
    """
    import httpx  # lazy: optional dependency, as in the rest of the service

    last = "no attempt was made"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.request(method, url, **kwargs)
        except httpx.TransportError as exc:  # timeouts, resets, DNS
            last = f"{type(exc).__name__}: {exc}"
            response = None
        else:
            if response.status_code < 400:
                return response
            if response.status_code not in RETRY_STATUSES:
                raise HttpFailure(
                    f"{method} {_origin(url)} answered {response.status_code}",
                    status=response.status_code, retryable=False,
                )
            last = f"{method} {_origin(url)} answered {response.status_code}"

        if attempt < MAX_ATTEMPTS:
            sleep(_wait_seconds(response, attempt))
    raise HttpFailure(f"{last} (after {MAX_ATTEMPTS} attempts)", retryable=True)


def _wait_seconds(response: Any, attempt: int) -> float:
    if response is not None:
        header = response.headers.get("retry-after", "")
        if header.isdigit():
            return min(float(header), MAX_WAIT_SECONDS)
    return min(BACKOFF_BASE_SECONDS * 2 ** (attempt - 1), MAX_WAIT_SECONDS)


def _origin(url: str) -> str:
    """Scheme, host and path only: a query string can carry a credential."""
    return url.split("?", 1)[0]
