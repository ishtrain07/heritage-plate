"""Scan & check: a photo of a product label, checked for everyone at home.

A vision model only reads the label's words (no Nemotron on Token Factory takes images yet); Nemotron Super
explains the product, and code checks every person's allergies, diet and health goals against the text.
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
import threading
import time
from collections import OrderedDict
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from . import care, dietitian, engine, llm, prompts
from .guards import _guard, _rate_limit, check_input, reject

router = APIRouter(prefix="/api")

VISION_MODEL = os.getenv("VISION_MODEL", "google/gemma-3-27b-it")
MAX_IMAGE_CHARS = 2_000_000  # about 1.5 MB of JPEG as a data URL; the page downscales to ~1024 px first
IMAGE_PREFIX = re.compile(r"data:image/(jpeg|png|webp);base64,")
MOCK_LABEL = ("Masala Instant Noodles\nIngredients: Refined wheat flour (maida), palm oil, salt, wheat gluten, "
              "sugar, milk solids, spices, flavour enhancer (E635)\nNutrition per 100 g: Energy 450 kcal, "
              "Carbohydrate 62 g, Sugars 3 g, Fat 18 g, Sodium 1250 mg")

_read_cache: OrderedDict[str, str] = OrderedDict()
_read_lock = threading.Lock()

# Allergy words → what a label calls them.
ALLERGENS = {
    "peanut": ("peanut", "groundnut", "arachis"),
    "nut": ("almond", "cashew", "walnut", "hazelnut", "pistachio", "pecan", "macadamia", "nut"),
    "milk": ("milk", "whey", "casein", "lactose", "butter", "cream", "cheese", "ghee", "curd", "yogurt", "yoghurt"),
    "dairy": ("milk", "whey", "casein", "lactose", "butter", "cream", "cheese", "ghee", "curd", "yogurt", "yoghurt"),
    "lactose": ("milk", "whey", "lactose"),
    "gluten": ("wheat", "maida", "atta", "gluten", "barley", "rye", "semolina", "sooji", "suji", "spelt", "malt"),
    "wheat": ("wheat", "maida", "atta", "semolina", "sooji", "suji"),
    "egg": ("egg", "albumin", "albumen"),
    "soy": ("soy", "soya"),
    "sesame": ("sesame", "til", "tahini"),
    "fish": ("fish", "anchov", "tuna", "salmon", "cod", "sardine"),
    "shellfish": ("prawn", "shrimp", "crab", "lobster", "shellfish", "mussel", "clam"),
    "mustard": ("mustard",),
    "celery": ("celery",),
}
PLANT_SAFE = re.compile(r"\b(coconut|almond|soy|soya|oat|rice|cashew|cocoa|shea) (milk|butter|cream)\b|\bnutmeg\b|\bbutternut\b")

# Per 100 g, "high" in UK front-of-pack guidance (FSA): sugars over 22.5 g, salt over 1.5 g (sodium 600 mg).
HIGH_SUGAR_G = 22.5
HIGH_SODIUM_MG = 600


class ScanMember(BaseModel):
    name: str = Field(default="", max_length=30)
    age: int | None = Field(default=None, ge=0, le=120)
    pregnant: bool = False
    diet: Literal["non_veg", "pescatarian", "eggetarian", "vegetarian", "vegan", "halal", "kosher", "jain"] = "non_veg"
    allergies: str = Field(default="", max_length=200)
    conditions: list[Literal["diabetes", "bp", "cholesterol"]] = Field(default_factory=list, max_length=3)
    concerns: list[care.Concern] = Field(default_factory=list, max_length=6)


class ScanIn(BaseModel):
    image: str = Field(default="", max_length=MAX_IMAGE_CHARS)
    text: str = Field(default="", max_length=3000)  # what was read, corrected by the person
    members: list[ScanMember] = Field(default_factory=list, max_length=8)
    language: str = ""


def read_label(image: str) -> tuple[str, dict]:
    """The label's words from a photo (data URL). Cached by image, so a retry costs nothing."""
    m = IMAGE_PREFIX.match(image)
    if not m:
        raise reject("bad_image", "Please send a photo (JPEG, PNG or WebP).")
    try:
        raw = base64.b64decode(image[m.end():], validate=True)
    except ValueError as exc:
        raise reject("bad_image", "That photo couldn't be read. Please try another.") from exc
    key = hashlib.sha256(raw).hexdigest()
    with _read_lock:
        if key in _read_cache:
            return _read_cache[key], {"step": "Read the label", "model": VISION_MODEL, "cached": True, "ms": 0}
    if not llm.is_live():
        text, trace = MOCK_LABEL, {"step": "Read the label", "model": "mock", "ms": 0}
    else:
        text, trace = _vision_call(image)
    with _read_lock:
        _read_cache[key] = text
        while len(_read_cache) > 128:
            _read_cache.popitem(last=False)
    return text, trace


def _vision_call(image: str) -> tuple[str, dict]:
    llm._take_budget()
    t0 = time.perf_counter()
    try:
        resp = llm._client().chat.completions.create(
            model=VISION_MODEL, temperature=0, max_tokens=600, timeout=40,
            messages=[{"role": "user", "content": [{"type": "text", "text": prompts.READ_LABEL},
                                                   {"type": "image_url", "image_url": {"url": image}}]}])
    except Exception as exc:
        raise llm.LLMError(f"read label: {exc}") from exc
    finally:
        llm.flush_traces()
    text = (resp.choices[0].message.content or "").strip()
    usage = getattr(resp, "usage", None)
    return text, {"step": "Read the label", "model": VISION_MODEL, "ms": int((time.perf_counter() - t0) * 1000),
                  "tokens": getattr(usage, "total_tokens", 0) if usage else 0}


def _per_100g(text: str, word: str, unit: str) -> float | None:
    m = re.search(rf"\b{word}\w*\b[^\d\n]{{0,25}}(\d+(?:[.,]\d+)?)\s*{unit}\b", text, re.IGNORECASE)
    return float(m.group(1).replace(",", ".")) if m else None


def nutrition_flags(text: str) -> dict:
    sugar = _per_100g(text, "sugar", "g")
    sodium = _per_100g(text, "sodium", "mg")
    if sodium is None and (salt := _per_100g(text, "salt", "g")) is not None:
        sodium = salt * 400
    return {"sugar_g": sugar, "sodium_mg": sodium,
            "high_sugar": sugar is not None and sugar > HIGH_SUGAR_G,
            "high_salt": sodium is not None and sodium > HIGH_SODIUM_MG}


def ingredient_parts(text: str) -> list[str]:
    """The ingredient list only: not the product name ("Choco Cream Biscuits") or the nutrition table."""
    m = re.search(r"\bingredients?\b\s*[:\-]?", text, re.IGNORECASE)
    body = text[m.end():] if m else text
    body = re.split(r"\n\s*\n|\bnutrition(al)?\b|\bper 100\s*g\b|\ballergen", body, maxsplit=1, flags=re.IGNORECASE)[0]
    # "Contains: milk, soy" and "May contain traces of peanuts" count too, as their own entries.
    warn = [w.strip(" .:").lower() for w in re.findall(r"\b(?:may )?contains?\b[^.\n]*", text, re.IGNORECASE)]
    return care.label_parts(body) + [w for w in warn if len(w) > 9]


def _allergy_hits(parts: list[str], allergies: str) -> list[str]:
    lower = allergies.lower()
    words = set(re.findall(r"[a-z]{3,}", lower)) - {"allergic", "allergy", "allergies", "and", "the", "intolerant", "intolerance"}
    terms: set[str] = set()
    for w in words:
        key = w.rstrip("s")
        terms |= set(ALLERGENS.get(key, ())) or ({key} if len(key) >= 4 else set())
    hits = []
    for p in parts:
        plain = PLANT_SAFE.sub(" ", p) if not {"nut", "almond", "cashew", "soy", "coconut"} & words else p
        if any(re.search(rf"\b{re.escape(t)}" + ("" if t == "anchov" else r"(s|es)?\b"), plain) for t in terms):
            hits.append(p)
    return hits


def _diet_hits(parts: list[str], diet: str) -> list[str]:
    groups = dietitian.DIET_WORDS.get(diet, ())
    hits = [p for p in parts if dietitian._animal_word(p, groups)]
    if diet == "kosher" and any(dietitian._animal_word(p, ("meat",)) for p in parts):
        hits += [p for p in parts if dietitian._animal_word(p, ("dairy",))]
    return list(dict.fromkeys(hits))


def food_person(m: dict, parts: list[str], flags: dict) -> dict:
    name = m.get("name") or "You"
    reasons, verdict = [], "fine"
    if hits := _allergy_hits(parts, m.get("allergies") or ""):
        verdict = "avoid"
        reasons.append(f"Allergy: the label lists {'; '.join(hits[:3])}.")
    if (diet := m.get("diet") or "non_veg") != "non_veg" and (hits := _diet_hits(parts, diet)):
        verdict = "avoid"
        reasons.append(f"Not {dietitian.DIET_LABELS.get(diet, diet).split(' (')[0]}: lists {', '.join(hits[:3])}.")
    conds = set(m.get("conditions") or [])
    if "diabetes" in conds and flags["high_sugar"]:
        verdict = "avoid" if verdict == "avoid" else "sometimes"
        reasons.append(f"High in sugar ({flags['sugar_g']:g} g per 100 g).")
    if "bp" in conds and flags["high_salt"]:
        verdict = "avoid" if verdict == "avoid" else "sometimes"
        reasons.append(f"High in salt ({flags['sodium_mg']:g} mg sodium per 100 g).")
    if "diabetes" in conds and verdict != "avoid" and re.search(r"\b(maida|refined (wheat )?flour|glucose|corn syrup)\b", " ".join(parts)):
        verdict = "sometimes"
        reasons.append("Refined flour or glucose raises blood sugar quickly.")
    return {"name": name, "verdict": verdict, "reasons": reasons or ["Nothing on the label clashes with their details."]}


def care_person(m: dict, text: str) -> dict:
    name = m.get("name") or "You"
    res = care.check_label(text, m)
    verdict = "avoid" if res["danger"] or res["warnings"] else ("sometimes" if any(i["high"] for i in res["irritants"]) else "fine")
    reasons = res["warnings"][:3] or ([f"{i['name']} is near the top of the list; it can irritate." for i in res["irritants"] if i["high"]][:2])
    if res["fits"]:
        reasons.append(f"Has {', '.join(res['fits'])}, which suits their concerns.")
    return {"name": name, "verdict": verdict, "reasons": reasons or ["Nothing on the label clashes with their details."]}


def check_scan(text: str, members: list[dict], language: str) -> tuple[dict, list[dict]]:
    parts = ingredient_parts(text)
    lang = language or "English"
    if llm.is_live():
        data, trace = llm.chat_json("super", prompts.SCAN.format(language=lang), text, step="Explain the product", max_tokens=600)
        traces = [trace]
    else:
        lib_hit = care.check_label(text, {})
        data = {"kind": "personal_care" if lib_hit["actives"] or lib_hit["danger"] else "food", "product": "",
                "summary": "", "watch": [], "instead": ""}
        traces = []
    kind = data.get("kind") if data.get("kind") in ("food", "personal_care", "other") else "other"
    label = care.check_label(text, {})
    if kind == "other" and (label["danger"] or label["actives"]):
        kind = "personal_care"
    if kind == "other":
        raise reject("off_topic", "That doesn't look like a food or skin and hair label. Try a clear photo of the ingredients.")
    people = members or [{}]
    flags = nutrition_flags(text) if kind == "food" else {}
    rows = [food_person(m, parts, flags) if kind == "food" else care_person(m, text) for m in people]
    clean = lambda v, n: str(v).strip()[:n] if isinstance(v, str) else ""
    watch = [clean(w, 140) for w in data.get("watch", []) if isinstance(w, str)][:3] if isinstance(data.get("watch"), list) else []
    result = {"kind": kind, "product": clean(data.get("product"), 60), "summary": clean(data.get("summary"), 240),
              "watch": [w for w in watch if w], "instead": clean(data.get("instead"), 200), "people": rows,
              "danger": [{"name": d["name"], "why": d["why"]} for d in label["danger"]] if kind == "personal_care" else [],
              "nutrition": flags}
    return result, traces


@router.post("/scan")
def scan(body: ScanIn, request: Request):
    """Scan & check: read a label photo (or corrected text) and check it for everyone at home."""
    if not body.image and not body.text.strip():
        raise reject("off_topic", "Take a photo of the label, or type the ingredients.")
    if body.language and body.language not in engine.LANGUAGES:
        raise reject("bad_language", "Unknown language.")
    _rate_limit(request, cost=2 if body.image and not body.text.strip() else 1)
    traces = []
    text = body.text.strip()
    if not text:
        text, trace = _guard(read_label, body.image)
        traces.append(trace)
        if not text or text.strip().upper().startswith("NO_LABEL"):
            raise reject("off_topic", "We couldn't find a label in that photo. Try a closer, sharper photo of the ingredients.")
    check_input(text, "label")
    result, more = _guard(check_scan, text[:3000], [m.model_dump() for m in body.members], body.language)
    return {"read": text[:3000], "result": result, "trace": traces + more}
