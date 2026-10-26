"""Heritage Plate API: keep the family's food, fix the numbers."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import care, dietitian, engine, llm, nutrition

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("heritage_plate")
app = FastAPI(title="Heritage Plate", version="0.2.0")

Condition = Literal["diabetes", "bp", "cholesterol", "everyday"]
Cuisine = Literal["south_asian", "east_asian", "southeast_asian", "continental", "middle_eastern", "latin_american", "other"]


class Ingredient(BaseModel):
    item: str = Field(min_length=1, max_length=60)
    grams: float = Field(gt=0, le=5000)


class Recipe(BaseModel):
    id: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    servings: int = Field(ge=1, le=20)
    meal: Literal["breakfast", "main", "dessert"] | None = None
    ingredients: list[Ingredient] = Field(min_length=1, max_length=40)
    source_text: str = Field(default="", max_length=2000)
    method: list[str] = Field(default_factory=list, max_length=12)

    def build(self) -> dict:
        """Recompute nutrition server-side; client-sent numbers are ignored."""
        ingredients = engine.normalize_ingredients([i.model_dump() for i in self.ingredients])
        recipe = engine.build_recipe(self.name, self.servings, ingredients, self.source_text, self.meal, self.method)
        return {**recipe, "id": self.id}


def _language(value: str) -> str:
    if value and value not in engine.LANGUAGES:  # "" = no note
        raise ValueError(f"language must be one of {', '.join(engine.LANGUAGES)}")
    return value


class ParseIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    servings: int | None = Field(default=None, ge=1, le=20)
    cuisine: Cuisine = "other"


class AdaptIn(BaseModel):
    recipe: Recipe
    condition: Condition = "diabetes"
    cuisine: Cuisine = "other"
    # "Ask about this dish": a family preference to honour, e.g. "Dad hates cauliflower".
    request: str = Field(default="", max_length=200)
    also: list[Condition] = Field(default_factory=list, max_length=3)  # more health issues besides `condition`


class PlanIn(BaseModel):
    recipes: list[Recipe] = Field(min_length=1, max_length=30)
    condition: Condition = "diabetes"
    language: str = "English"
    week: int = Field(default=1, ge=1, le=520)  # returning users plan again; each week number gets a fresh rotation

    @field_validator("language")
    @classmethod
    def _check_language(cls, value: str) -> str:
        return _language(value)


class Profile(BaseModel):
    diet: Literal["non_veg", "pescatarian", "eggetarian", "vegetarian", "vegan", "halal", "kosher", "jain"] = "non_veg"
    conditions: list[Literal["diabetes", "bp", "cholesterol"]] = Field(default_factory=list, max_length=3)
    goal: Literal["maintain", "lose_weight", "belly_fat", "steady_sugar", "build_muscle"] = "maintain"
    dislikes: str = Field(default="", max_length=200)
    sex: Literal["female", "male"] | None = None
    age: int | None = Field(default=None, ge=1, le=120)
    height_cm: float | None = Field(default=None, ge=80, le=250)
    weight_kg: float | None = Field(default=None, ge=25, le=350)
    activity: Literal["sedentary", "light", "moderate", "active"] = "light"
    # Optional: Asian BMI cut-offs apply to these backgrounds.
    ethnicity: Literal["south_asian", "east_asian", "southeast_asian", "other"] | None = None
    pregnant: bool = False  # pregnant or breastfeeding: no calorie cut
    snacks: bool = True


class WeekIn(BaseModel):
    recipes: list[Recipe] = Field(default_factory=list, max_length=30)
    profile: Profile = Field(default_factory=Profile)
    language: str = ""
    week: int = Field(default=1, ge=1, le=520)
    household: int = Field(default=1, ge=1, le=12)

    @field_validator("language")
    @classmethod
    def _check_language(cls, value: str) -> str:
        return _language(value)


# Rate limit and model-error handling live in guards.py so Care's routes share them.
from .guards import (  # noqa: F401
    EXAMPLES,
    _client_id,
    _guard,
    _rate_limit,
    check_input,
    reject,
)


@lru_cache
def _families() -> list[dict]:
    raw = json.loads((ROOT / "data" / "demo_families.json").read_text(encoding="utf-8"))
    families = []
    for fam in raw:
        recipes = [
            {**engine.build_recipe(r["name"], r["servings"], engine.normalize_ingredients(r["ingredients"]), r["source_text"], r.get("meal"), r.get("method")), "id": f'{fam["id"]}-{i}'}
            for i, r in enumerate(fam["recipes"])
        ]
        families.append({**fam, "recipes": recipes})
    return families


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "mode": "live" if llm.is_live() else "mock",
        "models": llm.MODELS,
        "foods": len(nutrition.foods()),
        "cuisines": engine.CUISINES,
        "languages": engine.LANGUAGES,
    }


@app.get("/api/demo")
async def demo_list():
    return [{k: f[k] for k in ("id", "family", "parent", "cuisine", "condition", "language")} for f in _families()]


@app.get("/api/demo/{family_id}")
async def demo(family_id: str):
    for fam in _families():
        if fam["id"] == family_id:
            return fam
    raise HTTPException(status_code=404, detail="Unknown demo family.")


@app.post("/api/parse")
def parse(body: ParseIn, request: Request):
    _rate_limit(request)
    check_input(body.text, "recipe")
    recipe, trace = _guard(engine.parse_recipe, body.text, body.servings, body.cuisine)
    if not any(i["matched"] for i in recipe["ingredients"]):
        raise reject("off_topic", "We couldn't find any ingredients. " + EXAMPLES["recipe"])
    return {"recipe": recipe, "trace": trace}


@app.post("/api/adapt")
def adapt(body: AdaptIn, request: Request):
    _rate_limit(request)
    check_input(body.request, "ask")
    adapted, trace = _guard(engine.adapt_recipe, body.recipe.build(), body.condition, body.cuisine, body.request.strip(), body.also)
    return {"recipe": adapted, "trace": trace}


@app.post("/api/plan")
def plan(body: PlanIn, request: Request):
    _rate_limit(request)
    recipes = [r.build() for r in body.recipes]
    result, trace = _guard(engine.make_plan, recipes, body.condition, body.language, body.week)
    return {"plan": result, "trace": trace}


class SuggestIn(BaseModel):
    wish: str = Field(min_length=3, max_length=300)  # e.g. "a high-protein dinner with spinach"
    conditions: list[Condition] = Field(default_factory=list, max_length=4)
    cuisine: Cuisine = "other"
    diet: Literal["non_veg", "pescatarian", "eggetarian", "vegetarian", "vegan", "halal", "kosher", "jain"] = "non_veg"
    dislikes: str = Field(default="", max_length=200)
    servings: int = Field(default=4, ge=1, le=12)


@app.post("/api/suggest")
def suggest(body: SuggestIn, request: Request):
    """Ask the AI to invent a dish for them; returns it in the same shape as an adapted recipe."""
    _rate_limit(request, cost=2)
    check_input(body.wish, "wish")
    check_input(body.dislikes, "dislikes")
    recipe, trace = _guard(engine.suggest_dish, body.wish.strip(), body.conditions, body.cuisine, body.diet,
                           body.dislikes, body.servings)
    return {"recipe": recipe, "trace": trace}


@app.post("/api/week")
def week(body: WeekIn, request: Request):
    """Personal dietitian week: calorie target from the profile, meals around the family's dishes."""
    _rate_limit(request, cost=5)  # one week plan is a long call, so it counts as several requests
    check_input(body.profile.dislikes, "dislikes")
    recipes = [r.build() for r in body.recipes]
    result, trace = _guard(dietitian.plan_week, recipes, body.profile.model_dump(), body.language, body.week, body.household)
    return {"week": result, "trace": trace}


app.include_router(care.router)  # Heritage Care: /api/care/*


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
