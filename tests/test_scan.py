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
