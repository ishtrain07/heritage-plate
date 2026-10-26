# Heritage Care: integration spec (for docs/CARE_SPEC.md, ~1.5 days)

Based on the current `static/` (hero, composer, recipe cards, intake, week, `#cookbookView`, How it works dialog, `BOOK_KEY` storage) and `data/facts.json` (checked facts with sources), which Care's evidence library copies.

## 1. One app, two doors

**Header:** logo `Heritage` + segmented switch `Plate | Care` (44px targets; full width under the logo at 375px). Switch sets `#plate` / `#care`. Plate keeps the paprika accent; Care uses curry-leaf green. Same fonts, linen, cards, buttons.

**Umbrella home** (first visit; returning users land on their last side):
- Eyebrow: `For families who look after each other`
- Headline: `Keep what works from home.` / *`Fix what doesn't.`*
- Sub-line: `Your family's recipes made lighter, and your home remedies checked against the evidence. In your words, in any language.`
- Two equal door cards, one button each:
  - `Food` · `Mum's recipe, lighter, with a week of meals.` → `Start with a recipe`
  - `Skin & hair` · `Is haldi, coconut oil or lemon actually helping?` → `Check a home remedy`
- Trust line: `Food numbers from food tables · Remedies checked against cited sources · No ads, no brands`

Plate's current hero becomes `#plate`, unchanged. Plate's flows stay as they are.

## 2. Shared family

Saved book moves to `v: 2`: `country` + `family: [{id, name, age, sex?, language, conditions[], skin[], hair[], pregnant?}]`. Plate's "Who is it for?" writes person 1; Care adds more. Once anyone is saved, both sides show a chip row `Mum · Dad · Riya · + Add`. `v:1` profiles migrate to person 1.

## 3. Care's three jobs

**`#care` landing**
- Eyebrow: `Heritage Care · skin & hair`
- Headline: `The remedies you grew up with.` / *`Kept, tweaked or swapped.`*
- Sub-line: `Say it the way it's said at home. We tell you what the evidence says and what actually does the job.`
- Primary (mic): `Say a remedy`. Secondary: `Type one`. Example chips: `besan haldi ka lep` · `coconut oil in hair every night` · `lemon on dark spots` · `toothpaste on a pimple`
- Quieter links below: `Make a care plan for someone →` · `Check a product label →`

**Job 1: Remedy check (the hook).** Reuses Plate's mic, textarea and speech-language select. Button `Check it`. Result card:
- Verdict pill with word and colour: `Keep` (green) · `Fine with care` (saffron) · `Swap` (paprika outline) · `Stop` (error ink).
- The remedy in the user's words as the heading.
- `What the evidence says`: 2–3 plain sentences.
- `What does the job`: ingredient + strength (`Benzoyl peroxide 2.5%`), `Where to find it` by country (`Pharmacy, no prescription`), `On the label look for: benzoyl peroxide`.
- `How to keep it safely` (Keep / Fine with care only): `Patch-test behind the ear for 2 days. Rinse within 10 minutes.`
- Badge: `Checked: 3 sources` (expands), or muted `AI-assessed, not in our checked library`.
- Actions: `Add to family book` (primary) · `Check another`.

**Job 2: Care plan.** `Who is this for?` (family chips) → `Skin` (Oily / acne-prone · Dry · Sensitive / eczema-prone · Dark spots) → `Hair & scalp` (Dandruff · Thinning · Dry / frizzy) → `Looking for` (`men's body wash`, `shampoo`) → `Pregnant or breastfeeding` when relevant. Button `Make their routine`. Output: `Morning` / `Night`, each step = product type + active + strength + one-line why. A red flag (patchy or sudden hair loss, painful lumps, spreading rash, changing mole) puts a calm callout first: `Worth a doctor's visit first` + the reason; the routine still shows below it. Pregnancy removes retinoids with `Skip retinoids while pregnant or breastfeeding.` Prescription items appear only as `Ask your doctor about tretinoin`.

**Job 3: Label check.** `Paste the ingredients list` (placeholder `Aqua, Glycerin, Niacinamide, Parfum…`) + person. Button `Check this label`. Output: `Helps with` (actives), `Watch out` (fragrance in first five, essential oils, drying alcohol), and fit: `Not ideal for Dad's eczema: fragrance is 4th.`

**Behind disclosure (`Why we say this`):** sources, strength reasoning, INCI matches. Model names only in How it works.

## 4. States

- Empty: `Say or type a remedy first, the way it's said at home.`
- Loading: `Checking what the evidence says…` / `Building Riya's routine…` / `Reading the label…` (skeleton cards)
- Error: `We couldn't check that just now. Try again.` → `Try again`
- Off-topic: `We only check skin and hair remedies for now.`
- Care footer: `General skincare information, not medical advice. If something hurts, spreads or changes, see a doctor.`

## 5. "Your family book"

The cookbook becomes `The Gill family book`: **Food** (dishes, week, note), **Care** (a page per person: routine, kept remedies, swaps), then **one shopping list** grouped `Kitchen` / `Skin & hair` (product types + actives, no brands). The parent's note gains one Care line when they have a plan. Ready bar: `Your family book is ready` · `Print or save PDF` · `Share`. Sides with no content are left out.

## 6. Backend (minimal)

- `data/remedies.json` (~25 entries: multi-language aliases, verdict, evidence, swap active, strength, safety, sources) and `data/actives.json` (~40 INCI names: role, irritant, pregnancy flag).
- `POST /api/care/remedy` `{text, language, country}` → `{verdict, evidence, swap{active,strength,where}, safety, grounded, sources[]}`. Code matches aliases first and grounds Nemotron Super; no match → `grounded:false`. Verdict enum validated.
- `POST /api/care/plan` → `{am[], pm[], red_flags[], ask_doctor[]}`. Red flags and the pregnancy/retinoid rule are enforced in code after the model.
- `POST /api/care/label` → `{helps[], watch[], fit}`. Parsing is done in code.
- Mock mode: fixed answers for the four example chips.

## 7. Must / Should (~1.5 days)

**Must:** switch + umbrella home; remedy check end to end (endpoint, library, card, grounded badge, mock); care plan with red flags and pregnancy rule; family book Care section + combined list; `v:2` shared family.
**Should:** label check; country picker; voice on Care; Care line in the note; How it works Care row.

## 8. Video beats (≤40 s)

1. (0–20 s) Home → `Check a home remedy`, say "besan haldi ka lep for Riya's pimples" → `Fine with care`, `Checked: 3 sources`. Tap "toothpaste on a pimple" → `Swap` → `Benzoyl peroxide 2.5%, pharmacy`.
2. (20–40 s) `Make their routine` for Dad: dandruff + "men's body wash" → Morning/Night. Tick patchy hair loss → doctor callout. Open `Your family book`: Food, Care, one list, `Print or save PDF`.
