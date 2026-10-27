# Heritage — Devpost submission

**Track:** Best Apps & Agents · **Built with:** NVIDIA Nemotron 3 (Nano, Super, Ultra) on Nebius Token Factory

**Live demo:** [LIVE URL] · **Code:** https://github.com/ishtrain07/heritage-plate · **Video:** [VIDEO URL]

## Name and tagline
**Heritage** — Keep what works from home. Fix what doesn't.

## Inspiration
When a parent is told they have type 2 diabetes, high blood pressure or high cholesterol, the family gets
generic advice: eat brown rice, cut salt. None of it is about *their* food. So they either give up Mum's dal
and parathas for bland "diet" meals that nobody eats, or keep cooking the same way because no one can say
how much rice or ghee is too much. The same happens with skin and hair: families pass down besan and haldi,
nimbu on dark spots and coconut oil every night, and nobody tells them which ones help and which ones burn.

India alone has over 100 million people with diabetes (ICMR-INDIAB, 2023), and millions of families abroad
cook from a tradition that mainstream health apps ignore. We built Heritage for them.

## What it does
Say it the way it's said at home, in any language. Heritage keeps what works and fixes what doesn't.

**Heritage Plate (food)**
- Reads a family recipe from voice or text ("3 katori atta, 2 boiled aloo, ghee on top") in any mix of
  languages and home measures.
- Makes it lighter for diabetes, blood pressure or cholesterol (or several at once) with a few changes that
  keep the dish recognisable, and shows before-and-after numbers per serving.
- Plans a week of meals like a dietitian: a personal calorie target from age, height, weight and activity,
  several goals (e.g. lose weight and build muscle), diets including vegetarian, vegan, halal, kosher-style
  and Jain, allergies respected, one shopping list, and a warm note to the parent in their language.
- Suggests a new healthy dish on request.

**Heritage Care (skin & hair)**
- Checks a home remedy and gives a clear verdict (keep, fine with care, swap or stop), what it really does,
  and the proven ingredient that does the job better, with strengths and where to find it. No brands.
- Builds a simple morning, night and shower routine for each person in the family, with one shopping list.
- Reads any product label and flags irritants and dangerous hidden ingredients (steroids, mercury,
  hydroquinone in "fairness" creams).

**One family at the centre:** add Mum, Dad or Nani once; both sides work for them, and everything saves to a
printable family book. Answers come back in the family's language (Hindi, Spanish, Tagalog and more).

## How we built it
- **Three Nemotron tiers, each with its own job** (Nebius Token Factory, OpenAI-compatible API):
  Nano reads recipes (fast extraction); Super adapts dishes, checks remedies, builds care plans and translates
  our checked text; Ultra plans the week across all dishes and writes in the parent's language, with
  automatic fallback to Super.
- **The AI never makes up numbers or safety rules.** Nutrition is calculated in code from published food
  tables (IFCT 2017, USDA SR28). Calorie targets use Mifflin-St Jeor with WHO Asian BMI cut-offs. Care
  recommendations can only come from a checked, cited ingredient library; pregnancy, age limits,
  prescription-only items, allergies and "see a doctor first" warnings are enforced in code after the model.
- **Guardrails before the model:** dangerous remedies (kerosene for lice, bleach, mercury, steroid creams)
  always get "stop"; non-food and nonsense inputs get a friendly prompt; signs of self-harm get a calm
  message with helplines and never reach the AI.
- FastAPI backend, plain HTML/CSS/JS front end with browser voice input, deployed on Vercel; LangSmith tracing
  for every model call; 196 automated tests.

## Challenges we ran into
- Getting honest numbers from messy, spoken recipes ("thoda ghee", "1 katori") without letting the model guess.
- Safety in a health app: false alarms annoy people, missed warnings hurt them. We tuned red flags and
  guardrails with two rounds of adversarial review (about 80 tricky inputs, in English, Hinglish and Spanish).
- Answering fully in the family's language while our checked facts are written in English: the model writes
  in the chosen language, and our library text is translated in the same flow.

## Accomplishments we're proud of
- It works for real family food in any cuisine, and in the family's own words.
- Every number and every safety rule can be traced to a source or a rule in code.
- One app for the whole family's food and skin and hair, built around the people, not features.

## What we learned
Small models are great at structure, big models at judgement, and neither should be trusted with facts
alone. Pairing Nemotron's understanding with checked tables and code rules gave us answers families can trust.

## What's next
- Country-aware examples and a fully translated interface.
- Sharing the family plan with the parent's doctor or dietitian.
- More food tables (Middle Eastern, West African, Caribbean) and more checked remedies.
- Pilots with diabetes educators and community health workers.

[ADD: one real quote from a family that tried it]
