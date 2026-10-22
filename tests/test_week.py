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
    days, replaced = dietitian._clean_live_week(raw, recipes, [], ["breakfast", "lunch", "dinner"], "vegetarian", set(), "kcal")
    assert replaced >= 3 and all(m["source"] == "suggested" for m in days[0]["meals"])
    assert "Bacon toast" not in {m["name"] for m in days[0]["meals"]}


def test_a_failed_model_call_falls_back_to_the_meal_library(monkeypatch):
    monkeypatch.setattr(llm, "is_live", lambda: True)

    def boom(*a, **k):
        raise llm.LLMError("Plan the week: timed out")

    monkeypatch.setattr(llm, "chat_json", boom)
    w, trace = dietitian.plan_week([], {"diet": "vegetarian"}, "Hindi")
    assert len(w["days"]) == 7 and "failed" in trace[0]["model"] and w["message_for_parent"]
