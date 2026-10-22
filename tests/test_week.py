import pytest
from fastapi.testclient import TestClient

from app import dietitian, llm
from app.main import app


@pytest.fixture(autouse=True)
def mock_mode(monkeypatch):
    monkeypatch.setenv("MOCK", "1")


@pytest.fixture
def client():
    return TestClient(app)


PROFILE = {"diet": "vegetarian", "conditions": ["diabetes"], "goal": "lose_weight", "dislikes": "mushrooms",
           "sex": "female", "age": 58, "height_cm": 160, "weight_kg": 72, "activity": "light"}


def test_calorie_target_uses_mifflin_st_jeor_with_a_safe_deficit():
    kcal, protein, _ = dietitian.calorie_target(PROFILE)
    # BMR 1269 x 1.375 = 1745, minus 500 -> 1245, rounded to 10.
    assert kcal == 1240 and protein == 86
    kcal, _, notes = dietitian.calorie_target({**PROFILE, "weight_kg": 45, "height_cm": 150, "age": 80})
    assert kcal == 1200 and any("safe minimum" in n for n in notes)


def test_belly_fat_is_explained_and_missing_body_data_means_no_target():
    kcal, _, notes = dietitian.calorie_target({"goal": "belly_fat"})
    assert kcal is None and any("one spot" in n for n in notes) and any("Add age" in n for n in notes)


def test_week_hits_target_respects_diet_and_varies(client):
    recipes = client.get("/api/demo/rossi").json()["recipes"]  # lasagne and carbonara have meat
    w = client.post("/api/week", json={"recipes": recipes, "profile": PROFILE, "household": 2}).json()["week"]
    assert len(w["days"]) == 7 and all(len(d["meals"]) == 4 for d in w["days"])
    assert all(abs(d["totals"]["kcal"] - 1240) / 1240 < 0.15 for d in w["days"])
    items = {i["item"] for d in w["days"] for m in d["meals"] for i in m.get("ingredients", [])}
    assert not items & (dietitian.MEAT | dietitian.FISH | dietitian.EGG | {"mushrooms"})
    assert any("lasagne" in n for n in w["notes"])
    assert len({m["name"] for d in w["days"] for m in d["meals"]}) >= 10
    assert w["message_for_parent"] == "" and w["shopping_list"]


def test_week_works_without_any_family_dishes(client):
    w = client.post("/api/week", json={"profile": {"diet": "vegan", "goal": "maintain"}}).json()["week"]
    items = {i["item"] for d in w["days"] for m in d["meals"] for i in m.get("ingredients", [])}
    assert w["target"]["kcal"] is None and not items & dietitian.EXCLUDES["vegan"]


def test_model_meals_that_break_the_rules_are_replaced():
    recipes = []
    raw = [{"day": "Mon", "meals": [
        {"slot": "breakfast", "dish_id": None, "name": "Bacon toast", "ingredients": [{"item": "bacon", "grams": 50}]},
        {"slot": "lunch", "dish_id": 99, "servings": 1},
        {"slot": "dinner", "dish_id": None, "name": "Mystery stew", "ingredients": [{"item": "unicorn", "grams": 50}]},
    ]}]
    slots = ["breakfast", "lunch", "dinner"]
    pools = dietitian.candidates(slots, "vegetarian", set(), "kcal")
    days, replaced = dietitian._clean_live_week(raw, recipes, [], slots, "vegetarian", set(), pools)
    assert replaced >= 3 and all(m["source"] == "suggested" for m in days[0]["meals"])
    assert "Bacon toast" not in {m["name"] for m in days[0]["meals"]}


def test_a_failed_model_call_falls_back_to_the_meal_library(monkeypatch):
    monkeypatch.setattr(llm, "is_live", lambda: True)

    def boom(*a, **k):
        raise llm.LLMError("Plan the week: timed out")

    monkeypatch.setattr(llm, "chat_json", boom)
    w, trace = dietitian.plan_week([], {"diet": "vegetarian"}, "Hindi")
    assert len(w["days"]) == 7 and "failed" in trace[0]["model"] and w["message_for_parent"]


def test_asian_cutoffs_change_the_healthy_range_and_band():
    p = {"height_cm": 160, "weight_kg": 62}  # BMI 24.2
    assert dietitian.body_check(p)["band"] == "healthy"
    asian = dietitian.body_check({**p, "ethnicity": "south_asian"})
    assert asian["band"] == "overweight" and asian["healthy_range_kg"] == [47, 59] and asian["cutoffs"] == "WHO Asian"


def test_older_adults_lose_more_gently_with_more_protein():
    _, yp, _ = dietitian.calorie_target({**PROFILE, "age": 40})
    old, op, notes = dietitian.calorie_target({**PROFILE, "age": 70})
    # Same body: the over-65 cut is 300 not 500, so the target sits closer to maintenance.
    old_tdee = (10 * 72 + 6.25 * 160 - 5 * 70 - 161) * 1.375
    assert old == round((old_tdee - 300) / 10) * 10 and any("Over 65" in n for n in notes) and op == yp == 86


def test_healthy_weight_gets_a_gentle_deficit_and_pregnancy_none():
    kcal, _, notes = dietitian.calorie_target({**PROFILE, "weight_kg": 55})  # BMI 21.5
    tdee = (10 * 55 + 6.25 * 160 - 5 * 58 - 161) * 1.375
    assert kcal == max(round((tdee - 250) / 10) * 10, 1200) and any("gentle 250" in n for n in notes)
    kcal, _, notes = dietitian.calorie_target({**PROFILE, "pregnant": True})
    assert kcal is None and any("pregnancy" in n for n in notes)


def test_diet_filter_catches_animal_words_outside_the_food_table():
    assert not dietitian.allowed(["chicken stock"], "vegetarian", set())
    assert not dietitian.allowed(["anchovies"], "eggetarian", set())
    assert not dietitian.allowed(["kimchi"], "vegetarian", set())
    assert dietitian.allowed(["vegetable stock"], "vegan", set())
    assert not dietitian.allowed(["paneer"], "vegan", set()) and dietitian.allowed(["paneer"], "vegetarian", set())


def test_allergy_group_words_are_understood_and_unknowns_reported():
    avoid, unknown = dietitian.avoid_items("peanut allergy, no dairy")
    assert {"peanuts", "groundnut oil", "yogurt", "ghee"} <= avoid and not unknown
    avoid, unknown = dietitian.avoid_items("nothing too fancy")
    assert not avoid and unknown


@pytest.mark.parametrize("profile", [
    {**PROFILE, "goal": "build_muscle", "diet": "non_veg"},
    {**PROFILE, "diet": "vegan", "goal": "maintain"},
    PROFILE,
])
def test_every_day_lands_within_10_percent_of_target(client, profile):
    recipes = client.get("/api/demo/gill").json()["recipes"]
    w = client.post("/api/week", json={"recipes": recipes, "profile": profile}).json()["week"]
    target = w["target"]["kcal"]
    assert all(abs(d["totals"]["kcal"] - target) <= 0.1 * target for d in w["days"]), [d["totals"]["kcal"] for d in w["days"]]


def test_live_garbage_does_not_crash():
    pools = dietitian.candidates(["breakfast"], "non_veg", set(), "kcal")
    raw = [{"day": "Mon", "meals": None}, {"meals": [{"slot": "breakfast", "dish_id": 0, "servings": float("nan")}]}]
    recipes = [{"name": "X", "meal": "main", "ingredients": [], "nutrition": {}, "servings": 4}]
    days, _ = dietitian._clean_live_week(raw, recipes, [0], ["breakfast"], "non_veg", set(), pools)
    assert days[1]["meals"][0]["servings"] == 1.0


def test_one_family_dish_is_not_repeated_all_week(client):
    dish = client.get("/api/demo/gill").json()["recipes"][1]
    w = client.post("/api/week", json={"recipes": [dish], "profile": {"diet": "vegetarian"}}).json()["week"]
    assert sum(m["source"] == "family" for d in w["days"] for m in d["meals"]) <= 3
