"""Request guards shared by every endpoint: per-client rate limit and model-error handling."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import llm

log = logging.getLogger("heritage_plate")


# ---------- input guardrail: checked in code before any model call ----------

class OffTopic(Exception):
    """The model says the text isn't a recipe / remedy / food wish."""


SUPPORT_LINES = ["India: Tele-MANAS 14416 (free, 24/7)", "US: call or text 988", "UK & Ireland: Samaritans 116 123",
                 "Elsewhere: findahelpline.com"]
SUPPORT = re.compile(
    r"\b(kill myself|end (my life|it all)|want to end it|suicid\w*|want(ed)? to die|wanna die|don'?t want to (live|be alive)|"
    r"self[- ]?harm|(want to|going to|i'?m|i am) (hurt|harm|cut|hurting|harming|cutting) myself(?! (with|on|while|by|accidentally))|overdose (on|of) (pills|tablets|medicine)|"
    r"(want to|going to) overdose|overdose on purpose|khud ?kushi|aatmahatya|atmahatya|marna chaht[aie]|mar jana chaht[aie]|"
    r"jeena nahi (hai|chahta|chahti)|quiero morir(me)?|no quiero vivir|matarme)\b|आत्महत्या|मरना चाहत"
    r"|\b(eat|eating|drink|drinking|swallow|take|taking|khana|peena)\b[^.]{0,20}\b(poison|rat poison|bleach|pesticide|zeher|zehar|veneno)\b"
    r"|\b(poison|bleach|pesticide|zeher|zehar|veneno)\b[^.]{0,20}\b(eat|drink|swallow|khana|khaana|peena|pina|tomar|beber)\b",
    re.IGNORECASE)
NOT_FOOD = re.compile(
    r"\b(poison|rat poison|zeher|zehar|bleach|detergent|pesticide|insecticide|kerosene|petrol|gasoline|diesel|cement|"
    r"cocaine|heroin|meth|lsd)\b",
    re.IGNORECASE)
FOOD_KINDS = {"recipe", "ask", "wish"}
EXAMPLES = {"recipe": "Try a family recipe, e.g. “Mum's dal: 1 cup toor dal, 1 onion, 2 tomatoes, 1 tsp ghee”.",
            "ask": "Try a change for this dish, e.g. “Dad hates cauliflower” or “make it less spicy”.",
            "wish": "Try something like “a high-protein vegetarian dinner with spinach”.",
            "remedy": "Try a home remedy, e.g. “besan and haldi pack for acne” or “coconut oil for dry hair”.",
            "details": "Describe the skin or hair concern, e.g. “dry patches on elbows in winter”.",
            "dislikes": "List foods to leave out, e.g. “mushrooms, peanuts”."}


def reject(code: str, message: str, lines: list[str] | None = None, field: str = "") -> HTTPException:
    detail: dict = {"code": code, "message": message}
    if field:
        detail["field"] = field
    if lines:
        detail["lines"] = lines
    return HTTPException(status_code=422, detail=detail)


def support_error() -> HTTPException:
    return reject("support", "It sounds like you might be going through something really hard. You don't have to face it "
                  "alone: please talk to someone you trust, or call a helpline now. If you're in danger, call your local "
                  "emergency number.", SUPPORT_LINES)


def check_input(text: str, kind: str, field: str = "") -> str:
    """Refuse text that is harmful, not food (for food fields) or gibberish, before it reaches the model."""
    text = (text or "").strip()
    if not text:
        return text
    if SUPPORT.search(text):
        raise support_error()
    if kind in FOOD_KINDS and NOT_FOOD.search(text):
        raise reject("not_food", "That doesn't look like food. " + EXAMPLES[kind], field=field)
    letters = [c.lower() for c in text if c.isalpha()]
    if len(letters) < 2 or (len(letters) > 4 and len(set(letters)) < 3) or (len(letters) >= 12 and len(set(letters)) < 5):
        raise reject("gibberish", "We couldn't make sense of that. " + EXAMPLES.get(kind, ""), field=field)
    return text


def off_topic_error(kind: str) -> HTTPException:
    what = {"recipe": "a recipe", "ask": "a change to this dish", "wish": "a dish idea", "remedy": "a skin or hair remedy"}
    return reject("off_topic", f"That doesn't look like {what.get(kind, 'what this box is for')}. " + EXAMPLES.get(kind, ""))


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
    except OffTopic as exc:
        raise off_topic_error(str(exc)) from exc
    except llm.LLMError as exc:
        log.warning("model call failed: %s", exc)
        raise HTTPException(status_code=502, detail="The AI model didn't respond properly. Please try again.") from exc
    except (TypeError, ValueError, KeyError, AttributeError) as exc:  # malformed model output
        log.warning("bad model output: %r", exc)
        raise HTTPException(status_code=502, detail="The AI model didn't respond properly. Please try again.") from exc
