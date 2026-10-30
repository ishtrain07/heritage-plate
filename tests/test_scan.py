"""Scan & check: label photo or text, checked per person in code (mock mode, no model calls)."""

import pytest
from fastapi.testclient import TestClient

from app import scan
from app.main import app

client = TestClient(app)
BISCUIT = ("CHOCO CREAM BISCUITS\n\nINGREDIENTS: Refined wheat flour (maida), sugar, palm oil, milk solids,\n"
           "hazelnut paste, emulsifier (soy lecithin), salt.\nMay contain traces of peanuts.\n\n"
           "NUTRITION per 100 g: Energy 490 kcal, Sugars 34 g, Sodium 320 mg")


@pytest.fixture(autouse=True)
def mock_mode(monkeypatch):
    monkeypatch.setenv("MOCK", "1")


def _photo() -> str:  # a 1x1 PNG
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _verdicts(text: str, members: list[dict]) -> dict:
    r = client.post("/api/scan", json={"text": text, "members": members})
    assert r.status_code == 200, r.text
    return {p["name"]: p["verdict"] for p in r.json()["result"]["people"]}


def test_photo_is_read_then_checked():
    r = client.post("/api/scan", json={"image": _photo(), "members": [{"name": "Riya", "allergies": "milk"}]})
    assert r.status_code == 200
    assert "Ingredients" in r.json()["read"]
    assert r.json()["result"]["people"][0]["verdict"] == "avoid"


def test_each_person_gets_their_own_verdict():
    got = _verdicts(BISCUIT, [{"name": "Mum", "conditions": ["diabetes"]}, {"name": "Riya", "allergies": "tree nuts"},
                              {"name": "Sam", "diet": "vegan"}, {"name": "Dev", "diet": "jain"},
                              {"name": "Arjun", "allergies": "peanuts"}, {"name": "Lee", "allergies": "gluten"}])
    assert got == {"Mum": "sometimes", "Riya": "avoid", "Sam": "avoid", "Dev": "fine", "Arjun": "avoid", "Lee": "avoid"}


def test_product_name_and_nutrition_table_are_not_ingredients():
    parts = scan.ingredient_parts(BISCUIT)
    assert not any("cream biscuits" in p or "nutrition" in p for p in parts)
    assert _verdicts("Ingredients: oats, salt.\nNutrition per 100 g: sugars 1 g", [{"name": "A", "allergies": "nuts"}]) == {"A": "fine"}


def test_plant_milks_are_not_dairy():
    assert _verdicts("Ingredients: coconut milk, rice, salt", [{"name": "A", "allergies": "milk"}]) == {"A": "fine"}


def test_high_salt_flags_blood_pressure():
    flags = scan.nutrition_flags("Per 100 g: salt 2.5 g")
    assert flags["high_salt"] and flags["sodium_mg"] == 1000


def test_skin_product_uses_the_care_label_check():
    r = client.post("/api/scan", json={"text": "Aqua, Clobetasol propionate, Parfum", "members": [{"name": "Mum", "pregnant": True}]})
    res = r.json()["result"]
    assert res["kind"] == "personal_care" and res["danger"] and res["people"][0]["verdict"] == "avoid"


def test_bad_inputs_are_friendly_422s():
    assert client.post("/api/scan", json={}).status_code == 422
    assert client.post("/api/scan", json={"image": "data:text/html;base64,PGI+"}).status_code == 422
    assert client.post("/api/scan", json={"text": "I want to kill myself"}).json()["detail"]["code"] == "support"


# ---- review findings: allergies must never come back "fine" on ordinary labels ----
@pytest.mark.parametrize("allergy,label", [
    ("nuts", "Ingredients: water, almond milk, sugar"),
    ("tree nuts", "Ingredients: almond milk, oats"),
    ("cashews", "Ingredients: cashew butter, salt"),
    ("soya", "Ingredients: soya milk, sugar"),
    ("soya", "Ingredients: cocoa, emulsifier (soy lecithin)"),
    ("oat", "Ingredients: oat milk, salt"),
    ("pea", "Ingredients: pea protein, rice"),
    ("coeliac", "Ingredients: wheat flour, salt"),
    ("seafood", "Ingredients: rice noodles, fish sauce"),
    ("milk", "Ingredients: buttermilk powder, salt"),
    ("milk", "Ingredients: wheat flour, sodium caseinate"),
    ("moongphali", "Ingredients: rice, groundnut oil"),
    ("मूंगफली", "Ingredients: rice, groundnut oil"),
    ("milk", "Ingredients: wheat flour, sugar\nAllergens: Milk, Soy"),
    ("milk", "Ingredients:\n\nWheat flour, milk solids"),
    ("milk", "INGREDIENTS (allergens in bold): Wheat flour, MILK powder"),
    ("milk", "Ingredients: fruit (35 g per 100 g), milk protein"),
])
def test_allergy_is_caught(allergy, label):
    assert _verdicts(label, [{"name": "A", "allergies": allergy}]) == {"A": "avoid"}


def test_milk_allergy_is_fine_with_plant_milk_and_free_from():
    assert _verdicts("Ingredients: coconut milk, rice", [{"name": "A", "allergies": "milk"}]) == {"A": "fine"}
    assert _verdicts("Ingredients: rice, salt. Free from: milk", [{"name": "A", "allergies": "milk"}]) == {"A": "fine"}


def test_unknown_allergy_note_says_check_not_fine():
    assert _verdicts("Ingredients: rice, salt", [{"name": "A", "allergies": "quinine"}]) == {"A": "check"}


def test_allergy_checked_even_on_skin_products():
    r = client.post("/api/scan", json={"text": "Aqua, Glycerin, Niacinamide, Prunus Amygdalus Dulcis (Sweet Almond) Oil",
                                       "members": [{"name": "A", "allergies": "almonds"}]})
    assert r.json()["result"]["people"][0]["verdict"] == "avoid"


def test_vegan_and_vegetarian_catch_hidden_animal_ingredients():
    got = _verdicts("Ingredients: oats, honey, gelatine", [{"name": "V", "diet": "vegan"}, {"name": "J", "diet": "jain"},
                                                         {"name": "Veg", "diet": "vegetarian"}])
    assert got == {"V": "avoid", "J": "avoid", "Veg": "avoid"}
    assert _verdicts("Ingredients: oats, sugar. May contain milk.", [{"name": "V", "diet": "vegan"}]) == {"V": "fine"}


def test_drinks_and_per_serving_tables():
    assert scan.nutrition_flags("Per 100 ml: sugars 10.6 g")["high_sugar"] is False
    assert scan.nutrition_flags("Per 100 ml: sugars 12 g")["high_sugar"] is True
    assert scan.nutrition_flags("Per serving (30 g): sodium 400 mg")["basis"] == "serving"
    assert scan.nutrition_flags("Per 100 g: sodium 1.2 g")["sodium_mg"] == 1200


def test_label_warnings_are_not_crisis_signals():
    r = client.post("/api/scan", json={"text": "Ingredients: sodium fluoride, sorbitol. Do not swallow, call poison centre."})
    assert r.status_code == 200


@pytest.mark.parametrize("allergy,label", [
    ("egg", "Ingredients: pasteurised free range egg, flour"),
    ("milk", "Ingredients: sugar-free chocolate (cocoa, milk solids)"),
    ("milk", "Ingredients: rice. Allergy advice: Contains milk. Made in a nut-free kitchen"),
    ("oat", "Ingredients: gluten-free oats, honey"),
    ("soy", "Ingredients: soybean oil, salt"),
    ("nuts", "Ingredients: cashewnuts, sugar"),
    ("milk", "Ingredients: milkfat, sugar"),
    ("corn", "Ingredients: cornflour, water"),
    ("moongfali", "Ingredients: peanuts, jaggery"),
])
def test_allergy_is_caught_in_compounds_and_free_phrases(allergy, label):
    assert _verdicts(label, [{"name": "A", "allergies": allergy}]) == {"A": "avoid"}


def test_free_from_and_lookalikes_stay_fine():
    for allergy, label in [("milk", "Ingredients: rice. Free from milk"), ("milk", "Ingredients: mango butter, shea butter"),
                           ("nuts", "Ingredients: nutmeg, sugar"), ("milk", "Ingredients: maltodextrin, salt")]:
        assert _verdicts(label, [{"name": "A", "allergies": allergy}]) == {"A": "fine"}, label


def test_danger_and_diet_hold_whatever_the_model_says(monkeypatch):
    monkeypatch.setattr(scan.llm, "is_live", lambda: True)
    monkeypatch.setattr(scan.llm, "chat_json", lambda *a, **k: ({"kind": "food", "product": "Cream", "summary": "Safe for everyone."}, {}))
    r = client.post("/api/scan", json={"text": "Aqua, Mercury, Hydroquinone 4%", "members": [{"name": "A"}]}).json()["result"]
    assert r["danger"] and r["people"][0]["verdict"] == "avoid" and r["summary"] == ""
    monkeypatch.setattr(scan.llm, "chat_json", lambda *a, **k: ({"kind": "personal_care", "product": "X"}, {}))
    r = client.post("/api/scan", json={"text": "Ingredients: sugar, gelatin, pork fat", "members": [{"name": "V", "diet": "vegetarian"}]})
    assert r.json()["result"]["people"][0]["verdict"] == "avoid"


def test_sugar_is_read_from_the_table_not_the_ingredients():
    assert scan.nutrition_flags("Ingredients: sugar, oats. Nutrition per 100 g: Sugars 30 g")["sugar_g"] == 30
    assert scan.nutrition_flags("Nutrition per 100 g: Sodium (mg) 900")["sodium_mg"] == 900
