# Heritage Plate: product spec (redesign, ~2 days)

Based on driving the app in mock mode at 1280px and 375px (home, demo family, adapted dishes, week plan, "use your own recipes").

## 1. Purpose and the promise above the fold

**Purpose (one sentence):** Say or paste your family's recipe the way it's cooked at home, and get back a lighter version you can actually cook (amounts, steps, portion), plus a week of meals, a shopping list and a note for the person you cook for.

**Above the fold (replaces the current hero copy; keep the example card on the right, below the text on mobile):**

- Eyebrow: `Family recipes, made healthier`
- Headline (Fraunces, keep the paprika italic line): `Your family's recipes.` / *`Made lighter, still home.`*
- Sub-line: `Say Mum's recipe the way she says it. We give it back lighter, with amounts, steps and a week of meals. Built for families cooking for a parent with diabetes, blood pressure or cholesterol.`
- Primary CTA (paprika, mic icon): `Say a recipe`
- Secondary CTA (outline): `Type or paste one`
- Tertiary text link: `No recipe handy? Try a sample family ↓`
- Under the CTAs, one line of trust: `Numbers from food tables, not guesses · Any cuisine · Free`

Why: "Fix the numbers" is abstract and the hero has **no button**. A user can't tell in 5 seconds what to do or what they get. The new copy states the input (your recipe, by voice), the output (lighter recipe you can cook + week), and the strongest story (parent with a condition) without excluding everyone else.

## 2. Top problems, ranked, with fixes

1. **No action in the first screen.** Hero is copy + chips; the first button is a family card below a step-pill bar. **Fix:** CTAs in the hero (above). Remove the three-pill step nav; it duplicates "Step 1 of 3" and looks like a form wizard.
2. **The output isn't a recipe.** After "Make every dish lighter" the user gets a % and a gram-only ingredient diff. You can't cook from it. **Fix:** every adapted dish becomes a recipe card: ingredients with amounts, numbered method, portion line (section 4, screen B).
3. **Voice is buried.** It exists (`#mic`, Web Speech API), but only inside the collapsed "Add a family recipe" box, at the bottom of step 2, and is hidden when unsupported. **Fix:** voice is the hero's primary CTA and the default state of the recipe composer. When speech isn't supported, the button still shows and opens the composer in typing mode with the line `Voice works in Chrome and Safari. You can type it here instead.`
4. **AI plumbing is in the user's face.** Header badge "Demo mode", footer "Under the hood: which AI model did what" with model IDs and per-call latency, and note label "English (written in Punjabi when live)". **Fix:** remove the header badge and the trace from the main page. One footer link `How it works` opens a modal (section 4, screen E) for judges. In mock mode, the note label is just `A note for Mum`; the demo caveat moves into How it works.
5. **"Use your own recipes" lands on a form, not a recipe box.** It opens "About them" with the name field focused and pushes the actual recipe box below an empty state. **Fix:** own-recipe goes straight to the composer; "who is it for" is optional and asked after the first dish is adapted.
6. **No end product.** Nothing to keep: no save, print or share of the cookbook; only "Copy the note" and copy-list. Reloading loses everything. **Fix:** "Your family cookbook" screen with Print / Save as PDF and Share (section 3).
7. **Clutter / unpremium details.** Each dish card shows the before/after twice (big numbers and bars); "Why this helps" sits between the families and step 2; three chips wrap awkwardly at 375px; the week plan (mock) repeats the same breakfast 7 days. **Fix:** one number treatment per card (big numbers; drop the bars on dish cards, keep them only in the hero example); move "Why this helps" into How it works; chips become the single trust line; ask backend mock planner to rotate breakfasts.
8. **Can't edit or reuse.** A mis-heard ingredient can't be fixed; no way to come back next week. **Fix:** `Edit recipe` on each card reopens the composer with the original text; cookbook persists in `localStorage` on this device (wrapped in try/catch), with `Plan another week` reusing saved dishes.

## 3. The end game

**What the user walks away with: "The [Name] family cookbook"**, a single printable/shareable page containing:

1. A cover line: `Lighter family recipes for Mum · diabetes` (or `for everyday` when no condition).
2. Each dish as a full recipe card: name, serves, ingredients with amounts (changed ones marked), numbered steps, portion tip, one line "What we changed and why", and the focus number before → after.
3. This week's plan (7 rows, compact table).
4. Shopping list, grouped, with quantities.
5. The note for the parent, in their language, large type, so it can be printed and stuck on the fridge or sent on WhatsApp.
6. Footer: "Numbers from IFCT 2017 / USDA food tables. Not medical advice."

**How they get it:** the flow always ends on a `Your cookbook is ready` bar with three buttons: `Print or save PDF` (`window.print()` with a print stylesheet: one dish per page, no nav, no colours that waste ink), `Share` (`navigator.share` with the plain-text cookbook; fallback `Copy as text`), and `Send the note to Mum` (share just the note). No accounts, no backend endpoint needed.

Screen path: Hero → Composer (say/type) → Recipe card (adapted) → `Add another dish` or `Plan our week` → Week → Cookbook.

## 4. Screen-by-screen

### A. Home
Order: header (logo, theme toggle only) → hero (copy, CTAs, example card) → `Try a sample family` row (the 4 demo cards, horizontal scroll on mobile; tapping one loads its dishes and jumps straight to adapted recipe cards, auto-running the adapt) → footer (`How it works` · `Not medical advice. Check changes with their doctor.`).

### B. Composer (first-class recipe entry)
- Heading: `Tell us the recipe`
- Big circular mic button (paprika, 72px) with label `Tap and say it the way she says it`. Example under it, muted: *"3 katori atta, 2 boiled aloo, ghee on top, serves 4"*.
- While listening: pulsing ring, live transcript appears in the textarea, button label `Done`.
- Below: textarea (always visible, placeholder `Or type or paste it here: dish name, then what goes in. Home measures are fine.`), Serves stepper.
- Goal picker (segmented, 4 options): `Everyday lighter` · `Diabetes` · `Blood pressure` · `Cholesterol`. Default `Everyday lighter` for own recipes; demo families preset theirs. Helper line per option (existing focus hint copy; for Everyday: `Fewer calories, less fat and salt, more vegetables.`).
- Cuisine select stays, collapsed under `Cooking style: South Asian · Change`.
- Primary button: `Make it lighter`. Empty state error: `Say or type a recipe first.`

### C. Recipe card (the core output)
Top: meal tag, dish name, `Serves 4`, big focus number `62 → 47 g sugar-raising carbs per serving` with `25% less` tag.
Then, open by default for the first dish, collapsed (`Show recipe`) for the rest:
- **Ingredients** (lighter version): `180 g whole wheat flour (was 300 g)`; new items get a `new` tag; removed items listed last struck through. Show grams; show `home_measure` in brackets when the backend gives one.
- **Method**: numbered list from `method`. Steps that implement a swap get a small saffron dot.
- **Portion**: a curry-leaf callout with `portion_tip`, e.g. `One paratha with a bowl of raita and salad. Fill half the plate with vegetables first.`
- **What we changed**: the existing changes list (what + why), max 4.
- Disclosure links: `Where the numbers come from`, `Show the original`, `Edit recipe`.
Card footer actions: `Add another dish` (secondary) · `Plan our week` (primary, sticky on mobile once ≥1 dish).

### D. Week
Heading `Your week`. Tabs stay: `Meals` · `Shopping list` · `Note for Mum`. Each meal cell links to its recipe card. Sticky bottom bar: `Your cookbook is ready` → `Print or save PDF` · `Share`.

"Who is it for" appears here only if not set, as an inline optional prompt: `Who are you cooking for? (optional)` name + language, so the note is written to them. If skipped, no note tab; the plan still works.

### E. How it works (modal from footer; for judges)
Three short rows: `Reads your recipe — NVIDIA Nemotron Nano`, `Suggests lighter swaps and writes the steps — Nemotron Super`, `Plans the week and writes the note — Nemotron Ultra`, then `Numbers are computed in code from IFCT 2017 and USDA tables, never by the AI.` A small `Technical details` disclosure inside holds model IDs, this session's call trace with latency/tokens, and `Running in demo mode` when mocked. This is the only place those appear.

### Look and feel
Keep linen/paprika/curry-leaf/saffron, Fraunces + Figtree. Changes: one primary paprika button visible per screen; reduce eyebrow labels (drop "Step N of 3"); recipe cards use more white space and a 17px body for method steps (readable at the stove); print stylesheet in black on white with Fraunces headings.

## 5. Backend changes needed (minimal)

- **`/api/adapt` response** (in progress): `method: [str]` (4–10 imperative steps for the lighter version, amounts inline for changed ingredients) and `portion_tip: str` (one sentence). Mock mode must return both (template steps per dish are fine). Validate: strings ≤240 chars, cap 10 steps; if missing, the UI hides the Method block rather than erroring.
- **Optional** `ingredients[].home_measure: str` (e.g. "1½ katori") from the parse/adapt step. Should, not must.
- **General goal:** add `"everyday"` to `Condition` in `app/main.py`. Focus nutrient: **`kcal` per serving** (`FOCUS_KEY["everyday"] = "kcal"`), with sat fat and sodium shown as secondary lines. Prompt text: "general healthy eating (focus: fewer calories from fat and refined starch, less salt, more vegetables)". Mock rules: apply the fat and salt rules plus a mild starch reduction. Add fallback tips and message for `everyday`.
- **`/api/plan`:** accept empty `language`/no parent → return `message_for_parent: ""`; mock planner rotates breakfasts.
- No new endpoints. Cookbook, print, share and persistence are client-side.

## 6. Must / Should / Could (~2 days)

**Must (day 1):** new hero copy + CTAs; composer with voice as primary (visible even when unsupported, with the fallback line); recipe card with ingredients + method + portion; remove header badge and trace from main flow, add How it works modal; own-recipe goes straight to composer.

**Should (day 2):** cookbook view with print stylesheet and Share/Copy; `Everyday lighter` goal (+ backend); "who is it for" optional and moved after adaptation; Edit recipe; drop duplicate bars and step pills; localStorage cookbook + "Plan another week".

**Could:** `home_measure`; WhatsApp-specific share of the note; read the note aloud (speechSynthesis) in the parent's language.

**3-minute video:** 0:00 the problem in one sentence over the hero. 0:15 tap `Say a recipe`, speak a messy aloo paratha recipe with Punjabi words, watch the transcript. 0:45 lighter recipe card: 62 → 47 g, then scroll the steps and portion tip. 1:20 add a sample family to fill the week; show week, shopping list, note in Punjabi. 2:00 `Print or save PDF`, show the cookbook PDF. 2:30 open How it works: three Nemotron tiers, numbers from food tables not AI. 2:50 closing line: `Your family's recipes. Made lighter, still home.`
