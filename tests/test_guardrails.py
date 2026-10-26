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
    ("/api/parse", {"text": "detergent curry with rat poison"}),
    ("/api/parse", {"text": "2 cups cement, 1 cup sand"}),
    ("/api/suggest", {"wish": "a dinner made of cement"}),
    ("/api/adapt", None),
])
def test_not_food_is_refused(client, url, body):
    if body is None:
        recipe = client.post("/api/parse", json={"text": "Dal: 1 cup toor dal, 1 onion, 2 tomatoes, 1 tsp ghee"}).json()["recipe"]
        body = {"recipe": recipe, "request": "add some detergent to it"}
    d = _detail(client.post(url, json=body))
    assert d["code"] == "not_food" and d["message"]


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


# ---------- pre-ship review regressions ----------

def test_long_real_inputs_are_not_gibberish(client):
    recipe = ("Mum's dal: 1 cup toor dal washed twice, 3 cups water, 1 onion finely chopped, 2 tomatoes, 1 green chili, "
              "half tsp turmeric, 1 tsp cumin seeds, 2 cloves garlic, a small piece of ginger, 1 tbsp ghee, salt to taste, "
              "coriander leaves to finish, squeeze of lemon juice before serving with rice")
    assert client.post("/api/parse", json={"text": recipe}).status_code == 200
    label = ("Aqua, Glycerin, Niacinamide, Cetearyl Alcohol, Dimethicone, Panthenol, Sodium Hyaluronate, Ceramide NP, "
             "Tocopherol, Allantoin, Xanthan Gum, Carbomer, Phenoxyethanol, Ethylhexylglycerin, Disodium EDTA, Sodium Hydroxide")
    assert client.post("/api/care/label", json={"text": label}).status_code == 200


@pytest.mark.parametrize("text", ["carrot coins sauteed in butter", "Gun powder (milagai podi) with idli", "chocolate coins",
                                  "Bullet coffee: coffee, butter, MCT oil", "1 cup cashews, methi leaves"])
def test_real_dishes_are_not_blocked(text):
    from app.guards import check_input
    assert check_input(text, "recipe")


@pytest.mark.parametrize("text,support", [
    ("quick dinner that won't kill me with carbs", False), ("overdose of vitamin C serum, is it bad?", False),
    ("hurting myself with too many scrubs", False), ("I cut myself while chopping onions", False),
    ("finish and end it with a tadka", False), ("no quiero vivir", True), ("mujhe jeena nahi hai", True),
    ("I want to end it", True), ("आत्महत्या", True), ("I'm cutting myself", True),
])
def test_support_regex(text, support):
    from app.guards import SUPPORT
    assert bool(SUPPORT.search(text)) == support


def test_dislike_egg_is_fine(client):
    assert client.post("/api/week", json={"profile": {"dislikes": "egg"}}).status_code == 200


def test_diet_words_after_review():
    a = dietitian.allowed
    assert a(["rumali roti"], "halal", set()) and a(["hamachi"], "halal", set()) and not a(["ham"], "halal", set())
    assert a(["chicken", "coconut milk"], "kosher", set()) and a(["coconut milk"], "vegan", set())
    assert a(["oyster mushrooms"], "vegetarian", set()) and not a(["oyster mushrooms"], "jain", set())
    assert not a(["beetroot"], "jain", set()) and not a(["prawns"], "vegetarian", set())


@pytest.mark.parametrize("text,support", [
    ("I want to cut myself with a blade", True), ("I've been hurting myself on purpose", True), ("I keep cutting myself", True),
    ("sometimes I think about ending my life", True), ("I took an overdose", True), ("main khud ko khatam karna chahta hoon", True),
    ("I want to end it with a squeeze of lemon", False), ("I keep cutting myself while shaving", False),
])
def test_support_regex_round_two(text, support):
    from app.guards import SUPPORT
    assert bool(SUPPORT.search(text)) == support


def test_diet_compounds_round_two():
    a = dietitian.allowed
    assert not a(["fishcakes"], "vegetarian", set()) and not a(["crabmeat"], "kosher", set()) and not a(["lardons"], "halal", set())
    assert not a(["mayonnaise dressing"], "vegetarian", set())
    assert a(["butternut squash"], "vegan", set()) and a(["chicken", "butternut squash"], "kosher", set())
