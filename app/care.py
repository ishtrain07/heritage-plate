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
RED_FLAGS = [
    (r"\b(sudden|suddenly|patch|patches|patchy|bald spot|clumps)\b.*\bhair\b|\bhair\b.*\b(sudden|suddenly|patch|patches|patchy|clumps)\b",
     "Sudden or patchy hair loss can have medical causes (thyroid, iron, alopecia areata). See a doctor first."),
    (r"\b(cystic|cysts|nodule|nodules|painful lumps|scarring)\b",
     "Deep, painful or scarring acne needs a doctor's treatment; creams alone won't be enough."),
    (r"\b(mole|moles)\b.*\b(chang|grow|bleed|itch|dark)|\b(bleeding|changing|growing) (mole|spot)\b",
     "A mole or spot that changes, grows or bleeds should be checked by a doctor soon."),
    (r"\b(spreading|blister|blisters|pus|oozing|fever|swollen|swelling|infected|infection)\b",
     "Spreading, blistering, oozing or swollen skin can be an infection or allergy. See a doctor or pharmacist today."),
    (r"\b(burn|burns|burned|burnt|chemical burn)\b",
     "For a burn, cool it under running water for 20 minutes and get it checked if it blisters or is large."),
]
SKIN_CONCERNS = {"acne", "oily", "dry", "sensitive", "dark_spots", "sun"}
PHOTOTOXIC = re.compile(r"\b(lemon|lime|nimbu|limon|limón|kalamansi|calamansi|citrus)\b", re.IGNORECASE)


@lru_cache
def library() -> dict:
    path = Path(__file__).resolve().parent.parent / "data" / "care_actives.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["by_id"] = {a["id"]: a for a in data["actives"]}
    return data


def red_flags(text: str) -> list[str]:
    lower = (text or "").lower()
    return [msg for pattern, msg in RED_FLAGS if re.search(pattern, lower)]


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
    if active["status"] == "prescription" and country not in active.get("otc_in", []):
        return False, f"Ask your doctor about {active['name'].lower()} ({active['strength']})."
    return True, ""


def where_to_find(active: dict, country: str) -> str:
    place = {"pharmacy": "a pharmacy (often behind the counter)", "prescription": "a pharmacy with a prescription"}.get(
        active["status"], "a pharmacy or supermarket")
    return f"Look for “{active['aliases'][0]}” on the label ({active['strength']}) at {place}."


def _card(active: dict, member: dict, country: str, why: str = "") -> dict:
    return {"id": active["id"], "name": active["name"], "strength": active["strength"], "grade": active["grade"],
            "how": active["how"], "why": why[:240], "cautions": active["cautions"], "products": active["products"],
            "time": active["time"], "find": where_to_find(active, country), "sources": _sources(active["sources"]),
            "pregnancy_note": "Ask a doctor or pharmacist before using in pregnancy." if member.get("pregnant") and active["pregnancy"] == "ask" else ""}


def _member(m: dict) -> dict:
    return {k: m.get(k) for k in ("name", "age", "sex", "pregnant", "concerns", "skin_type", "wants", "allergies")}


def _blocked_by_allergy(active: dict, allergies: str) -> bool:
    lower = (allergies or "").lower()
    return any(re.search(rf"\b{re.escape(w)}", lower) for w in [active["name"].lower().split(" (")[0], *active["aliases"]])


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


def check_remedy(text: str, member: dict, country: str, language: str) -> tuple[dict, list[dict]]:
    flags = red_flags(text)
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
    remedies = []
    raw = data.get("remedies") if isinstance(data.get("remedies"), list) else []
    for r in raw[:4]:
        if not isinstance(r, dict):
            continue
        cards, notes = [], []
        for aid in r.get("better") or []:
            active = lib["by_id"].get(str(aid))
            if not active or _blocked_by_allergy(active, member.get("allergies", "")):
                continue  # only checked ingredients, never one they're allergic to
            ok, note = allowed_for(active, member, country)
            if ok:
                cards.append(_card(active, member, country))
            elif note:
                notes.append(note)
        verdict = r.get("verdict") if r.get("verdict") in VERDICTS else "care"
        remedy_text = str(r.get("remedy") or text)[:120]
        sources = [s for c in cards for s in c["sources"]]
        if PHOTOTOXIC.search(remedy_text) or PHOTOTOXIC.search(text):
            sources.insert(0, lib["sources"]["mja_lime"])
            if verdict == "keep":
                verdict = "care"  # citrus on skin + sun can burn
        unique = list({s["url"]: s for s in sources}.values())
        remedies.append({
            "remedy": remedy_text,
            "verdict": verdict,
            "evidence": r.get("evidence") if r.get("evidence") in EVIDENCE else "little",
            "why": str(r.get("why") or "")[:500],
            "how_better": str(r.get("how_better") or "")[:300],
            "better": cards[:3],
            "notes": notes[:3],
            "checked": bool(unique),
            "sources": unique[:4],
        })
    if not remedies:
        raise llm.LLMError("Check a remedy: no usable answer")
    return {"remedies": remedies, "red_flags": flags, "note": str(data.get("note_for_family") or "")[:400]}, [trace]


# ---------- family care plan ----------

def candidates(member: dict, country: str) -> tuple[list[dict], list[str]]:
    """Checked actives that fit this person's concerns, minus what's unsafe for them; plus doctor notes."""
    lib = library()
    concerns = set(member.get("concerns") or [])
    out, notes = [], []
    for a in lib["actives"]:
        if not concerns & set(a["concerns"]) or _blocked_by_allergy(a, member.get("allergies", "")):
            continue
        ok, note = allowed_for(a, member, country)
        if ok:
            out.append(a)
        elif note and note not in notes:
            notes.append(note)
    if concerns & SKIN_CONCERNS:  # every skin routine includes sunscreen
        sun = lib["by_id"]["sunscreen"]
        if sun not in out:
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
        out.append({"active": str(s["active"]), "product": str(s.get("product") or allowed[str(s["active"])]["products"][0])[:60],
                    "tip": str(s.get("tip") or "")[:160]})
    return out[:5]


def care_plan(members: list[dict], country: str, language: str) -> tuple[dict, list[dict]]:
    prepared = []
    for m in members:
        cands, notes = candidates(m, country)
        flags = red_flags(" ".join([*(m.get("concerns") or []), m.get("wants") or "", m.get("details") or ""]))
        prepared.append((m, cands, notes, flags))
    plans: list[dict] = []
    if llm.is_live():
        brief = {"country": COUNTRIES.get(country, country), "family": [
            {"index": i, "person": _member(m), "details": (m.get("details") or "")[:300],
             "allowed_ingredients": [{"id": a["id"], "name": a["name"], "helps": a["concerns"], "strength": a["strength"],
                                      "time": a["time"], "products": a["products"]} for a in cands]}
            for i, (m, cands, _, _) in enumerate(prepared)]}
        system = prompts.CARE_PLAN.format(language=language or "English")
        data, trace = llm.chat_json("super", system, json.dumps(brief, ensure_ascii=False), step="Plan family care", max_tokens=4000)
        raw = {p.get("index"): p for p in (data.get("people") or []) if isinstance(p, dict)}
        note = str(data.get("note_for_family") or "")[:600]
    else:
        trace, raw, note = engine._mock_trace("Plan family care", "super"), {}, ""
    for i, (m, cands, notes, flags) in enumerate(prepared):
        allowed = {a["id"]: a for a in cands}
        r = raw.get(i) or {}
        routine = {k: _clean_steps(r.get(k), allowed) for k in ("am", "pm", "shower")}
        if not any(routine.values()):
            routine = _mock_routine(m, cands)  # model gave nothing usable: fall back to the checked defaults
            summary = routine.pop("summary")
        else:
            summary = str(r.get("summary") or "")[:400]
        used = {s["active"] for steps in routine.values() for s in steps}
        whys = r.get("why") if isinstance(r.get("why"), dict) else {}
        plans.append({
            "name": (m.get("name") or f"Person {i + 1}")[:30],
            "concerns": m.get("concerns") or [],
            "red_flags": flags,
            "doctor_notes": notes,
            "routine": routine,
            "summary": summary,
            "ingredients": [_card(allowed[a], m, country, str(whys.get(a) or "")) for a in allowed if a in used],
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

def check_label(text: str, member: dict) -> dict:
    lib = library()
    parts = [p.strip().lower() for p in re.split(r"[,;\n]|\s•\s", text or "") if p.strip()]
    found, irritants = [], []
    for pos, part in enumerate(parts):
        for a in lib["actives"]:
            hit = any(alias == part or re.search(rf"\b{re.escape(alias)}\b", part) for alias in a["aliases"])
            if hit and a["id"] not in {f["id"] for f in found}:
                    found.append({"id": a["id"], "name": a["name"], "position": pos + 1, "helps": a["concerns"], "how": a["how"],
                                  "pregnancy": a["pregnancy"]})
        for irr in lib["irritants"]:
            hit = any(alias == part or re.search(rf"\b{re.escape(alias)}\b", part) for alias in irr["aliases"])
            if hit and irr["name"] not in {i["name"] for i in irritants}:
                    irritants.append({"name": irr["name"], "position": pos + 1, "why": irr["why"], "high": pos < 5})
    concerns = set(member.get("concerns") or [])
    fits = [f for f in found if concerns & set(f["helps"])]
    warnings = []
    if member.get("pregnant"):
        warnings += [f"Contains {f['name'].lower()}: avoid in pregnancy or breastfeeding." for f in found if f["pregnancy"] == "avoid"]
    if "sensitive" in concerns:
        warnings += [f"{i['name']} is in this product; it often bothers sensitive skin." for i in irritants]
    allergies = (member.get("allergies") or "").lower()
    if allergies:
        warnings += [f"Check: the label lists {p}, which matches your allergy note." for p in parts
                     if any(re.search(rf"\b{re.escape(w)}\b", p) for w in re.findall(r"[a-z]{4,}", allergies))]
    return {"count": len(parts), "actives": found, "irritants": irritants, "fits": [f["name"] for f in fits],
            "warnings": warnings[:6]}


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
