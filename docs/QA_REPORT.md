# Heritage Plate QA report

Date: 2026-10-22. Mode: `MOCK=1` (no live Nemotron calls). Nothing in `app/`, `data/` or `static/` was changed.

The front end was tested against `static/` as it stood at 14:37 UTC and re-checked against the 14:45 UTC version, because another agent was editing it during the run. The line numbers below are from the 14:45 copy of `static/app.js` (2258 lines). Two bugs had already been fixed or changed in that later copy, and the report says so where that happened.

Severity: **High** means wrong numbers shown to a family, or broken UI in a common flow. **Medium** means a visible bug or misleading result in a plausible flow. **Low** is polish or an edge case.

---

## Ranked findings (all parts)

| # | Sev | Where | Problem | Repro | Suggested fix |
|---|---|---|---|---|---|
| 1 | High | `app/engine.py` `_mock_parse` (l.~150) | **In demo mode, ingredients it doesn't recognise disappear without a trace.** They never appear as "not counted". The card then shows totals and a "% less" for only part of the dish. | Parse `Trail mix: almonds, walnuts, raisins, 2 eggs, honey`. The card shows 57 kcal/serving and "12% less" from egg and honey alone. Almonds, walnuts and raisins appear nowhere, and `nutrition.uncounted` is `[]`. | When mock parse finds unknown comma- or line-separated items, emit them as `{"item": <text>, "grams": <guess>}` so `normalize_ingredients` marks them `matched: false`. The simplest version splits on `,`/newline and keeps the segments with no `find_mentions` hit. |
| 2 | High | `data/foods.csv` coverage | **The nuts, seeds and dried fruit the founder named aren't counted.** Missing: almonds/badam, walnuts/akhrot, pistachios/pista, mixed nuts, raisins/kishmish, dates/khajoor, chia, flax/alsi, sesame/til seeds, and peanut butter. Only peanuts and cashews match. | `nutrition.match("almonds")` returns `None` (see the Part 1 table). | Add the rows in Part 1 §D (USDA SR28 12061, 12155, 12151, 09298, 09087/09421, 12006, 12220, 12023, 16098). |
| 3 | High | `app/prompts.py` `PARSE` | **The live parse prompt has no conversion for cooked weight, pieces or ml.** It says "Use RAW weights for grains" but gives no cooked-to-raw ratio. The app's own East Asian example says "2 bowls cooked rice". Nano can easily write 300–400 g of raw `white rice`, which is about 3× the carbs. It also has no rules for roti/chapati/paratha counts, bread slices, ml→g for milk, a "glass", "half katori" of cooked dal or sabzi, or "spoon" (tsp vs tbsp) in home speech. | Code review. The live model can't be called from here. | Add these lines: "1 bowl/katori cooked rice ≈ 60 g raw rice; 1 roti/chapati ≈ 30 g atta (+3 g ghee if 'with ghee'); 1 paratha ≈ 40 g atta + 5 g fat; 1 slice bread = 30 g; 1 ml milk/curd ≈ 1 g; 1 glass = 200 ml; 'spoon' without tsp/tbsp = 10 g; half = 0.5 × the measure; 1 egg white = 33 g; 1 handful nuts = 25 g". Also: "If an item isn't in the list, keep its own name. Never substitute a different food (almonds ≠ cashews)." |
| 4 | High | `app/nutrition.py` `find_mentions`, used by mock parse | **In demo mode, compound names get counted as their parts, with default amounts.** `rice flour` → 300 g white rice + 250 g maida. `peanut butter` → butter. `cream cheese` → cream + cheddar. `chicken stock` → 500 g chicken. `condensed milk`, `soy milk` and `almond milk` → 500 g whole milk. `ice cream` → cream. `coconut water` → coconut. `black eyed peas` → green peas. `rice vinegar` → rice. Dish titles count too: `Butter chicken: …` adds butter, and `Egg curry` adds egg. | `POST /api/parse {"text":"Thai curry: coconut milk 200 ml, chicken 300g, rice flour 2 tbsp"}` returns rice 300 g, maida 250 g and chicken 500 g. | In `find_mentions`, skip a hit when the next word makes it a different food. A small "blocking suffix" list (flour, butter, milk, cheese, stock, broth, cube, water, sauce, vinegar, paper, wrapper, starch, leaves, pickle) keeps "rice flour" from matching rice. Mock parse should also skip the title line, and read the number and unit next to each hit (see #6). |
| 5 | High | `static/app.js` l.324–331 `busy()` + l.630 `loadFamily` | **The "Make every dish lighter" button stays stuck on its spinner.** If the user switches sample family while a batch is still running, the new run's `busy()` saves the *spinner* HTML as the button's "old" label. When the new run ends, it puts the spinner back. The button is enabled but reads "⟳ Making them lighter…" for good, and it shows whenever a dish has failed. The same bug happened on goal change in the 14:37 version. The 14:45 version waits 700 ms before re-adapting (`readaptTimer`, l.546), which fixes the goal path but not the family path. | Slow `/api/adapt` (1.2 s). Load Gill, then click Chen mid-batch while some adapts fail. `#adaptBar` is visible with the spinner label and `disabled=false`. | In `busy()`, store the original label once (`btn.dataset.label ??= btn.innerHTML`) and restore that. Or don't start a new `busy()` while `btn` has `aria-busy`: wait for the old one to end first. |
| 6 | Medium | `app/engine.py` `_mock_parse` | **Demo parse ignores every quantity.** `chicken 300g` → 500 g. `200 ml milk` → 500 g. `1 tbsp ghee` → 30 g. `1 egg` and `6 eggs` → both 100 g. The "half" rule only fires when "half" comes right before the food, so `half katori moong dal` → 200 g (not halved) while `thoda ghee` is halved. Rotis (`4 rotis`) aren't recognised at all. | `/api/parse` with `2 eggs, 4 rotis, a handful of almonds, 1 tbsp ghee, half katori dal, 200 ml milk` returns egg 100, ghee 30, milk 500 and nothing else. | Read a leading number+unit (`(\d+(\.\d+)?)\s*(g|kg|ml|l|tbsp|tsp|cup|katori|handful)?`) within the 12–20 characters before each hit. Use the same unit table as the PARSE prompt, and apply `half` anywhere in that window. |
| 7 | Medium | `app/nutrition.py` aliases | **Wrong matches that change the numbers.** `cottage cheese` → paneer: Western cottage cheese (USDA 01012) has ~98 kcal and 4 g fat against paneer's 258 kcal and 15 g fat, so Rossi/Reyes families are overstated about 2.6×. `tapioca` → cassava: tapioca pearls/sabudana (USDA 20068) are dry starch at ~358 kcal, against 160 for cassava. `yam` → sweet potato: Caribbean "yam" is Dioscorea (USDA 11601). `chicken breast` → the thigh record (05096). `sevai` → rice noodles, though North Indian sevai is wheat. | `match("cottage cheese").name == "paneer"` | Give each its own row or alias: cottage cheese → 01012, tapioca pearl/sabudana → 20068, yam → 11601, chicken breast → 05062, wheat vermicelli/semiya → pasta 20120. |
| 8 | Medium | `app/nutrition.py` `match()` strictness (live path) | **Common phrasings Nano may produce are "not counted".** Examples: `chicken thighs` (plural), `hard boiled eggs`, `egg yolks`, `onions sliced thin`, `sea salt`, `rock salt`, `sendha namak`, `kala namak`, `dark soy sauce`, `low sodium soy sauce`, `corn oil`, `toned milk`, `skim milk`, `amul butter`, `desiccated coconut`, `multigrain bread`, `processed cheese`. Mock (`find_mentions`) counts several of these, but live (`match`) doesn't, so the two modes disagree. | `match("sea salt") is None` | Add these aliases. Add `thin, thick, finely, roughly, peeled, cubed, hard, soft, beaten, whisked` to FILLER. Add `sea, rock` to SAFE_ADJECTIVES for salt only, or as aliases. Fall back to singularising (strip a trailing `s`/`es`) before giving up. Note that `sea salt` and `rock salt` matter for the BP condition. |
| 9 | Medium | `app/dietitian.py` l.~68–106 `GROUPS` / `avoid_items` | **Dislike and allergy words are matched as plain substrings, so they over-exclude.** `no eggplant` also bans egg. `no coconut milk` and `no almond milk` ban **all dairy**, and coconut triggers the nut group. `no nutmeg` and `butternut` trigger the nut group. `dislikes fish sauce` bans all fish. `no peanut butter` bans butter. Meanwhile `allergic to almonds` bans nothing; it only adds a "couldn't match" note. | `avoid_items("no coconut milk")` returns all 12 dairy foods plus peanuts and cashews. | Match group words on word boundaries. Skip a group word when it's part of a longer known food (coconut milk, eggplant, fish sauce, peanut butter, butternut). Add almonds, walnuts and pistachios to the nut group once those rows exist. |
| 10 | Medium | `static/app.js` l.392–403 `readBook` / l.409 `restoreBook` | **A corrupt or old saved cookbook crashes the restore with no message.** The page is left with no dishes. Uncaught cases: `TypeError: Cannot read properties of null (reading 'grams')` (null ingredient, `baseFields` l.301); `(r.ingredients || []).map is not a function` (adapted with non-array fields); `reading 'slot'` (null meal in a plan, `mealRow` l.1556). `condition: "toString"` passes `in CONDITIONS` and leads to a 422. Bad grams or a non-string name surface as raw server validation text on the card ("Please check: grams: Input should be greater than 0."). Invalid JSON is handled fine, and saved XSS strings are escaped. | Put `{"v":1,"recipes":[{"id":"a","base":{"name":"X","ingredients":[null]}}]}` in `localStorage['hp-cookbook-v1']`, reload and click "Plan this week". | In `readBook`, validate deeply: ingredients are `{item: string, grams > 0}`, and drop `adapted` unless its arrays are arrays. Drop plan days whose meals aren't objects. Use `Object.hasOwn(CONDITIONS, d.condition)`. Wrap `restoreBook` in try/catch, and on failure `clearBook()` and toast "Couldn't open the saved cookbook". |
| 11 | Medium | `app/engine.py` `build_recipe` (`source_text[:1000]`) vs `#recipeText maxlength=2000` | **Editing a long recipe silently drops its second half.** The server keeps only the first 1000 characters of the source text, and "Edit recipe" refills the box from that (`recipeAsText`, l.1083). | Parse a 2000-char recipe, click "Edit recipe": the textarea now has 1000 chars. | Raise `source_text` to 2000 on both `Recipe.source_text` and `build_recipe`, or cap the textarea at 1000. |
| 12 | Medium | `static/styles.css`, intake at 320 px | **The page scrolls sideways at 320 px.** In the intake, the "Cooking for − N people +" stepper overflows to 345 px. In the week view, the ready-bar "Copy as text" button overflows to 328 px. | 320×640 viewport: load a family, then Plan my week. `scrollWidth` is 345. | Let `.q-row` wrap (`flex-wrap: wrap`), and let the stepper and `.ready-btns` wrap or shrink (`min-width: 0`). |
| 13 | Medium | `static/app.js` l.808 / l.1018 `askDish` | **Each "Ask" starts again from the original recipe.** It sends `baseFields(e.base)`, so after "no onion" then "less spicy", the onion is back. | Ask "no ghee", then tap the "Less spicy" chip. The ghee is restored. | Send the current adapted ingredients plus the earlier requests, or show that each ask replaces the last one. |
| 14 | Low | `static/app.js` l.1821 | `const plan = state.plan && !state.planStale ? state.plan : state.plan;` is a no-op: both branches return `state.plan`. A stale week prints in the cookbook with no "out of date" label. | Code review | Show the stale warning in the cookbook view, or leave out the stale plan. |
| 15 | Low | `static/app.js` l.2037 | **Remove takes one tap, with no confirm or undo,** on a dish that may hold an AI adaptation and asks. | Click Remove. | Add an Undo toast, as the ask "Undo" already does. |
| 16 | Low | `static/app.js` l.2157 | **Escape doesn't close the composer or the intake.** It only closes the cookbook or cancels planning. | Open Edit, press Esc. | Make Esc close the composer and intake, the same as Cancel / Not now. |
| 17 | Low | `static/app.js` l.2037 + composer | If you remove the dish that's open in "Edit the recipe", then submit, a new dish is created. The title still says "Edit". | Code review | Close the composer, or reset `editingId`, when the dish being edited is removed. |
| 18 | Low | `static/index.html` `#pAge min=18` vs `cleanProfile` 1–120 | The age limits disagree, though the server handles under-18. | | Use the same limits in both. |
| 19 | Low | API 422 text | `>2000` chars pasted into the box (bypassing maxlength) shows "Please check: text: String should have at most 2000 characters." | | Map it to "That recipe is too long; keep it under 2,000 characters." |
| 20 | Low | `data/ingredients.csv` | `corn flour` → cornmeal but `cornflour` → cornstarch. In India and the UK both mean cornstarch. `masa` → cornmeal, though nixtamalised masa harina is USDA 20317. | | Make both mean cornstarch, and give masa its own row. |

### What passed (no action needed)

- **XSS:** `<img onerror>`, `<script>`, `<svg onload>`, quotes and emoji in the recipe text, the ask box, saved-cookbook fields (parent name, family name, dish id and name, ingredient) and the trace dialog were all rendered as text. No dialog fired. Every `innerHTML` assignment in `app.js` builds from `esc()` / `safeUrl()`, numbers, or fixed constants. `pickHTML`'s `name="${name}"` is unescaped but only ever gets constants.
- **Empty submit:** shows "Say or type a recipe first." and focuses the textarea. A recipe with nothing recognised shows the server's 422 message.
- **Double clicks:** double-clicking Make it lighter, Ctrl+Enter twice, double-clicking Plan my week, and Plan another week then Cancel each sent one request. The progress view's Cancel works, and focus goes back to "Your week".
- **Removing a dish mid-batch:** the batch carries on, the late reply is dropped, and focus moves to "Your lighter recipes". A busy card has no Remove link.
- **429:** per-card "Lots of requests right now. Please wait a few minutes and try again." The week shows the same text with Try again / Change preferences.
- **Network failure** (route abort) on adapt, parse, week and initial load: friendly "Can't reach the server…" text. Families show "didn't load" with a Try again button.
- **localStorage:** works when the getter throws (SecurityError) and when `setItem` throws (quota). The theme toggle still works.
- **Contrast:** an automated WCAG text-contrast scan in light and dark (home, dishes with all details open, intake, week, cookbook) found nothing under 4.5:1, or 3:1 for large text.
- **Keyboard:** the skip link comes first, focus rings are 3 px solid, tabs follow ARIA arrow/Home/End, the dialog focuses Close and returns focus to "How it works", and Esc leaves the cookbook. After actions, focus goes to a sensible heading (dish h3, "Your week", intake title).
- **Print:** only `#cookbookView` prints; header, footer, toolbar and dialog are hidden. `beforeprint` renders the cookbook even from the main view.
- **Share fallback:** with no `navigator.share`, the button reads "Copy as text" and toasts "Copied as text. Paste it anywhere."
- **Console:** no uncaught errors in normal flows. The only errors were the expected 422/429/network failures, and the corrupt-storage crashes in #10.
- **Data integrity:** `ingredients.csv` and `foods.csv` have the same names, aliases and default_g. There are no duplicate aliases, and every ingredient in `meals.json`, `demo_families.json` and `facts.json` matches.

One transient error appeared: during the run, while the other agent was mid-edit, the page threw `Cannot read properties of null (reading 'addEventListener')` because `index.html` and `app.js` briefly disagreed on IDs. It went away on reload with the next version. Worth a final load test before you ship.

---

## Part 1: does everything count?

How to read the table: "match" is `nutrition.match(item)` and decides what's counted after a live parse. "mock" is `find_mentions(text)` and decides what's counted after a demo parse. "—" means not counted.

### A. Ingredient → result

| Ingredient (as typed) | match (live) | mock | Verdict |
|---|---|---|---|
| almonds / badam | — | — | **not counted** |
| walnuts / akhrot | — | — | **not counted** |
| pistachios / pista | — | — | **not counted** |
| cashews / kaju | cashews | cashews | ok |
| peanuts / moongphali | peanuts | peanuts | ok |
| mixed nuts / dry fruits / nuts | — | — | **not counted** |
| raisins / kishmish | — | — | **not counted** |
| dates / khajoor | — | — | **not counted** |
| chia seeds, flax seeds / alsi, sesame seeds / til | — | — | **not counted** |
| makhana / fox nuts, sunflower/pumpkin/melon seeds | — | — | **not counted** |
| coconut / nariyal | grated coconut | grated coconut | ok |
| desiccated coconut | — | grated coconut | live: not counted |
| coconut milk | coconut milk | coconut milk | ok (not milk ✓) |
| coconut water | — | grated coconut | **wrong match (mock)** |
| coconut cream | — | coconut + heavy cream | **wrong match (mock)** |
| egg / eggs / 2 eggs / anda / ande / itlog / huevo / boiled egg | egg | egg | ok |
| huevos / jidan (鸡蛋) | — | — | **not counted** |
| egg whites / egg yolks / hard boiled eggs | — | egg | live: not counted; mock counts as whole egg |
| egg noodles | egg noodles | egg noodles | ok (not egg ✓) |
| butter / makhan | butter | butter | ok |
| amul butter | — | butter | live: not counted |
| peanut butter | — | **butter** | live: not counted; **mock wrong match** |
| ghee / desi ghee | ghee | ghee | ok |
| cheese / cheddar / mozzarella / parmesan | cheddar / mozzarella / parmesan | same | ok |
| cream cheese | — | heavy cream + cheddar | **wrong match (mock)** |
| feta | — | — | **not counted** |
| processed cheese | — | cheddar | live: not counted |
| cottage cheese | **paneer** | **paneer** | **wrong match** (see #7) |
| queso | — | — | not counted (queso fresco ok) |
| cream / malai / fresh cream | heavy cream | heavy cream | ok |
| ice cream | — | heavy cream | **wrong match (mock)** |
| milk / doodh / 2% milk | whole milk | whole milk | ok (2% counted as whole) |
| toned / skim / skimmed / low-fat milk | — | whole milk | live: not counted |
| soy milk / almond milk | — | **whole milk** | **wrong match (mock)** |
| condensed milk / evaporated milk / milk powder | — | **whole milk** | **wrong match (mock)** |
| leche | — | — | not counted |
| buttermilk / chaas | — | — | **not counted** |
| curd / dahi / yogurt / greek yogurt | yogurt | yogurt | ok |
| oil / mustard / olive / coconut / groundnut / sesame / peanut oil | ✓ | ✓ | ok |
| corn oil / aceite | — | vegetable oil / — | live: not counted |
| sugar / brown sugar / honey / jaggery / gur | ✓ | ✓ | ok (brown sugar ≠ sugar ✓) |
| powdered / icing sugar | — | sugar | live: not counted |
| maple syrup / stevia / jam | — | — | not counted |
| rice / chawal / basmati / sona masoori / jasmine rice | white rice | white rice | ok |
| arroz / kanin / mifan | — | — | **not counted** |
| rice flour | — | **white rice + maida** | **wrong match (mock)** |
| brown rice flour | — | brown rice + maida | **wrong match (mock)** |
| atta / maida / besan / suji / sooji / ragi / bajra / jowar | ✓ | ✓ | ok |
| chickpea flour | gram flour | gram flour | ok (= besan ✓) |
| upma rava / idli rava | — | semolina | live: not counted |
| sabudana / tapioca pearls | — / cassava | — | not counted / **wrong match** |
| toor / moong / masoor / chana dal | ✓ | ✓ | ok |
| urad dal | — | — | **not counted** |
| dal (generic) / half katori dal | — | — | **not counted** |
| rajma / chole | kidney beans / chickpeas | same | ok |
| lobia / black eyed peas | — | — / **green peas** | not counted / **wrong match (mock)** |
| okra / bhindi, karela, lauki, methi, palak, cabbage, capsicum | ✓ | ✓ | ok |
| drumstick / moringa / malunggay | — | — | **not counted** |
| pumpkin / kaddu, beetroot, radish / mooli, tinda, turai / ridge gourd, arbi, jackfruit / kathal, kale, kangkong, corn / bhutta / sweet corn | — | — | **not counted** |
| sweet potato | sweet potato | sweet potato | ok (≠ potato ✓) |
| sweet potato leaves / potato starch | — | sweet potato / potato | **wrong match (mock)** |
| sprouts / moong sprouts | — | — | not counted (bean sprouts ok) |
| banana / apple / mango / lemon / lime | ✓ | ✓ | ok |
| berries / strawberries / blueberries, orange, grapes, papaya, pineapple, guava, watermelon, pomegranate / anar, pear, kiwi, chikoo, litchi | — | — | **not counted** |
| chicken / murgh / pollo / chicken breast / chicken thigh / boneless chicken | chicken | chicken | ok (breast uses the thigh record) |
| chicken thighs / chicken breast boneless | — | chicken | live: not counted |
| mutton | goat meat | goat meat | ok |
| keema | lamb | lamb | ok-ish |
| chicken keema / mutton keema | — | **chicken + lamb** / goat + lamb | **double count (mock)** |
| prawns / shrimp / jhinga | shrimp | shrimp | ok |
| fish / rohu / salmon / cod | ✓ | ✓ | ok |
| tuna, sardines, pomfret, surmai, tilapia, bangus | — | — | **not counted** |
| beef / pork / lamb / bacon | ✓ | ✓ | ok |
| turkey, ham, sausage, salami, duck, crab, squid | — | — | not counted |
| chicken stock / broth / stock cube / maggi cube | — | **chicken** / — | **wrong match (mock)**; sodium missed |
| tofu | tofu | tofu | ok |
| doufu, tempeh, soy chunks / nutrela | — | — | **not counted** |
| bread / white / brown bread / pav | ✓ | ✓ | ok |
| multigrain bread | — | white bread | live: not counted |
| roti / chapati / paratha / naan / "4 rotis" | — | — | **not counted** (very common) |
| noodles / hakka noodles | egg noodles | egg noodles | ok |
| maggi / instant noodles / ramen | — | — / egg noodles | not counted |
| vermicelli / semiya | — | — | not counted |
| oats | rolled oats | rolled oats | ok |
| cornflakes, muesli | — | — | **not counted** |
| chocolate / dark chocolate / cocoa | — | — | **not counted** |
| ketchup / tomato ketchup | — | — / **tomato** | not counted / wrong match (mock) |
| tomato paste / puree / canned tomatoes | — | tomato | live: not counted |
| mayonnaise / mayo | — | — | **not counted** |
| pickle / achar / lime pickle / mango pickle | — | — / lime / mango | not counted / wrong match (mock) |
| papad | — | — | **not counted** |
| salt / namak | salt | salt | ok |
| sea salt / rock salt / sendha namak / kala namak | — | salt | live: not counted (matters for BP) |
| soy sauce / toyo / light soy sauce | soy sauce | soy sauce | ok |
| dark / low-sodium soy sauce | — | soy sauce | live: not counted |
| black pepper, tamarind / imli, curry leaves, hing, mint / pudina, coriander seed / dhaniya, cardamom, saffron | — | — | not counted (negligible nutrients, but the label is noisy) |

### B. Units, mock vs live prompt

| Input | Mock `/api/parse` today | What the live PARSE prompt says | Gap |
|---|---|---|---|
| `2 eggs` | egg 100 g (fixed default) | 1 egg = 50 g → 100 g | Mock is right only by coincidence. `1 egg` and `6 eggs` also give 100 g. |
| `4 rotis` | nothing (dropped silently) | no roti rule; Nano may write "roti" (not counted) or guess atta | Add "1 roti ≈ 30 g atta" to the prompt and a `roti` alias. |
| `a handful of almonds` | nothing | 1 handful = 30 g, but "almonds" isn't in the names list | Needs an almonds row. |
| `1 tbsp ghee` | ghee 30 g | 13 g | Mock overcounts 2.3×. |
| `half katori dal` | nothing ("dal" alone isn't known) | 1 katori raw lentils = 100 g, half implied | Prompt doesn't say if katori is cooked or raw; "dal" has no default. |
| `half katori moong dal` | moong dal 200 g (half ignored) | ≈ 50 g | Mock only halves when "half" comes right before the food. |
| `200 ml milk` | whole milk 500 g | no ml rule | Add "1 ml milk/curd/oil ≈ 1 g (oil 0.92)". |
| `chicken 300g` | chicken 500 g | grams kept | Mock ignores explicit grams. |
| `2 bowls cooked rice` (app's own East Asian example) | white rice 300 g | "Use RAW weights" with no ratio | High risk of 3× carbs live (#3). |

### C. False-match checks requested

| Phrase | match (live) | mock | OK? |
|---|---|---|---|
| peanut butter | — | butter 20 g | live ok; **mock wrong** |
| coconut milk | coconut milk | coconut milk | ok |
| egg noodles | egg noodles | egg noodles | ok |
| sweet potato | sweet potato | sweet potato | ok |
| brown sugar | brown sugar | brown sugar | ok |
| rice flour | — | rice + maida | live ok (but not counted); **mock wrong** |
| chickpea flour | gram flour | gram flour | ok |

### D. Missing items, ranked by how often families would use them, with suggested rows

Notes on this table:
- No nutrient numbers are given. Each row names the published record that `scripts/build_foods.py` should pull.
- IDs marked *(verify)* are the nearest record I'm aware of. Check them against ABBREV.txt or the IFCT index before adding.
- `default_g` is a family-recipe default in the same spirit as the existing rows.

| Rank | name | aliases | category | default_g | source record |
|---|---|---|---|---|---|
| 1 | *(no new food)* roti/chapati/phulka/paratha | handle in PARSE prompt (≈30 g atta per roti, +fat for paratha); optional alias → whole wheat flour only when Nano gives atta grams | grain | — | IFCT A019 (atta), already in table |
| 2 | almonds | badam\|almond | nuts | 30 | USDA SR28 12061 "Nuts, almonds" |
| 3 | urad dal | black gram dal\|udad dal\|urad\|mash dal | legume | 200 | IFCT 2017 B003 "Black gram, dal" *(verify)* |
| 4 | toned milk | skim milk\|skimmed milk\|low fat milk\|double toned milk\|nonfat milk | dairy | 500 | USDA SR28 01085 "Milk, nonfat" (skim); 01082 "Milk, lowfat 1%" for toned *(verify the IFCT equivalent)* |
| 5 | raisins | kishmish\|kismis\|sultanas | fruit | 30 | USDA SR28 09298 "Raisins, seedless" |
| 6 | dates | khajoor\|khajur\|medjool dates | fruit | 50 | USDA SR28 09087 "Dates, deglet noor" (or 09421 medjool) |
| 7 | walnuts | akhrot\|walnut | nuts | 30 | USDA SR28 12155 "Nuts, walnuts, english" |
| 8 | egg white | egg whites\|anda safedi | protein | 100 | USDA SR28 01124 "Egg, white, raw, fresh" |
| 9 | orange | oranges\|santra\|narangi\|naranja\|dalandan | fruit | 150 | USDA SR28 09200 "Oranges, raw, all commercial varieties" |
| 10 | papaya | papita\|papaya\|lechosa | fruit | 200 | USDA SR28 09226 "Papayas, raw" |
| 11 | guava | amrood\|bayabas\|guayaba | fruit | 150 | USDA SR28 09139 "Guavas, common, raw" |
| 12 | grapes | angoor\|uvas\|ubas | fruit | 150 | USDA SR28 09132 "Grapes, red or green" |
| 13 | pomegranate | anar\|granada | fruit | 150 | USDA SR28 09286 "Pomegranates, raw" |
| 14 | pineapple | ananas\|pina\|pinya | fruit | 150 | USDA SR28 09266 "Pineapple, raw, all varieties" |
| 15 | berries | strawberries\|blueberries | fruit | 150 | USDA SR28 09316 "Strawberries, raw" / 09050 "Blueberries, raw" (two rows) |
| 16 | buttermilk | chaas\|chhachh\|mattha\|majjige | dairy | 250 | USDA SR28 01088 "Milk, buttermilk, fluid, cultured, lowfat" |
| 17 | pistachios | pista | nuts | 20 | USDA SR28 12151 "Nuts, pistachio nuts, raw" |
| 18 | peanut butter | peanut butter\|mani butter | nuts | 30 | USDA SR28 16098 "Peanut butter, smooth style" (also fixes the mock false match) |
| 19 | chia seeds | chia | nuts | 15 | USDA SR28 12006 "Seeds, chia seeds, dried" |
| 20 | flaxseed | flax seeds\|alsi\|linseed | nuts | 15 | USDA SR28 12220 "Seeds, flaxseed" |
| 21 | sesame seeds | til\|til seeds\|ajonjoli | nuts | 15 | USDA SR28 12023 "Seeds, sesame seeds, whole, dried" |
| 22 | mixed nuts | dry fruits\|nuts | nuts | 30 | USDA SR28 12135 "Nuts, mixed nuts, dry roasted, with peanuts" *(verify)* |
| 23 | lobia | black eyed peas\|cowpeas\|chawli | legume | 200 | USDA SR28 16062 "Cowpeas, common, mature seeds, raw" (or IFCT cowpea B005/B006 *(verify)*) |
| 24 | rice flour | chawal ka atta\|galapong\|harina de arroz | grain | 150 | USDA SR28 20061 "Rice flour, white" |
| 25 | cottage cheese (Western) | cottage cheese (move off paneer)\|requeson | dairy | 200 | USDA SR28 01012 "Cheese, cottage, creamed" |
| 26 | tuna | canned tuna\|tuna can | protein | 150 | USDA SR28 15121 "Fish, tuna, light, canned in water" |
| 27 | sardines | sardinas\|tamban | protein | 150 | USDA SR28 15088 "Fish, sardine, Atlantic, canned in oil" |
| 28 | tilapia | pla nil | protein | 400 | USDA SR28 15261 "Fish, tilapia, raw" |
| 29 | milkfish | bangus | protein | 400 | USDA SR28 milkfish raw *(verify ID)* |
| 30 | soy chunks | nutrela\|soya chunks\|tvp\|meal maker | legume | 100 | USDA SR28 16117 "Soy flour, defatted" as nearest *(verify; or IFCT soya bean)* |
| 31 | tempeh | | legume | 200 | USDA SR28 16114 "Tempeh" |
| 32 | sweet corn | corn\|bhutta\|makai\|mais\|elote | vegetable | 150 | USDA SR28 11167 "Corn, sweet, yellow, raw" |
| 33 | pumpkin | kaddu\|kalabasa\|calabaza | vegetable | 300 | USDA SR28 11422 "Pumpkin, raw" |
| 34 | beetroot | chukandar\|beet | vegetable | 150 | USDA SR28 11080 "Beets, raw" |
| 35 | radish | mooli\|labanos\|daikon | vegetable | 200 | USDA SR28 11429 "Radishes, raw" |
| 36 | taro | arbi\|gabi\|colocasia | vegetable | 250 | USDA SR28 11518 "Taro, raw" |
| 37 | drumstick | moringa pods\|sahjan\|malunggay pods | vegetable | 150 | IFCT 2017 drumstick pod *(verify D-series ID)* |
| 38 | moringa leaves | malunggay\|sahjan ke patte | vegetable | 50 | IFCT 2017 drumstick leaves *(verify C-series ID)* |
| 39 | ridge gourd / tinda / turai / kangkong | each as its own row | vegetable | 300 | IFCT 2017 D-series (ridge gourd, round gourd); USDA 11505 "Swamp cabbage (kangkong)" *(verify)* |
| 40 | stock cube | maggi cube\|bouillon\|knorr cube\|chicken stock cube | sauce | 10 | USDA SR28 bouillon cube *(verify ID)*; high sodium, so it matters for BP |
| 41 | ketchup | tomato ketchup\|catsup\|banana ketchup | sauce | 30 | USDA SR28 11935 "Catsup" |
| 42 | mayonnaise | mayo | fat | 30 | USDA SR28 04025 "Salad dressing, mayonnaise, regular" |
| 43 | sweetened condensed milk | condensed milk\|milkmaid\|leche condensada | dairy | 100 | USDA SR28 01095 "Milk, canned, condensed, sweetened" |
| 44 | evaporated milk | leche evaporada | dairy | 150 | USDA SR28 01096 *(verify)* |
| 45 | ice cream | | dairy | 100 | USDA SR28 19095 "Ice creams, vanilla" |
| 46 | dark chocolate | chocolate | sweetener | 30 | USDA SR28 19904 "Chocolate, dark, 70-85% cacao solids" (and 19120 milk chocolate) |
| 47 | cornflakes | corn flakes | grain | 50 | USDA SR28 corn flakes cereal *(verify ID)* |
| 48 | tapioca pearls | sabudana\|sago | grain | 150 | USDA SR28 20068 "Tapioca, pearl, dry" (remove "tapioca" from cassava) |
| 49 | yam (Dioscorea) | name\|ñame\|ube | vegetable | 300 | USDA SR28 11601 "Yam, raw" (remove "yam" from sweet potato) |
| 50 | chicken breast | chicken breast\|boneless chicken breast | protein | 500 | USDA SR28 05062 "Chicken, broilers or fryers, breast, meat only, raw" |
| 51 | pickle (achar) / papad | | | | **No suitable record in IFCT 2017 or SR28** (SR28 11937 is a dill cucumber pickle, not oil-and-salt achar). Leave these "not counted", but show a BP warning: "pickle and papad are very salty". |

Alias-only additions to existing rows (cheap, no new data):

- white rice: `arroz|kanin|mifan|chawal`
- egg: `huevos|jidan|anda bhurji eggs|hard boiled eggs|boiled eggs`
- whole milk: `leche`
- tofu: `doufu`
- soy sauce: `jiangyou|dark soy sauce|low sodium soy sauce` (low-sodium should get its own SR28 row, 16124 *(verify)*)
- ground beef: `niurou`
- pork: `zhurou`
- napa cabbage: `baicai`
- vegetable oil: `aceite|corn oil`
- salt: `sea salt|rock salt|sendha namak|kala namak|sal de mar`
- butter: `amul butter`
- whole wheat bread: `multigrain bread|atta bread`
- grated coconut: `desiccated coconut` *(or SR28 12108 "Nuts, coconut meat, dried")*
- semolina: `upma rava|idli rava|bombay rava`
- chicken: `chicken thighs|chicken pieces|chicken drumsticks`
- pasta: `vermicelli|semiya|seviyan (wheat)`
- queso fresco: `queso`
- toor dal: `dal` (most common default), or tell Nano which dal to pick.

---

## Method

- **Part 1:** `nutrition.match()` and `nutrition.find_mentions()` were run over ~330 ingredient phrases, and `POST /api/parse` was called in mock mode with mixed-unit inputs. I also checked `foods.csv` against `ingredients.csv`, and the items in the demo, meal and fact data.
- **Part 2:** Playwright (global install, Chromium at `/opt/pw-browsers/chromium`) ran against `MOCK=1 uvicorn app.main:app --port 8070`, plus a second server with `RATE_LIMIT=2` on port 8071 for the 429 checks. Route interception added delays and aborts. Both servers were stopped by PID afterwards.
