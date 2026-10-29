# Heritage — Devpost project page (ready to paste)

**Project name:** Heritage: Keep what works from home

**Elevator pitch (180/200):** Heritage makes family recipes healthier for diabetes, BP and cholesterol, plans
the week's meals and fact-checks home remedies for skin & hair, in any language, with NVIDIA Nemotron.

---

## About the project (paste everything between the lines)

---

## Inspiration

Every South Asian kitchen has a recipe that nobody ever wrote down.

It lives in Mum's hands: a katori of atta, *thoda sa* ghee, salt "until it tastes right". It's the dal that smelled like coming home from school, the aloo parathas on a Sunday morning, the rajma chawal that fixed every bad day. We don't just eat these dishes. We grew up inside them.

And then there's Nani. Nani, who had a cure for everything. A besan and haldi lep before every wedding. A spoon of coconut oil massaged into your hair on Sunday afternoons, whether you wanted it or not. Nimbu for dark spots, haldi doodh for everything else. Half love, half science, passed down with total certainty.

Then the doctor's visits started. One by one, our parents and grandparents came home with the same words — *diabetes, high blood pressure, cholesterol* — and the same printed sheet: eat brown rice, cut salt, avoid fried food. Nobody said it out loud, but the message was clear: **give up your food.**

We watched what that did. Mum stopped making Dad's favourite parathas, or made them anyway and felt guilty. The kitchen got quieter. And nobody could tell us how much rice or ghee was actually too much, or which of Nani's remedies really helped and which ones (lemon on skin in the sun, toothpaste on a pimple) could quietly do harm.

When we talked to friends, we realised this wasn't just our story. A friend's Lola and her adobo. Another's abuela and her pozole. Different kitchens, different languages, the same pride in recipes handed down for generations, the same grandmother with a remedy for everything, and the same health worries at the table.

These recipes aren't just recipes. They're how our families say *I love you*. Asking someone to give them up isn't diet advice; it's asking them to let go of a piece of home.

So we built Heritage, for every family that doesn't want to choose between their health and their heritage. **Keep what works from home. Fix what doesn't.** Keep the dish, keep Nani's ritual, keep the memory, and make them healthier, in your family's own words and language.

## What it does

Say it the way it's said at home, in any language, by voice or text.

**Heritage Plate (food)**
- Reads a real family recipe ("3 katori atta, 2 boiled aloo, ghee on top") and makes it lighter for diabetes, blood pressure or cholesterol, with a few changes that keep it recognisably Mum's dish.
- Shows honest before → after numbers per serving: Mum's aloo paratha goes from 62 g to 47 g of sugar-raising carbs.
- Plans a week of meals like a dietitian: a personal calorie target, several goals at once, diets from vegan to halal, kosher-style and Jain, allergies respected, one shopping list and a warm note to the parent in their language.

**Heritage Care (skin & hair)**
- Checks any home remedy and gives a clear verdict (keep, fine with care, swap or stop), what it really does, and the proven ingredient that works better, with strength and where to find it. No brands, no sales.
- Builds a simple morning, night and shower routine for each person in the family.
- Reads any product label and flags irritants and dangerous hidden ingredients, like steroids, mercury and hydroquinone in "fairness" creams.

**One family at the centre.** Add Mum, Dad or Nani once and both sides work for them. Everything saves to a family book you can share as a PDF with the doctor.

## How we built it

**Three NVIDIA Nemotron models, each with its own job**, served on **Nebius Token Factory**:

| Step | Model | Why |
|---|---|---|
| Read the recipe from voice or text | Nemotron 3 **Nano** | Fast, structured extraction |
| Make it lighter, check remedies, build care plans, translate | Nemotron 3 **Super** | Careful, constrained reasoning |
| Plan the whole week and write to the parent | Nemotron 3 **Ultra** | Planning across many dishes, in the parent's language |

**The AI never makes up numbers or safety rules.** That was our core design decision.
- Nutrition is calculated in code from published food tables (Indian Food Composition Tables 2017 and USDA SR28, 205 foods with their home-language names). If we can't measure an ingredient, we say "not counted" and never claim a "% less".
- Calorie targets use the Mifflin–St Jeor equation, adjusted for activity and goal, with WHO Asian BMI cut-offs:

$$\text{BMR} = 10\,w + 6.25\,h - 5\,a + s, \qquad s = \begin{cases} +5 & \text{men} \\ -161 & \text{women} \end{cases}$$

- Care can only recommend ingredients from a checked library where every entry cites a source (NHS, American Academy of Dermatology and others). Pregnancy rules, age limits, prescription-only items, allergies and "see a doctor first" warnings are enforced in code *after* the AI answers.
- **Guardrails before the AI:** dangerous remedies (kerosene for lice, bleach, mercury, steroid creams) always get "stop", whatever the AI says. Non-food or nonsense input gets a friendly prompt. Signs of self-harm get a calm message with helplines and never reach the AI.

**Stack:** Python and FastAPI on Vercel, a plain HTML/CSS/JavaScript front end with voice input and PDF export, LangSmith tracing on every model call, 198 automated tests and Playwright testing on phone and desktop.

## Challenges we ran into

- **Messy, spoken recipes.** "Thoda ghee", "1 katori", Hinglish and Spanish all had to become honest grams without letting the model guess the numbers.
- **Safety without being annoying.** False alarms ("a dinner that won't kill me with carbs") frustrate people; missed warnings hurt them. We ran two rounds of adversarial review with about 80 tricky inputs in English, Hinglish and Spanish, and tuned every rule.
- **Answering fully in the family's language.** Our checked facts are written in English, so the model answers in Hindi (or any language) and our library and safety text are translated in the same flow.
- **Diet rules that respect culture.** Jain means no root vegetables; kosher-style means never meat with dairy in one dish; "eggplant" is not egg, and "rumali roti" is not rum.

## Accomplishments that we're proud of

- It works on real family food, in the family's own words, in any language.
- Every number and every safety rule can be traced to a source or a rule in code.
- One calm, accessible app for a whole family's food *and* skin and hair, built around people, not features.

## What we learned

Small models are great at structure and big models at judgement, but neither should be trusted with facts on its own. Pairing Nemotron's understanding with checked tables and code rules gave us answers a family can actually trust.

## What's next for Heritage: Keep what works from home

- Testing with families and diabetes educators. [Add a real quote or "tried with N families" here if you have one.]
- More cuisines in the food tables (West African, Caribbean, Middle Eastern) and more checked remedies.
- Sharing the family plan with the parent's doctor or dietitian.
- A fully translated interface.

---

## Built with (25 tags)

python, fastapi, javascript, html5, css3, nvidia-nemotron, nemotron-nano, nemotron-super, nemotron-ultra, nebius,
nebius-token-factory, openai-api, langsmith, vercel, pydantic, pytest, playwright, web-speech-api, html2pdf,
usda-food-data, ifct-2017, github, llm, generative-ai, accessibility

## Try it out

- Live app: [Vercel production URL]
- Code: https://github.com/ishtrain07/heritage-plate (only if the repo is public)

## Image gallery (3:2, in this order) — files in docs/gallery/

1. home.png: home page with the pitch and spice photo
2. plate-result.png: a dish made lighter (62 → 47 g)
3. week-plan.png: the week plan with the note to the parent
4. care-result.png: "Nimbu on dark spots" → Stop
5. label-check.png: label check catching a steroid
6. family-book.png: the family book
7. how-it-works.png: the "How it works" diagram

## Demo video

Follow docs/VIDEO_SCRIPT.md (under 3 minutes). Upload to YouTube as Unlisted and paste the link. Open with
your real story in the first 15 seconds.

## Before posting

- Personal details in Inspiration (Mum and Dad's parathas, Sunday coconut oil, friends' Lola and abuela) must
  be true for you; change or cut anything that isn't.
- Credit for the home photo: Photo by Anju Ravindranath on Unsplash.
