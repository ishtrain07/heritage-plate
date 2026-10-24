"""Bundle a single-file, serverless preview of the demo (mock) mode.

The preview is the real front end (static/) plus a small in-page stand-in for
the API. All four demo families are precomputed with the real Python engine in
mock mode: every dish x every health focus. Heritage Care answers the four example
remedy chips (every country, pregnant or not), the sample family's care plan and the
example label, all precomputed by the real /api/care routes. The week plan and shopping list are
recomputed in the browser with a direct port of the engine's mock schedule, and
tests/test_preview.py checks that port against the Python output.

Usage:  python scripts/build_preview.py <out.html> [--standalone]
        --standalone wraps it as a full HTML document for plain static hosts.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from pathlib import Path

os.environ["MOCK"] = "1"
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from app import care, engine, nutrition
from app.main import app

CONDITIONS = ("diabetes", "bp", "cholesterol", "everyday")
# The preview can't plan for any profile, so each family's week is planned once for a sample person.
SAMPLE_PROFILES = {
    "gill": {"diet": "vegetarian", "conditions": ["diabetes"], "goal": "lose_weight", "sex": "female", "age": 64,
             "height_cm": 158, "weight_kg": 68, "activity": "light", "ethnicity": "south_asian"},
    "chen": {"diet": "non_veg", "conditions": ["bp"], "goal": "maintain", "sex": "male", "age": 70,
             "height_cm": 168, "weight_kg": 70, "activity": "light", "ethnicity": "east_asian"},
    "rossi": {"diet": "non_veg", "conditions": ["cholesterol"], "goal": "lose_weight", "sex": "female", "age": 72,
              "height_cm": 160, "weight_kg": 74, "activity": "light", "ethnicity": "other"},
    "reyes": {"diet": "non_veg", "conditions": ["diabetes"], "goal": "steady_sugar", "sex": "female", "age": 68,
              "height_cm": 155, "weight_kg": 70, "activity": "light", "ethnicity": "other"},
}


# Must match CARE_SAMPLE and CARE_EXAMPLES / LABEL_EXAMPLE in static/care.js (as the page sends them).
CARE_SAMPLE = [
    {"name": "Dad", "age": 58, "sex": "male", "pregnant": False, "concerns": ["dandruff", "body_dry"], "skin_type": None,
     "wants": "men's body wash", "details": "hair falling out in patches lately", "allergies": ""},
    {"name": "Mum", "age": 54, "sex": "female", "pregnant": False, "concerns": ["dark_spots", "dry"], "skin_type": "dry",
     "wants": "", "details": "", "allergies": ""},
    {"name": "Priya", "age": 29, "sex": "female", "pregnant": True, "concerns": ["acne", "dark_spots"], "skin_type": "oily",
     "wants": "", "details": "", "allergies": ""},
]
CARE_CHIPS = ["besan haldi ka lep", "nimbu on dark spots", "coconut oil in hair every night", "toothpaste on a pimple"]
LABEL_EXAMPLE = ("Aqua, Glycerin, Niacinamide, Parfum, Alcohol Denat., Cetearyl Alcohol, Salicylic Acid, "
                 "Lavandula Angustifolia Oil")


def check_care_sample() -> None:
    js = (ROOT / "static" / "care.js").read_text(encoding="utf-8")
    for m in CARE_SAMPLE:
        assert f'name: "{m["name"]}", age: {m["age"]}' in js, f"CARE_SAMPLE out of step with care.js: {m['name']}"
    for t in CARE_CHIPS:
        assert f'"{t}"' in js, f"CARE_EXAMPLES out of step with care.js: {t}"
    assert LABEL_EXAMPLE in js, "LABEL_EXAMPLE out of step with care.js"


def canon_member(m: dict) -> str:
    keys = ("name", "age", "sex", "pregnant", "concerns", "skin_type", "wants", "details", "allergies")
    out = {k: m.get(k) for k in keys}
    out["concerns"] = sorted(out["concerns"] or [])
    out["pregnant"] = bool(out["pregnant"])
    for k in ("name", "wants", "details", "allergies"):
        out[k] = (out[k] or "").strip()
    return json.dumps(out, sort_keys=True, separators=(",", ":"))


def precompute_care(client: TestClient) -> dict:
    check_care_sample()
    countries = list(care.COUNTRIES)
    remedy = {}
    for text in CARE_CHIPS:
        for country in countries:
            for preg in (0, 1):
                member = {"sex": "female", "pregnant": True} if preg else {}
                body = {"text": text, "member": member, "country": country, "language": "English"}
                remedy[f"{text}|{country}|{preg}"] = client.post("/api/care/remedy", json=body).json()["result"]
    plan = {}
    for country in countries:
        res = client.post("/api/care/plan", json={"members": CARE_SAMPLE, "country": country, "language": "English"}).json()
        plan[country] = res["result"]
    label = {}
    for m in [{}, *CARE_SAMPLE]:
        label[canon_member(m)] = client.post("/api/care/label", json={"text": LABEL_EXAMPLE, "member": m}).json()["result"]
    return {"library": client.get("/api/care/library").json(), "remedy": remedy, "plan": plan,
            "planKey": "|".join(canon_member(m) for m in CARE_SAMPLE), "label": label,
            "labelExample": LABEL_EXAMPLE}


def precompute() -> dict:
    client = TestClient(app)
    families = {f["id"]: client.get(f"/api/demo/{f['id']}").json() for f in client.get("/api/demo").json()}
    adapt = {}
    for fam in families.values():
        for recipe in fam["recipes"]:
            for condition in CONDITIONS:
                body = {"recipe": recipe, "condition": condition, "cuisine": fam["cuisine"]}
                adapt[f'{recipe["id"]}|{condition}'] = client.post("/api/adapt", json=body).json()
    weeks = {}
    for fid, fam in families.items():
        recipes = [adapt[f'{r["id"]}|{fam["condition"]}']["recipe"] for r in fam["recipes"]]
        body = {"recipes": recipes, "profile": SAMPLE_PROFILES.get(fid, {}), "language": fam["language"]}
        weeks[fid] = client.post("/api/week", json=body).json()
    weeks["default"] = client.post("/api/week", json={"profile": {"diet": "vegetarian"}}).json()
    return {
        "weeks": weeks,
        "health": client.get("/api/health").json(),
        "demoList": client.get("/api/demo").json(),
        "families": families,
        "adapt": adapt,
        "categories": {name: food.category for name, food in nutrition.foods().items()},
        "focusKey": engine.FOCUS_KEY,
        "messages": engine.FALLBACK_MESSAGES,
        "tips": engine.FALLBACK_TIPS,
        "days": list(engine.DAYS),
        "care": precompute_care(client),
    }


SHIM = r"""
// Serverless preview: answers the app's /api calls from data precomputed by the
// real engine in demo mode. The week plan is a direct port of engine._mock_schedule.
(() => {
  const D = window.__HP_DATA__;
  const round1 = (g) => Math.round(Number(g) * 10) / 10;
  const sig = (r) => `${r.id}|${JSON.stringify((r.ingredients || []).map((i) => [i.item, round1(i.grams)]))}`;
  const known = {};
  for (const fam of Object.values(D.families)) for (const r of fam.recipes) known[sig(r)] = r;
  for (const res of Object.values(D.adapt)) known[sig(res.recipe)] = res.recipe;

  const mockTrace = (step, tier) => [{ step, tier, model: `mock (Nemotron ${tier[0].toUpperCase()}${tier.slice(1)} when live)`, ms: 0, tokens: null, fallback: false, cached: false }];
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const notInPreview = () => reply(503, { detail: "This preview runs the four demo families. Adding your own recipes needs the full app with a live server." });

  function schedule(recipes, focus) {
    const ids = { breakfast: [], main: [], dessert: [] };
    recipes.forEach((r, i) => ids[r.meal].push(i));
    let mains = ids.main.length ? ids.main : recipes.map((r, i) => (r.meal !== "dessert" ? i : -1)).filter((i) => i >= 0);
    if (!mains.length) mains = recipes.map((_, i) => i);
    const breakfasts = ids.breakfast.length ? ids.breakfast : mains;
    const dinners = [...mains].sort((a, b) => recipes[a].nutrition[focus] - recipes[b].nutrition[focus]);
    return D.days.map((day, d) => {
      const lunch = mains[d % mains.length];
      let dinner = dinners[d % dinners.length];
      if (dinner === lunch && mains.length > 1) dinner = dinners[(d + 1) % dinners.length];
      const dessert = ids.dessert.length && (day === "Sat" || day === "Sun") ? ids.dessert[0] : null;
      return { day, breakfast: breakfasts[d % breakfasts.length], lunch, dinner, dessert };
    });
  }

  function shopping(recipes, days) {
    const need = new Map();
    for (const day of days) for (const slot of ["breakfast", "lunch", "dinner", "dessert"]) {
      const idx = day[slot];
      if (idx === null) continue;
      for (const ing of recipes[idx].ingredients) need.set(ing.item, (need.get(ing.item) || 0) + ing.grams);
    }
    const order = ["grain", "legume", "vegetable", "fruit", "dairy", "protein", "fat", "nuts", "sauce", "sweetener", "spice", "other"];
    const pyRound = (x) => { const f = Math.floor(x); const r = x - f; return r > 0.5 || (r === 0.5 && f % 2 === 1) ? f + 1 : f; };
    const items = [...need].map(([item, grams]) => {
      const step = grams >= 50 ? 50 : 5;
      return { item, grams: Math.max(step, pyRound(grams / step) * step), category: D.categories[item] || "other" };
    });
    const rank = (c) => (order.includes(c) ? order.indexOf(c) : 99);
    return items.sort((a, b) => rank(a.category) - rank(b.category) || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
  }

  function plan(body) {
    const recipes = (body.recipes || []).map((r) => known[sig(r)]);
    if (!recipes.length || recipes.some((r) => !r)) return notInPreview();
    const condition = body.condition || "diabetes";
    const language = body.language || "English";
    const days = schedule(recipes, D.focusKey[condition]);
    const named = days.map((d) => ({ day: d.day, ...Object.fromEntries(["breakfast", "lunch", "dinner", "dessert"].map((s) => [s, d[s] === null ? null : recipes[d[s]].name])) }));
    return reply(200, {
      plan: {
        days: named,
        shopping_list: shopping(recipes, days),
        message_for_parent: D.messages[condition],
        language: language === "English" ? "English" : `English (written in ${language} when live)`,
        tips: D.tips[condition],
      },
      trace: mockTrace("Plan the week", "ultra"),
    });
  }

  // Heritage Care: the four example chips, the sample family and the example label.
  const careMsg = () => reply(503, { detail: "This preview answers the four example remedies, the sample family and the example label. Checking your own needs the full app with a live server." });
  const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
  const canon = (m) => {
    m = m || {};
    const out = { age: m.age ?? null, allergies: String(m.allergies || "").trim(), concerns: [...(m.concerns || [])].sort(),
      details: String(m.details || "").trim(), name: String(m.name || "").trim(), pregnant: Boolean(m.pregnant),
      sex: m.sex ?? null, skin_type: m.skin_type ?? null, wants: String(m.wants || "").trim() };
    return JSON.stringify(out);
  };
  function careRoute(path, body) {
    const C = D.care;
    if (path === "/api/care/library") return reply(200, C.library);
    if (path === "/api/care/remedy") {
      const hit = C.remedy[`${norm(body.text)}|${body.country || "OTHER"}|${body.member && body.member.pregnant ? 1 : 0}`];
      return hit ? reply(200, { result: hit, trace: [] }) : careMsg();
    }
    if (path === "/api/care/plan") {
      const key = (body.members || []).map(canon).join("|");
      const hit = key === C.planKey && C.plan[body.country || "OTHER"];
      return hit ? reply(200, { result: { ...hit, language: body.language || "" }, trace: [] }) : careMsg();
    }
    if (path === "/api/care/label") {
      const hit = norm(body.text) === norm(C.labelExample) && C.label[canon(body.member && Object.keys(body.member).length ? body.member : null)];
      return hit ? reply(200, { result: hit }) : careMsg();
    }
    return null;
  }

  window.__HP_PLAN__ = plan; // used by tests/test_preview.py
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (url, opts = {}) => {
    const path = String(url);
    if (!path.startsWith("/api/")) return realFetch(url, opts);
    const body = opts.body ? JSON.parse(opts.body) : {};
    await new Promise((r) => setTimeout(r, 250)); // feel like a real request
    if (path === "/api/health") return reply(200, D.health);
    if (path === "/api/demo") return reply(200, D.demoList);
    const fam = path.match(/^\/api\/demo\/([a-z]+)$/);
    if (fam) return D.families[fam[1]] ? reply(200, D.families[fam[1]]) : reply(404, { detail: "Unknown demo family." });
    if (path === "/api/adapt") {
      const r = body.recipe || {};
      const hit = known[sig(r)] && D.adapt[`${r.id}|${body.condition || "diabetes"}`];
      return hit ? reply(200, hit) : notInPreview();
    }
    if (path.startsWith("/api/care/")) return careRoute(path, body) || reply(404, { detail: "Not found." });
    if (path === "/api/plan") return plan(body);
    if (path === "/api/week") {
      // One sample week per family, planned by the real engine at build time.
      const ids = (body.recipes || []).map((r) => String(r.id || "").split("-")[0]);
      const fid = ids.find((f) => D.weeks[f]) || "default";
      const res = JSON.parse(JSON.stringify(D.weeks[fid]));
      res.week.notes = ["Demo preview: this week was planned for a sample person, not your answers. The full app plans around yours.",
                        ...(res.week.notes || [])];
      return reply(200, res);
    }
    if (path === "/api/parse" || path === "/api/suggest") return notInPreview();
    return reply(404, { detail: "Not found." });
  };
})();
"""

BANNER = """<div class="preview-banner" role="note">Preview of demo mode: the four demo families run fully in your browser,
using numbers precomputed by the real engine, plus Care's example remedies and sample family. Your own recipes and remedies need the full app.</div>"""


def build(out: Path, standalone: bool = False) -> None:
    static = ROOT / "static"
    html = (static / "index.html").read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.DOTALL).group(1)
    body = re.sub(r'\s*<script src="/static/[\w.-]+\.js"></script>', "", body)
    body = body.replace('<main id="main">', BANNER + '\n  <main id="main">', 1)
    css = (static / "styles.css").read_text(encoding="utf-8")
    # One self-contained file: embed the self-hosted fonts as data URIs.
    css = re.sub(
        r'url\("fonts/([\w.-]+\.woff2)"\)',
        lambda m: 'url("data:font/woff2;base64,' + base64.b64encode((static / "fonts" / m.group(1)).read_bytes()).decode() + '")',
        css,
    )
    css += """
:root { color-scheme: light; }
.preview-banner { background: var(--saffron-soft); color: var(--warn-ink); border-bottom: 1px solid var(--line);
  padding: 10px max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px));
  font-size: .95rem; text-align: center; }
"""
    data = json.dumps(precompute(), separators=(",", ":")).replace("</", "<\\/")
    scripts = "\n".join("<script>" + (static / name).read_text(encoding="utf-8").replace("</script", "<\\/script") + "</script>"
                        for name in ("family.js", "app.js", "care.js"))
    page = f"""<meta charset="utf-8">
<title>Heritage</title>
<meta name="description" content="Keep what works from home. Fix what doesn't.">
<style>
{css}
</style>
{body}
<script>window.__HP_DATA__ = {data};</script>
<script>{SHIM}</script>
{scripts}
"""
    if standalone:  # plain static hosts (e.g. a Hugging Face Static Space) need a full document
        page = page.replace('<meta charset="utf-8">\n', "", 1)
        cut = page.index("</style>") + len("</style>")
        page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                f"{page[:cut]}\n</head>\n<body data-side=\"home\">\n{page[cut:]}\n</body>\n</html>\n")
    out.write_text(page, encoding="utf-8")
    print(f"Wrote {out} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--standalone"]
    build(Path(args[0] if args else "preview.html"), standalone="--standalone" in sys.argv)
