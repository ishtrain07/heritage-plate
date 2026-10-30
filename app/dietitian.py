"""Personal week plan: a calorie target from the person's profile, a week of meals around the
family's own dishes, and every number computed from the food tables.

Nemotron Ultra chooses and composes the meals; code sets the target, checks the diet rules,
computes nutrition and scales portions so each day lands near the target.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path

from . import engine, llm, nutrition, prompts

DAYS = engine.DAYS
MEAT = {"bacon", "chicken", "chicken breast", "goat meat", "ground beef", "lamb", "pork", "chorizo", "ground turkey"}
FISH = {"cod", "fish", "salmon", "shrimp", "tuna", "fish sauce", "oyster sauce", "kimchi", "salt cod", "tilapia", "sardines", "mackerel"}
EGG = {"egg", "egg white", "egg noodles", "mayonnaise"}
DAIRY = {"cheddar cheese", "heavy cream", "khoa", "mozzarella cheese", "paneer", "parmesan cheese", "queso fresco",
         "sour cream", "whole milk", "yogurt", "butter", "ghee", "cottage cheese", "buttermilk", "sweetened condensed milk", "feta cheese"}
PORK = {"pork", "bacon", "chorizo"}
SHELLFISH = {"shrimp", "oyster sauce"}
ROOTS = {"onion", "spring onion", "garlic", "potato", "sweet potato", "carrot", "cassava", "ginger", "true yam", "mushrooms", "shiitake",
         "taro", "beetroot", "turnip", "parsnip", "leek", "daikon", "lotus root", "jicama"}
EXCLUDES = {
    "non_veg": set(),
    "pescatarian": MEAT,
    "eggetarian": MEAT | FISH,
    "vegetarian": MEAT | FISH | EGG,
    "vegan": MEAT | FISH | EGG | DAIRY | {"honey"},
    "halal": PORK,
    "kosher": PORK | SHELLFISH,
    "jain": MEAT | FISH | EGG | ROOTS | {"honey"},
}
DIET_LABELS = {"non_veg": "eats everything", "pescatarian": "pescatarian (fish, no meat)",
               "eggetarian": "vegetarian plus eggs", "vegetarian": "vegetarian (no meat, fish or egg)",
               "vegan": "vegan (no animal products)", "halal": "halal (no pork or alcohol)",
               "kosher": "kosher-style (no pork or shellfish, never meat with dairy in one dish)",
               "jain": "Jain (vegetarian; no onion, garlic, potato or other root vegetables, no mushrooms or honey)"}
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


# Words that give away an animal ingredient even when a name isn't in the food table ("chicken stock", "lard").
WORDS = {
    "meat": ("chicken", "beef", "pork", "lamb", "mutton", "goat", "bacon", "ham", "sausage", "turkey", "duck",
             "salami", "pepperoni", "lard", "gelatin", "stock", "broth", "keema", "mince"),
    "fish": ("fish", "anchov", "tuna", "prawn", "shrimp", "crab", "lobster", "oyster", "squid", "salmon", "cod",
             "sardine", "mackerel", "kimchi", "dashi"),
    "egg": ("egg", "mayo"),
    "dairy": ("milk", "cheese", "butter", "ghee", "cream", "yogurt", "yoghurt", "curd", "paneer", "khoa", "whey", "dahi"),
    "pork": ("pork", "bacon", "ham", "lard", "gelatin", "salami", "pepperoni", "chorizo", "prosciutto", "pancetta", "jamon", "jamón"),
    "alcohol": ("wine", "beer", "rum", "brandy", "whisky", "vodka", "sake", "mirin", "liqueur", "alcohol"),
    "shellfish": ("prawn", "shrimp", "crab", "lobster", "oyster", "squid", "clam", "mussel", "scallop"),
    "root": ("onion", "garlic", "potato", "carrot", "beet", "beetroot", "radish", "turnip", "yam", "ginger", "mushroom", "shallot", "leek"),
}
DIET_WORDS = {"non_veg": (), "pescatarian": ("meat",), "eggetarian": ("meat", "fish"),
              "vegetarian": ("meat", "fish", "egg"), "vegan": ("meat", "fish", "egg", "dairy"),
              "halal": ("pork", "alcohol"), "kosher": ("pork", "shellfish"), "jain": ("meat", "fish", "egg", "root")}
# Allergy and avoid words that stand for a group of foods.
GROUPS = {
    ("peanut", "peanuts", "groundnut"): {"peanuts", "groundnut oil", "peanut butter", "mixed nuts"},
    ("nut", "nuts", "tree nut", "tree nuts"): {"peanuts", "cashews", "groundnut oil", "almonds", "walnuts", "pistachios",
                                                "mixed nuts", "peanut butter"},
    ("dairy", "lactose", "milk"): DAIRY,
    ("seafood", "fish"): FISH,
    ("shellfish", "prawn", "prawns"): {"shrimp", "oyster sauce"},
    ("gluten", "wheat"): {"whole wheat flour", "all-purpose flour", "white bread", "whole wheat bread", "pasta",
                          "couscous", "bulgur", "semolina", "egg noodles", "flour tortilla", "pita bread", "barley",
                          "soy sauce"},
    ("egg",): EGG,
    ("soy",): {"soy sauce", "tofu", "soybeans", "miso"},
    ("sesame",): {"sesame oil", "tahini", "sesame seeds"},
    ("meat",): MEAT,
}


WHOLE_WORDS = {"ham", "rum", "sake", "yam", "beet"}  # as prefixes they'd catch rumali roti, hamachi, beetroot (listed separately)
PLANT_LOOKALIKES = re.compile(r"\beggplants?\b|\bbutternut\b|\bcream of tartar\b|\b(coconut|almond|soy|soya|oat|rice|peanut|cashew|cocoa|shea|mango|kokum|nut|seed)s? "
                              r"(milk|butter|cream|yogurt|yoghurt|cheese|curd)\b|\boyster(?= mushrooms?\b)")


def _animal_word(name: str, groups: tuple[str, ...]) -> bool:
    lower = name.lower()
    if "vegetable" in lower or "veg " in lower:  # "vegetable stock" is fine
        return False
    lower = PLANT_LOOKALIKES.sub(" ", lower)  # eggplant, coconut milk, oyster mushrooms: plants
    # Short words must be whole words ("rum" not "rumali", "ham" not "hamachi"); longer ones may be prefixes ("anchov").
    return any(re.search(rf"\b{w}(s|es)?\b" if w in WHOLE_WORDS else rf"\b{w}", lower) for g in groups for w in WORDS[g])


def allowed(items: list[str], diet: str, avoid: set[str]) -> bool:
    banned = EXCLUDES.get(diet, set()) | avoid
    groups = DIET_WORDS.get(diet, ())
    if any(i in banned or _animal_word(i, groups) for i in items):
        return False
    if diet == "kosher":  # never meat and dairy in the same dish
        meat = any(i in MEAT or _animal_word(i, ("meat",)) for i in items)
        dairy = any(i in DAIRY or _animal_word(i, ("dairy",)) for i in items)
        return not (meat and dairy)
    return True


def avoid_items(dislikes: str) -> tuple[set[str], list[str]]:
    """Foods to keep out, from names ("mushrooms") and group words ("nut allergy"). Also returns words not understood."""
    text = nutrition.normalize(dislikes or "")
    avoid = {food.name for food, _ in nutrition.find_mentions(text)}
    # Blank out the foods already named, so "coconut milk" or "eggplant" don't also trigger "milk" or "egg".
    rest = text
    index = nutrition._alias_index()
    for alias, name in index.items():
        if name in avoid:
            rest = re.sub(rf"\b{re.escape(alias)}\b", " ", rest)
    for words, foods in GROUPS.items():
        if any(re.search(rf"\b{re.escape(w)}\b", rest) for w in words):
            avoid |= foods
    unknown = []
    if text.strip() and not avoid:
        unknown.append(dislikes.strip()[:80])
    return avoid, unknown


# WHO BMI cut-offs; for Asian populations risk starts lower (WHO expert consultation, Lancet 2004).
ASIAN = {"south_asian", "east_asian", "southeast_asian"}
BMI_CUTOFFS = {"asian": (23.0, 27.5), "standard": (25.0, 30.0)}


def body_check(profile: dict) -> dict | None:
    """BMI, its band and a healthy-weight range, using Asian cut-offs where they apply."""
    height, weight = profile.get("height_cm"), profile.get("weight_kg")
    if not (height and weight):
        return None
    scale = "asian" if profile.get("ethnicity") in ASIAN else "standard"
    over, obese = BMI_CUTOFFS[scale]
    bmi = weight / (height / 100) ** 2
    band = "low" if bmi < 18.5 else "healthy" if bmi < over else "overweight" if bmi < obese else "obese"
    m2 = (height / 100) ** 2
    return {"bmi": round(bmi, 1), "band": band, "cutoffs": "WHO Asian" if scale == "asian" else "WHO",
            "healthy_range_kg": [round(18.5 * m2), round((over - 0.1) * m2)]}


def goals_of(profile: dict) -> list[str]:
    """Several goals can be picked; "maintain" (eat well) only counts when it's the only one."""
    goals = [g for g in (profile.get("goals") or [profile.get("goal") or "maintain"]) if g in GOALS]
    return list(dict.fromkeys(g for g in goals if g != "maintain")) or ["maintain"]


def calorie_target(profile: dict) -> tuple[int | None, float | None, list[str]]:
    """Mifflin-St Jeor resting energy x activity, adjusted for goal, age and body. Returns (kcal, protein_g, notes)."""
    notes: list[str] = []
    goals = goals_of(profile)
    losing = bool({"lose_weight", "belly_fat"} & set(goals))
    muscle = "build_muscle" in goals
    if "belly_fat" in goals:
        notes.append("Fat can't be lost from one spot. Belly fat goes down with overall fat loss, so this plan "
                     "aims for a steady calorie deficit; regular walking and strength exercise help most.")
    if profile.get("pregnant"):
        notes.append("During pregnancy or breastfeeding, energy needs go up, not down, so there's no calorie cut here. "
                     "The plan shows balanced meals and each day's calories; follow your midwife's or doctor's advice.")
        return None, None, notes
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
    body = body_check(profile)
    floor = 1500 if sex == "male" else 1200
    older = age >= 65
    # Protein aims in g/kg: 0.8 adult RDA; 1.0-1.2 for over-65s (PROT-AGE); 1.2 while losing; 1.6 for muscle.
    per_kg = 1.6 if muscle else 1.2 if losing else 1.0 if older else 0.8
    target = tdee
    if losing:
        if body["band"] == "low":
            notes.append(f"BMI is about {body['bmi']}, which is already low, so this plan keeps calories at "
                         "maintenance instead of cutting. Please check with a doctor.")
            per_kg = 1.6 if muscle else 1.0 if older else 0.8  # building muscle still needs the protein
            if muscle:
                target = tdee + 250  # underweight: no cut, a small surplus for the muscle goal
        else:
            cut = 250 if body["band"] == "healthy" or muscle else 300 if older else 500
            if muscle:
                notes.append("Losing fat while building muscle: a small calorie deficit, plenty of protein, and "
                             "strength exercise two or three times a week.")
            if body["band"] == "healthy":
                low, high = body["healthy_range_kg"]
                notes.append(f"Weight is already in the healthy range ({low}-{high} kg by {body['cutoffs']} cut-offs), "
                             "so the plan uses a gentle 250 kcal a day deficit.")
            elif older:
                notes.append("Over 65, slower weight loss with protein at every meal helps keep muscle; "
                             "strength exercise helps too.")
            target = max(tdee - cut, floor)
            if tdee - cut < floor:
                notes.append(f"Calories are kept at {floor} a day, the usual safe minimum without medical supervision.")
    elif muscle:
        target = tdee + 250
    elif older:
        notes.append("Over 65, aim for some protein at every meal to help keep muscle.")
    if body["band"] in ("overweight", "obese") and body["cutoffs"] == "WHO Asian" and not losing:
        notes.append(f"BMI {body['bmi']} counts as {body['band']} by the WHO cut-offs for Asian adults, where health risks "
                     "start at a lower BMI. Ask the doctor whether gentle weight loss would help.")
    protein = round(per_kg * weight)
    if per_kg >= 1.2:
        notes.append("Kidney disease? Ask the doctor before eating more protein.")
    notes.append("Calorie targets are estimates (usually within about 10%). If weight doesn't change as expected "
                 "after 2-3 weeks, adjust by 100-200 kcal a day.")
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


def candidates(slots: list[str], diet: str, avoid: set[str], focus: str) -> dict[str, list[dict]]:
    """Library meals allowed for this person, per slot, best for their focus nutrient per calorie first."""
    out = {}
    for slot in slots:
        pool = [m for m in meal_library() if slot in m["slots"] and allowed([i["item"] for i in m["ingredients"]], diet, avoid)]
        nut = {m["name"]: nutrition.per_serving(m["ingredients"], 1) for m in pool}
        out[slot] = sorted(pool, key=lambda m: nut[m["name"]][focus] / max(nut[m["name"]]["kcal"], 1))
    return out


def usable_dishes(recipes: list[dict], diet: str, avoid: set[str]) -> tuple[list[int], list[str]]:
    ok, skipped = [], []
    for i, r in enumerate(recipes):
        if allowed([g["item"] for g in r["ingredients"]], diet, avoid):
            ok.append(i)
        else:
            skipped.append(r["name"])
    return ok, skipped


def _mock_week(recipes: list[dict], ok: list[int], slots: list[str], pools: dict[str, list[dict]], week: int) -> list[dict]:
    """Deterministic plan: each family dish up to 3 times in its natural slot, the rest from the meal library."""
    by_slot = {s: [i for i in ok if (recipes[i]["meal"] == "breakfast") == (s == "breakfast") and recipes[i]["meal"] != "dessert"]
               for s in slots}
    by_slot["snack"] = []
    uses = dict.fromkeys(ok, 0)
    shift = week - 1
    days = []
    for d, day in enumerate(DAYS):
        meals: list[dict] = []
        for s in slots:
            family = [i for i in by_slot.get(s, []) if uses[i] < 3 and all(m.get("dish_id") != i for m in meals)]
            pool = pools.get(s, [])
            if family and (d + shift + (s == "dinner")) % 2 == 0:  # a family dish about every other day
                pick = family[(d + shift) // 2 % len(family)]
                uses[pick] += 1
                meals.append(_dish_meal(s, pick, recipes))
            elif pool:
                taken = {m["name"] for m in meals}
                choices = [m for m in pool if m["name"] not in taken] or pool
                meals.append(_library_meal(s, choices[(d + shift + (s == "dinner") * 3) % len(choices)]))
        days.append({"day": day, "meals": meals})
    return days


def _clean_live_week(raw: object, recipes: list[dict], ok: list[int], slots: list[str], diet: str, avoid: set[str],
                     pools: dict[str, list[dict]]) -> tuple[list[dict], int]:
    """Keep the model's meals that follow the rules; replace the rest from the meal library. Returns (days, replaced)."""
    raw_days = raw if isinstance(raw, list) else []
    replaced = 0
    days = []
    for d, day in enumerate(DAYS):
        src = raw_days[d] if d < len(raw_days) and isinstance(raw_days[d], dict) else {}
        by_slot = {m.get("slot"): m for m in (src.get("meals") or []) if isinstance(m, dict)}
        meals = []
        for s in slots:
            m = by_slot.get(s) or {}
            meal = None
            dish = m.get("dish_id")
            if type(dish) is int and dish in ok and recipes[dish]["meal"] != "dessert":
                try:
                    servings = float(m.get("servings") or 1)
                except (TypeError, ValueError):
                    servings = 1.0
                servings = min(max(servings, 0.5), 2.0) if math.isfinite(servings) else 1.0
                meal = _dish_meal(s, dish, recipes, servings)
            elif dish is None and m.get("name"):
                ings = engine.normalize_ingredients(m.get("ingredients"))
                if ings and allowed([i["item"] for i in ings], diet, avoid) and all(i["matched"] for i in ings):
                    meal = {"slot": s, "dish_id": None, "name": str(m["name"])[:70], "source": "suggested",
                            "ingredients": [{"item": i["item"], "grams": i["grams"]} for i in ings],
                            "how": str(m.get("how") or "")[:200]}
            if meal is None:
                pool = pools.get(s, [])
                if not pool:
                    continue
                meal = _library_meal(s, pool[(d * 2 + len(meals)) % len(pool)])
                replaced += 1
            meals.append(meal)
        days.append({"day": day, "meals": meals})
    return days, replaced


# Protein sides, best protein per calorie first; the first one the diet and dislikes allow gets used.
PROTEIN_SIDES = [("tofu", 120, "tofu"), ("egg", 100, "2 boiled eggs"), ("paneer", 60, "paneer"),
                 ("moong dal", 40, "moong dal"), ("chickpeas", 40, "chickpeas"), ("chicken", 80, "grilled chicken")]


def _top_up_protein(days: list[dict], recipes: list[dict], aim: float | None, diet: str, avoid: set[str]) -> int:
    """Add a protein side to suggested meals on days well short of the aim. Returns how many were added."""
    if not aim:
        return 0
    sides = [s for s in PROTEIN_SIDES if allowed([s[0]], diet, avoid)]
    added = 0
    for day in days:
        for _ in range(2):  # at most two sides a day
            # One side per main meal; snacks and breakfasts stay as they are.
            meals = [m for m in day["meals"] if m["dish_id"] is None and m["slot"] in ("lunch", "dinner") and not m.get("topped")]
            protein = sum(_meal_nutrition(m, recipes)["protein_g"] for m in day["meals"])
            if not sides or not meals or protein >= 0.85 * aim:
                break
            meal = min(meals, key=lambda m: _meal_nutrition(m, recipes)["protein_g"])
            have = {i["item"] for i in meal["ingredients"]}
            fresh = [x for x in sides if x[0] not in have] or sides
            item, grams, label = fresh[added % len(fresh)]
            meal["ingredients"] = [*meal["ingredients"], {"item": item, "grams": grams}]
            meal["name"] = f"{meal['name']} + {label}"
            meal["how"] = (meal.get("how") or "") + f" Add {label} on the side for protein."
            meal["topped"] = True
            added += 1
    return added


def _finish_days(days: list[dict], recipes: list[dict], target: int | None, slots: list[str], notes: list[str]) -> list[dict]:
    """Compute every meal from the food tables and size portions so each day lands near the target.

    Family dishes are rounded to quarter servings first; suggested meals then fill the rest of the day.
    """
    missed = []
    for day in days:
        for meal in day["meals"]:
            if meal["dish_id"] is None:
                meal["base_ingredients"] = [dict(i) for i in meal["ingredients"]]
            meal["nutrition"] = _meal_nutrition(meal, recipes)
        total = sum(m["nutrition"]["kcal"] for m in day["meals"])
        if target and total:
            family = [m for m in day["meals"] if m["dish_id"] is not None]
            suggested = [m for m in day["meals"] if m["dish_id"] is None]
            factor = target / total
            for m in family:
                m["servings"] = min(max(0.5, round(m["servings"] * factor * 4) / 4), 2.5)
                m["nutrition"] = _meal_nutrition(m, recipes)
            fixed = sum(m["nutrition"]["kcal"] for m in family)
            rest = sum(m["nutrition"]["kcal"] for m in suggested)
            if rest:
                fill = min(max((target - fixed) / rest, 0.5), 2.5)
                for m in suggested:
                    m["ingredients"] = _scaled(m["base_ingredients"], fill)
                    m["nutrition"] = _meal_nutrition(m, recipes)
        day["totals"] = {k: round(sum(m["nutrition"][k] for m in day["meals"]), 1) for k in NUTRIENTS}
        if target and abs(day["totals"]["kcal"] - target) > 0.1 * target:
            missed.append(day["day"])
        day["meals"].sort(key=lambda m: slots.index(m["slot"]))
    if missed:
        notes.append(f"{', '.join(missed)} {'is' if len(missed) == 1 else 'are'} more than 10% off the calorie target; "
                     "adjust portions on those days.")
    return days


def _shopping(days: list[dict], recipes: list[dict], household: int) -> list[dict]:
    """Groceries for the household: the planned person's portions plus a normal portion for everyone else."""
    need: dict[str, float] = {}
    others = household - 1
    for day in days:
        for meal in day["meals"]:
            if meal["dish_id"] is not None:
                r = recipes[meal["dish_id"]]
                ings = _scaled(r["ingredients"], (meal["servings"] + others) / r["servings"])
            else:
                base = meal.get("base_ingredients") or meal["ingredients"]
                ings = meal["ingredients"] + _scaled(base, others)
            for i in ings:
                need[i["item"]] = need.get(i["item"], 0) + i["grams"]
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
    goals = goals_of(profile)
    goal = goals[0]
    avoid, unknown = avoid_items(profile.get("dislikes", ""))
    slots = ["breakfast", "lunch", "snack", "dinner"] if profile.get("snacks", True) else ["breakfast", "lunch", "dinner"]
    focus = "net_carbs_g" if "diabetes" in conditions or "steady_sugar" in goals else (
        "sodium_mg" if "bp" in conditions else "sat_fat_g" if "cholesterol" in conditions else "kcal")
    target, protein, notes = calorie_target(profile)
    if unknown:
        notes.append(f"Couldn't match \u201c{unknown[0]}\u201d to specific foods, so please check the meals for it yourself.")
    ok, skipped = usable_dishes(recipes, diet, avoid)
    pools = candidates(slots, diet, avoid, focus)
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
            "goal": "; ".join(GOALS.get(g, g) for g in goals),
            "dislikes_or_allergies": profile.get("dislikes", "")[:200],
            "daily_kcal_target": target,
            "kcal_per_meal": {s: round((target or 1900) * split[s]) for s in slots},
            "protein_g_per_day": protein,
            "meals_each_day": slots,
            "family_dishes": menu,
            "week_number": week,
        }
        system = prompts.WEEK.format(names=", ".join(nutrition.canonical_names()), language=language or "English")
        if not language:
            system += '\nNobody to write to this time: set "message_for_parent" to "".'
        try:
            # No Super fallback: if Ultra is slow, the meal library is faster than a second long call.
            data, trace = llm.chat_json("ultra", system, json.dumps(brief), step="Plan the week", max_tokens=9000,
                                        fallback=False)
        except llm.LLMError as exc:
            # A slow or failed model call shouldn't cost the user their week: plan from the meal library instead.
            trace = {**trace, "model": "meal library (model call failed)", "error": str(exc)[:200]}
        else:
            days, replaced = _clean_live_week(data.get("days"), recipes, ok, slots, diet, avoid, pools)
            message = str(data.get("message_for_parent") or "")[:800]
            raw_tips = data.get("tips")
            tips = [str(t)[:200] for t in raw_tips][:3] if isinstance(raw_tips, list) else []
            trace["meals_replaced"] = replaced
    if days is None:
        days = _mock_week(recipes, ok, slots, pools, week)

    if _top_up_protein(days, recipes, protein, diet, avoid):
        notes.append("Some meals have a protein side added to get closer to the day's protein aim.")
    days = _finish_days(days, recipes, target, slots, notes)
    avg = {k: round(sum(d["totals"][k] for d in days) / len(days), 1) for k in NUTRIENTS}
    if protein and avg["protein_g"] < 0.85 * protein:
        notes.append(f"Protein averages about {avg['protein_g']:.0f} g a day against an aim of {protein} g. "
                     "Add a bowl of dal, yogurt, paneer, tofu, eggs or lean meat to a meal or two.")
    condition = conditions[0] if conditions else "everyday"
    note_language = language
    if language and not message:
        message, note_language = engine.FALLBACK_MESSAGES[condition], "English"
    return {
        "target": {"kcal": target, "protein_g": protein, "method": "Mifflin-St Jeor x activity" if target else None,
                   "body": body_check(profile) if not profile.get("pregnant") else None},
        "profile": {"diet": diet, "goal": goal, "goals": goals, "conditions": conditions},
        "days": days,
        "average": avg,
        "shopping_list": _shopping(days, recipes, household),
        "household": household,
        "message_for_parent": message if language else "",
        "language": note_language,
        "tips": tips or engine.FALLBACK_TIPS[condition],
        "notes": notes,
    }, [trace]
