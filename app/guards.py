"""Request guards shared by every endpoint: per-client rate limit and model-error handling."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import llm

log = logging.getLogger("heritage_plate")


# Simple per-client limit on model-backed endpoints (protects credits on a public demo URL).
def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


RATE_LIMIT = _int_env("RATE_LIMIT", 200)  # model-backed requests per client per window
RATE_WINDOW_S, MAX_CLIENTS = 600, 10_000
# Set TRUST_PROXY=1 when deployed behind a proxy that sets X-Forwarded-For (e.g. a hosted endpoint).
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def _client_id(request: Request) -> str:
    if TRUST_PROXY:
        # The last hop is the one our own proxy appended; earlier ones are client-supplied.
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _rate_limit(request: Request, cost: int = 1) -> None:
    now = time.monotonic()
    with _hits_lock:
        if len(_hits) > MAX_CLIENTS:  # drop idle clients so memory stays bounded
            for key in [k for k, v in _hits.items() if not v or now - v[-1] > RATE_WINDOW_S]:
                del _hits[key]
        hits = _hits[_client_id(request)]
        while hits and now - hits[0] > RATE_WINDOW_S:
            hits.popleft()
        if len(hits) + cost > RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Too many requests. Please wait a few minutes.")
        hits.extend([now] * cost)


def _guard(fn, *args):
    try:
        return fn(*args)
    except llm.LLMError as exc:
        log.warning("model call failed: %s", exc)
        raise HTTPException(status_code=502, detail="The AI model didn't respond properly. Please try again.") from exc
    except (TypeError, ValueError, KeyError, AttributeError) as exc:  # malformed model output
        log.warning("bad model output: %r", exc)
        raise HTTPException(status_code=502, detail="The AI model didn't respond properly. Please try again.") from exc
