"""Household insights: daily aims for each person, worked out in code from published guidance (no AI).

Calories and protein reuse the week planner's maths (Mifflin-St Jeor, WHO Asian BMI cut-offs); the other
aims come from WHO, ICMR-NIN, EFSA and ADA guidance, and every number says where it comes from.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from . import dietitian

router = APIRouter(prefix="/api")

Goal = Literal["maintain", "lose_weight", "belly_fat", "steady_sugar", "build_muscle"]
# ICMR-NIN 2020 reference adults (kg), used for protein and water when weight isn't known.
REF_WEIGHT = {"male": 65, "female": 55}


class InsightMember(BaseModel):
    name: str = Field(default="", max_length=30)
    sex: Literal["female", "male"] | None = None
    age: int | None = Field(default=None, ge=0, le=120)
    height_cm: float | None = Field(default=None, ge=80, le=250)
    weight_kg: float | None = Field(default=None, ge=25, le=350)
    activity: Literal["sedentary", "light", "moderate", "active"] = "light"
    ethnicity: Literal["south_asian", "east_asian", "southeast_asian", "other"] | None = None
    pregnant: bool = False
    conditions: list[Literal["diabetes", "bp", "cholesterol"]] = Field(default_factory=list, max_length=3)
    goals: list[Goal] = Field(default_factory=list, max_length=5)


class InsightsIn(BaseModel):
    members: list[InsightMember] = Field(min_length=1, max_length=8)


def _aim(key: str, label: str, value: str, why: str, source: str) -> dict:
    return {"key": key, "label": label, "value": value, "why": why, "source": source}


def person_insights(m: dict) -> dict:
    name = m.get("name") or "You"
    age, sex, weight = m.get("age"), m.get("sex"), m.get("weight_kg")
    conds = set(m.get("conditions") or [])
    goals = set(m.get("goals") or [])
    if "diabetes" in conds:
        goals.add("steady_sugar")
    out = {"name": name, "aims": [], "notes": [], "missing": [], "body": None, "focus": []}
    if age is not None and age < 18:
        out["notes"].append("Daily aims here are for adults. Growing children need regular meals, milk or another calcium "
                            "source, and plenty of fruit and vegetables; ask their doctor about anything specific.")
        out["aims"].append(_aim("activity", "Activity", "60 min a day", "Active play or sport every day, on average.", "WHO 2020"))
        return out

    kcal, protein, notes = dietitian.calorie_target({**m, "goals": sorted(goals - {"steady_sugar"}) or ["maintain"]})
    out["body"] = dietitian.body_check(m)
    out["notes"] += [n for n in notes if not n.startswith("Calorie targets are estimates")]
    for key, label in (("sex", "sex"), ("age", "age"), ("height_cm", "height"), ("weight_kg", "weight")):
        if not m.get(key):
            out["missing"].append(label)

    ref = weight or REF_WEIGHT.get(sex or "", 60)
    if kcal:
        out["aims"].append(_aim("kcal", "Calories", f"{kcal:,} kcal", "From age, height, weight and activity, adjusted for the goals.",
                                "Mifflin-St Jeor"))
    elif not m.get("pregnant"):
        out["aims"].append(_aim("kcal", "Calories", "add height & weight", "A personal target needs age, sex, height and weight.",
                                "Mifflin-St Jeor"))
    if protein is None:
        per_kg = 1.1 if m.get("pregnant") else 1.0 if age and age >= 65 else 0.83
        protein = round(per_kg * ref)
        basis = "their weight" if weight else f"a typical {ref} kg adult; add weight for theirs"
        why = f"{per_kg:g} g per kg of body weight, using {basis}."
        if m.get("pregnant"):
            why = "Needs rise in pregnancy (about +10 to 25 g a day later on). " + why
    else:
        why = "Enough to keep muscle while the goals change the calories." if goals & {"lose_weight", "belly_fat", "build_muscle"} \
            else "Per kg of body weight; a little more over 65 to keep muscle."
    out["aims"].append(_aim("protein", "Protein", f"{protein} g", why + " Spread it across meals.",
                            "ICMR-NIN 2020, PROT-AGE" if age and age >= 65 else "ICMR-NIN 2020"))
    if conds & {"diabetes", "bp"} and not any("Kidney" in n for n in out["notes"]):
        out["notes"].append("If kidney function is reduced (common with long-term diabetes or high blood pressure), ask the "
                            "doctor before eating more protein or potassium.")

    fibre = max(25, round(14 * kcal / 1000)) if kcal else (30 if sex == "male" else 25)
    out["aims"].append(_aim("fibre", "Fibre", f"{fibre} g+", "Whole grains, dal, vegetables and fruit; helps blood sugar, "
                            "cholesterol and fullness.", "WHO 2023, IOM"))
    if "bp" in conds:
        out["aims"].append(_aim("sodium", "Sodium", "under 2,000 mg", "1,500 mg is ideal. Count pickles, papad and packaged "
                                "food too; less sodium lowers blood pressure.", "WHO, AHA"))
        out["focus"].append("Less salt: taste before salting, more lemon, herbs and spices.")
        out["focus"].append("More potassium from vegetables, dal, fruit and curd (the DASH pattern), unless the doctor has "
                            "said otherwise (some BP medicines and kidney problems).")
    else:
        out["aims"].append(_aim("sodium", "Sodium", "under 2,000 mg", "Under 5 g of salt (one level teaspoon) a day.", "WHO"))
    if kcal:
        sugar = round(kcal * 0.10 / 4)
        out["aims"].append(_aim("sugar", "Added sugar", f"under {sugar} g", "Under 10% of calories, ideally half that: "
                                "sweets, sugary chai and drinks count.", "WHO"))
    else:
        out["aims"].append(_aim("sugar", "Added sugar", "under 25–50 g", "Under 10% of calories, ideally under 5%.", "WHO"))
    if "cholesterol" in conds:
        cap = f"under {round(kcal * 0.06 / 9)} g" if kcal else "under 6% of calories"
        out["aims"].append(_aim("satfat", "Saturated fat", cap, "Less ghee, butter, cream and fatty meat; use oils like "
                                "mustard, groundnut or olive in measured spoons.", "AHA"))
        out["focus"].append("Oats, dal and rajma: soluble fibre helps lower LDL cholesterol.")
    if "steady_sugar" in goals:
        per_meal = "30–45 g" if sex == "female" else "45–60 g" if sex == "male" else "30–60 g"
        out["aims"].append(_aim("carbs_meal", "Carbs per meal", per_meal, "A starting point: a steady amount at each meal "
                                "keeps blood sugar even. Half the plate vegetables, a quarter protein, a quarter grains.",
                                "ADA carb counting"))
        out["focus"].append("Pair rice or roti with dal, curd or paneer, space meals evenly, and walk 10 minutes after meals.")
        out["notes"].append("On insulin or tablets like gliclazide? Don't cut carbs without the doctor: it can cause low "
                            "blood sugar.")
    water = min(round(ref * 0.035, 1), 3.0) if weight else (2.5 if sex == "male" else 2.0)
    out["aims"].append(_aim("water", "Water", f"about {water:g} L", "From drinks and food together; more in heat or exercise, "
                            "unless the doctor limits fluids.", "EFSA"))
    act = "150 min a week + strength twice"
    why = "Brisk walking counts. Strength exercise keeps muscle and helps blood sugar."
    if age and age >= 65:
        why += " Add balance exercises to prevent falls."
    if "build_muscle" in goals:
        act, why = "strength 3× a week", "Train each muscle group 2–3 times a week, with protein at every meal."
    out["aims"].append(_aim("activity", "Activity", act, why, "WHO 2020"))
    if m.get("pregnant"):
        out["focus"].append("Folic acid, iron and calcium matter most now; follow the midwife's or doctor's advice.")
    return out


@router.post("/insights")
def insights(body: InsightsIn):
    """Daily aims for everyone at home. Pure code, no model call."""
    people = [person_insights(m.model_dump()) for m in body.members]
    conds = sorted({c for m in body.members for c in m.conditions})
    return {"people": people, "household": {"size": len(body.members), "conditions": conds}}
