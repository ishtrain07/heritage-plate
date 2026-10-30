"""Household insights: daily aims in code, no model calls."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _aims(member: dict) -> dict:
    r = client.post("/api/insights", json={"members": [member]})
    assert r.status_code == 200, r.text
    return {a["key"]: a["value"] for a in r.json()["people"][0]["aims"]}


def test_full_profile_gets_calories_and_carbs_per_meal():
    aims = _aims({"name": "Mum", "sex": "female", "age": 54, "height_cm": 160, "weight_kg": 62, "conditions": ["diabetes"]})
    assert aims["kcal"].endswith("kcal") and aims["carbs_meal"] == "30–45 g" and aims["protein"] == "50 g"


def test_blood_pressure_lowers_sodium_and_cholesterol_adds_sat_fat():
    aims = _aims({"name": "Dad", "sex": "male", "age": 67, "conditions": ["bp", "cholesterol"]})
    assert aims["sodium"] == "under 2,000 mg" and "satfat" in aims and aims["kcal"] == "add height & weight"
    assert aims["protein"] == "65 g"  # 1.0 g/kg over 65, ICMR reference weight


def test_children_and_pregnancy_get_no_calorie_cut():
    assert set(_aims({"name": "Kid", "age": 8})) == {"activity"}
    aims = _aims({"name": "Asha", "sex": "female", "age": 30, "height_cm": 160, "weight_kg": 60, "pregnant": True,
                  "goals": ["lose_weight"]})
    assert "kcal" not in aims and aims["protein"] == "66 g"
