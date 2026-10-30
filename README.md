# Nouri: Keep what works from home

**Good food. Healthier tomorrows.** Nouri is a health helper for a whole household, family or flatmates. It makes Mum's recipes healthier, plans the week with one shopping list, checks any food or skin-care label for everyone at home, and fact-checks Nani's remedies. It works in any language, by voice, text or photo.

Built for the **Nebius × NVIDIA Global AI Hackathon** (Best Apps & Agents) with **NVIDIA Nemotron 3 on Nebius Token Factory**.

- Live app: `https://[your nouri domain].vercel.app`
- Demo video: `[YouTube link]`
- Screenshots: [`docs/gallery/`](docs/gallery/)

## What it does

| Feature | What a family gets |
|---|---|
| **Household** | Set up once in 3 steps: names, ages, several health conditions and goals per person, diets (vegan, Jain, halal, kosher-style…) and allergies. Share with an invite link, no accounts. |
| **Food** | Say a recipe the way it's said at home ("1 katori arhar, ghee on top"). Get it lighter for diabetes, blood pressure or cholesterol, with before → after numbers from food tables. |
| **Week + one shopping list** | A dietitian-style week around the family's own dishes: calorie targets, goals, diets and allergies, a note to the parent in their language, and one consolidated list. |
| **Scan & check** | Photograph any food or skin-care label. Get an answer for each person (fine / now and then / check the label / not for them), an ingredient breakdown, and "add to list". |
| **Skin & hair** | Check a home remedy (keep, fine with care, swap or stop, with sources) and get a simple routine per person from a cited ingredient library. |
| **Insights** | Daily aims per person (calories, protein, fibre, sodium, sugar, carbs per meal, water, activity), each cited to WHO, ICMR-NIN, ADA or EFSA. |

## How NVIDIA Nemotron and Nebius Token Factory are used

Each step goes to the Nemotron model sized for its job. All of them are called through Token Factory's OpenAI-compatible API (`app/llm.py`), so one client serves every model with no GPUs to manage.

| Step | Model on Token Factory | Why this size |
|---|---|---|
| Read a spoken or typed recipe into grams | **Nemotron 3 Nano** (30B-A3B), thinking off | Fast, cheap structured extraction (~2 s) |
| Make dishes lighter, answer "Dad hates cauliflower", suggest a dish | **Nemotron 3 Super** (120B-A12B), thinking off | Judgement inside strict rules (2–5 s) |
| Check remedies, care plans, translation, explain scanned labels | **Nemotron 3 Super** | Same: constrained reasoning, multilingual |
| Plan the whole week and write to the parent | **Nemotron 3 Ultra** (550B-A55B), thinking on | Long-horizon planning across many dishes (~45 s); falls back to Super |
| Copy the words off a label photo | Gemma 3 27B (vision, on Token Factory) | No Nemotron model on Token Factory takes images yet; it only transcribes, and Nemotron plus code decide |

**Where Token Factory helped:**
- One API key and one client for four models, so routing by task is a one-word change.
- Per-token pricing let us budget each step. A full household session is about 20 calls and 70k tokens.
- `chat_template_kwargs` switches Nemotron's thinking off for the fast steps.

After a scan, an optional **Tavily** web search (`/api/scan/news`, on when `TAVILY_API_KEY` is set) shows up to 3 recent links on recalls or recipe changes for that product. It never affects a verdict, and only the product name is sent.

Every call is traced in **LangSmith** (model, tokens, latency) when `LANGSMITH_TRACING=true`.

## Trust: the AI never makes up numbers or safety rules

- **Nutrition is computed in code** from IFCT 2017 and USDA SR28 (`data/foods.csv`, 205 foods with home-language names). Anything unmatched is shown as "not counted".
- **Calorie targets** use Mifflin–St Jeor with WHO Asian BMI cut-offs (`app/dietitian.py`).
- **Safety runs in code after the model answers** (`app/scan.py`, `app/care.py`, `app/dietitian.py`):
  - allergies, including "may contain", compound words and Hindi/Hinglish names
  - diets, pregnancy, age limits and prescription-only items
  - dangerous remedies and ingredients (steroids, mercury, hydroquinone) always get "stop"
- **Guardrails before the model** (`app/guards.py`): self-harm signals get helplines and never reach it. Poisons or chemicals typed as food get a firm "not food" with emergency numbers; swear words, non-label photos and gibberish get a friendly reply.

## Run it

```bash
git clone https://github.com/ishtrain07/heritage-plate.git && cd heritage-plate
pip install -r requirements.txt
cp .env.example .env               # add NEBIUS_API_KEY for live mode
export $(grep -v '^#' .env | xargs)
uvicorn app.main:app --reload      # http://localhost:8000
```

- **Demo mode** (no key, or `MOCK=1`): deterministic rules stand in for the models, so every screen works offline.
- **Live mode:** set `NEBIUS_API_KEY`. `python scripts/check_models.py` verifies the model IDs. `HP_LIVE=1 python scripts/live_run.py` runs the demo live and reports latency and tokens.
- **Settings:**
  - `RATE_LIMIT`: requests per client per 10 minutes, default 200
  - `MAX_CALLS_PER_HOUR`: model calls across all users, default 600
  - `TRUST_PROXY`
  - `LLM_TIMEOUT_S`, `LLM_TIMEOUT_ULTRA_S`, `LLM_DEADLINE_S`
  - `VISION_MODEL`, default `google/gemma-3-27b-it`
  - `TAVILY_API_KEY` (optional): turns on "In the news" after a scan
  - `LANGSMITH_TRACING`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, `LANGSMITH_API_KEY`

**Deploy:** Vercel, using `vercel.json` (`app/main.py` as a Python function, `maxDuration` 120 s). Set `NEBIUS_API_KEY` (and the LangSmith variables) for Production and Preview. A `Dockerfile` is included for any container host.

## Tests

```bash
python -m pytest -q    # 272 tests, offline (mock mode)
ruff check .
```

## How we built it with review agents

`.claude/agents/` holds the three Claude Code agents that audited every change before it shipped:

- [`code-reviewer.md`](.claude/agents/code-reviewer.md): correctness and safety. It found allergy false negatives in the scanner, each now a regression test in `tests/test_scan.py`.
- [`frontend-ux.md`](.claude/agents/frontend-ux.md): design, accessibility, dark mode, phone layouts.
- [`product-ux-strategist.md`](.claude/agents/product-ux-strategist.md): flow, copy, and nutrition guidance from a dietitian's view.

## Project layout

```
app/main.py        routes: /api/parse, /api/adapt, /api/suggest, /api/plan, /api/week, /api/demo, /api/health
app/scan.py        /api/scan: label photo → text → per-person checks (allergies, diet, sugar/salt, skin safety)
app/insights.py    /api/insights: daily aims per person, pure code
app/care.py        /api/care/*: remedy check, care plan, label check, cited library, safety rules
app/dietitian.py   week plan: calorie target, diets, allergies, portions, shopping list
app/engine.py      parse → adapt → plan pipeline (live Nemotron or mock rules)
app/llm.py         Token Factory client, JSON parsing, cache, budget, deadline, Ultra → Super fallback, tracing
app/prompts.py     system prompts
app/guards.py      input guardrails, rate limit, model-error handling
app/nutrition.py   nutrition maths over data/foods.csv
data/              foods.csv, ingredients.csv, meals.json, care_actives.json, demo_families.json, facts.json
static/            the app: index.html, styles.css, family.js, app.js, care.js, scan.js, setup.js, insights.js, shop.js
scripts/           build_foods.py, check_models.py, live_run.py, build_preview.py
docs/              DEVPOST.md, VIDEO_SCRIPT.md, gallery/, notes/ (specs and review notes)
tests/             pytest suite
```

### Rebuilding the food table

```bash
npm pack @ifct2017/compositions fda-nutrient-database && for f in *.tgz; do mkdir -p "${f%.tgz}" && tar -xzf "$f" -C "${f%.tgz}"; done
python scripts/build_foods.py --ifct ifct2017-compositions-*/package/index.csv --sr28 fda-nutrient-database-*/package/data/ABBREV.txt
```

## Credits

Photos on Unsplash by Anju Ravindranath, Helena Lopes, Omar Abozeid, iKshana Productions, Vije Vijendranath and Jack Lee. Food data: IFCT 2017 (National Institute of Nutrition, India) and USDA SR28.

## Disclaimer

General guidance, not medical advice. Check changes with a doctor, pharmacist or registered dietitian.

## License

[MIT](LICENSE)
