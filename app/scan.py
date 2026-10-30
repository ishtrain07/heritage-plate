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

# Text that has no place on a product label: refuse it rather than explain it.
OBSCENE = re.compile(r"\b(porn\w*|sex(ual|y)?|fuck\w*|nsfw|xxx|kill (you|him|her|them))\b", re.IGNORECASE)
_read_cache: OrderedDict[str, str] = OrderedDict()
_read_lock = threading.Lock()

# Allergy note words → what a label calls them. Hindi and Hinglish names included; plant "milks" only matter for dairy.
DAIRY_TERMS = ("milkfat", "butterfat", "milk", "whey", "casein", "caseinate", "lactose", "butter", "buttermilk", "cream", "cheese", "ghee", "curd",
               "yogurt", "yoghurt", "paneer", "khoya", "khoa", "dahi", "malai", "doodh")
NUT_TERMS = ("almond", "cashew", "walnut", "hazelnut", "pistachio", "pecan", "macadamia", "brazil nut", "nut", "badam", "kaju",
             "akhrot", "pista", "praline", "marzipan")
PEANUT_TERMS = ("peanut", "groundnut", "arachis", "moongphali", "moongfali", "mungfali", "मूंगफली")
GLUTEN_TERMS = ("wheat", "maida", "atta", "gluten", "barley", "rye", "semolina", "sooji", "suji", "spelt", "malt", "गेहूं")
FISH_TERMS = ("fish", "anchov", "tuna", "salmon", "cod", "sardine", "mackerel", "machli", "मछली")
SHELL_TERMS = ("prawn", "shrimp", "crab", "lobster", "shellfish", "mussel", "clam", "oyster", "scallop", "squid", "jhinga")
ALLERGY_GROUPS = [
    (("milk", "dairy", "lactose", "casein", "whey", "doodh", "दूध", "paneer", "dahi"), DAIRY_TERMS),
    (("peanut", "groundnut", "moongphali", "moongfali", "mungfali", "मूंगफली"), PEANUT_TERMS),
    (("nut", "tree", "almond", "cashew", "walnut", "hazelnut", "pistachio", "badam", "kaju", "akhrot", "बादाम", "काजू"), NUT_TERMS),
    (("gluten", "wheat", "coeliac", "celiac", "atta", "maida", "गेहूं"), GLUTEN_TERMS),
    (("egg", "anda", "अंडा"), ("egg", "albumin", "albumen", "mayonnaise", "anda")),
    (("soy", "soya", "soybean", "tofu"), ("soy", "soya", "soybean", "edamame", "tofu")),
    (("sesame", "til", "gingelly", "तिल"), ("sesame", "til", "tahini", "gingelly")),
    (("fish", "machli", "मछली"), FISH_TERMS),
    (("seafood",), FISH_TERMS + SHELL_TERMS),
    (("shellfish", "prawn", "shrimp", "crab", "jhinga", "lobster"), SHELL_TERMS),
    (("mustard", "sarson", "rai", "सरसों"), ("mustard", "sarson", "rai")),
    (("celery",), ("celery",)),
    (("lupin",), ("lupin",)),
    (("sulphite", "sulfite", "sulphites", "sulfites"), ("sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide", "metabisulphite",
                                                       "metabisulfite", "e220", "e221", "e222", "e223", "e224")),
    (("pea",), ("pea", "peas", "pea protein")),
    (("oat", "oats"), ("oat", "oats")),
    (("corn", "maize"), ("corn", "maize", "cornflour", "cornstarch")),
]
NOTE_STOP = {"allergic", "allergy", "allergies", "and", "the", "intolerant", "intolerance", "to", "no", "not", "severe", "mild",
             "very", "with", "from", "also", "some", "any", "all", "kinds", "type", "of", "or", "a", "an", "is", "has", "have"}
# "Free from milk", "gluten-free", "contains no nuts": blanked out before matching (never "free range").
NEGATED = re.compile(r"\b(free from|contains no|does not contain|no added)\b[^.;\n]*|\b(?!range\b)\w+[- ]free\b(?![- ]range)"
                     r"|\bmade in a \w+[- ]free \w+", re.IGNORECASE)
# Per 100 g, "high" in UK front-of-pack guidance (FSA): sugars over 22.5 g, salt over 1.5 g (sodium 600 mg).
HIGH_SUGAR_G = 22.5
HIGH_SODIUM_MG = 600
HIGH_SUGAR_ML = 11.25  # drinks, per 100 ml
HIGH_SODIUM_ML = 300


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
            model=VISION_MODEL, temperature=0, max_tokens=1200, timeout=40,
            messages=[{"role": "user", "content": [{"type": "text", "text": prompts.READ_LABEL},
                                                   {"type": "image_url", "image_url": {"url": image}}]}])
    except Exception as exc:
        raise llm.LLMError(f"read label: {exc}") from exc
    finally:
        llm.flush_traces()
    if not resp.choices:
        raise llm.LLMError("read label: empty reply")
    text = (resp.choices[0].message.content or "").strip()
    if resp.choices[0].finish_reason == "length":
        text += "\n[PARTIAL]"
    usage = getattr(resp, "usage", None)
    return text, {"step": "Read the label", "model": VISION_MODEL, "ms": int((time.perf_counter() - t0) * 1000),
                  "tokens": getattr(usage, "total_tokens", 0) if usage else 0}


def _per_100g(text: str, word: str, unit: str) -> float | None:
    head = re.search(r"\b(nutrition|nutritional|typical values|per 100)\b", text, re.IGNORECASE)
    table = text[head.start():] if head else text  # never the ingredient list ("Ingredients: sugar...")
    m = re.search(rf"\b{word}\w*\b[^\d\n]{{0,25}}(\d+(?:[.,]\d+)?)\s*{unit}\b", table, re.IGNORECASE) \
        or re.search(rf"\b{word}\w*\s*\({unit}\)[^\d\n]{{0,10}}(\d+(?:[.,]\d+)?)", table, re.IGNORECASE)
    return float(m.group(1).replace(",", ".")) if m else None


def nutrition_flags(text: str) -> dict:
    """Sugar and salt against FSA "high" levels, per 100 g (food) or 100 ml (drinks). Per-serving tables aren't compared."""
    per_ml = bool(re.search(r"\b100\s*ml\b", text, re.IGNORECASE))
    per_100 = per_ml or bool(re.search(r"\b100\s*g\b", text, re.IGNORECASE))
    if not per_100 and re.search(r"\bper (serving|portion|pack|piece|biscuit)\b|\bserving size\b", text, re.IGNORECASE):
        return {"sugar_g": None, "sodium_mg": None, "high_sugar": False, "high_salt": False, "basis": "serving"}
    sugar = _per_100g(text, "sugar", "g")
    sodium = _per_100g(text, "sodium", "mg")
    if sodium is None and (g := _per_100g(text, "sodium", "g")) is not None:
        sodium = g * 1000
    if sodium is None and (salt := _per_100g(text, "salt", "g")) is not None:
        sodium = salt * 400
    sugar_cap, sodium_cap = (HIGH_SUGAR_ML, HIGH_SODIUM_ML) if per_ml else (HIGH_SUGAR_G, HIGH_SODIUM_MG)
    return {"sugar_g": sugar, "sodium_mg": sodium, "basis": "100 ml" if per_ml else "100 g",
            "high_sugar": sugar is not None and sugar > sugar_cap,
            "high_salt": sodium is not None and sodium > sodium_cap}


HEADER = re.compile(r"\bingredients?\b[^:\n]{0,40}:?", re.IGNORECASE)
LIST_END = re.compile(r"^\s*(nutrition|nutritional|per 100|typical values|allergen|allergy advice|storage|store |best before|"
                      r"manufactured|mfd|net (wt|weight|qty)|directions|how to use)", re.IGNORECASE)
WARN_LINE = re.compile(r"\b(may contain|contains?|allergens?|allergy advice|traces? of)\b[^\n]*", re.IGNORECASE)


def label_sections(text: str) -> tuple[list[str], list[str]]:
    """(ingredient list, allergen statements). Not the product name ("Choco Cream Biscuits") or the nutrition table."""
    m = HEADER.search(text)
    lines = (text[m.end():] if m else text).split("\n")
    body: list[str] = []
    for line in lines:
        if LIST_END.match(line):
            break
        if not line.strip():
            if body:
                break
            continue  # a blank line right after the heading
        body.append(line)
    warns = [w.group(0).strip(" .:").lower() for w in WARN_LINE.finditer(text)]
    return care.label_parts("\n".join(body)), [w for w in warns if len(w) > 8]


def ingredient_parts(text: str) -> list[str]:
    parts, warns = label_sections(text)
    return parts + warns


def allergy_terms(allergies: str) -> tuple[set[str], set[str], list[str]]:
    """(label terms, the dairy subset, note words we don't know). Unknown words are still searched for as typed."""
    words = [w for w in re.findall(r"[a-z]{3,}|[\u0900-\u097F]+", (allergies or "").lower()) if w not in NOTE_STOP]
    terms: set[str] = set()
    dairy: set[str] = set()
    unknown = []
    for w in words:
        key = w[:-1] if w.endswith("s") and len(w) >= 4 else w
        groups = [t for keys, t in ALLERGY_GROUPS if w in keys or key in keys]
        if groups:
            for t in groups:
                terms |= set(t)
                if t is DAIRY_TERMS:
                    dairy |= set(t)
        else:
            terms.add(key)
            unknown.append(w)
    return terms, dairy, unknown


def _allergy_hits(parts: list[str], allergies: str) -> list[str]:
    terms, dairy, _ = allergy_terms(allergies)
    hits = []
    for p in parts:
        p0, p = p, NEGATED.sub(" ", p)
        plant = dietitian.PLANT_LOOKALIKES.sub(" ", p)  # coconut milk, cocoa butter: not dairy, but still nuts or soy
        for t in terms:
            text = plant if t in dairy else p
            if re.match(r"[\u0900-\u097F]", t):
                pat = re.escape(t)
            elif len(t) >= 4:  # compounds count: soybean, cashewnuts, milkfat, cornflour
                pat = rf"\b{re.escape(t)}" + (r"(?!odextrin)" if t == "malt" else "")
            else:
                pat = rf"\b{re.escape(t)}(s|es)?\b"
            if re.search(pat, text):
                hits.append(p0)
                break
    return hits


ANIMAL_EXTRA = {"vegan": re.compile(r"\b(honey|casein|caseinate|lactose|whey|gelatine?|carmine|cochineal|e120|shellac|beeswax|lanolin)\b"),
                "jain": re.compile(r"\b(honey|gelatine?|carmine|cochineal|e120)\b"),
                "vegetarian": re.compile(r"\b(gelatine?|carmine|cochineal|e120|animal rennet)\b"),
                "eggetarian": re.compile(r"\b(gelatine?|carmine|cochineal|e120|animal rennet)\b")}


def _diet_hits(parts: list[str], diet: str) -> list[str]:
    groups = dietitian.DIET_WORDS.get(diet, ())
    extra = ANIMAL_EXTRA.get(diet)
    hits = [p for p in parts if not p.startswith("may contain")
            and (dietitian._animal_word(NEGATED.sub(" ", p), groups) or (extra and extra.search(NEGATED.sub(" ", p))))]
    if diet == "kosher" and any(dietitian._animal_word(p, ("meat",)) for p in parts):
        hits += [p for p in parts if dietitian._animal_word(p, ("dairy",))]
    return list(dict.fromkeys(hits))


def allergy_reasons(m: dict, parts: list[str]) -> list[str]:
    note = (m.get("allergies") or "").strip()
    if not note:
        return []
    if hits := _allergy_hits(parts, note):
        return [f"Allergy: the label lists {'; '.join(hits[:3])}."]
    _, _, unknown = allergy_terms(note)
    if unknown:
        return [f"We couldn't fully check their allergy note ({note[:60]}). Please read the label yourself."]
    return []


RANK = {"fine": 0, "sometimes": 1, "check": 2, "avoid": 3}


def _worse(a: str, b: str) -> str:
    return a if RANK[a] >= RANK[b] else b


def food_person(m: dict, parts: list[str], flags: dict) -> dict:
    name = m.get("name") or "You"
    reasons = allergy_reasons(m, parts)
    verdict = "avoid" if any(x.startswith("Allergy:") for x in reasons) else "check" if reasons else "fine"
    if (diet := m.get("diet") or "non_veg") != "non_veg" and (hits := _diet_hits(parts, diet)):
        verdict = "avoid"
        reasons.append(f"Not {dietitian.DIET_LABELS.get(diet, diet).split(' (')[0]}: lists {', '.join(hits[:3])}.")
    conds = set(m.get("conditions") or [])
    unit = flags.get("basis", "100 g")
    if "diabetes" in conds and flags.get("high_sugar"):
        verdict = _worse(verdict, "sometimes")
        reasons.append(f"High in sugar ({flags['sugar_g']:g} g per {unit}).")
    if "bp" in conds and flags.get("high_salt"):
        verdict = _worse(verdict, "sometimes")
        reasons.append(f"High in salt ({flags['sodium_mg']:g} mg sodium per {unit}).")
    if "diabetes" in conds and re.search(r"\b(maida|refined (wheat )?flour|glucose|corn syrup)\b", " ".join(parts)):
        verdict = _worse(verdict, "sometimes")
        reasons.append("Refined flour or glucose raises blood sugar quickly.")
    missing = ("diabetes" in conds and flags.get("sugar_g") is None) or ("bp" in conds and flags.get("sodium_mg") is None)
    if missing and flags and flags.get("basis") != "serving":
        reasons.append("We couldn't find sugar or salt per 100 g on this label, so we couldn't compare them.")
    if conds & {"diabetes", "bp"} and flags.get("basis") == "serving":
        reasons.append("Nutrition is given per serving, so we couldn't compare sugar and salt; check the serving size.")
    return {"name": name, "verdict": verdict, "reasons": reasons or ["Nothing on the label clashes with their details."]}


def care_person(m: dict, text: str, parts: list[str]) -> dict:
    name = m.get("name") or "You"
    res = care.check_label(text, m)
    verdict = "avoid" if res["danger"] or res["warnings"] else ("sometimes" if any(i["high"] for i in res["irritants"]) else "fine")
    reasons = res["warnings"][:3] or ([f"{i['name']} is near the top of the list; it can irritate." for i in res["irritants"] if i["high"]][:2])
    if (diet := m.get("diet") or "non_veg") in ("vegan", "jain", "vegetarian", "eggetarian", "halal", "kosher") and (hits := _diet_hits(parts, diet)):
        verdict = "avoid"
        reasons = [f"Not {dietitian.DIET_LABELS.get(diet, diet).split(' (')[0]}: lists {', '.join(hits[:3])}.", *reasons]
    allergy = allergy_reasons(m, parts)  # allergies count on skin too, with the same names as for food
    if allergy:
        verdict = _worse(verdict, "avoid" if allergy[0].startswith("Allergy:") else "check")
        reasons = allergy + reasons
    if res["fits"]:
        reasons.append(f"Has {', '.join(res['fits'])}, which suits their concerns.")
    return {"name": name, "verdict": verdict, "reasons": reasons or ["Nothing on the label clashes with their details."]}


FOOD_CAUTION = re.compile(r"\b(sugar|glucose|corn syrup|invert syrup|maltodextrin|dextrose|maida|refined (wheat )?flour|palm (oil|olein)|"
                          r"hydrogenated|vanaspati|salt|sodium|msg|monosodium|e621|e635|flavour enhancer|flavor enhancer)\b")
FOOD_GOOD = re.compile(r"\b(whole ?(wheat|grain)|oats?|millet|ragi|bajra|jowar|lentils?|dal|chickpeas?|besan|nuts?|almonds?|seeds?|"
                       r"vegetables?|spinach|fruit|yogh?urt|curd|milk|olive oil|mustard oil)\b")


def ingredient_notes(kind: str, text: str, parts: list[str], people: list[dict]) -> list[dict]:
    """Each ingredient tagged good / caution / avoid with one plain line, so people can see why."""
    out: list[dict] = []
    if kind == "personal_care":
        label = care.check_label(text, {})
        seen = set()
        for d in label["danger"]:
            out.append({"name": d["name"], "tag": "avoid", "note": d["why"]})
            seen.add(d["name"])
        for i in label["irritants"]:
            out.append({"name": i["name"], "tag": "caution", "note": i["why"]})
        for a in label["actives"]:
            out.append({"name": a["name"], "tag": "good", "note": a["how"]})
        return out[:20]
    for p in parts[:24]:
        clashes = [m.get("name") or "You" for m in people if _allergy_hits([p], m.get("allergies") or "")
                   or ((m.get("diet") or "non_veg") != "non_veg" and _diet_hits([p], m["diet"]))]
        if clashes:
            out.append({"name": p, "tag": "avoid", "note": f"Clashes with {', '.join(clashes[:3])}'s allergy or diet."})
        elif FOOD_CAUTION.search(p):
            out.append({"name": p, "tag": "caution", "note": "Sugar, refined flour, salt or processed fat: fine now and then."})
        elif FOOD_GOOD.search(p):
            out.append({"name": p, "tag": "good", "note": "A whole food: fibre, protein or good fats."})
        else:
            out.append({"name": p, "tag": "plain", "note": ""})
    return out


def check_scan(text: str, members: list[dict], language: str) -> tuple[dict, list[dict]]:
    parts = ingredient_parts(text)
    lang = language or "English"
    if llm.is_live():
        data, trace = llm.chat_json("super", prompts.SCAN.format(language=lang), text, step="Explain the product", max_tokens=600,
                                    deadline_s=45)
        traces = [trace]
    else:
        lib_hit = care.check_label(text, {})
        data = {"kind": "personal_care" if lib_hit["actives"] or lib_hit["danger"] else "food", "product": "",
                "summary": "", "watch": [], "instead": ""}
        traces = []
    kind = data.get("kind") if data.get("kind") in ("food", "personal_care", "other") else "other"
    label = care.check_label(text, {})
    if label["danger"] or (kind == "other" and label["actives"]):
        kind = "personal_care"  # a dangerous ingredient always gets the skin-care checks, whatever the model said
    if kind == "other":
        raise reject("off_topic", "That doesn't look like a food or skin and hair label. Try a clear photo of the ingredients.")
    people = members or [{}]
    flags = nutrition_flags(text) if kind == "food" else {}
    parts = parts or care.label_parts(text)
    rows = [food_person(m, parts, flags) if kind == "food" else care_person(m, text, parts) for m in people]
    # Allergy and safety calls are made in code, per person: drop any the model makes ("safe for nut allergies").
    claims = re.compile(r"allerg|safe for|suitable for|\bsafe\b|\w+[- ]free\b|vegan|vegetarian|contains no|free of|"
                        r"\bno (nuts?|dairy|milk|gluten|eggs?|soy)\b|ok for|fine for|good for (everyone|all)", re.IGNORECASE)
    clean = lambda v, n: "" if not isinstance(v, str) or claims.search(v) else v.strip()[:n]
    watch = [clean(w, 140) for w in data.get("watch", []) if isinstance(w, str)][:3] if isinstance(data.get("watch"), list) else []
    result = {"kind": kind, "product": data["product"].strip()[:60] if isinstance(data.get("product"), str) else "", "summary": clean(data.get("summary"), 240),
              "watch": [w for w in watch if w], "instead": clean(data.get("instead"), 200), "people": rows,
              "danger": [{"name": d["name"], "why": d["why"]} for d in label["danger"]],
              "nutrition": flags, "ingredients": ingredient_notes(kind, text, parts, people)}
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
        if not text or re.search(r"\bno[_ ]label", text[:60], re.IGNORECASE) or not re.search(r"[a-zA-Z\u0900-\u097F]{3,}", text):
            raise reject("off_topic", "We couldn't find a label in that photo. Try a closer, sharper photo of the ingredients.")
    check_input(text, "label")
    if OBSCENE.search(text):
        raise reject("off_topic", "That doesn't look like a product label. Try a clear photo of the ingredients.")
    result, more = _guard(check_scan, text[:3000], [m.model_dump() for m in body.members], body.language)
    result["partial"] = "[PARTIAL]" in text
    return {"read": text.replace("[PARTIAL]", "").strip()[:3000], "result": result, "trace": traces + more}
