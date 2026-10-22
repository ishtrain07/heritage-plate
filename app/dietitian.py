"""Personal week plan: a calorie target from the person's profile, a week of meals around the
family's own dishes, and every number computed from the food tables.

Nemotron Ultra chooses and composes the meals; code sets the target, checks the diet rules,
computes nutrition and scales portions so each day lands near the target.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from . import engine, llm, nutrition, prompts

DAYS = engine.DAYS
MEAT = {"bacon", "chicken", "goat meat", "ground beef", "lamb", "pork"}
FISH = {"cod", "fish", "salmon", "shrimp", "fish sauce", "oyster sauce"}
EGG = {"egg", "egg noodles"}
DAIRY = {"cheddar cheese", "heavy cream", "khoa", "mozzarella cheese", "paneer", "parmesan cheese", "queso fresco",
         "sour cream", "whole milk", "yogurt", "butter", "ghee"}
EXCLUDES = {
    "non_veg": set(),
    "pescatarian": MEAT,
    "eggetarian": MEAT | FISH,
    "vegetarian": MEAT | FISH | EGG,
    "vegan": MEAT | FISH | EGG | DAIRY | {"honey"},
}
DIET_LABELS = {"non_veg": "eats everything", "pescatarian": "pescatarian (fish, no meat)",
               "eggetarian": "vegetarian plus eggs", "vegetarian": "vegetarian (no meat, fish or egg)",
               "vegan": "vegan (no animal products)"}
ACTIVITY = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "active": 1.725}
GOALS = {
    "maintain": "keep weight steady and eat well",
    "lose_weight": "lose weight gradually (about 0.5 kg a week)",
    "belly_fat": "lose belly fat (treated as gradual overall fat loss)",
    "steady_sugar": "keep blood sugar steady through the day",
    "build_muscle": "build muscle (a small surplus with plenty of protein)",
}
CONDITION_TEXT = {"diabetes": "type 2 diabetes", "bp": "high blood pressure", "cholesterol": "high cholesterol"}
# Share of the day's calories per meal.
SPLIT = {
    True: {"breakfast": 0.25, "lunch": 0.33, "snack": 0.10, "dinner": 0.32},
    False: {"breakfast": 0.27, "lunch": 0.38, "dinner": 0.35},
}
NUTRIENTS = ("kcal", "carbs_g", "net_carbs_g", "fiber_g", "protein_g", "fat_g", "sat_fat_g", "sodium_mg")


@lru_cache
def meal_library() -> list[dict]:
    path = Path(__file__).resolve().parent.parent / "data" / "meals.json"
    return json.loads(path.read_text(encoding="utf-8"))


def allowed(items: list[str], diet: str, avoid: set[str]) -> bool:
    banned = EXCLUDES.get(diet, set()) | avoid
    return not any(i in banned for i in items)


def avoid_items(dislikes: str) -> set[str]:
    return {food.name for food, _ in nutrition.find_mentions(dislikes or "")}


def calorie_target(profile: dict) -> tuple[int | None, float | None, list[str]]:
    """Mifflin-St Jeor resting energy x activity, adjusted for the goal. Returns (kcal, protein_g, notes)."""
    notes: list[str] = []
    goal = profile.get("goal", "maintain")
    if goal == "belly_fat":
        notes.append("Fat can't be lost from one spot. Belly fat goes down with overall fat loss, so this plan "
                     "aims for a steady calorie deficit; regular walking and strength exercise help most.")
    sex, age, height, weight = (profile.get(k) for k in ("sex", "age", "height_cm", "weight_kg"))
    if not (sex in ("female", "male") and age and height and weight):
        notes.append("Add age, height, weight and sex for a personal calorie target. Until then the plan uses "
                     "normal portions and shows each day's calories.")
        return None, None, notes
    if age < 18:
        notes.append("Calorie targets here are for adults. For under-18s, ask a doctor or dietitian.")
        return None, None, notes
    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if sex == "male" else -161)
    tdee = bmr * ACTIVITY.get(profile.get("activity", "light"), 1.375)
    bmi = weight / (height / 100) ** 2
    floor = 1500 if sex == "male" else 1200
    protein = None
    if goal in ("lose_weight", "belly_fat"):
        if bmi < 18.5:
            notes.append(f"BMI is about {bmi:.1f}, which is already low, so this plan keeps calories at maintenance "
                         "instead of cutting. Please check with a doctor.")
            target = tdee
        else:
            target = max(tdee - 500, floor)
            if tdee - 500 < floor:
                notes.append(f"Calories are kept at {floor} a day, the usual safe minimum without medical supervision.")
            protein = round(1.2 * weight)
    elif goal == "build_muscle":
        target = tdee + 250
        protein = round(1.6 * weight)
    else:
        target = tdee
    return round(target / 10) * 10, protein, notes


def _scaled(ingredients: list[dict], factor: float) -> list[dict]:
    return [{"item": i["item"], "grams": round(i["grams"] * factor, 1)} for i in ingredients]


def _meal_nutrition(meal: dict, recipes: list[dict]) -> dict:
    if meal.get("dish_id") is not None:
        r = recipes[meal["dish_id"]]
        per = r["nutrition"]
        out = {k: round(per[k] * meal["servings"], 1) for k in NUTRIENTS}
        out["uncounted"] = per["uncounted"]
        return out
    return nutrition.per_serving(meal["ingredients"], 1)


def _dish_meal(slot: str, idx: int, recipes: list[dict], servings: float = 1.0) -> dict:
    return {"slot": slot, "dish_id": idx, "servings": servings, "name": recipes[idx]["name"], "source": "family",
            "recipe_id": recipes[idx].get("id"), "how": ""}


def _library_meal(slot: str, item: dict) -> dict:
    return {"slot": slot, "dish_id": None, "name": item["name"], "source": "suggested",
            "ingredients": [dict(i) for i in item["ingredients"]], "how": item["how"]}


def _candidates(slot: str, diet: str, avoid: set[str], focus: str) -> list[dict]:
    pool = [m for m in meal_library() if slot in m["slots"] and allowed([i["item"] for i in m["ingredients"]], diet, avoid)]
    return sorted(pool, key=lambda m: nutrition.per_serving(m["ingredients"], 1)[focus])


def usable_dishes(recipes: list[dict], diet: str, avoid: set[str]) -> tuple[list[int], list[str]]:
    ok, skipped = [], []
    for i, r in enumerate(recipes):
        if allowed([g["item"] for g in r["ingredients"]], diet, avoid):
            ok.append(i)
        else:
            skipped.append(r["name"])
    return ok, skipped


def _mock_week(recipes: list[dict], ok: list[int], slots: list[str], diet: str, avoid: set[str], focus: str, week: int) -> list[dict]:
    """Deterministic plan: each family dish a few times in its natural slot, the rest from the meal library."""
    by_slot = {s: [i for i in ok if (recipes[i]["meal"] == "breakfast") == (s == "breakfast") and recipes[i]["meal"] != "dessert"]
               for s in slots}
    by_slot["snack"] = []
    shift = week - 1
    days = []
    for d, day in enumerate(DAYS):
        meals = []
        for s in slots:
            family = by_slot.get(s, [])
            pool = _candidates(s, diet, avoid, focus)
            use_family = family and (d + shift + (s == "dinner")) % 2 == 0  # family dish about every other day
            if use_family:
                meals.append(_dish_meal(s, family[(d + shift) // 2 % len(family)], recipes))
            elif pool:
                meals.append(_library_meal(s, pool[(d + shift + (s == "dinner") * 3) % len(pool)]))
        days.append({"day": day, "meals": meals})
    return days


def _clean_live_week(raw: object, recipes: list[dict], ok: list[int], slots: list[str], diet: str, avoid: set[str],
                     focus: str) -> tuple[list[dict], int]:
    """Keep the model's meals that follow the rules; replace the rest from the meal library. Returns (days, replaced)."""
    raw_days = raw if isinstance(raw, list) else []
    replaced = 0
    days = []
    for d, day in enumerate(DAYS):
        src = raw_days[d] if d < len(raw_days) and isinstance(raw_days[d], dict) else {}
        by_slot = {m.get("slot"): m for m in src.get("meals", []) if isinstance(m, dict)}
        meals = []
        for s in slots:
            m = by_slot.get(s) or {}
            meal = None
            dish = m.get("dish_id")
            if type(dish) is int and dish in ok and recipes[dish]["meal"] != "dessert":
                try:
                    servings = min(max(float(m.get("servings") or 1), 0.5), 2.0)
                except (TypeError, ValueError):
                    servings = 1.0
                meal = _dish_meal(s, dish, recipes, servings)
            elif dish is None and m.get("name"):
                ings = engine.normalize_ingredients(m.get("ingredients"))
                if ings and allowed([i["item"] for i in ings], diet, avoid) and all(i["matched"] for i in ings):
                    meal = {"slot": s, "dish_id": None, "name": str(m["name"])[:70], "source": "suggested",
                            "ingredients": [{"item": i["item"], "grams": i["grams"]} for i in ings],
                            "how": str(m.get("how") or "")[:200]}
            if meal is None:
                pool = _candidates(s, diet, avoid, focus)
                if not pool:
                    continue
                meal = _library_meal(s, pool[(d * 2 + len(meals)) % len(pool)])
                replaced += 1
            meals.append(meal)
        days.append({"day": day, "meals": meals})
    return days, replaced


def _finish_days(days: list[dict], recipes: list[dict], target: int | None, slots: list[str]) -> list[dict]:
    """Compute every meal from the food tables and scale each day's portions toward the target."""
    for day in days:
        for meal in day["meals"]:
            meal["nutrition"] = _meal_nutrition(meal, recipes)
        total = sum(m["nutrition"]["kcal"] for m in day["meals"])
        if target and total:
            factor = min(max(target / total, 0.7), 1.35)
            for meal in day["meals"]:
                if meal["dish_id"] is not None:
                    meal["servings"] = max(0.5, round(meal["servings"] * factor * 4) / 4)
                else:
                    meal["ingredients"] = _scaled(meal["ingredients"], factor)
                meal["nutrition"] = _meal_nutrition(meal, recipes)
        day["totals"] = {k: round(sum(m["nutrition"][k] for m in day["meals"]), 1) for k in NUTRIENTS}
        day["meals"].sort(key=lambda m: slots.index(m["slot"]))
    return days


def _shopping(days: list[dict], recipes: list[dict], household: int) -> list[dict]:
    need: dict[str, float] = {}
    for day in days:
        for meal in day["meals"]:
            if meal["dish_id"] is not None:
                r = recipes[meal["dish_id"]]
                ings = _scaled(r["ingredients"], meal["servings"] / r["servings"])
            else:
                ings = meal["ingredients"]
            for i in ings:
                need[i["item"]] = need.get(i["item"], 0) + i["grams"] * household
    items = []
    for item, grams in need.items():
        food = nutrition.match(item)
        step = 50 if grams >= 50 else 5
        items.append({"item": item, "grams": max(step, int(round(grams / step) * step)), "category": food.category if food else "other"})
    order = ["grain", "legume", "vegetable", "fruit", "dairy", "protein", "fat", "nuts", "sauce", "sweetener", "spice", "other"]
    return sorted(items, key=lambda i: (order.index(i["category"]) if i["category"] in order else 99, i["item"]))


def plan_week(recipes: list[dict], profile: dict, language: str = "", week: int = 1, household: int = 1) -> tuple[dict, list[dict]]:
    diet = profile.get("diet", "non_veg")
    conditions = [c for c in profile.get("conditions", []) if c in CONDITION_TEXT]
    goal = profile.get("goal", "maintain")
    avoid = avoid_items(profile.get("dislikes", ""))
    slots = ["breakfast", "lunch", "snack", "dinner"] if profile.get("snacks", True) else ["breakfast", "lunch", "dinner"]
    focus = "net_carbs_g" if "diabetes" in conditions or goal == "steady_sugar" else (
        "sodium_mg" if "bp" in conditions else "sat_fat_g" if "cholesterol" in conditions else "kcal")
    target, protein, notes = calorie_target(profile)
    ok, skipped = usable_dishes(recipes, diet, avoid)
    if skipped:
        notes.append("Left out for this diet or dislikes: " + ", ".join(skipped[:5]) + ".")
    split = SPLIT["snack" in slots]

    message, tips, replaced, days = "", [], 0, None
    trace = {"step": "Plan the week", "tier": "ultra", "model": "mock (Nemotron Ultra when live)",
             "ms": 0, "tokens": None, "fallback": False, "cached": False}
    if llm.is_live():
        menu = [{"id": i, "name": recipes[i]["name"], "meal": recipes[i]["meal"], "kcal_per_serving": recipes[i]["nutrition"]["kcal"]}
                for i in ok]
        brief = {
            "diet": DIET_LABELS.get(diet, diet),
            "health": [CONDITION_TEXT[c] for c in conditions] or ["none given"],
            "goal": GOALS.get(goal, goal),
            "dislikes_or_allergies": profile.get("dislikes", "")[:200],
            "daily_kcal_target": target,
            "kcal_per_meal": {s: round((target or 1900) * split[s]) for s in slots},
            "protein_g_per_day": protein,
            "meals_each_day": slots,
            "family_dishes": menu,
            "week_number": week,
        }
        system = prompts.WEEK.format(names=", ".join(nutrition.canonical_names()), language=language or "English")
        try:
            data, trace = llm.chat_json("ultra", system, json.dumps(brief), step="Plan the week", max_tokens=9000)
        except llm.LLMError as exc:
            # A slow or failed model call shouldn't cost the user their week: plan from the meal library instead.
            trace = {**trace, "model": "meal library (model call failed)", "error": str(exc)[:200]}
        else:
            trace = {**trace}
            days, replaced = _clean_live_week(data.get("days"), recipes, ok, slots, diet, avoid, focus)
            message = str(data.get("message_for_parent") or "")[:800]
            raw_tips = data.get("tips")
            tips = [str(t)[:200] for t in raw_tips][:3] if isinstance(raw_tips, list) else []
            trace["meals_replaced"] = replaced
    if days is None:
        days = _mock_week(recipes, ok, slots, diet, avoid, focus, week)

    days = _finish_days(days, recipes, target, slots)
    avg = {k: round(sum(d["totals"][k] for d in days) / len(days), 1) for k in NUTRIENTS}
    if protein and avg["protein_g"] < 0.85 * protein:
        notes.append(f"Protein averages about {avg['protein_g']:.0f} g a day against an aim of {protein} g. "
                     "Add a bowl of dal, yogurt, paneer, tofu, eggs or lean meat to a meal or two.")
    condition = conditions[0] if conditions else "everyday"
    note_language = language
    if language and not message:
        message, note_language = engine.FALLBACK_MESSAGES[condition], "English"
    return {
        "target": {"kcal": target, "protein_g": protein, "method": "Mifflin-St Jeor x activity" if target else None},
        "profile": {"diet": diet, "goal": goal, "conditions": conditions},
        "days": days,
        "average": avg,
        "shopping_list": _shopping(days, recipes, household),
        "household": household,
        "message_for_parent": message if language else "",
        "language": note_language,
        "tips": tips or engine.FALLBACK_TIPS[condition],
        "notes": notes,
    }, [trace]
