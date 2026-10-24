"""Heritage Care: skin & hair for the whole family, ingredient-first.

Nemotron reasons about whatever the family says (any remedy, any concern, any language). The checked
library in data/care_actives.json grounds those answers: the model may only recommend ingredients that
are in it, every recommendation carries the library's sources, and safety rules (red flags, pregnancy,
prescription-only items) are applied in code after the model, never left to it.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import engine, llm, prompts
from .guards import _guard, _rate_limit

router = APIRouter(prefix="/api/care")

VERDICTS = ("keep", "care", "stop", "swap")
EVIDENCE = ("strong", "some", "little", "none")
COUNTRIES = {"IN": "India", "US": "United States", "GB": "United Kingdom", "CA": "Canada", "AU": "Australia",
             "PH": "Philippines", "MX": "Mexico", "CN": "China", "AE": "United Arab Emirates", "OTHER": "elsewhere"}
# Symptoms that need a doctor or pharmacist before any routine (checked in code, before the model).
_LOSS = r"(hair ?loss|hair ?fall|losing|falling out|fall(?:ing)? out|thinning|bald)"
_PATCH = r"(patch|patches|patchy|sudden|suddenly|clumps)"
# (key, pattern, message, concerns held back). The regex is a floor; the model can add keys for other languages.
RED_FLAGS = [
    ("hair_loss_patches",
     rf"\bbald (patch|patches|spot|spots)\b|\balopecia\b|\b(guchh\w*|gucch\w*|ganje? (dhabb|patch)\w*|mechones|calvas?|kalbo)\b|\b{_PATCH}\b[^.]{{0,40}}\b{_LOSS}|\b{_LOSS}\b[^.]{{0,40}}\b{_PATCH}\b",
     "Sudden or patchy hair loss can have medical causes (thyroid, iron, alopecia areata). See a doctor first.", {"thinning_hair"}),
    ("deep_acne", r"\b(cystic|cysts?|nodules?|boils?|painful (lumps|spots|pimples|bumps)|deep,? painful)\b",
     "Deep, painful acne needs a doctor's treatment; creams alone won't be enough.", {"acne"}),
    ("acne_scars", r"\b(scarring|scars?)\b",
     "Acne scars can be treated by a dermatologist; the routine here helps prevent new marks.", set()),
    ("changing_mole",
     r"\bnew mole\b|\b(mole|moles)\b[^.]{0,40}\b(chang\w*|grow\w*|bigger|bleed\w*|itch\w*|irregular|uneven)|\b(bleeding|changing|growing) (mole|spot)\b",
     "A mole or spot that is new, changes, grows or bleeds should be checked by a doctor soon.", set()),
    ("infection",
     r"\bspread\w* (rash|redness|red)\b|\b(rash|redness)\b[^.]{0,30}\bspread|\b(blister|blisters|pus|oozing|fever|swollen|swelling|infected|infection)\b",
     "Spreading, blistering, oozing or swollen skin can be an infection or allergy. See a doctor or pharmacist today.", set()),
    ("burn", r"\b(burn|burns|burned|burnt|burning|sunburn\w*|chemical burn)\b",
     "For a burn, cool it under running water for 20 minutes and get it checked if it blisters or is large.", set()),
]
RED_FLAG_KEYS = {k for k, *_ in RED_FLAGS}
SKIN_CONCERNS = {"acne", "oily", "dry", "sensitive", "dark_spots", "sun"}
STRONG_ACTIVES = ("adapalene", "retinol", "benzoyl_peroxide", "glycolic_acid")
CITRUS = r"(lemons?|limes?|nimbu|nimboo|nimbo|limbu|lebu|limon|limón|limão|citron|zitrone|kalamansi|calamansi|citrus|bergamot|grapefruit|柠檬)"
PHOTOTOXIC = re.compile(rf"(?<!slaked ){CITRUS}(?!\w)", re.IGNORECASE)
# Remedies we always answer "stop" to, whatever the model says (pattern, why, what to do instead, offer better options).
STOP_RULES = [
    (r"\b(kerosene|kerosine|mitti ka tel|petrol|gasoline|diesel|turpentine)\b",
     "Kerosene, petrol and turpentine are poisons: they burn skin, the fumes are harmful and they catch fire.",
     "For lice, use wet combing with conditioner or a lice lotion from a pharmacy.", False),
    (r"\b(bleach|chlorine|harpic|phenyle?|toilet cleaner)\b",
     "Bleach and cleaning chemicals burn skin and eyes; never put them on skin or hair.", "Rinse with plenty of water if it touched skin.", False),
    (r"\b(mercury|calomel|mercurous|mercuric)\b",
     "Mercury in creams is toxic and banned in many countries; it can damage the kidneys and nerves.", "Stop the cream and see a doctor if you've used it for a while.", False),
    (r"\b(clobetasol|betamethasone|betnovate|dermovate|tenovate|steroid creams?)\b",
     "Steroid creams are prescription medicines; used daily on the face they thin the skin and cause acne and marks.",
     "Use them only as a doctor directs; for dark spots, sunscreen and the options below are safer.", True),
    (r"\bhydroquinone\b",
     "Hydroquinone is a prescription medicine in many countries and is not for use in pregnancy.", "Use it only under a doctor's care.", True),
    (r"\b(battery acid|caustic soda|lye|sodium hydroxide)\b",
     "Caustic chemicals cause deep burns.", "Rinse with running water for 20 minutes and get medical help.", False),
    (r"\b(chuna|choona|slaked lime|calcium hydroxide)\b",
     "Chuna (slaked lime) is caustic and can burn skin.", "Don't put it on skin; rinse well if it touched skin.", False),
    (r"\btooth ?paste\b",
     "Toothpaste is made for teeth; its foaming and whitening ingredients irritate skin and can make a spot worse.", "Use one of the proven spot treatments below.", True),
]
# Remedies with their own checked source (only these get the "Checked" badge).
REMEDY_SOURCES = [  # (remedy, context it must be used in, source)
    (PHOTOTOXIC, None, "mja_lime"),
    (re.compile(r"\bcoconut oil\b|\b(nariyal|naariyal|coconut)\b[^.]{0,20}\b(tel|oil)\b", re.IGNORECASE),
     re.compile(r"\b(hair|baal|baalon|scalp|pelo|cabello|buhok)\b", re.IGNORECASE), "jcs_coconut"),
]
CITRUS_TIP = "Lemon or lime on skin plus sunlight can burn and leave dark marks: never use it before going out."


@lru_cache
def library() -> dict:
    path = Path(__file__).resolve().parent.parent / "data" / "care_actives.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["by_id"] = {a["id"]: a for a in data["actives"]}
    return data


def red_flag_keys(text: str, extra: object = None) -> list[str]:
    """Red flags in the text (regex floor) plus any valid keys the model spotted (other languages)."""
    lower = (text or "").lower()
    keys = [k for k, pattern, _, _ in RED_FLAGS if re.search(pattern, lower)]
    for k in extra if isinstance(extra, list) else []:
        if isinstance(k, str) and k in RED_FLAG_KEYS and k not in keys:
            keys.append(k)
    return keys


def red_flags(text: str, extra: object = None) -> list[str]:
    keys = red_flag_keys(text, extra)
    return [msg for k, _, msg, _ in RED_FLAGS if k in keys]


def flagged_concerns(text: str, extra: object = None) -> set[str]:
    """Concerns a red flag covers: no products for them until a doctor has looked."""
    keys = red_flag_keys(text, extra)
    return set().union(*(c for k, _, _, c in RED_FLAGS if k in keys))


def child_holds(member: dict) -> tuple[set[str], list[str]]:
    """Acne in young children needs a doctor to look for a cause."""
    age = member.get("age")
    if isinstance(age, int) and age < 8 and "acne" in (member.get("concerns") or []):
        return {"acne"}, ["Acne in a child under 8 is unusual and needs a doctor to check for a cause."]
    return set(), []


def _text(v: object, limit: int) -> str:
    return v[:limit] if isinstance(v, str) else ""


def _sources(ids: list[str]) -> list[dict]:
    lib = library()
    seen, out = set(), []
    for key in ids:
        if key in lib["sources"] and key not in seen:
            seen.add(key)
            out.append(lib["sources"][key])
    return out


def allowed_for(active: dict, member: dict, country: str) -> tuple[bool, str]:
    """Can this active be suggested as a buy for this person? Returns (buy_ok, note)."""
    if member.get("pregnant") and active["pregnancy"] == "avoid":
        return False, f"Not during pregnancy or breastfeeding: {active['name'].lower()}."
    if active.get("sex") and member.get("sex") and member["sex"] != active["sex"]:
        return False, ""
    if active.get("min_age"):
        if member.get("age") is None and active["min_age"] >= 18:
            return False, f"Ask a pharmacist before using {active['name'].lower()} if it's for someone under {active['min_age']}."
        if member.get("age") is not None and member["age"] < active["min_age"]:
            return False, f"Under {active['min_age']}: ask a doctor before using {active['name'].lower()}."
    if active["status"] == "prescription" and country not in active.get("otc_in", []):
        return False, f"Ask your doctor about {active['name'].lower()} ({active['strength']})."
    return True, ""


def where_to_find(active: dict, country: str) -> str:
    place = {"pharmacy": "a pharmacy (often behind the counter)", "prescription": "a pharmacy with a prescription"}.get(
        active["status"], "a pharmacy or supermarket")
    look = active.get("label_hint") or f"“{active['aliases'][0]}” on the label ({active['strength']})"
    return f"Look for {look} at {place}."


def _card(active: dict, member: dict, country: str, why: str = "") -> dict:
    return {"id": active["id"], "name": active["name"], "strength": active["strength"], "grade": active["grade"],
            "how": active["how"], "why": why[:240], "cautions": (f"Not for under-{active['min_age']}s without a doctor's advice. "
            if active.get("min_age") and member.get("age") is None else "") + active["cautions"], "products": active["products"],
            "time": active["time"], "find": where_to_find(active, country), "sources": _sources(active["sources"]),
            "pregnancy_note": "Ask a doctor or pharmacist before using in pregnancy." if member.get("pregnant") and active["pregnancy"] == "ask" else ""}


def _member(m: dict) -> dict:
    return {k: m.get(k) for k in ("name", "age", "sex", "pregnant", "concerns", "skin_type", "wants", "allergies")}


def _blocked_by_allergy(active: dict, allergies: str) -> bool:
    """Match both ways: the note names the active ("coconut oil"), or a word of the note is in its names ("coconut")."""
    lower = (allergies or "").lower()
    if not lower.strip():
        return False
    names = [active["name"].lower().split(" (")[0], *active["aliases"], *active.get("allergy_terms", [])]
    if any(re.search(rf"\b{re.escape(w)}", lower) for w in names):
        return True
    words = set(re.findall(r"[a-z]{4,}", lower)) - {"allergic", "allergy", "allergies", "sensitive", "skin", "cream", "with", "from", "react", "reacts"}
    return any(re.search(rf"\b{re.escape(w)}\b", n) for w in words for n in names)


# ---------- remedy check ----------

def _mock_remedy(text: str) -> dict:
    """Demo-mode stand-in for the AI answer, for the usual examples; live mode handles anything."""
    lower = text.lower()
    rules = [
        (("lemon", "lime", "nimbu"), "stop", "little", "Lemon juice on skin can burn and leave dark marks when the sun hits it, and there's no good evidence it fades spots.", ["sunscreen", "azelaic_acid", "vitamin_c"]),
        (("toothpaste",), "stop", "none", "Toothpaste is made for teeth; its foaming and whitening ingredients irritate skin and can make a spot worse.", ["benzoyl_peroxide", "azelaic_acid"]),
        (("besan", "haldi", "turmeric", "ubtan"), "care", "little", "A besan and haldi pack is a gentle scrub and mask; it's fine once a week, but turmeric can stain and there's little evidence it treats acne or spots.", ["niacinamide", "azelaic_acid"]),
        (("coconut oil",), "keep", "some", "A little coconut oil before washing reduces protein loss and breakage, but it won't regrow hair and can worsen dandruff on an oily scalp.", ["coconut_oil_hair", "ketoconazole"]),
        (("aloe",), "keep", "little", "Aloe vera gel is soothing for mild irritation or sunburn; evidence for acne or spots is weak.", ["glycerin", "sunscreen"]),
        (("onion juice",), "care", "little", "Onion juice on the scalp has only tiny studies behind it and can irritate; the proven option for thinning hair is minoxidil.", ["minoxidil"]),
    ]
    for words, verdict, evidence, why, better in rules:
        if any(w in lower for w in words):
            return {"remedies": [{"remedy": text[:80], "verdict": verdict, "evidence": evidence, "why": why, "better": better,
                                  "how_better": "Use the proven ingredient below instead, or alongside if the remedy is gentle."}]}
    return {"remedies": [{"remedy": text[:80], "verdict": "care", "evidence": "little", "why":
                          "Demo mode only knows a few remedies. The full app checks any remedy with the AI.", "better": [], "how_better": ""}]}


def _stop_rule(*texts: str) -> tuple[str, str, bool] | None:
    for pattern, why, instead, offer in STOP_RULES:
        if any(re.search(pattern, t or "", re.IGNORECASE) for t in texts):
            return why, instead, offer
    return None


def _remedy_sources(*texts: str) -> list[dict]:
    keys = []
    for remedy, context, key in REMEDY_SOURCES:
        if any(remedy.search(t or "") and (context is None or context.search(t or "")) for t in texts):
            keys.append(key)
    return _sources(keys)


def check_remedy(text: str, member: dict, country: str, language: str) -> tuple[dict, list[dict]]:
    lib = library()
    if llm.is_live():
        brief = {
            "remedy_as_said": text,
            "person": _member(member),
            "checked_ingredients": [{"id": a["id"], "name": a["name"], "helps": a["concerns"], "grade": a["grade"]} for a in lib["actives"]],
        }
        system = prompts.CARE_REMEDY.format(language=language or "English")
        data, trace = llm.chat_json("super", system, json.dumps(brief, ensure_ascii=False), step="Check a remedy", max_tokens=2500)
    else:
        data, trace = _mock_remedy(text), engine._mock_trace("Check a remedy", "super")
    flag_keys = red_flag_keys(text, data.get("red_flags"))
    flags = [msg for k, _, msg, _ in RED_FLAGS if k in flag_keys]
    held = flagged_concerns(text, data.get("red_flags")) | child_holds(member)[0]
    remedies = []
    raw = data.get("remedies") if isinstance(data.get("remedies"), list) else []
    for r in raw[:4]:
        if not isinstance(r, dict):
            continue
        cards, notes = [], []
        better = r.get("better") if isinstance(r.get("better"), list) else []
        for aid in better:
            active = lib["by_id"].get(str(aid))
            if not active or _blocked_by_allergy(active, member.get("allergies", "")):
                continue  # only checked ingredients, never one they're allergic to
            if set(active["concerns"]) & held:
                continue  # a doctor should look first
            ok, note = allowed_for(active, member, country)
            if ok:
                cards.append(_card(active, member, country))
            elif note:
                notes.append(note)
        verdict = r.get("verdict") if r.get("verdict") in VERDICTS else "care"
        evidence = r.get("evidence") if r.get("evidence") in EVIDENCE else "little"
        remedy_text = _text(r.get("remedy"), 120) or text[:120]
        why, how = _text(r.get("why"), 500), _text(r.get("how_better"), 300)
        # One remedy alone: judge it on the family's own words too; several: only on the model's name for it.
        own = [remedy_text, text] if len(raw) == 1 else [remedy_text]
        stop = _stop_rule(*own)
        if stop:  # dangerous: code decides, whatever the model said
            cards = cards if stop[2] else []  # e.g. no acne creams offered for kerosene on lice
            verdict, evidence, why, how = "stop", "none", stop[0] + (" " + why if verdict == "stop" else ""), stop[1]
        elif any(PHOTOTOXIC.search(t) for t in own):
            if verdict == "keep":
                verdict = "care"  # citrus on skin + sun can burn
            how = (how + " " if how else "") + CITRUS_TIP
        sources = _remedy_sources(*own)
        remedies.append({
            "remedy": remedy_text,
            "verdict": verdict,
            "evidence": evidence,
            "why": why[:600],
            "how_better": how[:400],
            "better": cards[:3],
            "notes": notes[:3],
            "safety_rule": bool(stop),
            "checked": bool(sources),
            "sources": sources[:4],
        })
    stop = _stop_rule(text)
    if stop and not any(r["safety_rule"] for r in remedies):  # the model skipped the dangerous one
        remedies.insert(0, {"remedy": text[:120], "verdict": "stop", "evidence": "none", "why": stop[0], "how_better": stop[1],
                            "better": [], "notes": [], "safety_rule": True, "checked": False, "sources": []})
    if not remedies:
        raise llm.LLMError("Check a remedy: no usable answer")
    notes = child_holds(member)[1]
    return {"remedies": remedies, "red_flags": flags + notes, "red_flag_keys": flag_keys,
            "note": _text(data.get("note_for_family"), 400)}, [trace]


# ---------- family care plan ----------

def candidates(member: dict, country: str) -> tuple[list[dict], list[str]]:
    """Checked actives that fit this person's concerns, minus what's unsafe for them; plus doctor notes."""
    lib = library()
    concerns = set(member.get("concerns") or [])
    kid_held, notes = child_holds(member)
    held = concerns & (flagged_concerns(" ".join([member.get("wants") or "", member.get("details") or ""]), member.get("_flag_keys")) | kid_held)
    concerns -= held  # see a doctor first; no products for these
    out: list[dict] = []
    for a in lib["actives"]:
        if not concerns & set(a["concerns"]) or _blocked_by_allergy(a, member.get("allergies", "")):
            continue
        ok, note = allowed_for(a, member, country)
        if ok:
            out.append(a)
        elif note and note not in notes:
            notes.append(note)
    sun = lib["by_id"]["sunscreen"]
    if concerns & SKIN_CONCERNS and sun not in out:  # every skin routine includes sunscreen
        if _blocked_by_allergy(sun, member.get("allergies", "")):
            notes.append("Choose a sunscreen without the ingredients you react to; a pharmacist can help.")
        else:
            out.append(sun)
    return out, notes


def _mock_routine(member: dict, cands: list[dict]) -> dict:
    """Deterministic routine: the best-graded active per concern, placed by time of day."""
    picked: list[dict] = []
    for concern in member.get("concerns") or []:
        best = sorted((a for a in cands if concern in a["concerns"]), key=lambda a: a["grade"])
        if best and best[0] not in picked:
            picked.append(best[0])
    sun = next((a for a in cands if a["id"] == "sunscreen"), None)
    if sun and sun not in picked:
        picked.append(sun)
    steps = {"am": [], "pm": [], "shower": []}
    for a in picked:
        slots = ["am", "pm"] if a["time"] == "both" else [a["time"]]
        for s in slots:
            steps[s].append({"active": a["id"], "product": a["products"][0], "tip": ""})
    return {"am": steps["am"], "pm": steps["pm"], "shower": steps["shower"],
            "summary": "Start one new product at a time, two weeks apart, so you can tell what helps."}


def _clean_steps(raw: object, allowed: dict[str, dict]) -> list[dict]:
    out = []
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict) or str(s.get("active")) not in allowed:
            continue  # the model may only use checked, allowed ingredients
        out.append({"active": str(s["active"]), "product": _text(s.get("product"), 60) or allowed[str(s["active"])]["products"][0],
                    "tip": _text(s.get("tip"), 160)})
    return out[:5]


def _enforce(routine: dict[str, list[dict]], allowed: dict[str, dict], member: dict) -> dict[str, list[dict]]:
    """Rules we don't leave to the model: right time of day, no repeats, one strong active, sunscreen every morning."""
    out: dict[str, list[dict]] = {"am": [], "pm": [], "shower": []}
    strong = None
    for slot in ("am", "pm", "shower"):
        for step in routine.get(slot, []):
            active = allowed[step["active"]]
            slots = ["am", "pm"] if active["time"] == "both" else [active["time"]]
            target = slot if slot in slots else slots[0]
            if step["active"] in STRONG_ACTIVES:
                if strong and strong != step["active"]:
                    continue
                strong = step["active"]
            if all(s["active"] != step["active"] for s in out[target]):
                out[target].append(step)
    if set(member.get("concerns") or []) & SKIN_CONCERNS and "sunscreen" in allowed and all(s["active"] != "sunscreen" for s in out["am"]):
        out["am"].append({"active": "sunscreen", "product": "sunscreen", "tip": "Last step every morning."})
    return {k: v[:4] for k, v in out.items()}


def care_plan(members: list[dict], country: str, language: str) -> tuple[dict, list[dict]]:
    prepared = []
    for m in members:
        cands, notes = candidates(m, country)
        prepared.append((m, cands, notes))
    plans: list[dict] = []
    if llm.is_live():
        brief = {"country": COUNTRIES.get(country, country), "family": [
            {"index": i, "person": _member(m), "details": (m.get("details") or "")[:300],
             "allowed_ingredients": [{"id": a["id"], "name": a["name"], "helps": a["concerns"], "strength": a["strength"],
                                      "time": a["time"], "products": a["products"]} for a in cands]}
            for i, (m, cands, _) in enumerate(prepared)]}
        system = prompts.CARE_PLAN.format(language=language or "English")
        data, trace = llm.chat_json("super", system, json.dumps(brief, ensure_ascii=False), step="Plan family care", max_tokens=4000)
        people = data.get("people") if isinstance(data.get("people"), list) else []
        raw = {p["index"]: p for p in people if isinstance(p, dict) and isinstance(p.get("index"), int)}
        note = _text(data.get("note_for_family"), 600)
    else:
        trace, raw, note = engine._mock_trace("Plan family care", "super"), {}, ""
    for i, (m, cands, notes) in enumerate(prepared):
        r = raw.get(i) or {}
        said = " ".join([m.get("wants") or "", m.get("details") or ""])
        flags = red_flags(said + " " + " ".join(m.get("concerns") or []), r.get("red_flags"))
        held = flagged_concerns(said, r.get("red_flags"))  # the model may spot flags in other languages
        allowed = {a["id"]: a for a in cands if not set(a["concerns"]) <= held or a["id"] == "sunscreen"}
        routine = {k: _clean_steps(r.get(k), allowed) for k in ("am", "pm", "shower")}
        if not any(routine.values()):
            routine = _mock_routine(m, list(allowed.values()))  # model gave nothing usable: fall back to the checked defaults
            summary = routine.pop("summary")
        else:
            summary = _text(r.get("summary"), 400)
        routine = _enforce(routine, allowed, m)
        if not any(routine.values()):
            summary = ""
        used = {s["active"] for steps in routine.values() for s in steps}
        whys = r.get("why") if isinstance(r.get("why"), dict) else {}
        plans.append({
            "name": (m.get("name") or f"Person {i + 1}")[:30],
            "concerns": m.get("concerns") or [],
            "red_flags": flags,
            "doctor_notes": notes,
            "routine": routine,
            "summary": summary,
            "ingredients": [_card(allowed[a], m, country, _text(whys.get(a), 240)) for a in allowed if a in used],
        })
    shopping: dict[str, dict] = {}
    for p in plans:
        for c in p["ingredients"]:
            item = shopping.setdefault(c["id"], {"name": c["name"], "strength": c["strength"], "products": c["products"][0],
                                                 "find": c["find"], "for": []})
            item["for"].append(p["name"])
    if language and not note:
        note = "Here's a simple plan for everyone's skin and hair. Start one new product at a time, and see a doctor about anything marked."
    return {"people": plans, "shopping": list(shopping.values()), "note_for_family": note if language else "",
            "language": language, "country": country}, [trace]


# ---------- label check (code only, no model) ----------

LABEL_SYNONYMS = {"fragrance": ["parfum", "aroma"], "perfume": ["parfum", "fragrance"], "peanut": ["arachis"], "coconut": ["cocos nucifera"],
                  "lanolin": ["lanolin"], "almond": ["prunus amygdalus", "prunus dulcis"], "shea": ["butyrospermum"], "nuts": ["butyrospermum", "prunus", "arachis"]}


def label_parts(text: str) -> list[str]:
    """Split an INCI list: drop the "Ingredients:" header, stop at "may contain", split on commas outside brackets."""
    text = re.sub(r"^\s*(ingredients|ingrédients|ingredientes|inci)\s*:", "", (text or "").strip(), flags=re.IGNORECASE)
    text = re.split(r"\b(may contain|peut contenir|\+/-|\[\+/-\])", text, maxsplit=1, flags=re.IGNORECASE)[0]
    parts, depth, cur = [], 0, ""
    for ch in text:
        depth += ch in "(["
        depth -= ch in ")]" and depth > 0
        if depth == 0 and ch in ",;\n·|•":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip(" .").lower() for p in parts if p.strip(" .")]


def _hits(part: str, aliases: list[str]) -> bool:
    plain = re.sub(r"\s+", " ", re.sub(r"\([^)]*\)", " ", part)).strip()  # "cocos nucifera (coconut) oil" → "cocos nucifera oil"
    inner = re.sub(r"[()]", " ", part)  # ... and "cocos nucifera coconut oil"
    for alias in aliases:
        if alias == "alcohol":  # only the plain INCI "Alcohol", never fatty alcohols
            if plain == "alcohol":
                return True
        elif alias == plain or any(re.search(rf"\b{re.escape(alias)}\b", t) for t in (part, plain, inner)):
            return True
    return False


def check_label(text: str, member: dict) -> dict:
    lib = library()
    parts = label_parts(text)
    found, irritants, danger = [], [], []
    for pos, part in enumerate(parts):
        for a in lib["actives"]:
            if a["id"] not in {f["id"] for f in found} and _hits(part, a["aliases"]):
                found.append({"id": a["id"], "name": a["name"], "position": pos + 1, "helps": a["concerns"],
                              "how": a.get("label_note") or a["how"], "pregnancy": a["pregnancy"]})
        for irr in lib["irritants"]:
            if irr["name"] not in {i["name"] for i in irritants} and _hits(part, irr["aliases"]):
                irritants.append({"name": irr["name"], "position": pos + 1, "why": irr["why"], "high": pos < 5})
        for d in lib.get("danger", []):
            if d["name"] not in {x["name"] for x in danger} and _hits(part, d["aliases"]):
                danger.append({"name": d["name"], "position": pos + 1, "why": d["why"]})
    concerns = set(member.get("concerns") or [])
    fits = [f for f in found if concerns & set(f["helps"])]
    warnings = [f"{d['name']}: {d['why']}" for d in danger]
    if member.get("pregnant"):
        warnings += [f"Contains {f['name'].lower()}: avoid in pregnancy or breastfeeding." for f in found if f["pregnancy"] == "avoid"]
    if "sensitive" in concerns:
        warnings += [f"{i['name']} is in this product; it often bothers sensitive skin." for i in irritants]
    allergies = (member.get("allergies") or "").lower()
    if allergies:
        terms = [t.strip() for t in re.split(r"[,;/]|\band\b|\bor\b", re.sub(r"\b(allergic|allergy|allergies|sensitive|to|i'm|i am|react)\b", " ", allergies))]
        terms = [t for t in terms if len(t) >= 3]
        terms += [syn for t in terms for k, v in LABEL_SYNONYMS.items() if k in t for syn in v]
        warnings += [f"Check: the label lists {p}, which matches your allergy note." for p in parts
                     if any(re.search(rf"\b{re.escape(t)}", p) for t in terms)]
    return {"count": len(parts), "actives": found, "irritants": irritants, "danger": danger, "fits": [f["name"] for f in fits],
            "warnings": warnings[:8]}


# ---------- routes ----------

Concern = Literal["acne", "oily", "dry", "sensitive", "dark_spots", "sun", "dandruff", "thinning_hair", "dry_hair", "body_dry"]
Country = Literal["IN", "US", "GB", "CA", "AU", "PH", "MX", "CN", "AE", "OTHER"]


class Member(BaseModel):
    name: str = Field(default="", max_length=30)
    age: int | None = Field(default=None, ge=0, le=120)
    sex: Literal["female", "male"] | None = None
    pregnant: bool = False
    concerns: list[Concern] = Field(default_factory=list, max_length=6)
    skin_type: Literal["oily", "dry", "combination", "normal", "sensitive"] | None = None
    wants: str = Field(default="", max_length=120)  # "men's body wash", "a shampoo"
    details: str = Field(default="", max_length=300)
    allergies: str = Field(default="", max_length=200)


class RemedyIn(BaseModel):
    text: str = Field(min_length=3, max_length=400)
    member: Member = Field(default_factory=Member)
    country: Country = "OTHER"
    language: str = ""


class PlanIn(BaseModel):
    members: list[Member] = Field(min_length=1, max_length=6)
    country: Country = "OTHER"
    language: str = ""


class LabelIn(BaseModel):
    text: str = Field(min_length=3, max_length=3000)
    member: Member = Field(default_factory=Member)


def _check_language(value: str) -> str:
    if value and value not in engine.LANGUAGES:
        raise HTTPException(status_code=422, detail="Unknown language.")
    return value


@router.get("/library")
async def care_library():
    lib = library()
    return {"concerns": lib["concerns"], "countries": COUNTRIES,
            "actives": [{k: a[k] for k in ("id", "name", "concerns", "strength", "grade")} for a in lib["actives"]]}


@router.post("/remedy")
def remedy(body: RemedyIn, request: Request):
    """Check a home remedy, said or typed the family's way."""
    _rate_limit(request)
    result, trace = _guard(check_remedy, body.text.strip(), body.member.model_dump(), body.country, _check_language(body.language))
    return {"result": result, "trace": trace}


@router.post("/plan")
def plan(body: PlanIn, request: Request):
    """A skin & hair routine for each family member, from checked ingredients only."""
    _rate_limit(request, cost=2)
    result, trace = _guard(care_plan, [m.model_dump() for m in body.members], body.country, _check_language(body.language))
    return {"result": result, "trace": trace}


@router.post("/label")
async def label(body: LabelIn):
    """Read a product's ingredient list (no AI involved)."""
    return {"result": check_label(body.text, body.member.model_dump())}
