import pytest
from fastapi.testclient import TestClient

from app import care, llm
from app.main import app


@pytest.fixture(autouse=True)
def mock_mode(monkeypatch):
    monkeypatch.setenv("MOCK", "1")


@pytest.fixture
def client():
    return TestClient(app)


def _live(monkeypatch, reply):
    monkeypatch.setattr(llm, "is_live", lambda: True)
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: (reply, {"step": "x", "tier": "super", "model": "fake", "ms": 1}))


def test_lemon_on_spots_is_stopped_with_sources(client):
    r = client.post("/api/care/remedy", json={"text": "nimbu on dark spots"}).json()["result"]["remedies"][0]
    assert r["verdict"] == "stop" and r["checked"] and any("lime" in s["name"].lower() for s in r["sources"])
    assert {b["id"] for b in r["better"]} <= {a["id"] for a in care.library()["actives"]}


def test_ai_can_only_recommend_checked_ingredients(client, monkeypatch):
    _live(monkeypatch, {"remedies": [{"remedy": "x", "verdict": "keep", "evidence": "some", "why": "w",
                                      "better": ["snake_oil", "niacinamide", "adapalene"]}]})
    r = client.post("/api/care/remedy", json={"text": "rice water on face", "country": "IN"}).json()["result"]["remedies"][0]
    assert [b["id"] for b in r["better"]] == ["niacinamide"]  # unknown dropped; adapalene is Rx in India
    assert any("adapalene" in n for n in r["notes"])


def test_citrus_can_never_be_a_plain_keep(client, monkeypatch):
    _live(monkeypatch, {"remedies": [{"remedy": "lemon juice", "verdict": "keep", "evidence": "some", "why": "w", "better": []}]})
    r = client.post("/api/care/remedy", json={"text": "lemon juice on face daily"}).json()["result"]["remedies"][0]
    assert r["verdict"] == "care" and r["sources"]


def test_pregnancy_blocks_retinoids_even_if_the_model_suggests_them(client, monkeypatch):
    _live(monkeypatch, {"people": [{"index": 0, "pm": [{"active": "retinol", "product": "serum"}],
                                    "am": [{"active": "sunscreen", "product": "sunscreen"}]}]})
    p = client.post("/api/care/plan", json={"members": [{"name": "Mum", "pregnant": True, "concerns": ["dark_spots"]}]}).json()
    steps = [s["active"] for v in p["result"]["people"][0]["routine"].values() for s in v]
    assert "retinol" not in steps and "sunscreen" in steps
    assert any("pregnancy" in n for n in p["result"]["people"][0]["doctor_notes"])


def test_red_flags_and_prescriptions(client):
    members = [{"name": "Dad", "sex": "male", "concerns": ["thinning_hair"], "details": "hair coming out in patches"},
               {"name": "Riya", "concerns": ["acne"], "details": "painful cysts on my chin"}]
    people = client.post("/api/care/plan", json={"members": members, "country": "GB"}).json()["result"]["people"]
    assert people[0]["red_flags"] and people[1]["red_flags"]
    assert any("finasteride" in n for n in people[0]["doctor_notes"])  # Rx: ask, never a buy
    assert all(s["active"] != "finasteride" for v in people[0]["routine"].values() for s in v)


def test_finasteride_is_never_for_women_and_allergies_are_respected(client):
    p = client.post("/api/care/plan", json={"members": [{"name": "Nani", "sex": "female", "concerns": ["thinning_hair", "dry"],
                                                        "allergies": "shea butter"}]}).json()["result"]["people"][0]
    notes = " ".join(p["doctor_notes"])
    used = {s["active"] for v in p["routine"].values() for s in v}
    assert "finasteride" not in notes and "shea_butter" not in used


def test_hair_only_routine_has_no_sunscreen_and_shopping_is_combined(client):
    members = [{"name": "Dad", "concerns": ["dandruff"]}, {"name": "Mum", "concerns": ["dry"]}]
    r = client.post("/api/care/plan", json={"members": members, "language": "Hindi"}).json()["result"]
    dad = {s["active"] for v in r["people"][0]["routine"].values() for s in v}
    assert "sunscreen" not in dad and r["note_for_family"]
    assert {s["name"] for s in r["shopping"]} >= {"Ketoconazole shampoo", "Broad-spectrum sunscreen"}


def test_label_check_finds_actives_irritants_and_pregnancy_warnings(client):
    text = "Aqua, Glycerin, Niacinamide, Parfum, Alcohol Denat., Retinol"
    r = client.post("/api/care/label", json={"text": text, "member": {"pregnant": True, "concerns": ["oily", "sensitive"]}}).json()["result"]
    assert [a["name"] for a in r["actives"]][:2] == ["Glycerin", "Niacinamide (vitamin B3)"]
    assert {i["name"] for i in r["irritants"]} == {"Fragrance", "Drying alcohol"}
    assert any("retinol" in w for w in r["warnings"]) and "Niacinamide (vitamin B3)" in r["fits"]


def test_label_input_is_bounded_and_odd_text_is_safe(client):
    assert client.post("/api/care/label", json={"text": "x" * 3001}).status_code == 422
    r = client.post("/api/care/label", json={"text": "<script>alert(1)</script>, ;; ,"}).json()["result"]
    assert r["actives"] == [] and r["irritants"] == []


def test_every_active_cites_known_sources_and_valid_fields():
    lib = care.library()
    for a in lib["actives"]:
        assert a["sources"] and all(s in lib["sources"] for s in a["sources"]), a["id"]
        assert a["grade"] in "ABC" and a["pregnancy"] in ("ok", "ask", "avoid") and set(a["concerns"]) <= set(lib["concerns"])
