"""Parse -> adapt -> plan pipeline.

Live mode calls Nemotron on Token Factory (Nano parses, Super adapts, Ultra plans).
Mock mode uses deterministic rules so the app works without an API key.
Nutrition and the shopping list are always computed in code.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from . import llm, nutrition, prompts
from .guards import OffTopic

CONDITIONS = {
    "diabetes": "type 2 diabetes (focus: carbohydrates that raise blood sugar)",
    "bp": "high blood pressure (focus: sodium from salt and salty sauces)",
    "cholesterol": "high cholesterol (focus: saturated fat from ghee, butter, cream, cheese and fatty meat)",
    "everyday": "no specific condition; the goal is everyday healthier eating (focus: fewer calories from fat, "
                "sugar and refined starch, less salt, more vegetables)",
}
CUISINES = {
    "south_asian": "South Asian (Indian, Pakistani, Bangladeshi, Sri Lankan)",
    "east_asian": "East Asian (Chinese, Korean, Japanese)",
    "southeast_asian": "Southeast Asian (Filipino, Vietnamese, Thai, Malaysian)",
    "continental": "Continental European (Italian, French, British, Eastern European)",
    "middle_eastern": "Middle Eastern and North African",
    "latin_american": "Latin American and Caribbean",
    "other": "home cooking from any tradition",
}
LANGUAGES = (
    "English", "Hindi", "Punjabi", "Gujarati", "Urdu", "Bengali", "Tamil", "Telugu",
    "Mandarin", "Cantonese", "Korean", "Japanese", "Tagalog", "Vietnamese", "Thai",
    "Arabic", "Farsi", "Spanish", "Portuguese", "Italian", "French", "Polish",
)
FOCUS_KEY = {"diabetes": "net_carbs_g", "bp": "sodium_mg", "cholesterol": "sat_fat_g", "everyday": "kcal"}
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
BREAKFAST_HINTS = ("paratha", "poha", "upma", "idli", "dosa", "oats", "oatmeal", "chilla", "cheela", "thepla",
                   "congee", "jook", "porridge", "omelette", "omelet", "pancake", "silog", "huevos", "chilaquiles", "toast")
DESSERT_HINTS = ("kheer", "halwa", "ladoo", "laddu", "barfi", "payasam", "gulab", "jalebi", "flan", "cake",
                 "pudding", "tiramisu", "mochi", "leche", "churro", "baklava", "biko", "pie", "cookie")


@lru_cache
def _facts() -> list[dict]:
    return json.loads((Path(__file__).resolve().parent.parent / "data" / "facts.json").read_text(encoding="utf-8"))


def facts_for(ingredients: list[dict], condition: str, limit: int = 2) -> list[dict]:
    """Up to `limit` checked, sourced facts about ingredients in the dish; never written by the AI.

    Facts relevant to the goal come first, then the most-used ingredient; one fact per ingredient.
    """
    by_weight = sorted(ingredients, key=lambda i: -i["grams"])
    ranked = []
    for fact in _facts():
        hit = next((i["item"] for i in by_weight if i["item"] in fact["items"]), None)
        if hit:
            weight = next(i["grams"] for i in by_weight if i["item"] == hit)
            # Goal-relevant first, then established facts (tier 1) before emerging research (tier 2).
            ranked.append((condition not in fact["goals"], fact.get("tier", 1), -weight, fact, hit))
    out, used = [], set()
    for *_, fact, item in sorted(ranked, key=lambda r: r[:3]):
        if item in used:
            continue
        used.add(item)
        out.append({"id": fact["id"], "item": item, "text": fact["text"].format(item=item.capitalize()),
                    "source": fact["source"], "url": fact["url"]})
        if len(out) == limit:
            break
    return out


def _mock_trace(step: str, tier: str) -> dict:
    return {"step": step, "tier": tier, "model": f"mock (Nemotron {tier.title()} when live)",
            "ms": 0, "tokens": None, "fallback": False, "cached": False}


def normalize_ingredients(raw: object) -> list[dict]:
    """Snap item names to the food table, merge duplicates, clean up grams."""
    out: dict[str, dict] = {}
    for ing in raw if isinstance(raw, list) else []:
        if not isinstance(ing, dict):
            continue
        name = str(ing.get("item", "")).strip()[:60]
        if not name or name.lower() in ("water", "ice", "hot water", "cold water"):  # no nutrition; not "uncounted"
            continue
        try:
            grams = max(0.0, min(float(ing.get("grams") or 0), 5000.0))
        except (TypeError, ValueError):
            grams = 0.0
        if grams <= 0:
            continue
        food = nutrition.match(name)
        key = food.name if food else name.lower()
        if key in out:
            out[key]["grams"] += grams
        else:
            out[key] = {"item": key, "grams": grams, "matched": food is not None}
    for ing in out.values():  # keep within the API's (0, 5000] bounds so recipes round-trip
        grams = min(ing["grams"], 5000.0)
        ing["grams"] = max(0.1, round(grams, 1)) if grams < 10 else round(grams)
    return list(out.values())[:40]


def _servings(value: object, default: int = 4) -> int:
    try:
        return max(1, min(int(float(str(value).split("-")[0])), 20))
    except (TypeError, ValueError):
        return default


def _meal_type(name: str, ingredients: list[dict]) -> str:
    lower = name.lower()
    if any(h in lower for h in DESSERT_HINTS):
        return "dessert"
    if any(h in lower for h in BREAKFAST_HINTS):
        return "breakfast"
    total = sum(i["grams"] for i in ingredients) or 1
    sweet = sum(i["grams"] for i in ingredients if i["item"] in ("sugar", "brown sugar", "jaggery", "honey"))
    return "dessert" if sweet / total > 0.08 else "main"


def clean_steps(raw: object, limit: int = 10) -> list[str]:
    """Keep a short list of non-empty cooking steps."""
    steps = [str(s).strip()[:220] for s in (raw if isinstance(raw, list) else []) if isinstance(s, str | int | float)]
    return [s for s in steps if s][:limit]


def build_recipe(name: str, servings: int, ingredients: list[dict], source_text: str = "", meal: str | None = None,
                 method: object = None) -> dict:
    return {
        "name": name[:80],
        "servings": servings,
        "meal": meal if meal in ("breakfast", "main", "dessert") else _meal_type(name, ingredients),
        "ingredients": ingredients,
        "source_text": source_text[:2000],
        "method": clean_steps(method),
        "nutrition": nutrition.per_serving(ingredients, servings),
        "sources": nutrition.sources_for(ingredients),
    }


# ---------- parse ----------

# Demo-mode quantity reading (live mode: Nemotron Nano with the PARSE prompt's conversions).
UNIT_G = {"g": 1, "gm": 1, "gms": 1, "gram": 1, "grams": 1, "kg": 1000, "ml": 1, "l": 1000, "litre": 1000, "liter": 1000,
          "tbsp": 15, "tablespoon": 15, "tablespoons": 15, "tsp": 5, "teaspoon": 5, "teaspoons": 5,
          "spoon": 10, "spoons": 10, "cup": 150, "cups": 150, "katori": 100, "katoris": 100, "bowl": 100, "bowls": 100,
          "handful": 30, "handfuls": 30, "pinch": 1, "glass": 200, "glasses": 200}
PIECE_G = {"egg": 50, "egg white": 33, "onion": 110, "tomato": 120, "potato": 150, "banana": 100, "apple": 150,
           "garlic": 4, "green chili": 5, "carrot": 60, "orange": 150, "white bread": 30, "whole wheat bread": 30,
           "flour tortilla": 45, "corn tortilla": 25, "plantain": 180, "dates": 8}
BREADS = {"roti": 30, "rotis": 30, "chapati": 30, "chapatis": 30, "phulka": 25, "phulkas": 25, "paratha": 40, "parathas": 40}
WORD_NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "half": 0.5, "ek": 1, "do": 2, "teen": 3}


def _segment_grams(segment: str, food: nutrition.Food, pos: int) -> float:
    """Grams for one food from the amount written in its part of the recipe ("2 eggs", "half katori dal",
    "chicken 300g", "200 ml milk"). Segments are split on commas, so each usually holds one food."""
    before = nutrition.normalize(segment)[:pos].split()[-4:]
    nums = re.findall(r"(\d+(?:\.\d+)?)\s*([a-z]+)?", segment.lower())
    if nums:
        value, unit = nums[0]
        if unit in UNIT_G:
            return float(value) * UNIT_G[unit]
        unit = next((w for w in before if w in UNIT_G), None)
        if unit:
            return float(value) * UNIT_G[unit]
        return float(value) * PIECE_G.get(food.name, food.default_g / 4)
    word = next((w for w in reversed(before) if w in WORD_NUM), None)
    num = WORD_NUM[word] if word else None
    unit = next((w for w in reversed(before) if w in UNIT_G), None)
    # "half" as the number already halves; "thoda"/"little" halve the usual amount.
    half = 0.5 if word != "half" and any(w in ("half", "thoda", "little") for w in before) else 1
    if unit:
        return (num or 1) * UNIT_G[unit] * half
    if num is not None:
        return num * PIECE_G.get(food.name, food.default_g / 4) if word != "half" else food.default_g * 0.5
    return food.default_g * half


def _mock_parse(text: str) -> dict:
    """Demo-mode recipe reader: known foods with their written amounts, unknown items kept as "not counted".

    Live mode does the real reading with Nemotron Nano; this keeps the demo honest without an API key.
    """
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()] or ["My recipe"]
    first = lines[0]
    if ":" in first:
        name, rest = first.split(":", 1)
        body = "\n".join([rest, *lines[1:]])
    elif len(lines) > 1:
        name, body = first, "\n".join(lines[1:])
    else:
        name, body = "My recipe", first
    ingredients = []
    for seg in re.split(r"[,;\n]|\band\b|\baur\b|\by\b", body):
        seg = seg.strip(" .")
        if not seg or re.match(r"(serves|for \d+|makes)\b", seg.lower()):
            continue
        norm = nutrition.normalize(seg)
        bread = next((w for w in BREADS if re.search(rf"\b{w}\b", norm)), None)
        if bread:  # "8 rotis" -> atta (+ fat for parathas)
            count = next((float(n) for n in re.findall(r"\d+(?:\.\d+)?", seg)), None) or 4
            ingredients.append({"item": "whole wheat flour", "grams": count * BREADS[bread]})
            if "paratha" in bread:
                ingredients.append({"item": "ghee", "grams": count * 5})
            continue
        found = nutrition.find_mentions(seg)
        if not found:
            words = [w for w in norm.split() if w not in UNIT_G and w not in WORD_NUM and not w.isdigit()]
            if words and len(words) <= 4:
                ingredients.append({"item": " ".join(words)[:40], "grams": 50})  # shown as "not counted"
            continue
        for food, pos in found:
            ingredients.append({"item": food.name, "grams": max(1.0, _segment_grams(seg, food, pos))})
    servings = re.search(r"serves\s*(\d+)|for\s*(\d+)\s*(people|persons)", text.lower())
    serves = int(next(g for g in servings.groups() if g and g.isdigit())) if servings else 4
    return {"name": name.strip()[:60] or "My recipe", "servings": serves, "ingredients": ingredients}


def parse_recipe(text: str, servings: int | None, cuisine: str) -> tuple[dict, list[dict]]:
    if llm.is_live():
        system = prompts.PARSE.format(cuisine=CUISINES[cuisine], names=", ".join(nutrition.canonical_names()))
        data, trace = llm.chat_json("nano", system, text, step="Read recipe")
    else:
        data, trace = _mock_parse(text), _mock_trace("Read recipe", "nano")
    if data.get("off_topic") is True:
        raise OffTopic("recipe")
    ingredients = normalize_ingredients(data.get("ingredients"))
    serves = servings or _servings(data.get("servings"))
    return build_recipe(str(data.get("name") or "My recipe"), serves, ingredients, text), [trace]


# ---------- adapt ----------

# item -> (keep fraction, vegetable/legume added per gram removed, what, why)
STARCH_SWAPS = {
    "white rice": (0.6, ("cauliflower", 1.5), "Use 40% less rice and mix in riced cauliflower", "Same full plate, far fewer fast carbs."),
    "glutinous rice": (0.65, ("mushrooms", 1.0), "Use a third less sticky rice, add mushrooms", "Sticky rice spikes sugar fast; mushrooms keep it hearty."),
    "pasta": (0.6, ("zucchini", 1.5), "Use 40% less pasta and toss in zucchini ribbons", "Same bowl size with far fewer carbs."),
    "egg noodles": (0.6, ("bean sprouts", 1.5), "Use 40% less noodles, add bean sprouts and greens", "Keeps the slurp, cuts the starch."),
    "rice noodles": (0.6, ("bean sprouts", 1.5), "Use 40% less rice noodles, add bean sprouts", "Rice noodles are almost pure starch."),
    "potato": (0.5, ("cauliflower", 1.0), "Swap half the potato for cauliflower", "Potato is mostly starch; cauliflower keeps the texture."),
    "flattened rice": (0.65, ("green peas", 1.0), "Use a third less poha, more peas", "Lower carbs per bowl, more fibre."),
    "couscous": (0.6, ("chickpeas", 0.5), "Use 40% less couscous, add chickpeas", "Chickpeas add protein and fibre, so sugar rises slower."),
    "cornmeal": (0.7, ("black beans", 0.4), "Use 30% less cornmeal, serve with beans", "Beans slow the sugar rise from corn."),
    "plantain": (0.6, ("green beans", 1.0), "Use 40% less plantain, add green beans", "Plantain is starchy; beans fill the plate."),
    "cassava": (0.6, ("green beans", 1.0), "Use 40% less cassava, add green beans", "Cassava is very starchy."),
}
FULL_SWAPS = {
    "white bread": ("whole wheat bread", "Use whole-wheat bread instead of white", "More fibre, slower sugar rise."),
    "flour tortilla": ("corn tortilla", "Use corn tortillas instead of flour", "Fewer carbs and less fat per tortilla."),
}
SWEETS = ("sugar", "brown sugar", "jaggery", "honey")
SALTY = {
    "salt": (0.6, "Use 40% less salt; finish with lemon or lime", "Sour and fresh flavours hide the missing salt."),
    "soy sauce": (0.5, "Use half the soy sauce, add a splash of vinegar", "Soy sauce is one of the saltiest things in the kitchen."),
    "fish sauce": (0.5, "Use half the fish sauce, add lime", "Fish sauce is very high in sodium."),
    "oyster sauce": (0.5, "Use half the oyster sauce", "Bottled sauces carry most of the salt."),
    "parmesan cheese": (0.6, "Use 40% less parmesan", "Hard cheeses are salty."),
    "cheddar cheese": (0.6, "Use 40% less cheddar", "Cheese adds a lot of sodium."),
    "queso fresco": (0.6, "Use 40% less queso", "Cheese adds a lot of sodium."),
    "bacon": (0.5, "Use half the bacon", "Cured meat is salty and fatty."),
}


MOCK_PORTION_TIPS = {
    "diabetes": "Half the plate vegetables, a quarter this dish's starch, a quarter protein.",
    "bp": "Serve the usual portion; taste before adding any salt or sauce at the table.",
    "cholesterol": "Serve with a big salad or vegetables, and keep cheese and cream as toppings, not fillings.",
    "everyday": "Serve the usual portion with a side of vegetables or salad filling half the plate.",
}


FAT_FACTOR = {"diabetes": 0.7, "bp": 0.75, "cholesterol": 0.5, "everyday": 0.7}


def condition_text(conditions: list[str]) -> str:
    """One condition, or several joined ("type 2 diabetes ... and high blood pressure ...")."""
    return " and ".join(CONDITIONS[c] for c in conditions)


def _mock_adapt_all(recipe: dict, conditions: list[str]) -> dict:
    """Apply each condition's rules in turn; fat is cut once, by the strictest factor."""
    fat = min(FAT_FACTOR[c] for c in conditions)
    data = _mock_adapt(recipe, conditions[0], fat)
    for c in conditions[1:]:
        more = _mock_adapt({**recipe, "ingredients": data["ingredients"]}, c, 1.0)
        seen = {x["what"] for x in data["changes"]}
        data = {**data, "ingredients": more["ingredients"],
                "changes": data["changes"] + [x for x in more["changes"] if x["what"] not in seen and "less ghee" not in x["what"]]}
    return data


def _mock_adapt(recipe: dict, condition: str, fat_factor: float | None = None) -> dict:
    ings = {i["item"]: float(i["grams"]) for i in recipe["ingredients"]}
    changes: list[dict] = []
    is_dessert = recipe.get("meal") == "dessert"

    def scale(item: str, factor: float) -> float:
        before = ings.get(item, 0.0)
        ings[item] = before * factor
        return before - ings[item]

    def add(item: str, grams: float) -> None:
        ings[item] = ings.get(item, 0.0) + grams

    if condition == "diabetes":
        for item, (keep, (veg, ratio), what, why) in STARCH_SWAPS.items():
            if ings.get(item):
                cut = scale(item, keep)
                if is_dessert:
                    changes.append({"what": f"Use {round((1 - keep) * 100)}% less {item} and serve a smaller bowl", "why": "Fewer carbs per serving, same dessert."})
                else:
                    add(veg, cut * ratio)
                    changes.append({"what": what, "why": why})
        for item, (new, what, why) in FULL_SWAPS.items():
            if ings.get(item):
                add(new, ings.pop(item))
                changes.append({"what": what, "why": why})
        if ings.get("whole wheat flour"):
            original = ings["whole wheat flour"]
            scale("whole wheat flour", 0.6)
            add("gram flour", original * 0.25)
            changes.append({"what": "Make the dough 70% atta + 30% besan, one roti less each", "why": "Besan adds protein and fibre, so sugar rises more slowly."})
        if ings.get("all-purpose flour"):
            moved = scale("all-purpose flour", 0.5)
            add("whole wheat flour", moved * 0.8)
            changes.append({"what": "Swap half the white flour for whole-wheat, use a little less", "why": "More fibre, slower sugar rise."})
        for sweet in SWEETS:
            if ings.get(sweet):
                scale(sweet, 0.4)
                changes.append({"what": f"Use 60% less {sweet}", "why": "Every sweetener (sugar, jaggery, honey) raises blood sugar."})
    if condition == "everyday":
        for item, (_keep, (veg, ratio), _what, _why) in STARCH_SWAPS.items():
            if ings.get(item) and not is_dessert:
                add(veg, scale(item, 0.8) * ratio)
                changes.append({"what": f"Use a fifth less {item} and add {veg}", "why": "Same full plate, fewer calories."})
        for sweet in SWEETS:
            if ings.get(sweet):
                scale(sweet, 0.7)
                changes.append({"what": f"Use 30% less {sweet}", "why": "Most desserts taste just as good a little less sweet."})
    if condition in ("bp", "everyday"):
        for item, (keep, what, why) in SALTY.items():
            if ings.get(item):
                scale(item, keep)
                changes.append({"what": what, "why": why})
    if condition == "cholesterol":
        if ings.get("heavy cream"):
            moved = scale("heavy cream", 0.4)
            add("yogurt", moved)
            changes.append({"what": "Replace most of the cream with yogurt", "why": "Cream is mostly saturated fat; yogurt keeps it creamy."})
        for meat, extra in (("ground beef", "mushrooms"), ("pork", "mushrooms"), ("lamb", "chickpeas"), ("bacon", "mushrooms")):
            if ings.get(meat):
                moved = scale(meat, 0.6)
                add(extra, moved * (1.0 if extra == "mushrooms" else 0.5))
                changes.append({"what": f"Use 40% less {meat}, bulk it up with {extra}", "why": "Less saturated fat, same hearty dish."})
        if ings.get("coconut milk"):
            moved = scale("coconut milk", 0.5)
            add("yogurt", moved * 0.5)
            changes.append({"what": "Use half the coconut milk; thicken with a little yogurt", "why": "Coconut milk is very high in saturated fat."})
        for cheese in ("cheddar cheese", "mozzarella cheese", "parmesan cheese", "queso fresco", "paneer"):
            if ings.get(cheese):
                scale(cheese, 0.7)
                changes.append({"what": f"Use 30% less {cheese}", "why": "Cheese is a big source of saturated fat."})
    fat_factor = fat_factor or FAT_FACTOR[condition]
    fats = [f for f in ("ghee", "butter", "coconut oil", "vegetable oil", "olive oil", "mustard oil", "groundnut oil", "canola oil") if ings.get(f)]
    for fat in fats:
        scale(fat, fat_factor)
    if fats and fat_factor < 1:
        changes.append({"what": f"Use {round((1 - fat_factor) * 100)}% less ghee, butter or oil", "why": "Measure with a spoon; add the flavourful fat at the end."})

    return {
        "ingredients": [{"item": k, "grams": v} for k, v in ings.items()],
        "changes": changes[:5] or [{"what": "Keep it as is, watch the portion", "why": "This dish already fits well."}],
        "cooking_tip": "Fill half the plate with vegetables or salad first, then the dish.",
        # Demo dishes carry a hand-written method; mock mode reuses it with the changes listed above.
        "method": recipe.get("method") or [],
        "portion_tip": MOCK_PORTION_TIPS[condition],
    }


AVOID_WORDS = ("hate", "dislike", "don't like", "dont like", "doesn't like", "doesnt like", "no ", "without",
               "avoid", "allerg", "can't eat", "cant eat", "skip", "instead of")
SWAP_VEG = ("zucchini", "green beans", "mushrooms", "bell pepper")
AROMATICS = {"onion", "garlic", "ginger", "green chili", "spring onion", "lemongrass"}


def _mock_request(data: dict, request: str) -> dict:
    """Stacked asks ("no ghee; less spicy") are handled one after another."""
    parts = [p.strip() for p in request.split(";") if p.strip()]
    if len(parts) > 1:
        asked: list[dict] = []
        for part in parts:
            data = _mock_request_one(data, part)
            asked.append(data["changes"][0])
        rest = [c for c in data["changes"] if c not in asked]
        return {**data, "changes": (asked + rest)[:5]}
    return _mock_request_one(data, request)


def _mock_request_one(data: dict, request: str) -> dict:
    """Demo-mode stand-in for "Ask about this dish": leave ingredients out or tone down chilli.

    Live mode lets Nemotron Super handle any request.
    """
    lower = request.lower()
    ings = {i["item"]: float(i["grams"]) for i in data["ingredients"]}
    # Only foods named after an avoid word count: "Dad loves chicken, no ghee" keeps the chicken.
    avoid_at = re.search(r"\b(" + "|".join(re.escape(nutrition.normalize(w)) + (r"\b" if len(w.strip()) <= 3 else "")
                                          for w in AVOID_WORDS) + r")", nutrition.normalize(request))
    first = avoid_at.start() if avoid_at else -1
    named = [food.name for food, pos in nutrition.find_mentions(request) if food.name in ings and first != -1 and pos >= first]
    changes = list(data["changes"])
    asked: list[dict] = []
    if named:
        for item in named:
            grams = ings.pop(item)
            food = nutrition.match(item)
            alt = next((v for v in SWAP_VEG if v not in ings), None)
            if alt and food and food.category == "vegetable" and item not in AROMATICS:
                ings[alt] = grams
                asked.append({"what": f"No {item}: used {alt} instead", "why": "As you asked; it keeps the plate just as full."})
            else:
                asked.append({"what": f"Left out the {item}", "why": "As you asked."})
            changes = [c for c in changes if item not in c["what"]]
    elif "spic" in lower or "chil" in lower or "mild" in lower:
        hot = [k for k in ings if k in ("green chili", "chili powder", "spices")]
        for k in hot:
            ings[k] *= 0.5
        asked.append({"what": "Halved the chilli" if hot else "Kept it mild",
                      "why": "Add more at the table for anyone who wants heat."})
    else:
        asked.append({"what": f"Noted: \u201c{request[:80]}\u201d", "why": "Adjust to taste; the lighter changes below still apply."})
    return {**data, "ingredients": [{"item": k, "grams": v} for k, v in ings.items()], "changes": (asked + changes)[:5]}


def adapt_recipe(recipe: dict, condition: str, cuisine: str, request: str = "", also: list[str] | None = None) -> tuple[dict, list[dict]]:
    """Adapt a dish for one condition, or several (`also`): the first one sets the headline number."""
    conditions = [condition, *[c for c in (also or []) if c != condition and c != "everyday"]][:3]
    # Recompute the "before" numbers server-side; never trust client nutrition.
    before = nutrition.per_serving(recipe["ingredients"], recipe["servings"])
    if llm.is_live():
        system = prompts.ADAPT.format(condition=condition_text(conditions), cuisine=CUISINES[cuisine],
                                      names=", ".join(nutrition.canonical_names()))
        payload = {k: recipe[k] for k in ("name", "servings", "ingredients", "source_text", "method")}
        if request:
            payload["request"] = request
        user = json.dumps(payload)
        data, trace = llm.chat_json("super", system, user, step="Adapt dish", max_tokens=2500)
    else:
        data, trace = _mock_adapt_all({**recipe, "nutrition": before}, conditions), _mock_trace("Adapt dish", "super")
        if request:
            data = _mock_request(data, request)

    if request and data.get("request_off_topic") is True:
        raise OffTopic("ask")
    ingredients = normalize_ingredients(data.get("ingredients"))
    if not ingredients:  # unusable reply: keep the dish and don't show changes that weren't applied
        ingredients, data = recipe["ingredients"], {}
    after = nutrition.per_serving(ingredients, recipe["servings"])
    # If the model introduced ingredients we can't count, the comparison would flatter it.
    new_unknowns = sorted(set(after["uncounted"]) - set(before["uncounted"]))
    raw_changes = data.get("changes")
    changes = [
        {"what": str(c.get("what") or "")[:200], "why": str(c.get("why") or "")[:240]}
        for c in (raw_changes if isinstance(raw_changes, list) else []) if isinstance(c, dict) and c.get("what")
    ][:5]
    adapted = {
        **recipe,
        "ingredients": ingredients,
        "nutrition": after,
        "sources": nutrition.sources_for(ingredients),
        "changes": changes,
        "cooking_tip": str(data.get("cooking_tip") or "")[:240],
        "method": clean_steps(data.get("method")) or recipe.get("method") or [],
        "portion_tip": str(data.get("portion_tip") or "")[:200],
        "facts": facts_for(ingredients, condition),
        "request": request,
        "original": {"ingredients": recipe["ingredients"], "nutrition": before},
        "delta": {k: round(after[k] - before[k], 1) for k in ("net_carbs_g", "sat_fat_g", "fat_g", "sodium_mg", "kcal")},
        "focus": FOCUS_KEY[condition],
        "comparable": not new_unknowns,
        "condition": condition,
        "conditions": conditions,
    }
    return adapted, [trace]


# ---------- suggest a new dish ----------

def _mock_suggest(wish: str, diet: str, avoid: set[str], servings: int) -> dict:
    """Demo mode: the library meal that best matches the wish, scaled to the family."""
    from . import dietitian

    wanted = {f.name for f, _ in nutrition.find_mentions(wish)}
    lower = wish.lower()
    slot = "breakfast" if "breakfast" in lower else "snack" if "snack" in lower else "lunch"
    pool = [m for m in dietitian.meal_library() if slot in m["slots"]
            and dietitian.allowed([i["item"] for i in m["ingredients"]], diet, avoid)] or dietitian.meal_library()
    best = max(pool, key=lambda m: len(wanted & {i["item"] for i in m["ingredients"]}))
    return {"name": best["name"], "meal": "breakfast" if slot == "breakfast" else "main",
            "ingredients": [{"item": i["item"], "grams": i["grams"] * servings} for i in best["ingredients"]],
            "method": [best["how"]], "portion_tip": "One portion per person, with a side of salad or vegetables.",
            "why": "Built from everyday ingredients with plenty of vegetables and pulses."}


def suggest_dish(wish: str, conditions: list[str], cuisine: str, diet: str, dislikes: str, servings: int) -> tuple[dict, list[dict]]:
    """A new dish written for the person (Nemotron Super); nutrition from the food tables, diet rules enforced."""
    from . import dietitian

    avoid, _ = dietitian.avoid_items(dislikes)
    conditions = conditions or ["everyday"]
    if llm.is_live():
        system = prompts.SUGGEST.format(cuisine=CUISINES[cuisine], condition=condition_text(conditions),
                                        diet=dietitian.DIET_LABELS.get(diet, diet), avoid=dislikes or "nothing",
                                        names=", ".join(nutrition.canonical_names()), servings=servings)
        data, trace = llm.chat_json("super", system, wish, step="Suggest a dish", max_tokens=2500)
    else:
        data, trace = _mock_suggest(wish, diet, avoid, servings), _mock_trace("Suggest a dish", "super")
    if data.get("off_topic") is True:
        raise OffTopic("wish")
    ingredients = normalize_ingredients(data.get("ingredients"))
    if not ingredients or not dietitian.allowed([i["item"] for i in ingredients], diet, avoid):
        raise llm.LLMError("Suggest a dish: the suggestion didn't fit the diet; try rephrasing")
    meal = data.get("meal") if data.get("meal") in ("breakfast", "main", "dessert") else None
    recipe = build_recipe(str(data.get("name") or "Suggested dish"), servings, ingredients, wish, meal, data.get("method"))
    condition = conditions[0]
    zero = dict.fromkeys(("net_carbs_g", "sat_fat_g", "fat_g", "sodium_mg", "kcal"), 0.0)
    return {
        **recipe,
        "suggested": True,
        "why": str(data.get("why") or "")[:240],
        "changes": [],
        "cooking_tip": "",
        "portion_tip": str(data.get("portion_tip") or "")[:200],
        "facts": facts_for(ingredients, condition),
        "request": "",
        "original": {"ingredients": ingredients, "nutrition": recipe["nutrition"]},
        "delta": zero,
        "focus": FOCUS_KEY[condition],
        "comparable": True,
        "condition": condition,
        "conditions": conditions,
    }, [trace]


# ---------- plan ----------

def _mock_schedule(recipes: list[dict], focus: str = "net_carbs_g", week: int = 1) -> list[dict]:
    ids = {m: [i for i, r in enumerate(recipes) if r["meal"] == m] for m in ("breakfast", "main", "dessert")}
    mains = ids["main"] or [i for i, r in enumerate(recipes) if r["meal"] != "dessert"] or list(range(len(recipes)))
    # With fewer than 3 breakfast dishes, mix in the lightest mains so the week isn't one breakfast on repeat.
    lightest = sorted(mains, key=lambda i: recipes[i]["nutrition"][focus])
    breakfasts = ids["breakfast"] + [i for i in lightest if i not in ids["breakfast"]][: max(0, 3 - len(ids["breakfast"]))]
    breakfasts = breakfasts or mains
    if len(ids["breakfast"]) == 1 and len(breakfasts) > 1:  # keep the real breakfast every other day
        breakfasts = [b for pair in zip([ids["breakfast"][0]] * (len(breakfasts) - 1), breakfasts[1:], strict=True) for b in pair]
    # Dinner rotates from the dish lowest in the condition's focus nutrient.
    dinners = sorted(mains, key=lambda i: recipes[i]["nutrition"][focus])
    days = []
    shift = week - 1  # later weeks start the rotation further along
    for d, day in enumerate(DAYS):
        lunch = mains[(d + shift) % len(mains)]
        dinner = dinners[(d + 2 * shift) % len(dinners)]
        if dinner == lunch and len(mains) > 1:
            dinner = dinners[(d + 2 * shift + 1) % len(dinners)]
        dessert = ids["dessert"][0] if ids["dessert"] and day in ("Sat", "Sun") else None
        days.append({"day": day, "breakfast": breakfasts[(d + shift) % len(breakfasts)], "lunch": lunch, "dinner": dinner, "dessert": dessert})
    return days


def _valid_schedule(days: object, recipes: list[dict]) -> list[dict] | None:
    """Accept the model's week only if it follows the rules; otherwise use ours."""
    n = len(recipes)
    if not isinstance(days, list) or len(days) != 7:
        return None
    mains = sum(1 for r in recipes if r["meal"] != "dessert")
    clean, desserts = [], 0
    meal_slots = ("breakfast", "lunch", "dinner")
    for i, day in enumerate(days):
        if not isinstance(day, dict):
            return None
        slots: dict[str, int | None] = {}
        for slot in ("breakfast", "lunch", "dinner", "dessert"):
            val = day.get(slot)
            if val is None and slot == "dessert":
                slots[slot] = None
                continue
            if type(val) is not int or not 0 <= val < n:
                return None
            slots[slot] = val
        if slots["dessert"] is not None:
            desserts += 1
            if recipes[slots["dessert"]]["meal"] != "dessert":
                return None
        if mains and any(recipes[slots[s]]["meal"] == "dessert" for s in meal_slots):
            return None
        if mains > 1 and slots["lunch"] == slots["dinner"]:
            return None
        clean.append({"day": DAYS[i], **slots})
    return clean if desserts <= 2 else None


def shopping_list(recipes: list[dict], days: list[dict]) -> list[dict]:
    """Each planned slot cooks one batch of that recipe; sum the grams."""
    need: dict[str, float] = {}
    for day in days:
        for slot in ("breakfast", "lunch", "dinner", "dessert"):
            idx = day.get(slot)
            if idx is None:
                continue
            for ing in recipes[idx]["ingredients"]:
                need[ing["item"]] = need.get(ing["item"], 0) + ing["grams"]
    items = []
    for item, grams in need.items():
        food = nutrition.match(item)
        step = 50 if grams >= 50 else 5
        items.append({"item": item, "grams": max(step, int(round(grams / step) * step)), "category": food.category if food else "other"})
    order = ["grain", "legume", "vegetable", "fruit", "dairy", "protein", "fat", "nuts", "sauce", "sweetener", "spice", "other"]
    return sorted(items, key=lambda i: (order.index(i["category"]) if i["category"] in order else 99, i["item"]))


FALLBACK_MESSAGES = {
    "everyday": "All your favourite dishes are still on the menu, just a little lighter, with more vegetables and less oil, salt and sugar. Enjoy every meal.",
    "diabetes": "We kept your favourite dishes on the menu. They're just lighter now, with smaller starch portions and more vegetables. Eat slowly, take a short walk after dinner, and enjoy your treat on the weekend.",
    "bp": "Your favourite dishes are all still here, just with less salt and lighter sauces. Taste before adding salt, use lemon and herbs for flavour, and drink water through the day.",
    "cholesterol": "Your favourite dishes are still on the menu, with less ghee, butter, cream and fatty meat. Small changes every day add up. Keep walking and enjoy your food.",
}
FALLBACK_TIPS = {
    "everyday": ["Fill half the plate with vegetables first.", "Measure oil with a spoon, don't pour.", "Taste before adding salt."],
    "diabetes": ["Measure rice, noodles and roti with the same bowl every time.", "Walk 10 minutes after the biggest meal.", "Keep roasted chickpeas or nuts for snacks."],
    "bp": ["Taste first, then salt.", "Check labels on sauces and stock cubes for sodium.", "Add herbs, garlic, lemon and vinegar for flavour."],
    "cholesterol": ["Measure oil with a spoon, don't pour.", "Choose lean cuts and trim visible fat.", "Add a bowl of beans or lentils a few times a week."],
}


def make_plan(recipes: list[dict], condition: str, language: str, week: int = 1) -> tuple[dict, list[dict]]:
    """language "" means there's no one to write a note to: the plan comes back without one."""
    days, message, tips = None, "", []
    wants_note = bool(language)
    language = language or "English"
    message_language = language if wants_note else ""
    if llm.is_live():
        system = prompts.PLAN.format(condition=CONDITIONS[condition], language=language)
        if week > 1:
            system += f"\nThis is week {week} of using the same dishes: change the order from a typical week so it feels fresh."
        focus = FOCUS_KEY[condition]
        menu = [{"id": i, "name": r["name"], "meal": r["meal"], focus: r["nutrition"][focus]} for i, r in enumerate(recipes)]
        data, trace = llm.chat_json("ultra", system, json.dumps(menu), step="Plan the week", max_tokens=8000)
        trace = {**trace}  # don't mutate the cached copy
        days = _valid_schedule(data.get("days"), recipes)
        message = str(data.get("message_for_parent", ""))[:800]
        raw_tips = data.get("tips")
        tips = [str(t)[:200] for t in raw_tips][:3] if isinstance(raw_tips, list) else []
        trace["schedule_valid"] = days is not None
    else:
        trace = _mock_trace("Plan the week", "ultra")
    if days is None:
        days = _mock_schedule(recipes, FOCUS_KEY[condition], week)
    if not wants_note:
        message = ""
    elif not message:
        message = FALLBACK_MESSAGES[condition]
        if language != "English":
            message_language = f"English (written in {language} when live)"
    tips = tips or FALLBACK_TIPS[condition]

    named_days = [
        {"day": d["day"], **{s: (recipes[d[s]]["name"] if d[s] is not None else None) for s in ("breakfast", "lunch", "dinner", "dessert")}}
        for d in days
    ]
    return {
        "days": named_days,
        "shopping_list": shopping_list(recipes, days),
        "message_for_parent": message,
        "language": message_language,
        "tips": tips,
    }, [trace]
