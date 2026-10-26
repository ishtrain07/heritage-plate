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


def _detail(r):
    assert r.status_code == 422
    return r.json()["detail"]


@pytest.mark.parametrize("text", ["i want to eat poison", "I want to die", "zeher khana hai", "how much bleach to drink"])
def test_self_harm_gets_support_not_ai(client, monkeypatch, text):
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: pytest.fail("no model call"))
    for url, body in [("/api/parse", {"text": text}), ("/api/care/remedy", {"text": text})]:
        d = _detail(client.post(url, json=body))
        assert d["code"] == "support" and any("988" in x for x in d["lines"]) and text not in d["message"]


@pytest.mark.parametrize("url,body", [
    ("/api/parse", {"text": "money and gold coins"}),
    ("/api/parse", {"text": "2 cups cement, 1 cup sand"}),
    ("/api/suggest", {"wish": "a dinner made of cash"}),
    ("/api/adapt", None),
])
def test_not_food_is_refused(client, url, body):
    if body is None:
        recipe = client.post("/api/parse", json={"text": "Dal: 1 cup toor dal, 1 onion, 2 tomatoes, 1 tsp ghee"}).json()["recipe"]
        body = {"recipe": recipe, "request": "add some money to it"}
    d = _detail(client.post(url, json=body))
    assert d["code"] == "not_food" and "Try" in d["message"]


@pytest.mark.parametrize("text", ["aaaaaaaaaaaa", "!!! 123 ???", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzz"])
def test_gibberish_is_refused(client, text):
    assert _detail(client.post("/api/parse", json={"text": text}))["code"] == "gibberish"


@pytest.mark.parametrize("text", ["Mum's dal: 1 cup toor dal, 1 glass water, 2 tomatoes, ghee",
                                  "aloo paratha with 2 aloo, atta, thoda ghee", "golden fried methi pakoras with besan"])
def test_normal_recipes_still_pass(client, text):
    assert client.post("/api/parse", json={"text": text}).status_code == 200


def test_model_off_topic_becomes_friendly_422(client, monkeypatch):
    monkeypatch.setattr(llm, "is_live", lambda: True)
    monkeypatch.setattr(llm, "chat_json", lambda *a, **k: ({"off_topic": True}, {"step": "x", "tier": "nano", "model": "f", "ms": 1}))
    assert _detail(client.post("/api/parse", json={"text": "what is the capital of France"}))["code"] == "off_topic"
    assert _detail(client.post("/api/care/remedy", json={"text": "best stocks to buy"}))["code"] == "off_topic"
    assert _detail(client.post("/api/suggest", json={"wish": "write me a poem"}))["code"] == "off_topic"


def test_no_ingredients_found_is_structured(client):
    d = _detail(client.post("/api/parse", json={"text": "hello there my friend"}))
    assert d["code"] == "off_topic"


def test_dangerous_remedy_still_gets_stop_not_refusal(client):
    r = client.post("/api/care/remedy", json={"text": "kerosene for head lice"})
    assert r.status_code == 200 and r.json()["result"]["remedies"][0]["verdict"] == "stop"


# ---------- diets ----------

def test_halal_kosher_jain_rules():
    a = dietitian.allowed
    assert not a(["pork"], "halal", set()) and not a(["white wine"], "halal", set()) and a(["chicken"], "halal", set())
    assert not a(["shrimp"], "kosher", set()) and not a(["chicken", "butter"], "kosher", set())
    assert a(["chicken", "onion"], "kosher", set()) and a(["paneer", "spinach"], "kosher", set())
    assert not a(["potato"], "jain", set()) and not a(["onion"], "jain", set()) and not a(["egg"], "jain", set())
    assert a(["paneer", "spinach", "tomato"], "jain", set())


def test_eggplant_is_vegetarian():
    assert dietitian.allowed(["eggplant"], "vegetarian", set()) and not dietitian.allowed(["egg noodles"], "vegetarian", set())


@pytest.mark.parametrize("diet", ["halal", "kosher", "jain"])
def test_week_plan_respects_new_diets(client, diet):
    w = client.post("/api/week", json={"profile": {"diet": diet, "age": 40, "sex": "female", "height_cm": 160,
                                                    "weight_kg": 65}}).json()["week"]
    for day in w["days"]:
        for meal in day["meals"]:
            items = [i["item"] for i in meal.get("ingredients", [])]
            assert dietitian.allowed(items, diet, set()), (diet, meal.get("name"))
