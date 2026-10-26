// Heritage Plate front end: plain JS, no build step, no external dependencies.
"use strict";

// An old page cached by the browser can load these new scripts without family.js: reload once to get the current page.
if (typeof FAMILY_KEY === "undefined") {
  try {
    if (!sessionStorage.getItem("hp-reloaded")) { sessionStorage.setItem("hp-reloaded", "1"); location.reload(); }
  } catch { /* storage blocked: the page still shows Plate */ }
}

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Only plain web links make it into an href.
function safeUrl(u) {
  const s = String(u ?? "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
}

// ---------- constants ----------
// `nutrient` is the plain-words name shown next to every number; `word` is used in sentences.
const CONDITIONS = {
  everyday: {
    label: "Everyday lighter", short: "Everyday lighter", word: "everyday", key: "kcal", nutrient: "calories", unit: "kcal",
    hint: "Fewer calories, less fat and salt, more vegetables.",
  },
  diabetes: {
    label: "Type 2 diabetes", short: "Diabetes", word: "diabetes", key: "net_carbs_g", nutrient: "sugar-raising carbs", unit: "g",
    hint: "We lower the carbs that raise blood sugar.",
  },
  bp: {
    label: "High blood pressure", short: "Blood pressure", word: "blood pressure", key: "sodium_mg", nutrient: "salt (sodium)", unit: "mg",
    hint: "We lower salt (sodium), mostly from salt and salty sauces.",
  },
  cholesterol: {
    label: "High cholesterol", short: "Cholesterol", word: "cholesterol", key: "sat_fat_g", nutrient: "saturated fat", unit: "g",
    hint: "We lower saturated fat, mostly from ghee, butter, cream and fatty meat.",
  },
};

const NUTRIENTS = [
  ["kcal", "Energy", "kcal"],
  ["net_carbs_g", "Sugar-raising carbs", "g"],
  ["fiber_g", "Fibre", "g"],
  ["protein_g", "Protein", "g"],
  ["fat_g", "Fat", "g"],
  ["sat_fat_g", "Saturated fat", "g"],
  ["sodium_mg", "Salt (sodium)", "mg"],
];
// Shown under the big number for "Everyday lighter", where calories lead.
const SECONDARY = [["sat_fat_g", "Saturated fat", "g"], ["sodium_mg", "Salt", "mg"]];

const DEFAULT_CUISINES = {
  south_asian: "South Asian (Indian, Pakistani, Bangladeshi, Sri Lankan)",
  east_asian: "East Asian (Chinese, Korean, Japanese)",
  southeast_asian: "Southeast Asian (Filipino, Vietnamese, Thai, Malaysian)",
  continental: "Continental European (Italian, French, British, Eastern European)",
  middle_eastern: "Middle Eastern and North African",
  latin_american: "Latin American and Caribbean",
  other: "home cooking from any tradition",
};
const DEFAULT_LANGUAGES = ["English", "Hindi", "Punjabi", "Gujarati", "Urdu", "Bengali", "Tamil", "Telugu", "Mandarin",
  "Cantonese", "Korean", "Japanese", "Tagalog", "Vietnamese", "Thai", "Arabic", "Farsi", "Spanish", "Portuguese",
  "Italian", "French", "Polish"];

// The example under the mic, in the family's own way of speaking.
const EXAMPLES = {
  south_asian: "3 katori atta, 2 boiled aloo, ghee on top, serves 4",
  east_asian: "2 bowls cooked rice, 2 eggs, a handful of peas, 2 spoons soy sauce",
  southeast_asian: "1 kg chicken, half cup toyo, half cup vinegar, garlic, bay leaf",
  continental: "2 carrots, 1 onion, celery, 1 tin beans, a handful of pasta, olive oil",
  middle_eastern: "1 cup lentils, 1 cup rice, 3 onions fried in olive oil, cumin",
  latin_american: "2 cups rice, 500 g chicken, 1 onion, 1 pepper, a little oil",
  other: "500 g beef, 3 potatoes, 2 carrots, 1 onion, a spoon of butter",
};

const SPEECH_LANG = {
  English: "en-IN", Hindi: "hi-IN", Punjabi: "pa-IN", Gujarati: "gu-IN", Tamil: "ta-IN", Bengali: "bn-IN",
  Urdu: "ur-PK", Telugu: "te-IN", Mandarin: "zh-CN", Cantonese: "zh-HK", Korean: "ko-KR", Japanese: "ja-JP",
  Tagalog: "fil-PH", Vietnamese: "vi-VN", Thai: "th-TH", Arabic: "ar-SA", Farsi: "fa-IR", Spanish: "es-ES",
  Portuguese: "pt-BR", Italian: "it-IT", French: "fr-FR", Polish: "pl-PL",
};
const VOICE_FALLBACK = "Voice works in Chrome, Edge or Safari, so type instead.";

const FAMILY_SHADES = 4; // .avatar.fam-1 … fam-4, coloured by theme tokens
const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const SLOT_NAMES = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
const SLOT_ORDER = ["breakfast", "lunch", "snack", "dinner"];

// The dietitian intake. Values match the /api/week Profile model.
const DIETS = [["non_veg", "Everything"], ["pescatarian", "Fish, no meat"], ["eggetarian", "Vegetarian + eggs"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"],
  ["halal", "Halal"], ["kosher", "Kosher-style"], ["jain", "Jain"]];
const DIET_WORDS = { non_veg: "Eats everything", pescatarian: "Fish, no meat", eggetarian: "Vegetarian + eggs", vegetarian: "Vegetarian", vegan: "Vegan",
  halal: "Halal", kosher: "Kosher-style", jain: "Jain" };
// A short plain note under the diet chips, for the diets people read differently.
const DIET_NOTES = {
  kosher: "Kosher-style: no pork or shellfish, no meat with dairy. We can't check certification.",
  jain: "Vegetarian, no onion, garlic or root vegetables.",
};
const HEALTH = [["diabetes", "Type 2 diabetes"], ["bp", "High blood pressure"], ["cholesterol", "High cholesterol"]];
const GOALS = [
  ["maintain", "Eat well", "Balanced meals at their usual calories."],
  ["lose_weight", "Lose weight", "A gentle calorie deficit, about half a kilo a week."],
  ["belly_fat", "Lose belly fat", "Fat can't be lost from one spot, so we plan a steady overall deficit. Walking and strength exercise help most."],
  ["steady_sugar", "Steady blood sugar", "Fewer sugar-raising carbs, spread evenly through the day."],
  ["build_muscle", "Build muscle", "A small calorie surplus with plenty of protein."],
];
const SEXES = [["female", "Female"], ["male", "Male"]];
const ETHNICITIES = [["south_asian", "South Asian"], ["east_asian", "East Asian"], ["southeast_asian", "Southeast Asian"], ["other", "Another background"]];
const ACTIVITY = [["sedentary", "Mostly sitting"], ["light", "Lightly active"], ["moderate", "Active"], ["active", "Very active"]];
// The number that matters most for each condition, shown as a weekly daily average.
const KEY_NUMBERS = {
  diabetes: ["net_carbs_g", "Sugar-raising carbs", "g"],
  bp: ["sodium_mg", "Salt (sodium)", "mg"],
  cholesterol: ["sat_fat_g", "Saturated fat", "g"],
};
const PLAN_STAGES = [
  // [label, seconds after start when this stage begins]
  ["Setting the calorie target", 0],
  ["Choosing meals", 3],
  ["Checking every meal against the food tables", 15],
  ["Balancing portions for each day", 27],
];
const SHOP_GROUPS = {
  grain: "Grains and flour", legume: "Beans and lentils", vegetable: "Vegetables", fruit: "Fruit", dairy: "Dairy",
  protein: "Meat, fish and eggs", fat: "Oils and fats", nuts: "Nuts", sauce: "Sauces", sweetener: "Sugar and sweeteners",
  spice: "Spices", other: "Other",
};
const ADAPT_CONCURRENCY = 3;
const MAX_DISHES = 30; // matches the /api/week limit
const LOWER_IS_BETTER = new Set(["kcal", "net_carbs_g", "fat_g", "sat_fat_g", "sodium_mg"]);
const BOOK_KEY = "hp-cookbook-v1";
const ASK_CHIPS = ["Less spicy", "No onion or garlic", "Quicker to cook"];
const ASK_CHIPS_SOUTH_ASIAN = ["Less spicy", "No onion or garlic", "Use jaggery instead of sugar?"];
const SOURCES_LINE = "Numbers from IFCT 2017 / USDA food tables. Not medical advice.";

// USDA names come in capitals ("BUTTER OIL,ANHYDROUS"); make them easier to read.
function readableRecord(s) {
  const t = String(s ?? "");
  if (t !== t.toUpperCase()) return t;
  const low = t.toLowerCase().replace(/,(?=\S)/g, ", ");
  return low.charAt(0).toUpperCase() + low.slice(1);
}

// ---------- state ----------
const state = {
  condition: "everyday",
  cuisine: "south_asian",
  language: "English",   // the parent's language, for the note
  speechLang: "English", // the language the cook speaks the recipe in
  parentName: "",
  family: null,          // {id, family, parent} when a sample family is loaded
  families: [],
  familiesLoaded: false,
  recipes: [],           // [{id, base, adapted, status: idle|busy|error, error, open, origin: "own"|familyId}]
  also: [],              // more health issues besides `condition` (multi-select)
  health: null,
  healthFailed: false,
  plan: null,            // the /api/week result
  planStale: false,
  planning: false,
  planError: false,
  planCtrl: null,        // AbortController for the running plan (Cancel)
  planErrorMsg: "",
  weekTab: "meals",
  weekDay: 0,            // which day shows on phones
  week: 1,               // which week's rotation /api/week should give; bumps for "Plan another week"
  profile: null,         // the person's intake (see defaultProfile)
  profileSet: false,     // true once they've planned with it, so a return visit is one tap
  profileTouched: false, // edited in the intake but not planned yet
  household: 1,
  intakeOpen: false,
  composerOpen: false,
  composerMode: "recipe", // "recipe" (make it lighter) or "suggest" (a new dish from a wish)
  editingId: null,
  saved: null,           // a cookbook saved on this device, offered on the home screen
  adaptRun: 0,           // bumps to cancel a running "make every dish lighter"
  cookbookVersion: 0,    // bumps whenever the dishes change; late /api/week replies are dropped
};

// The selected health issues, first one leads (its number is the headline on each card).
function conds() { return [state.condition, ...state.also.filter((c) => c !== state.condition)]; }
function condKey() { return conds().join("+"); }
function adaptedKey(a) { return a ? a.condKey || a.condition : ""; }
function cleanConds(list) {
  const ok = (Array.isArray(list) ? list : []).filter((c, i, arr) => Object.hasOwn(CONDITIONS, c) && arr.indexOf(c) === i);
  if (!ok.length || ok.includes("everyday") && ok[0] === "everyday") return ["everyday"];
  return ok.filter((c) => c !== "everyday").slice(0, 4);
}
function condWords() { return conds().map((c) => CONDITIONS[c].word).join(" + "); }

function markCookbookChanged() {
  state.cookbookVersion += 1;
  if (state.plan) state.planStale = true;
}

// ---------- helpers ----------
function uid() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function fmt(v, unit) {
  const n = num(v);
  if (unit === "mg" || unit === "kcal") return String(Math.round(n));
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function grams(g) {
  const n = num(g);
  if (n >= 1000) return (Math.round(n / 100) / 10) + " kg";
  return fmt(n, "g") + " g";
}

function parentWord() {
  const n = state.parentName.trim();
  return n || "Mum or Dad";
}
function hasParent() { return Boolean(state.parentName.trim()); }
function planLanguage() { return hasParent() ? state.language : ""; }

function shortCuisine(key) {
  const label = (state.health?.cuisines || DEFAULT_CUISINES)[key] || key;
  if (key === "other") return "Home cooking";
  return label.split(" (")[0];
}

function familyShort() {
  return String(state.family?.family || "").replace(/^The\s+/i, "").replace(/\s+family$/i, "").trim();
}
function cookbookTitle() {
  const f = familyShort();
  if (!f && !state.recipes.length && state.plan && !careInBook()) return "Your week of meals";
  return f ? `The ${f} family book` : "Your family book";
}
function careInBook() { return typeof hasCareBook === "function" && hasCareBook(); }
function coverLine() {
  if (!state.recipes.length && !state.plan && careInBook()) return "Skin & hair care for the family";
  if (!state.recipes.length && state.plan) return `A personal week of meals${hasParent() ? ` for ${state.parentName.trim()}` : ""} · ${profileWords(state.plan).join(" · ")}`;
  if (state.condition === "everyday") return "Lighter family recipes for everyday";
  return `Lighter family recipes for ${hasParent() ? state.parentName.trim() : "the family"} · ${condWords()}`;
}

function announce(text) {
  const a = $("announce");
  a.textContent = "";
  setTimeout(() => { a.textContent = text; }, 30);
}

let toastTimer;
// `action` = {label, run}: adds a button (e.g. Undo). Toasts with a button stay longer, and while hovered or focused.
function toast(text, action = null) {
  const t = $("toast");
  t.textContent = "";
  const msg = document.createElement("span");
  msg.textContent = text;
  t.appendChild(msg);
  const hide = () => { t.hidden = true; t.textContent = ""; };
  if (action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-btn"; b.textContent = action.label;
    b.addEventListener("click", () => { clearTimeout(toastTimer); hide(); action.run(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  const wait = action ? 8000 : 2600;
  const arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(() => { if (!t.matches(":hover, :focus-within")) hide(); else arm(); }, wait); };
  arm();
}

function reduceMotion() { return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
function scrollToEl(el) {
  el.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
}

function readableError(detail, status) {
  if (status === 429) return "Lots of requests right now. Please wait a few minutes and try again.";
  if (Array.isArray(detail)) {
    // Too-long text (pasted past the box limit) gets plain words, not validator jargon.
    const long = detail.find((d) => d && typeof d === "object" && (d.type === "string_too_long" || /at most \d+ characters?/i.test(String(d.msg || ""))));
    if (long) {
      const field = Array.isArray(long.loc) ? long.loc.filter((x) => typeof x === "string").pop() : "";
      const max = Number(long.ctx?.max_length) || Number((String(long.msg || "").match(/at most (\d+)/) || [])[1]) || 0;
      const limit = max ? max.toLocaleString("en-US") : "";
      if (field === "text" && max === 3000) return `That ingredient list is too long; keep it under ${limit} characters.`; // label check
      if (field === "text" && max === 400) return `That remedy is too long; keep it under ${limit} characters.`;
      if (field === "text" || field === "source_text") return `That recipe is too long; keep it under ${limit || "2,000"} characters.`;
      if (field === "request") return `That ask is too long; keep it under ${limit || "200"} characters.`;
      if (field === "wish") return `That's a bit long; keep it under ${limit || "300"} characters.`;
      if (field === "dislikes") return `The foods to avoid are too long; keep them under ${limit || "200"} characters.`;
      return `Something you typed is too long${limit ? `; keep it under ${limit} characters` : ""}.`;
    }
    const parts = detail.map((d) => {
      if (!d || typeof d !== "object") return String(d);
      const field = Array.isArray(d.loc) ? d.loc.filter((x) => x !== "body" && typeof x === "string").pop() : "";
      const msg = String(d.msg || "is not valid").replace(/^Value error,\s*/i, "");
      return field ? `${field.replace(/_/g, " ")}: ${msg}` : msg;
    });
    return "Please check: " + parts.join("; ") + ".";
  }
  if (detail && typeof detail === "object") return detail.msg ? String(detail.msg) : "Something in the request wasn't right.";
  if (typeof detail === "string" && detail) return detail;
  if (status === 502) return "The AI didn't answer properly. Please try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return `Request failed (${status}).`;
}

// `signal` lets the person cancel; a cancelled call throws an Error with .cancelled = true.
async function api(path, body, timeoutMs = 120000, signal = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onCancel = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onCancel);
  let res;
  try {
    res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (signal?.aborted) { const e = new Error("Cancelled."); e.cancelled = true; throw e; }
    throw new Error(err.name === "AbortError" ? "This is taking too long. Please try again." : "Can't reach the server. Check your connection and try again.");
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onCancel); }
  if (signal?.aborted) { const e = new Error("Cancelled."); e.cancelled = true; throw e; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const guard = res.status === 422 ? guardOf(data.detail) : null;
    const e = new Error(guard ? guard.message : readableError(data.detail, res.status));
    if (guard) e.guard = guard;
    throw e;
  }
  return data;
}

// ---------- input guardrail replies ----------
// A 422 whose detail is {code, message, lines?} is the server saying "that isn't something we can work with"
// (a normal validation 422 has a list as its detail). It's shown inline under the field that was sent, never
// as a toast, and never with the person's own text echoed back.
const GUARD_CODES = ["not_food", "off_topic", "gibberish", "support"];
function guardOf(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail) || !GUARD_CODES.includes(detail.code)) return null;
  const msg = typeof detail.message === "string" ? detail.message.trim() : "";
  const lines = Array.isArray(detail.lines) ? detail.lines.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 8) : [];
  const fallback = detail.code === "support"
    ? "It sounds like things are really hard right now. You don't have to face this alone. Please reach out to someone who can help today."
    : "That doesn't look like something we can check. Please try again.";
  return { code: detail.code, message: msg || fallback, lines };
}

// Helpline lines: the number becomes a tap-to-call link and a bare site a link, so help is one tap away.
function supportLine(line) {
  return esc(line)
    .replace(/\b(\d{3}(?: \d{3})?|\d{4,6})\b(?=\s*(?:\(|$))/, (n) => `<a class="guard-tel" href="tel:${n.replace(/\s/g, "")}">${n}</a>`)
    .replace(/\b([a-z0-9-]+\.(?:com|org|net))\b/i, (d) => `<a class="guard-tel" href="https://${d}" target="_blank" rel="noopener">${d}</a>`);
}

// `ex` = an example to try (filled into the field on tap); `exLabel` = button words when the example is long.
function guardHTML(g, ex = "", exLabel = "") {
  if (g.code === "support") {
    return `
      <div class="guard guard-support" role="status">
        <p class="guard-msg">${esc(g.message)}</p>
        ${g.lines.length ? `<ul class="guard-lines">${g.lines.map((l) => `<li>${supportLine(l)}</li>`).join("")}</ul>` : ""}
      </div>`;
  }
  const tryIt = ex ? `<p class="guard-ex">Try something like <button type="button" class="btn-link guard-use" data-guard-example="${esc(ex)}">${esc(exLabel || `“${ex}”`)}</button></p>` : "";
  return `<div class="guard" role="alert"><p class="guard-msg">${esc(g.message)}</p>${tryIt}</div>`;
}

function showGuard(slotId, fieldId, g, ex = "", exLabel = "") {
  const slot = $(slotId);
  if (!slot) return;
  slot.dataset.field = fieldId || "";
  slot.innerHTML = guardHTML(g, ex, exLabel);
  const field = fieldId ? $(fieldId) : null;
  if (field) {
    if (g.code !== "support") field.setAttribute("aria-invalid", "true");
    const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter((x) => x && x !== slotId);
    field.setAttribute("aria-describedby", [...ids, slotId].join(" "));
  }
  slot.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
}

function clearGuard(slotId) {
  const slot = $(slotId);
  if (!slot || !slot.innerHTML) return;
  const field = slot.dataset.field ? $(slot.dataset.field) : null;
  if (field) {
    field.removeAttribute("aria-invalid");
    const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter((x) => x && x !== slotId);
    if (ids.length) field.setAttribute("aria-describedby", ids.join(" ")); else field.removeAttribute("aria-describedby");
  }
  slot.innerHTML = "";
}

// "Try something like …": fill the field with the example and clear the message.
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-guard-example]");
  if (!b) return;
  const slot = b.closest(".guard-slot");
  const field = slot?.dataset.field ? $(slot.dataset.field) : null;
  if (slot) clearGuard(slot.id);
  if (field) { field.value = b.dataset.guardExample; field.focus(); field.dispatchEvent(new Event("input", { bubbles: true })); }
});
// Typing again clears the message under that field.
document.addEventListener("input", (e) => {
  document.querySelectorAll(".guard-slot").forEach((slot) => { if (slot.dataset.field && slot.dataset.field === e.target.id) clearGuard(slot.id); });
});

function baseFields(r) {
  const out = {
    id: r.id,
    name: r.name,
    servings: r.servings,
    meal: r.meal ?? null,
    ingredients: (r.ingredients || []).map((g) => ({ item: g.item, grams: num(g.grams) })),
    source_text: r.source_text || "",
  };
  if (Array.isArray(r.method) && r.method.length) out.method = r.method.slice(0, 10).map((s) => String(s).slice(0, 240));
  return out;
}

function current(entry) { return entry.adapted || entry.base; }
function findEntry(id) { return state.recipes.find((e) => e.id === id); }

// Elapsed-seconds feedback so waits never feel frozen.
// The message is written once (announced once); only an aria-hidden seconds counter updates.
function ticker(el, html) {
  const start = Date.now();
  el.innerHTML = `${html} <span class="secs" aria-hidden="true"></span>`;
  const secs = el.querySelector(".secs");
  const t = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    if (s >= 2) secs.textContent = `${s}s`;
  }, 1000);
  return () => clearInterval(t);
}

// The button's own label is kept once, so overlapping runs (e.g. switching family mid-batch)
// always put back the real label, never another run's spinner. Only the last run to finish restores it.
async function busy(btn, label, fn) {
  btn.dataset.label ??= btn.innerHTML;
  btn.dataset.runs = String(num(btn.dataset.runs) + 1);
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  try { return await fn(); } finally {
    const left = Math.max(0, num(btn.dataset.runs) - 1);
    btn.dataset.runs = String(left);
    if (!left) {
      btn.removeAttribute("aria-busy");
      btn.innerHTML = btn.dataset.label;
      delete btn.dataset.label; // labels can change between runs (e.g. "Update and make it lighter")
      btn.disabled = false;
    }
    refreshButtons();
  }
}

// ---------- the person's profile ----------
function defaultProfile() {
  return {
    diet: "non_veg", conditions: conds().filter((c) => c !== "everyday"),
    goal: "maintain", goals: ["maintain"], dislikes: "", sex: null, age: null, height_cm: null, weight_kg: null, activity: "light",
    ethnicity: null, pregnant: false, snacks: true,
  };
}

// Only keep values the API accepts, so an old or edited save can never cause a 422.
function cleanProfile(p) {
  const d = defaultProfile();
  if (!p || typeof p !== "object") return d;
  const pick = (v, list, def) => (list.some(([k]) => k === v) ? v : def);
  const inRange = (v, lo, hi) => { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  const age = inRange(p.age, 1, 120);
  return {
    diet: pick(p.diet, DIETS, d.diet),
    conditions: Array.isArray(p.conditions) ? HEALTH.map(([k]) => k).filter((k) => p.conditions.includes(k)) : d.conditions,
    goal: pick(p.goal, GOALS, d.goal),
    goals: (() => { // several goals; "Eat well" only on its own
      const g = (Array.isArray(p.goals) ? p.goals : [p.goal]).filter((k) => GOALS.some(([x]) => x === k));
      const rest = [...new Set(g)].filter((k) => k !== "maintain");
      return rest.length ? rest : ["maintain"];
    })(),
    dislikes: String(p.dislikes || "").slice(0, 200),
    sex: p.sex === "female" || p.sex === "male" ? p.sex : null,
    age: age === null ? null : Math.round(age),
    height_cm: inRange(p.height_cm, 80, 250),
    weight_kg: inRange(p.weight_kg, 25, 350),
    activity: pick(p.activity, ACTIVITY, d.activity),
    ethnicity: pick(p.ethnicity, ETHNICITIES, null),
    pregnant: p.sex === "female" && p.pregnant === true,
    snacks: p.snacks !== false,
  };
}

function profile() {
  if (!state.profile) state.profile = defaultProfile();
  return state.profile;
}

// ---------- saved cookbook (this device only; works without storage) ----------
function saveBook() {
  try {
    if (!state.recipes.length && !state.plan && !state.profileSet) { writePlate(null); return; }
    const data = {
      v: 1, savedAt: Date.now(),
      condition: state.condition, also: state.also, cuisine: state.cuisine, language: state.language, parentName: state.parentName,
      family: state.family ? { id: state.family.id, family: state.family.family, parent: state.family.parent } : null,
      recipes: state.recipes.map((e) => ({ id: e.id, base: e.base, adapted: e.adapted, origin: e.origin })),
      plan: state.plan && !state.planStale ? state.plan : null,
      week: state.week,
      profile: state.profileSet ? state.profile : null,
      household: state.household,
    };
    writePlate(data); // the shared family store (static/family.js)
  } catch { /* storage blocked or full: the book lasts for this visit */ }
}

// A saved cookbook may be old, edited or corrupt: keep only what the app and the API can use.
const isObj = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);
function goodIngredients(list) {
  return Array.isArray(list) && list.length > 0 && list.length <= 40
    && list.every((g) => isObj(g) && typeof g.item === "string" && g.item.trim() && g.item.length <= 60
      && typeof g.grams !== "boolean" && Number.isFinite(Number(g.grams)) && Number(g.grams) > 0 && Number(g.grams) <= 5000);
}
// Matches the /api Recipe model, so a restored dish never comes back as a 422.
function goodRecipe(r) {
  return isObj(r) && typeof r.name === "string" && r.name.trim() && r.name.length <= 80
    && Number.isInteger(Number(r.servings)) && Number(r.servings) >= 1 && Number(r.servings) <= 20
    && (r.meal === undefined || r.meal === null || ["breakfast", "main", "dessert"].includes(r.meal))
    && (r.source_text === undefined || (typeof r.source_text === "string" && r.source_text.length <= 2000))
    && (r.method === undefined || (Array.isArray(r.method) && r.method.every((s) => typeof s === "string")))
    && goodIngredients(r.ingredients);
}
function cleanAdapted(a) {
  if (!goodRecipe(a)) return null;
  for (const k of ["changes", "facts", "sources", "method", "conditions"]) if (k in a && !Array.isArray(a[k])) return null;
  if (a.original !== undefined && a.original !== null && !(isObj(a.original) && goodIngredients(a.original.ingredients))) return null;
  if (a.nutrition !== undefined && !isObj(a.nutrition)) return null;
  if ((a.changes || []).some((c) => !isObj(c))) return null;
  if (a.condition !== undefined && !Object.hasOwn(CONDITIONS, a.condition)) return null;
  const asks = Array.isArray(a.asks) ? a.asks.filter((s) => typeof s === "string" && s.trim()).map((s) => s.slice(0, 200)) : undefined;
  return { ...a, asks };
}
function readBook() {
  return checkBook(readPlateRaw());
}
// Also used by static/family.js to migrate an old hp-cookbook-v1 save.
function checkBook(d) {
  try {
    if (isObj(d) && d.v === 1 && Array.isArray(d.recipes)) {
      d.recipes = d.recipes
        .filter((r) => isObj(r) && (typeof r.id === "string" || typeof r.id === "number") && String(r.id) && goodRecipe(r.base))
        .map((r) => ({ ...r, adapted: cleanAdapted(r.adapted) }));
      if (!Object.hasOwn(CONDITIONS, d.condition)) d.condition = "everyday";
      if (!Array.isArray(d.also)) d.also = [];
      if (!isObj(d.family)) d.family = null;
      if (!isObj(d.profile)) d.profile = null;
      // Plans from the old /api/plan shape (one dish name per slot) or with broken meals are dropped; the dishes stay.
      if (d.plan) {
        const days = isObj(d.plan) && Array.isArray(d.plan.days)
          ? d.plan.days.filter((x) => isObj(x) && Array.isArray(x.meals) && x.meals.every((m) => isObj(m) && typeof m.slot === "string"))
          : [];
        d.plan = days.length ? { ...d.plan, days } : null;
        if (d.plan && d.plan.shopping_list !== undefined && !Array.isArray(d.plan.shopping_list)) d.plan.shopping_list = [];
        if (d.plan && d.plan.notes !== undefined && !Array.isArray(d.plan.notes)) d.plan.notes = [];
        if (d.plan && d.plan.tips !== undefined && !Array.isArray(d.plan.tips)) d.plan.tips = [];
      }
      if (d.recipes.length || d.plan || d.profile) return d;
    }
  } catch { /* ignore */ }
  return null;
}

function clearBook() {
  try { writePlate(null); } catch { /* ignore */ }
}

// Returns false (and starts fresh, with a message) if the saved cookbook can't be opened.
function restoreBook(d) {
  const keep = {
    condition: state.condition, also: state.also, cuisine: state.cuisine, language: state.language, parentName: state.parentName,
    family: state.family, recipes: state.recipes, plan: state.plan, week: state.week, profile: state.profile,
    profileSet: state.profileSet, household: state.household,
  };
  try {
    restoreBookUnsafe(d);
    return true;
  } catch {
    Object.assign(state, keep, { planStale: false, planError: false, saved: null });
    clearBook();
    try { fillSelects(); renderResume(); renderFamilies(); renderCookbook(); renderPlan(); } catch { /* keep the toast */ }
    toast("Couldn't open the saved family book, so we started fresh.");
    return false;
  }
}

function restoreBookUnsafe(d) {
  state.adaptRun += 1;
  const cs = cleanConds([d.condition, ...(Array.isArray(d.also) ? d.also : [])]);
  state.condition = cs[0]; state.also = cs.slice(1);
  state.cuisine = typeof d.cuisine === "string" ? d.cuisine : state.cuisine;
  state.language = typeof d.language === "string" ? d.language : "English";
  state.parentName = String(d.parentName || "").slice(0, 20);
  state.family = d.family && typeof d.family.id === "string" && d.family.id ? { id: d.family.id, family: String(d.family.family || ""), parent: String(d.family.parent || "") } : null;
  state.recipes = d.recipes.slice(0, MAX_DISHES).map((r) => ({
    id: String(r.id), base: r.base, adapted: r.adapted && (r.origin === "suggested" || adaptedKey(r.adapted) === condKey()) ? r.adapted : null,
    status: "idle", error: "", open: null, origin: typeof r.origin === "string" && r.origin ? r.origin : "own",
  }));
  state.plan = d.plan || null;
  state.planStale = false; state.planError = false;
  state.week = Math.max(1, Math.round(num(d.week)) || 1);
  state.profile = d.profile ? cleanProfile(d.profile) : defaultProfile();
  state.profileSet = Boolean(d.profile);
  state.household = Math.min(12, Math.max(1, Math.round(num(d.household)) || 1));
  state.cookbookVersion += 1;
  state.saved = null;
  fillSelects();
  renderResume();
  renderFamilies();
  renderCookbook();
  renderPlan();
}

function renderResume() {
  const box = $("resume");
  const d = state.saved;
  if (!d || state.recipes.length) { box.innerHTML = ""; return; }
  const f = d.family?.family ? String(d.family.family).replace(/^The\s+/i, "").replace(/\s+family$/i, "") : "";
  const title = f ? `The ${f} family book` : "Your family book";
  const n = d.recipes.length;
  const who = String(d.parentName || "").trim();
  const bits = [n ? `${title}: ${n} dish${n === 1 ? "" : "es"}` : "Your week plan"];
  if (d.profile) bits.push(`${DIET_WORDS[d.profile.diet] || "Eats everything"}${who ? ` · for ${who}` : ""}`);
  box.innerHTML = `
    <section class="resume" aria-labelledby="resumeTitle">
      <div class="resume-text">
        <h2 id="resumeTitle" class="resume-title">Welcome back.</h2>
        <p>${bits.map(esc).join(" · ")}</p>
      </div>
      <div class="resume-btns">
        <button type="button" class="btn btn-primary" data-resume="plan">Plan this week</button>
        <button type="button" class="btn btn-outline" data-resume="add"><span aria-hidden="true">+</span> Add a dish</button>
        <button type="button" class="btn-link" data-resume="clear">Start over</button>
      </div>
    </section>`;
}

// ---------- how it works ----------
function renderHow() {
  const mode = $("howMode");
  if (state.healthFailed) mode.textContent = "Can't reach the server right now.";
  else if (state.health && state.health.mode !== "live") mode.textContent = "Running in demo mode: built-in sample answers stand in for the AI, so it works without an API key. Numbers are still computed from the food tables.";
  else mode.textContent = "";
}

function openHow() {
  renderHow();
  const d = $("how");
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  $("howClose").focus();
}
function closeHow() {
  const d = $("how");
  if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
}

// ---------- settings ----------
function fillSelects() {
  const cuisines = state.health?.cuisines || DEFAULT_CUISINES;
  const langs = state.health?.languages || DEFAULT_LANGUAGES;
  $("cuisine").innerHTML = Object.entries(cuisines).map(([k, v]) => {
    const label = k === "other" ? "Something else / mixed" : v;
    return `<option value="${esc(k)}">${esc(label)}</option>`;
  }).join("");
  $("speechLang").innerHTML = langs.filter((l) => SPEECH_LANG[l]).map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  if (!(state.cuisine in cuisines)) state.cuisine = Object.keys(cuisines)[0];
  if (!langs.includes(state.language)) state.language = langs[0];
  if (!SPEECH_LANG[state.speechLang]) state.speechLang = "English";
  syncControls();
}

function syncControls() {
  const on = conds();
  document.querySelectorAll('input[name="condition"]').forEach((r) => { r.checked = on.includes(r.value); });
  $("goalChips").innerHTML = Object.entries(CONDITIONS).map(([k, c]) => `<label class="pick-opt"><input type="checkbox" name="goalChip" value="${esc(k)}"${on.includes(k) ? " checked" : ""}><span>${esc(c.short)}</span></label>`).join("");
  $("cuisine").value = state.cuisine;
  $("speechLang").value = state.speechLang;
  $("styleSummary").textContent = `Cooking style: ${shortCuisine(state.cuisine)}`;
  $("focusHint").textContent = state.composerMode === "suggest"
    ? `We'll suggest a dish that suits ${on.map((c) => (c === "everyday" ? "everyday healthy eating" : CONDITIONS[c].word)).join(" and ")}, using your cooking style.`
    : on.length > 1
    ? `${CONDITIONS[on[0]].hint} The big number on each card follows ${CONDITIONS[on[0]].short.toLowerCase()}; the swaps help all of them.`
    : CONDITIONS[on[0]].hint;
  $("micExample").textContent = `“${state.composerMode === "suggest" ? SUGGEST_EXAMPLE : EXAMPLES[state.cuisine] || EXAMPLES.other}”`;
  renderNames();
  updateMicHint();
}

function renderNames() {
  const bits = [];
  if (state.family) bits.push(`${esc(familyShort())} family`);
  if (hasParent()) bits.push(`for <b>${esc(state.parentName.trim())}</b>`);
  $("dishesWho").innerHTML = bits.length ? `${bits.join(" · ")} <span aria-hidden="true">·</span> ` : "";
}

// Tapping a chip: "Everyday lighter" is exclusive; the rest combine. Never leaves nothing selected.
function toggleCondition(value, checked) {
  let list = conds().filter((c) => c !== "everyday");
  if (value === "everyday") list = checked ? ["everyday"] : list;
  else list = checked ? [...list, value] : list.filter((c) => c !== value);
  setConditions(list.length ? list : ["everyday"]);
}

let readaptTimer;
function setConditions(list) {
  const next = cleanConds(list);
  if (next.join("+") === condKey()) { syncControls(); return; }
  state.condition = next[0]; state.also = next.slice(1);
  state.adaptRun += 1; // stop any running batch; late replies for the old selection are dropped
  // Suggested dishes were made for their own conditions and keep them; family dishes are made lighter again.
  state.recipes.forEach((e) => {
    if (e.origin === "suggested") return;
    e.adapted = null; e.prev = null; e.asking = false; e.askError = ""; e.status = "idle"; e.error = ""; e.req = null;
  });
  if (!state.profileSet && !state.profileTouched) state.profile = defaultProfile();
  $("adaptProgress").hidden = true;
  markCookbookChanged();
  syncControls();
  renderCookbook();
  renderPlan();
  announce(`Now making dishes lighter for ${next.map((c) => CONDITIONS[c].label.toLowerCase()).join(" and ")}.`);
  // Wait a moment so tapping two chips in a row runs one batch, not two.
  clearTimeout(readaptTimer);
  readaptTimer = setTimeout(() => { if (state.recipes.some((e) => !e.adapted)) adaptAll($("adaptAll")); }, 700);
  saveBook();
}

// ---------- which parts of the page show ----------
function renderSections() {
  const n = state.recipes.length;
  // The "Plan my week" button under the dishes only starts things; once there's a week, the week has its own buttons.
  const planBtnShown = !state.plan && !state.intakeOpen && !state.planning;
  $("dishes").hidden = n === 0;
  $("composer").hidden = false; // the input card: always on Plate's first screen
  $("dishActions").hidden = n === 0 || state.composerOpen;
  $("plan").hidden = !planBtnShown;
  $("dishActions").classList.toggle("is-sticky", planBtnShown);
  $("intake").hidden = !state.intakeOpen || state.planning;
  $("week").hidden = !(state.plan || state.planning || state.planError);
  $("readyBar").hidden = !(state.plan && !state.planning);
  if (typeof renderPlateXlink === "function") renderPlateXlink(); // care.js: the small "skin or hair?" card
}

// ---------- families ----------
function renderFamilies() {
  const box = $("families");
  if (!state.families.length) {
    box.innerHTML = state.familiesLoaded
      ? `<div class="empty" role="alert"><p><b>The sample families didn't load</b></p><p>Check the connection, then try again.</p><button type="button" class="btn btn-quiet btn-small" data-retry>Try again</button></div>`
      : box.innerHTML;
    return;
  }
  box.innerHTML = state.families.map((f, i) => {
    const initial = (f.family || "?").replace(/^The\s+/i, "").charAt(0).toUpperCase();
    const who = String(f.parent || "").split(/[,(]/)[0].trim();
    const on = state.family?.id === f.id;
    return `
      <button type="button" class="family" data-family="${esc(f.id)}" aria-pressed="${on}">
        <span class="avatar fam-${(i % FAMILY_SHADES) + 1}" aria-hidden="true">${esc(initial)}</span>
        <span class="family-text">
          <span class="family-name">${esc(String(f.family || "").replace(/^The\s+/i, "").replace(/\s+family$/i, ""))} family</span>
          <span class="family-meta">${esc(who)} · ${esc(CONDITIONS[f.condition]?.short || f.condition)}</span>
          <span class="family-sub">${esc(shortCuisine(f.cuisine))} · ${esc(f.language)}</span>
        </span>
        <span class="family-check" aria-hidden="true">${on ? "✓" : ""}</span>
      </button>`;
  }).join("");
}

async function loadFamily(id, btn) {
  btn.classList.add("is-loading");
  btn.setAttribute("aria-busy", "true");
  const check = btn.querySelector(".family-check");
  if (check) check.innerHTML = `<span class="spinner" aria-hidden="true"></span>`;
  try {
    const fam = await api(`/api/demo/${encodeURIComponent(id)}`);
    state.adaptRun += 1;
    if (state.planCtrl) { const c = state.planCtrl; state.planCtrl = null; state.planning = false; c.abort(); }
    stopListening();
    state.family = { id: fam.id, family: fam.family, parent: fam.parent };
    state.condition = Object.hasOwn(CONDITIONS, fam.condition) ? fam.condition : "diabetes"; state.also = [];
    state.cuisine = fam.cuisine;
    state.language = fam.language;
    state.parentName = String(fam.parent || "").split(",")[0].trim().slice(0, 20);
    state.saved = null;
    // A new family means a new person: start their intake fresh, with the family's condition ticked.
    state.profile = defaultProfile(); state.profileSet = false; state.intakeOpen = false;
    // Your own dishes stay; a sample family's dishes replace the previous sample family's.
    const own = state.recipes.filter((e) => e.origin === "own" || e.origin === "suggested");
    own.forEach((e) => {
      if (e.adapted && e.origin !== "suggested" && adaptedKey(e.adapted) !== condKey()) e.adapted = null;
      if (e.status !== "idle" || e.asking) { e.status = "idle"; e.error = ""; e.req = null; e.asking = false; }
    });
    const famEntries = (fam.recipes || []).map((r) => ({ id: String(r.id || uid()), base: r, adapted: null, status: "idle", error: "", open: null, origin: fam.id }));
    state.recipes = [...own, ...famEntries].slice(0, MAX_DISHES);
    state.plan = null; state.planStale = false; state.planError = false; state.cookbookVersion += 1; state.week = 1;
    resetComposer();
    $("adaptProgress").hidden = true;
    $("parseMsg").textContent = "";
    syncControls();
    renderResume();
    renderFamilies();
    renderCookbook();
    renderPlan();
    scrollToEl($("dishes"));
    $("dishesTitle").focus({ preventScroll: true });
    announce(`Loaded ${fam.family}: ${famEntries.length} dishes, cooking for ${fam.parent}. Making them lighter now.`);
    saveBook();
    adaptAll($("adaptAll"));
  } catch (err) {
    renderFamilies();
    toast(err.message);
  }
}

// ---------- dishes ----------
function refreshButtons() {
  const n = state.recipes.length;
  const anyBusy = state.recipes.some((e) => e.status === "busy" || e.asking);
  const todo = state.recipes.some((e) => !e.adapted && e.status !== "busy");
  const all = $("adaptAll");
  const allBusy = all.hasAttribute("aria-busy");
  // Only needed when something is left to do and nothing is running (e.g. after a failure).
  $("adaptBar").hidden = !(todo && !anyBusy && !allBusy);
  // Wait for dishes still being made lighter, or their late replies would make the new week stale.
  const wait = anyBusy || allBusy;
  $("plan").disabled = n === 0 || wait;
  const go = $("intakeGo");
  if (!state.planning) {
    go.disabled = wait;
    go.textContent = wait ? "Waiting for your dishes…" : "Plan my week";
  }
  document.querySelectorAll("[data-replan]").forEach((b) => { b.disabled = wait || state.planning; });
  renderSections();
  return anyBusy;
}

function focusNumbers(r) {
  const c = CONDITIONS[r.condition] || CONDITIONS[state.condition];
  const key = r.focus || c.key;
  const meta = NUTRIENTS.find((x) => x[0] === key) || [key, c.nutrient, c.unit];
  const before = num(r.original?.nutrition?.[key]);
  const after = num(r.nutrition?.[key]);
  const pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
  return { key, unit: meta[2], label: c.nutrient, before, after, pct };
}

function changedItems(r) {
  const orig = r.original?.ingredients;
  if (!orig) return new Set();
  const before = new Map(orig.map((g) => [g.item, num(g.grams)]));
  const out = new Set();
  (r.ingredients || []).forEach((g) => {
    const was = before.get(g.item);
    if (was === undefined || Math.abs(was - num(g.grams)) > 0.05) out.add(g.item);
  });
  return out;
}

function ingredientsBlock(r, { compare = true } = {}) {
  const orig = compare ? r.original?.ingredients : null;
  const unc = new Set(r.nutrition?.uncounted || []);
  const hm = (g) => (g.home_measure ? ` <span class="ing-hm">(${esc(g.home_measure)})</span>` : "");
  const tags = (g) => (g.matched === false || unc.has(g.item) ? ` <span class="ing-unc">not counted</span>` : "");
  const line = (g, extra = "") => `<li><span class="ing-amt">${esc(grams(g.grams))}</span><span class="ing-name">${esc(g.item)}${hm(g)}${extra}${tags(g)}</span></li>`;
  if (!orig) return `<ul class="ing-list">${(r.ingredients || []).map((g) => line(g)).join("")}</ul>`;
  const before = new Map(orig.map((g) => [g.item, num(g.grams)]));
  const nowItems = new Set((r.ingredients || []).map((g) => g.item));
  const items = (r.ingredients || []).map((g) => {
    const was = before.get(g.item);
    if (was === undefined) return line(g, ` <span class="ing-new">new</span>`);
    if (Math.abs(was - num(g.grams)) > 0.05) return line(g, ` <span class="ing-was">(was ${esc(grams(was))})</span>`);
    return line(g);
  });
  orig.filter((g) => !nowItems.has(g.item)).forEach((g) => {
    items.push(`<li class="is-gone"><span class="ing-amt"><s>${esc(grams(g.grams))}</s></span><span class="ing-name"><s>${esc(g.item)}</s> <span class="ing-gone-tag">left out</span></span></li>`);
  });
  return `<ul class="ing-list">${items.join("")}</ul>`;
}

// Steps that carry a swap get a saffron dot: they mention a new or changed ingredient, or a measuring word.
function swapStep(step, words) {
  const s = String(step).toLowerCase();
  if (/\b(instead|measured|measure|swap|swapped|less|fewer|lighter|skip|only)\b/.test(s)) return true;
  return words.some((w) => s.includes(w));
}

function methodBlock(r) {
  const steps = (Array.isArray(r.method) ? r.method : []).filter((s) => String(s || "").trim()).slice(0, 10);
  if (!steps.length) return "";
  const words = [];
  changedItems(r).forEach((item) => String(item).toLowerCase().split(/[^a-zÀ-ɏ]+/).forEach((w) => { if (w.length >= 4) words.push(w); }));
  let dots = 0;
  const lis = steps.map((s) => {
    const dot = r.original && swapStep(s, words);
    if (dot) dots += 1;
    return `<li${dot ? ` class="is-swap"` : ""}>${dot ? `<span class="sr-only">Changed step: </span>` : ""}${esc(s)}</li>`;
  }).join("");
  return `
    <div class="rc-block">
      <h4 class="rc-h">Method</h4>
      <ol class="method">${lis}</ol>
      ${dots ? `<p class="rc-legend"><span class="dot" aria-hidden="true"></span>Steps with a dot carry a lighter swap.</p>` : ""}
    </div>`;
}

function factsBlock(r) {
  const facts = (Array.isArray(r.facts) ? r.facts : []).filter((f) => f && String(f.text || "").trim()).slice(0, 2);
  if (!facts.length) return "";
  return `
    <aside class="facts" aria-label="Good to know">
      <p class="facts-h"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19c0-8 6-13 14-14-1 8-6 14-14 14Z"/><path d="M5 19l7-7"/></svg>Good to know</p>
      <ul>${facts.map((f) => {
        const url = safeUrl(f.url);
        const src = String(f.source || "").trim();
        const link = src ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(src)}<span class="sr-only"> (opens in a new tab)</span></a>` : esc(src)) : "";
        return `<li><p>${esc(f.text)}</p>${link ? `<p class="facts-src">Source: ${link}</p>` : ""}</li>`;
      }).join("")}</ul>
    </aside>`;
}

function sourcesBlock(r) {
  const n = r.nutrition || {};
  const o = r.original?.nutrition;
  const rows = NUTRIENTS.map(([k, label, unit]) => {
    const now = `${unit === "kcal" ? "≈ " : ""}${fmt(n[k], unit)} ${unit}`;
    if (!o) return `<tr><td>${esc(label)}</td><td>${esc(now)}</td></tr>`;
    const down = LOWER_IS_BETTER.has(k) && num(n[k]) < num(o[k]) - 0.05;
    return `<tr><td>${esc(label)}</td><td>${esc(fmt(o[k], unit))} ${esc(unit)}</td><td class="${down ? "down" : ""}">${esc(now)}</td></tr>`;
  }).join("");
  const head = o ? `<tr><th scope="col">Per serving</th><th scope="col">Before</th><th scope="col">Now</th></tr>` : `<tr><th scope="col">Per serving</th><th scope="col">Amount</th></tr>`;
  const sources = (r.sources || []).map((s) => `
    <li><span>${esc(s.item)}<br><span class="muted">${esc(readableRecord(s.record))}</span></span>
      <span class="src-id">${esc(s.source)} ${esc(s.id)}</span></li>`).join("");
  const unc = n.uncounted?.length ? `<p class="small-print">Not counted (not in our tables yet): ${esc(n.uncounted.join(", "))}.</p>` : "";
  return `
    <table class="nut-table"><caption class="sr-only">Nutrition per serving</caption><thead>${head}</thead><tbody>${rows}</tbody></table>
    <ul class="src-list">${sources || `<li class="muted">No sources listed.</li>`}</ul>
    ${unc}
    <p class="small-print">Worked out by our code from food tables, using raw weights. Not by the AI.</p>`;
}

// Asks stack: each one is sent with the earlier ones, always against the original recipe,
// so "no ghee" then "less spicy" keeps the ghee out. They live on the adapted version, so Undo
// and a change of health focus bring back the matching list.
const ASK_MAX = 200; // the /api/adapt request limit
function askList(e) {
  const a = e.adapted;
  if (!a) return [];
  if (Array.isArray(a.asks)) return a.asks;
  const legacy = String(a.request || "").trim();
  return legacy ? [legacy] : [];
}
// Keep the most recent asks that fit in one request.
function fitAsks(list) {
  const out = list.map((s) => String(s || "").trim().slice(0, ASK_MAX)).filter(Boolean);
  while (out.length > 1 && out.join("; ").length > ASK_MAX) out.shift();
  return out;
}

function askedLine(e) {
  const r = e.adapted;
  const asks = askList(e);
  if (!asks.length) return "";
  const first = (r.changes || [])[0];
  const answer = first ? `${first.what}${first.why ? `. ${first.why}` : ""}` : "Done.";
  const dis = e.asking ? " disabled" : "";
  return `
    <div class="asked">
      <p class="asked-q"><span class="asked-k">You asked${asks.length > 1 ? ` for all ${asks.length}` : ""}:</span></p>
      <ul class="ask-pills" aria-label="Your asks for this dish">
        ${asks.map((a, i) => `<li class="ask-pill"><span>${esc(a)}</span><button type="button" class="ask-x" data-ask-remove="${esc(e.id)}" data-i="${i}" aria-label="Drop “${esc(a)}”"${dis}><span aria-hidden="true">×</span></button></li>`).join("")}
      </ul>
      <p class="asked-a"><span aria-hidden="true">→</span> ${esc(answer)}</p>
      ${e.prev ? `<button type="button" class="btn-link" data-ask-undo="${esc(e.id)}"${dis}>Undo</button>` : ""}
    </div>`;
}

function askBox(e) {
  const chips = state.cuisine === "south_asian" ? ASK_CHIPS_SOUTH_ASIAN : ASK_CHIPS;
  const dis = e.asking ? " disabled" : "";
  return `
    <form class="ask" data-ask="${esc(e.id)}">
      <label class="rc-h" for="ask-${esc(e.id)}">Ask about this dish</label>
      <div class="ask-row">
        <input id="ask-${esc(e.id)}" type="text" maxlength="200" autocomplete="off" placeholder="e.g. Dad hates cauliflower"${dis} value="${esc(e.askDraft || "")}">
        <button type="submit" class="btn btn-quiet btn-small"${dis}>${e.asking ? `<span class="spinner" aria-hidden="true"></span><span>Changing…</span>` : "Ask"}</button>
      </div>
      <div class="chips" role="group" aria-label="Quick asks">
        ${chips.map((c) => `<button type="button" class="chip" data-chip="${esc(c)}"${dis}>${esc(c)}</button>`).join("")}
      </div>
      ${e.askGuard ? `<div class="guard-slot">${guardHTML(e.askGuard, e.askGuard.code === "support" ? "" : chips[0])}</div>`
        : e.askError ? `<p class="msg error" role="alert">${esc(e.askError)}</p>` : ""}
    </form>`;
}

async function askDish(id, text) {
  const e = findEntry(id);
  const request = String(text || "").trim().slice(0, ASK_MAX);
  if (!e || !e.adapted || e.asking) return;
  if (!request) { document.getElementById(`ask-${id}`)?.focus(); return; }
  // Asking the same thing again doesn't add it twice; it moves to the end (most recent).
  const earlier = askList(e).filter((a) => a.toLowerCase() !== request.toLowerCase());
  await runAsks(e, [...earlier, request], request);
}

function dropAsk(id, index) {
  const e = findEntry(id);
  if (!e || !e.adapted || e.asking) return;
  const list = askList(e).filter((_, i) => i !== index);
  runAsks(e, list, "");
}

// Re-make the dish from its original with these asks. `draft` stays in the box while it runs.
async function runAsks(e, list, draft) {
  const id = e.id;
  const asks = fitAsks(list);
  const request = asks.join("; ");
  const [condition, ...also] = conds();
  const key = condKey();
  const done = (next, note) => {
    e.prev = e.adapted;
    e.adapted = next;
    e.asking = false; e.askDraft = ""; e.askError = ""; e.askGuard = null;
    markCookbookChanged();
    renderCard(id);
    renderPlanStale();
    saveBook();
    const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
    (card?.querySelector(".asked") || card)?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
    if (!card?.contains(document.activeElement)) card?.querySelector("h3")?.focus({ preventScroll: true });
    announce(note);
  };
  // A suggested dish with no asks left goes back to the dish as it was suggested; no call needed.
  if (!asks.length && e.origin === "suggested") {
    done({ ...e.base, condition: e.adapted.condition, condKey: e.adapted.condKey, id: e.id, asks: [] }, `Back to ${e.base.name} as suggested.`);
    return;
  }
  const token = {};
  e.req = token; e.asking = true; e.askError = ""; e.askGuard = null; e.askDraft = draft; e.open = true;
  renderCard(id);
  const stale = () => findEntry(id) !== e || (e.origin !== "suggested" && condKey() !== key) || e.req !== token;
  try {
    // Always from the original (a suggested dish is its own original), with every ask so far.
    const body = { recipe: baseFields(e.base), condition, also, cuisine: state.cuisine };
    if (request) body.request = request;
    const { recipe } = await api("/api/adapt", body);
    if (stale()) return;
    // A server that doesn't echo the request didn't act on it (e.g. the static preview): don't pretend it did.
    if (request && !String(recipe.request || "").trim()) throw new Error("Couldn't change this dish for that request here. Please try again in the full app.");
    const next = { ...recipe, condition, condKey: key, id: e.id, request, asks };
    const dropped = list.length - asks.length;
    done(next, `Updated ${recipe.name}.${dropped > 0 ? ` To keep it short, we dropped your oldest ask${dropped === 1 ? "" : "s"}.` : ""}`);
    if (dropped > 0) toast(`Kept your latest ${asks.length} asks; the oldest ${dropped === 1 ? "one was" : `${dropped} were`} too long to send too.`);
  } catch (err) {
    if (stale()) return;
    e.asking = false; e.askError = err.message; e.askGuard = err.guard || null;
    if (e.askGuard?.code === "support") e.askDraft = ""; // don't leave the hard words sitting in the box
    renderCard(id);
  }
}

function mealWord(r) { return r.meal === "dessert" ? "Sweet" : r.meal === "breakfast" ? "Breakfast" : "Main"; }

function dishCard(e, index) {
  const r = current(e);
  const n = r.nutrition || {};
  const c = CONDITIONS[state.condition];
  const adapted = Boolean(e.adapted);
  const isBusy = e.status === "busy";
  const open = e.open === null || e.open === undefined ? index === 0 : e.open;
  const fromSuggest = e.origin === "suggested";
  const plainSuggested = adapted && Boolean(r.suggested); // as suggested, not yet changed by an ask
  const condList = (Array.isArray(r.conditions) && r.conditions.length ? r.conditions : [r.condition]).filter((x) => Object.hasOwn(CONDITIONS, x));
  const condTags = adapted && condList.length
    ? `<p class="cond-tags"><span class="sr-only">For: </span>${condList.map((x) => `<span class="cond-tag">${esc(CONDITIONS[x].short)}</span>`).join("")}</p>` : "";

  let numbers, badge = "", secondary = "";
  if (plainSuggested) {
    const f = focusNumbers(r);
    numbers = `
      <p class="nums"><span class="nums-now plain">${esc(fmt(f.after, f.unit))}<span class="nums-unit"> ${esc(f.unit)}</span></span></p>
      <p class="nums-label">${esc(f.label)} per serving</p>`;
    if (f.key === "kcal") secondary = `<ul class="nums-2">${SECONDARY.map(([k, label, unit]) => `<li>${esc(label)} <b>${esc(fmt(n[k], unit))} ${esc(unit)}</b></li>`).join("")}</ul>`;
    badge = `<span class="tag tag-suggest">Suggested for you</span>`;
  } else if (adapted) {
    const f = focusNumbers(r);
    numbers = `
      <p class="nums"><span class="sr-only">${esc(f.label)} per serving: was </span><span class="nums-was">${esc(fmt(f.before, f.unit))}</span><span class="nums-arrow" aria-hidden="true">→</span><span class="sr-only"> now </span><span class="nums-now">${esc(fmt(f.after, f.unit))}<span class="nums-unit"> ${esc(f.unit)}</span></span></p>
      <p class="nums-label" aria-hidden="true">${esc(f.label)} per serving</p>`;
    if (f.key === "kcal" && r.original?.nutrition) {
      secondary = `<ul class="nums-2">${SECONDARY.map(([k, label, unit]) => `<li>${esc(label)} <span class="n2-was">${esc(fmt(r.original.nutrition[k], unit))}</span> <span aria-hidden="true">→</span><span class="sr-only">now</span> <b>${esc(fmt(n[k], unit))} ${esc(unit)}</b></li>`).join("")}</ul>`;
    }
    if (fromSuggest) badge = `<span class="tag tag-suggest">Suggested for you</span>`;
    else if (r.comparable === false) badge = `<span class="tag tag-quiet">No % shown</span>`;
    else if (f.pct > 0) badge = `<span class="tag tag-win">${f.pct}% less</span>`;
    else badge = `<span class="tag tag-quiet">Already light</span>`;
  } else {
    numbers = `
      <p class="nums"><span class="nums-now plain">${esc(fmt(n[c.key], c.unit))}<span class="nums-unit"> ${esc(c.unit)}</span></span></p>
      <p class="nums-label">${esc(c.nutrient)} per serving, as cooked now</p>`;
  }

  // Same anatomy as Care's result card: headline chip, then what changes, then where it comes from.
  const quick = adapted && !plainSuggested ? (r.changes || []).slice(0, 3) : [];
  const whatChanges = quick.length ? `
    <div class="rc-quick"><p class="rc-h">What changes</p>
      <ul class="quick-list">${quick.map((ch) => `<li><span class="tick" aria-hidden="true">✓</span><span>${esc(ch.what)}</span></li>`).join("")}</ul></div>` : "";
  const trust = adapted ? `<p class="trust-chip"><span aria-hidden="true">✓</span> Numbers from food tables</p>` : "";

  let status = "";
  if (isBusy) status = `<p class="working"><span class="spinner" aria-hidden="true"></span><span>Making it lighter<span class="dots"></span><span class="working-sub">Keeping the taste, trimming the ${esc(c.nutrient)}</span></span></p>`;
  else if (e.status === "error") status = `<p class="msg error" role="alert">${esc(e.error)}</p>`;
  const retry = !adapted && !isBusy && e.status === "error" ? `<button type="button" class="btn btn-quiet btn-small" data-adapt="${esc(e.id)}">Try again</button>` : "";

  const links = `
    <div class="rc-links">
      ${fromSuggest ? "" : `<button type="button" class="btn-link" data-edit="${esc(e.id)}">Edit recipe</button>`}
      <button type="button" class="btn-link danger" data-remove="${esc(e.id)}" aria-label="Remove ${esc(r.name)}">Remove</button>
    </div>`;

  let body = "";
  if (plainSuggested) {
    const why = String(r.why || "").trim();
    const portion = String(r.portion_tip || r.cooking_tip || "").trim();
    body = `
      <details class="more" data-more="${esc(e.id)}" ${open ? "open" : ""}>
        <summary><span class="when-closed">Show recipe</span><span class="when-open">Hide recipe</span></summary>
        <div class="more-body">
          ${why ? `<div class="why-fits"><p class="portion-h">Why it fits</p><p>${esc(why)}</p></div>` : ""}
          <div class="rc-block"><h4 class="rc-h">Ingredients</h4>${ingredientsBlock(r, { compare: false })}</div>
          ${methodBlock({ ...r, original: null })}
          ${portion ? `<div class="portion"><p class="portion-h">Portion</p><p>${esc(portion)}</p></div>` : ""}
          ${askBox(e)}
          ${factsBlock(r)}
          <div class="rc-more"><details class="sub"><summary>Where the numbers come from</summary>${sourcesBlock({ ...r, original: null })}</details></div>
          ${links}
        </div>
      </details>`;
  } else if (adapted) {
    const why = r.comparable === false
      ? `<p class="small-print">The new version uses something not in our food tables, so we don't claim a "% less".</p>` : "";
    const changes = (r.changes || []).slice(0, 4);
    const portion = String(r.portion_tip || r.cooking_tip || "").trim();
    const orig = e.base;
    body = `
      <details class="more" data-more="${esc(e.id)}" ${open ? "open" : ""}>
        <summary><span class="when-closed">Show recipe</span><span class="when-open">Hide recipe</span></summary>
        <div class="more-body">
          <div class="rc-block">
            <h4 class="rc-h">Ingredients <span class="rc-h-note">lighter version</span></h4>
            ${ingredientsBlock(r)}
          </div>
          ${methodBlock(r)}
          ${portion ? `<div class="portion"><p class="portion-h">Portion</p><p>${esc(portion)}</p></div>` : ""}
          ${changes.length ? `<div class="rc-block"><h4 class="rc-h">Why these changes</h4><ul class="changes">${changes.map((ch) => `
            <li><span class="tick" aria-hidden="true">✓</span><span>${esc(ch.what)}<span class="why">${esc(ch.why)}</span></span></li>`).join("")}</ul></div>` : ""}
          ${why}
          ${askBox(e)}
          ${factsBlock(r)}
          <div class="rc-more">
            <details class="sub"><summary>Where the numbers come from</summary>${sourcesBlock(r)}</details>
            <details class="sub"><summary>Show the original</summary>
              <div class="sub-body">
                ${orig.source_text ? `<p class="quote">“${esc(orig.source_text)}”</p>` : ""}
                ${ingredientsBlock(orig, { compare: false })}
              </div>
            </details>
          </div>
          ${links}
        </div>
      </details>`;
  } else if (!isBusy) {
    const unc = n.uncounted?.length ? `<p class="small-print">Not counted yet (not in our tables): ${esc(n.uncounted.join(", "))}.</p>` : "";
    body = `
      <details class="more" data-more="${esc(e.id)}" ${e.open ? "open" : ""}>
        <summary><span class="when-closed">See the recipe as you gave it</span><span class="when-open">Hide the recipe</span></summary>
        <div class="more-body">
          ${e.base.source_text ? `<p class="quote">“${esc(e.base.source_text)}”</p>` : ""}
          ${ingredientsBlock(r, { compare: false })}
          ${unc}
          ${links}
        </div>
      </details>`;
  }

  return `
    <article class="dish${adapted ? " is-adapted" : ""}" id="dish-${esc(e.id)}" data-card="${esc(e.id)}" aria-busy="${isBusy}">
      <div class="dish-main">
        <div class="dish-top">
          <p class="dish-meal">${esc(mealWord(r))}</p>
          ${badge}
        </div>
        <h3 tabindex="-1">${esc(r.name)}</h3>
        <p class="dish-serves">Serves ${esc(r.servings)}</p>
        ${condTags}
        ${numbers}
        ${secondary}
        ${whatChanges}
        ${adapted ? askedLine(e) : ""}
        ${trust}
        ${status}
        ${retry}
      </div>
      ${body}
    </article>`;
}

function renderSummary() {
  const done = state.recipes.filter((e) => e.origin !== "suggested" && e.adapted && adaptedKey(e.adapted) === condKey());
  if (done.length < 2) { $("summary").innerHTML = ""; return; }
  const c = CONDITIONS[state.condition];
  const pcts = done.filter((e) => e.adapted.comparable !== false).map((e) => {
    const r = e.adapted; const k = r.focus || c.key;
    const b = num(r.original?.nutrition?.[k]); const a = num(r.nutrition?.[k]);
    return b > 0 ? ((b - a) / b) * 100 : 0;
  });
  const avg = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : 0;
  $("summary").innerHTML = avg > 0 ? `
    <div class="summary">
      <span class="summary-big">${avg}% less</span>
      <span class="summary-text">${esc(c.nutrient)} on average<br><span class="muted">${done.length} of ${state.recipes.length} dish${state.recipes.length === 1 ? "" : "es"}, same family food</span></span>
    </div>` : "";
}

function renderCookbook() {
  $("cookbook").innerHTML = state.recipes.map((e, i) => dishCard(e, i)).join("");
  renderNames();
  renderSummary();
  refreshButtons();
}

// Replace one card in place, keeping focus sensible for keyboard users.
function renderCard(id) {
  const e = findEntry(id);
  const old = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
  if (!e || !old) { renderCookbook(); return; }
  const hadFocus = old.contains(document.activeElement);
  const tmp = document.createElement("div");
  tmp.innerHTML = dishCard(e, state.recipes.indexOf(e)).trim();
  const card = tmp.firstElementChild;
  old.replaceWith(card);
  if (hadFocus) {
    const target = card.querySelector("[data-adapt]:not([disabled])") || card.querySelector("h3");
    target?.focus({ preventScroll: true });
  }
  renderSummary();
  refreshButtons();
}

async function adaptOne(id) {
  const e = findEntry(id);
  if (!e || e.adapted || e.status === "busy") return "skip";
  const [condition, ...also] = conds();
  const key = condKey();
  const token = {};
  e.req = token;
  e.status = "busy"; e.error = "";
  renderCard(id);
  const stale = () => findEntry(id) !== e || condKey() !== key || e.req !== token;
  try {
    const { recipe } = await api("/api/adapt", { recipe: baseFields(e.base), condition, also, cuisine: state.cuisine });
    // Drop the reply if the dish was removed/replaced, the health focus changed, or a newer request started.
    if (stale()) return "stale";
    if (recipe.condition && recipe.condition !== condition) return "stale";
    e.adapted = { ...recipe, condition, condKey: key, id: e.id };
    e.status = "idle";
    markCookbookChanged();
    renderCard(id);
    renderPlanStale();
    saveBook();
    return "ok";
  } catch (err) {
    if (stale()) return "stale";
    e.status = "error"; e.error = err.message;
    renderCard(id);
    return "fail";
  }
}

async function adaptAll(btn) {
  const run = ++state.adaptRun;
  const ids = state.recipes.filter((e) => !e.adapted && e.status !== "busy").map((e) => e.id);
  if (!ids.length) return;
  const prog = $("adaptProgress");
  let done = 0, failed = 0, i = 0;
  const draw = () => {
    if (run !== state.adaptRun) return;
    prog.hidden = false;
    prog.className = "progress-line";
    const pct = Math.round(((done + failed) / ids.length) * 100);
    prog.innerHTML = `<span>Making ${ids.length === 1 ? "it" : "them"} lighter: ${done} of ${ids.length} done${failed ? `, ${failed} couldn't be changed` : ""}…</span><span class="prog-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
  };
  draw();
  await busy(btn, "Making them lighter…", async () => {
    const worker = async () => {
      while (i < ids.length && run === state.adaptRun) {
        const id = ids[i++];
        const result = await adaptOne(id);
        if (result === "fail") failed += 1; else done += 1;
        draw();
      }
    };
    // Release the button as soon as the run is cancelled (family switch, condition change),
    // instead of waiting up to a minute for old in-flight replies.
    const finished = Promise.all(Array.from({ length: Math.min(ADAPT_CONCURRENCY, ids.length) }, worker));
    let poll;
    const cancelled = new Promise((resolve) => {
      poll = setInterval(() => { if (run !== state.adaptRun) resolve(); }, 200);
    });
    await Promise.race([finished, cancelled]).finally(() => clearInterval(poll));
  });
  if (run !== state.adaptRun) return;
  const ok = ids.length - failed;
  if (failed) {
    prog.className = "progress-line has-fail";
    prog.textContent = `${ok} of ${ids.length} dishes are lighter. Tap "Try again" on the ${failed === 1 ? "other one" : `other ${failed}`}.`;
    announce(prog.textContent);
  } else {
    prog.hidden = true;
    announce(`All ${ids.length} dishes are lighter. Next: plan the week.`);
  }
  saveBook();
}

// ---------- composer ----------
function recipeAsText(r) {
  if (r.source_text) return r.source_text;
  return `${r.name}: ${(r.ingredients || []).map((g) => `${grams(g.grams)} ${g.item}`).join(", ")}`;
}

const SUGGEST_EXAMPLE = "a quick high-protein dinner with spinach";
// "Or tap one" on Plate's input card, like Care's example remedies: one tap and it runs.
// scripts/build_preview.py precomputes these (and the home shortcut's dal), so keep the two in step.
const PLATE_EXAMPLES = [
  ["Mum's dal chawal", "Mum's dal chawal: 1 katori toor dal, 2 katori rice, 1 tomato, haldi, jeera, 1 spoon ghee"],
  ["Aloo paratha", "Aloo paratha: 3 katori atta, 2 boiled aloo, ghee on top"],
  ["Chicken adobo", "Chicken adobo: 1 kg chicken, half cup soy sauce, half cup vinegar, garlic, 3 cups rice"],
  ["Beef stew", "Beef stew: 500 g beef, 3 potatoes, 2 carrots, 1 onion, a spoon of butter"],
];
function renderPlateExamples() {
  $("plateExamples").innerHTML = PLATE_EXAMPLES.map(([label, text]) =>
    `<button type="button" class="chip-btn" data-plate-example="${esc(text)}">${esc(label)}</button>`).join("");
}
// Fill the card with an example recipe and make it lighter, exactly as if it had been typed.
function runPlateExample(text) {
  if ($("parse").hasAttribute("aria-busy")) return;
  if (state.composerMode !== "recipe" || state.editingId) resetComposer();
  clearGuard("recipeGuard");
  $("servings").value = 4;
  $("recipeText").value = text;
  submitComposer($("parse"));
}
function micIdleLabel() { return state.composerMode === "suggest" ? "Say what you'd like" : "Say a recipe"; }

// The composer has two jobs: a family recipe to make lighter, or a wish for a new dish ("suggest").
function setComposerMode(mode) {
  const suggest = mode === "suggest";
  if ((state.composerMode === "suggest") !== suggest) $("recipeText").value = "";
  state.composerMode = suggest ? "suggest" : "recipe";
  const box = $("recipeText");
  box.maxLength = suggest ? 300 : 2000;
  box.rows = suggest ? 3 : 4;
  box.placeholder = suggest ? `e.g. ${SUGGEST_EXAMPLE}` : "Or type or paste it: dish name, then what goes in. Home measures are fine.";
  $("recipeTextLabel").textContent = suggest ? "What would you like to eat?" : "The recipe: dish name, then what goes in";
  $("goalLegend").firstChild.textContent = suggest ? "Suggest it for " : "Make it lighter for ";
  $("composer").classList.toggle("is-suggest", suggest);
  syncControls();
  if (!voice.listening) $("mic").querySelector(".mic-label").textContent = micIdleLabel();
}

// The input card is always there. Its own title and Cancel show only for the other jobs (editing a dish,
// suggesting a new one); in its usual job the page headline is its title.
function composerChrome() {
  const suggest = state.composerMode === "suggest";
  const editing = Boolean(state.editingId && findEntry(state.editingId));
  const alt = editing || suggest;
  $("composer").classList.toggle("is-alt", alt);
  $("composerClose").hidden = !alt;
  $("composerTitle").textContent = editing ? "Edit the recipe" : suggest ? "What would you like?" : "Tell us the recipe";
  if (!$("parse").hasAttribute("aria-busy")) $("parse").textContent = editing ? "Update and make it lighter" : suggest ? "Suggest a dish" : "Make it lighter";
}

// Back to the card's usual job (a family recipe to make lighter), e.g. after a dish was added.
function resetComposer() {
  state.composerOpen = false;
  state.editingId = null;
  if (state.composerMode !== "recipe") setComposerMode("recipe");
  composerChrome();
}

function openComposer({ mode = "type", editId = null } = {}) {
  const editing = editId ? findEntry(editId) : null;
  if (state.intakeOpen) state.intakeOpen = false;
  setComposerMode(editing ? "recipe" : mode === "suggest" ? "suggest" : "recipe");
  state.composerOpen = true;
  state.editingId = editing ? editing.id : null;
  composerChrome();
  if (editing) {
    $("recipeText").value = recipeAsText(editing.base);
    $("servings").value = Math.min(20, Math.max(1, Math.round(num(editing.base.servings)) || 4));
  }
  const msg = $("parseMsg");
  msg.className = "msg"; msg.textContent = "";
  // Start listening inside the tap itself, so the browser allows the microphone.
  if (mode === "say") startListening();
  refreshButtons();
  syncControls();
  scrollToEl($("composer"));
  if (mode !== "say" || !voice.rec) $("recipeText").focus({ preventScroll: true });
}

function closeComposer() {
  stopListening();
  const wasEditing = Boolean(state.editingId);
  resetComposer();
  if (wasEditing) $("recipeText").value = "";
  refreshButtons();
  if (state.recipes.length) { scrollToEl($("dishes")); $("dishesTitle").focus({ preventScroll: true }); }
  else { window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); $("recipeText").focus({ preventScroll: true }); }
}

async function submitComposer(btn) {
  stopListening();
  const text = $("recipeText").value.trim();
  const msg = $("parseMsg");
  msg.className = "msg";
  clearGuard("recipeGuard");
  if (text.length < 3) {
    msg.className = "msg error";
    msg.textContent = state.composerMode === "suggest" ? "Say or type what you'd like first." : "Say or type a recipe first.";
    $("recipeText").focus();
    return;
  }
  if (state.composerMode === "suggest") { await submitSuggest(btn, text); return; }
  const editing = state.editingId ? findEntry(state.editingId) : null;
  if (!editing && state.recipes.length >= MAX_DISHES) {
    msg.className = "msg error";
    msg.textContent = `Your family book holds up to ${MAX_DISHES} dishes. Remove one to add another.`;
    return;
  }
  const servings = Math.min(20, Math.max(1, Math.round(num($("servings").value) || 4)));
  const stop = ticker(msg, `<span class="spinner" aria-hidden="true"></span><span>Reading your recipe<span class="dots"></span></span>`);
  msg.className = "msg working";
  try {
    const { recipe } = await busy(btn, "Reading…", () => api("/api/parse", { text, servings, cuisine: state.cuisine }));
    stop();
    let id;
    if (editing && findEntry(editing.id)) {
      id = editing.id;
      editing.base = { ...recipe, id };
      editing.adapted = null; editing.prev = null; editing.asking = false; editing.askError = "";
      editing.status = "idle"; editing.error = ""; editing.req = null; editing.open = true;
    } else {
      id = uid();
      state.recipes.unshift({ id, base: { ...recipe, id }, adapted: null, status: "idle", error: "", open: true, origin: "own" });
    }
    state.saved = null;
    markCookbookChanged();
    $("recipeText").value = "";
    msg.className = "msg"; msg.textContent = "";
    resetComposer();
    renderResume();
    renderCookbook();
    renderPlanStale();
    const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (card) { scrollToEl(card); card.querySelector("h3")?.focus({ preventScroll: true }); }
    announce(`Read “${recipe.name}”. Making it lighter now.`);
    saveBook();
    await adaptOne(id);
  } catch (err) {
    stop();
    if (err.guard) { msg.className = "msg"; msg.textContent = ""; showGuard("recipeGuard", "recipeText", err.guard, recipeExample()); return; }
    msg.className = "msg error";
    msg.textContent = err.message;
  }
}

// What to try when the box held something that isn't a recipe.
function recipeExample() {
  return state.cuisine === "south_asian" ? "Mum's dal: 1 katori toor dal, 1 tomato, haldi, jeera, 1 spoon ghee" : `Family stew: ${EXAMPLES[state.cuisine] || EXAMPLES.other}`;
}

async function submitSuggest(btn, wish) {
  const msg = $("parseMsg");
  if (state.recipes.length >= MAX_DISHES) {
    msg.className = "msg error";
    msg.textContent = `Your family book holds up to ${MAX_DISHES} dishes. Remove one to add another.`;
    return;
  }
  const servings = Math.min(12, Math.max(1, Math.round(num($("servings").value) || 4)));
  const p = state.profileSet || state.profileTouched ? profile() : null;
  const conditions = conds();
  const key = condKey();
  const stop = ticker(msg, `<span class="spinner" aria-hidden="true"></span><span>Thinking of a dish that fits<span class="dots"></span></span>`);
  msg.className = "msg working";
  try {
    const body = { wish: wish.slice(0, 300), conditions, cuisine: state.cuisine, servings, diet: p ? p.diet : "non_veg", dislikes: p ? p.dislikes : "" };
    const { recipe } = await busy(btn, "Thinking…", () => api("/api/suggest", body));
    stop();
    const id = uid();
    const r = { ...recipe, id, suggested: true };
    state.recipes.unshift({ id, base: r, adapted: { ...r, condition: conditions[0], condKey: key }, status: "idle", error: "", open: true, origin: "suggested" });
    state.saved = null;
    markCookbookChanged();
    $("recipeText").value = "";
    msg.className = "msg"; msg.textContent = "";
    resetComposer();
    renderResume();
    renderCookbook();
    renderPlanStale();
    const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (card) { scrollToEl(card); card.querySelector("h3")?.focus({ preventScroll: true }); }
    announce(`Suggested: ${recipe.name}. Added to your family book.`);
    saveBook();
  } catch (err) {
    stop();
    if (err.guard) { msg.className = "msg"; msg.textContent = ""; showGuard("recipeGuard", "recipeText", err.guard, SUGGEST_EXAMPLE); return; }
    msg.className = "msg error";
    msg.textContent = err.message;
  }
}

// ---------- voice ----------
const voice = { rec: null, listening: false, base: "" };

// No speech recognition (e.g. Firefox): the mic stays, and says plainly to type instead.
// `again` re-announces the line after a tap, since a status region only speaks when its text changes.
function noVoiceHint(hint, again = false) {
  hint.classList.add("is-novoice");
  hint.closest(".mic-wrap")?.classList.add("no-voice");
  if (!again) { hint.textContent = VOICE_FALLBACK; return; }
  hint.textContent = "";
  setTimeout(() => { hint.textContent = VOICE_FALLBACK; }, 60);
}

function updateMicHint() {
  const hint = $("micHint");
  if (!voice.rec) { noVoiceHint(hint); return; }
  hint.classList.remove("is-novoice"); hint.closest(".mic-wrap")?.classList.remove("no-voice");
  hint.textContent = voice.listening
    ? `Listening in ${state.speechLang}. Tap Done when you've finished.`
    : `Listens in ${state.speechLang}. Check the words before you go on.`;
}

function setListening(on) {
  voice.listening = on;
  const mic = $("mic");
  mic.setAttribute("aria-pressed", String(on));
  mic.querySelector(".mic-label").textContent = on ? "Done" : micIdleLabel();
  mic.closest(".mic-wrap").classList.toggle("is-listening", on);
  updateMicHint();
}

function startListening() {
  if (!voice.rec) { noVoiceHint($("micHint"), true); return; }
  if (voice.listening) return;
  const rec = voice.rec;
  voice.base = $("recipeText").value.trim();
  rec.lang = SPEECH_LANG[state.speechLang] || "en-IN";
  const m = $("parseMsg");
  m.className = "msg"; m.textContent = "";
  try {
    rec.start();
    setListening(true);
  } catch {
    // InvalidStateError: a session is still closing. Reset quietly and let the user tap again.
    try { rec.abort(); } catch { /* ignore */ }
    setListening(false);
  }
}

function stopListening() {
  if (!voice.rec || !voice.listening) return;
  try { voice.rec.stop(); } catch { /* already stopped */ }
}

function setupVoice() {
  const mic = $("mic");
  mic.addEventListener("click", () => {
    if (!voice.rec) { noVoiceHint($("micHint"), true); $("recipeText").focus(); return; }
    if (voice.listening) stopListening(); else startListening();
  });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { updateMicHint(); return; } // the button stays; it explains and moves to typing
  let rec;
  try { rec = new SR(); } catch { updateMicHint(); return; }
  voice.rec = rec;
  rec.interimResults = true;  // live transcript in the box
  rec.continuous = true;      // keep listening until Done
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const box = $("recipeText");
    const said = Array.from(ev.results).map((r) => r[0]?.transcript || "").join(" ").replace(/\s+/g, " ").trim();
    box.value = (voice.base ? voice.base + " " : "") + said;
  };
  rec.onerror = (ev) => {
    const m = $("parseMsg");
    const reasons = {
      "not-allowed": "Microphone access was blocked. Allow it in your browser settings, or type instead.",
      "service-not-allowed": "Voice typing isn't available here. Please type instead.",
      "no-speech": "We didn't hear anything. Tap the mic and try again.",
      "audio-capture": "No microphone found. Please type instead.",
      "network": "Voice typing needs an internet connection. Please type instead.",
      "language-not-supported": `Voice typing doesn't support ${state.speechLang} in this browser. Try English, or type instead.`,
    };
    if (ev.error !== "aborted") { m.className = "msg error"; m.textContent = reasons[ev.error] || "Voice typing stopped. Please try again or type instead."; }
    setListening(false);
  };
  rec.onend = () => setListening(false);
  updateMicHint();
}

// ---------- plan my week: the intake ----------
function pickHTML(name, options, type, isOn) {
  return options.map(([v, l]) => `<label class="pick-opt"><input type="${type}" name="${name}" value="${esc(v)}"${isOn(v) ? " checked" : ""}><span>${esc(l)}</span></label>`).join("");
}

function goalHelpText(goal) { return (GOALS.find(([k]) => k === goal) || GOALS[0])[2]; }
function goalsHelp(goals) { return goals.map(goalHelpText).join(" "); }
function checkedGoals() { return Array.from($("intakeForm").querySelectorAll('input[name="goal"]:checked')).map((x) => x.value); }
// "Eat well" means no special goal, so it can't sit alongside the others.
function onGoalToggle(input) {
  const boxes = $("intakeForm").querySelectorAll('input[name="goal"]');
  if (input.checked && input.value === "maintain") boxes.forEach((b) => { if (b !== input) b.checked = false; });
  else if (input.checked) boxes.forEach((b) => { if (b.value === "maintain") b.checked = false; });
  if (!checkedGoals().length) boxes.forEach((b) => { if (b.value === "maintain") b.checked = true; });
  $("goalHelp").textContent = goalsHelp(checkedGoals());
}

function setHeightFromCm() {
  const cm = num($("pHeight").value);
  if (!$("pHeight").value || cm <= 0) { $("pFt").value = ""; $("pIn").value = ""; return; }
  let ft = Math.floor(cm / 2.54 / 12);
  let inch = Math.round(cm / 2.54 - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  $("pFt").value = ft; $("pIn").value = inch;
}
function setHeightFromFtIn() {
  const ft = $("pFt").value, inch = $("pIn").value;
  if (!ft && !inch) { $("pHeight").value = ""; return; }
  $("pHeight").value = Math.round((num(ft) * 12 + num(inch)) * 2.54);
}
function setLbFromKg() {
  const kg = $("pWeight").value;
  $("pLb").value = kg && num(kg) > 0 ? Math.round(num(kg) * 2.20462) : "";
}
function setKgFromLb() {
  const lb = $("pLb").value;
  $("pWeight").value = lb && num(lb) > 0 ? Math.round((num(lb) / 2.20462) * 10) / 10 : "";
}

function intakeTitle() {
  return hasParent() ? `Let's plan ${state.parentName.trim()}'s week` : "Let's plan your week";
}

function renderIntake() {
  const p = profile();
  const langs = state.health?.languages || DEFAULT_LANGUAGES;
  const n = state.recipes.length;
  $("intakeTitle").textContent = intakeTitle();
  $("intakeSub").textContent = n
    ? `A few quick questions, like a chat with a dietitian. We'll build the week around your ${n} family dish${n === 1 ? "" : "es"} and suggest simple meals for the rest.`
    : "A few quick questions, like a chat with a dietitian. We'll suggest simple meals that fit. You can add family recipes any time.";
  $("pName").value = state.parentName;
  $("pLang").innerHTML = langs.map((l) => `<option value="${esc(l)}"${l === state.language ? " selected" : ""}>${esc(l)}</option>`).join("");
  $("pDiet").innerHTML = pickHTML("diet", DIETS, "radio", (v) => v === p.diet);
  $("dietNote").textContent = DIET_NOTES[p.diet] || "";
  clearGuard("avoidGuard");
  $("pCond").innerHTML = pickHTML("cond", HEALTH, "checkbox", (v) => p.conditions.includes(v));
  $("pGoal").innerHTML = pickHTML("goal", GOALS, "checkbox", (v) => p.goals.includes(v));
  $("goalHelp").textContent = goalsHelp(p.goals);
  $("pAvoid").value = p.dislikes;
  $("pSex").innerHTML = pickHTML("sex", SEXES, "radio", (v) => v === p.sex);
  $("pAge").value = p.age ?? "";
  $("pHeight").value = p.height_cm ?? "";
  $("pWeight").value = p.weight_kg ?? "";
  setHeightFromCm(); setLbFromKg();
  $("pAct").innerHTML = pickHTML("act", ACTIVITY, "radio", (v) => v === p.activity);
  $("pEth").innerHTML = pickHTML("eth", ETHNICITIES, "radio", (v) => v === p.ethnicity);
  $("pPregnant").checked = p.pregnant;
  $("pPregWrap").hidden = p.sex !== "female";
  $("pTarget").open = Boolean(p.sex || p.age || p.height_cm || p.weight_kg || p.ethnicity);
  $("pSnacks").checked = p.snacks;
  $("pHousehold").value = state.household;
  const msg = $("intakeMsg");
  msg.className = "msg"; msg.textContent = "";
}

// Read the form. Returns {profile, name, language, household} or {error, field}.
function readIntake() {
  const form = $("intakeForm");
  const checked = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
  const ranges = [["pAge", 1, 120, "Age", "years"], ["pHeight", 80, 250, "Height", "cm"], ["pWeight", 25, 350, "Weight", "kg"]];
  for (const [id, lo, hi, label, unit] of ranges) {
    const raw = $(id).value.trim();
    if (raw && !(num(raw) >= lo && num(raw) <= hi)) {
      $("pTarget").open = true;
      return { error: `${label} should be between ${lo} and ${hi} ${unit}.`, field: id };
    }
  }
  const val = (id) => ($(id).value.trim() ? num($(id).value) : null);
  const p = cleanProfile({
    diet: checked("diet"),
    conditions: Array.from(form.querySelectorAll('input[name="cond"]:checked')).map((x) => x.value),
    goal: checkedGoals()[0] || "maintain",
    goals: checkedGoals(),
    dislikes: $("pAvoid").value.trim(),
    sex: checked("sex"),
    age: val("pAge"),
    height_cm: val("pHeight"),
    weight_kg: val("pWeight"),
    activity: checked("act"),
    ethnicity: checked("eth"),
    pregnant: $("pPregnant").checked,
    snacks: $("pSnacks").checked,
  });
  return {
    profile: p,
    name: $("pName").value.trim().slice(0, 20),
    language: $("pLang").value,
    household: Math.min(12, Math.max(1, Math.round(num($("pHousehold").value)) || 1)),
  };
}

function openIntake() {
  if (!state.profileSet && !state.profileTouched) state.profile = defaultProfile();
  if (state.composerOpen) { stopListening(); resetComposer(); }
  state.intakeOpen = true;
  renderIntake();
  refreshButtons();
  scrollToEl($("intake"));
  $("intakeTitle").focus({ preventScroll: true });
}

function closeIntake() {
  state.intakeOpen = false;
  refreshButtons();
  if (state.plan) { scrollToEl($("week")); $("weekTitle").focus({ preventScroll: true }); }
  else if (state.recipes.length) { scrollToEl($("dishes")); $("dishesTitle").focus({ preventScroll: true }); }
  else { window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); $("recipeText").focus({ preventScroll: true }); }
}

function submitIntake() {
  const r = readIntake();
  const msg = $("intakeMsg");
  if (r.error) {
    msg.className = "msg error"; msg.textContent = r.error;
    $(r.field).focus();
    return;
  }
  msg.className = "msg"; msg.textContent = "";
  state.profile = r.profile;
  state.parentName = r.name;
  if (r.name) state.language = r.language;
  state.household = r.household;
  renderNames();
  makePlan();
}

// ---------- the week ----------
function renderPlanStale() {
  const el = document.querySelector("#planOut .stale");
  if (el) el.hidden = !state.planStale;
  refreshButtons();
}

function hasNote(plan) { return Boolean(String(plan?.message_for_parent || "").trim()); }

function noteLabel(plan) {
  const lang = String(plan.language || "").trim();
  const live = state.health?.mode === "live";
  return `A note for ${parentWord()}${live && lang && lang !== "English" ? ` · in ${lang}` : ""}`;
}

function shopGroups(plan) {
  const groups = {};
  (plan.shopping_list || []).forEach((s) => { (groups[s.category in SHOP_GROUPS ? s.category : "other"] ||= []).push(s); });
  return Object.keys(SHOP_GROUPS).filter((k) => groups[k]).map((k) => [k, groups[k]]);
}

const kcal = (v) => Math.round(num(v)).toLocaleString("en-US");
function people(n) { return `${n} ${n === 1 ? "person" : "people"}`; }

function planSlots(plan) {
  const seen = new Set();
  (plan.days || []).forEach((d) => (d.meals || []).forEach((m) => seen.add(m.slot)));
  return SLOT_ORDER.filter((k) => seen.has(k));
}

function portionWord(s) {
  const n = num(s) || 1;
  const whole = Math.floor(n + 1e-9);
  const frac = Math.round((n - whole) * 4) / 4;
  const f = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[frac] || "";
  const txt = `${whole || !f ? whole : ""}${f}`;
  return `${txt} ${n === 1 || n < 1 ? "portion" : "portions"}`;
}

function keyNumbers(plan) {
  const conds = plan.profile?.conditions || [];
  const keys = conds.map((c) => KEY_NUMBERS[c]).filter(Boolean);
  if ((plan.profile?.goals || [plan.profile?.goal]).includes("steady_sugar") && !conds.includes("diabetes")) keys.unshift(KEY_NUMBERS.diabetes);
  if (!keys.length) keys.push(["fiber_g", "Fibre", "g"]);
  return keys;
}

function profileWords(plan) {
  const p = plan.profile || {};
  const bits = [DIET_WORDS[p.diet] || DIET_WORDS.non_veg];
  (p.conditions || []).forEach((c) => { const h = HEALTH.find(([k]) => k === c); if (h) bits.push(h[1]); });
  (p.goals || [p.goal]).forEach((k) => { const g = GOALS.find(([x]) => x === k); if (g && g[0] !== "maintain") bits.push(g[1]); });
  return bits;
}

function targetLine(plan) {
  const t = num(plan.target?.kcal);
  return `About ${kcal(plan.average?.kcal)} kcal a day${t ? ` · target ${kcal(t)}` : ""}`;
}

function weekSummary(plan) {
  const avg = plan.average || {};
  const t = plan.target || {};
  const target = num(t.kcal);
  const prot = num(avg.protein_g);
  const aim = num(t.protein_g);
  const stats = [`
    <div class="stat"><dt>Protein</dt><dd><b>${esc(fmt(prot, "g"))} g</b> a day${aim ? `<span class="stat-sub${prot < 0.85 * aim ? " is-low" : ""}">aim ${esc(aim)} g</span>` : ""}</dd></div>`];
  keyNumbers(plan).forEach(([k, label, unit]) => {
    stats.push(`<div class="stat"><dt>${esc(label)}</dt><dd><b>${esc(unit === "mg" ? kcal(avg[k]) : fmt(avg[k], unit))} ${esc(unit)}</b> a day</dd></div>`);
  });
  const who = hasParent() ? `for ${state.parentName.trim()}` : "";
  return `
    <div class="wk-summary">
      <p class="wk-who">${profileWords(plan).map(esc).join(" · ")}${who ? ` · ${esc(who)}` : ""}</p>
      <div class="wk-cal">
        <p class="wk-big"><span class="wk-about">About</span> ${esc(kcal(avg.kcal))}<span class="wk-unit"> kcal a day</span></p>
        <p class="wk-target">${target ? `Target ${esc(kcal(target))} kcal a day, set from age, height, weight and activity` : "Normal portions. Add age, height and weight for a personal target."}</p>
        ${bodyLine(t.body) ? `<p class="wk-body">${esc(bodyLine(t.body))}</p>` : ""}
      </div>
      <dl class="wk-stats">${stats.join("")}</dl>
      <p class="wk-foot">Daily averages over the week, worked out from food tables.</p>
    </div>`;
}

// Neutral wording: a number and a range, never a judgement or a warning colour.
function bodyLine(b) {
  if (!b || !Number.isFinite(Number(b.bmi))) return "";
  const r = Array.isArray(b.healthy_range_kg) && b.healthy_range_kg.length === 2 ? b.healthy_range_kg : null;
  const cut = b.cutoffs === "WHO Asian" ? "WHO Asian cut-offs" : "WHO cut-offs";
  return `BMI ${fmt(b.bmi, "g")}${r ? ` · healthy range ${Math.round(num(r[0]))}–${Math.round(num(r[1]))} kg` : ""} (${cut})`;
}

function notesBlock(plan) {
  const notes = (plan.notes || []).filter((x) => String(x || "").trim());
  if (!notes.length) return "";
  const li = (x) => `<li>${esc(x)}</li>`;
  const rest = notes.slice(2);
  return `
    <aside class="wk-notes" aria-labelledby="wkNotesH">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19c0-8 6-13 14-14-1 8-6 14-14 14Z"/><path d="M5 19l7-7"/></svg>
      <div class="wk-notes-body">
        <h3 id="wkNotesH" class="wk-notes-h">Notes from your plan</h3>
        <ul>${notes.slice(0, 2).map(li).join("")}</ul>
        ${rest.length ? `<ul id="wkNotesRest" class="wk-notes-rest"${state.notesOpen ? "" : " hidden"}>${rest.map(li).join("")}</ul>
        <button type="button" class="btn-link wk-notes-toggle" data-notes-toggle aria-expanded="${Boolean(state.notesOpen)}" aria-controls="wkNotesRest">${state.notesOpen ? "Show fewer" : `Show all ${notes.length} notes`}</button>` : ""}
      </div>
    </aside>`;
}

function mealRow(m, dayIndex, mealIndex) {
  const slot = SLOT_NAMES[m.slot] || m.slot;
  const top = `<p class="meal-top"><span class="meal-slot">${esc(slot)}</span><span class="meal-kcal">${esc(kcal(m.nutrition?.kcal))} kcal</span></p>`;
  if (m.source === "family") {
    const e = m.recipe_id != null ? findEntry(String(m.recipe_id)) : null;
    const name = e
      ? `<button type="button" class="meal-name dish-link" data-goto-dish="${esc(e.id)}">${esc(m.name)}</button>`
      : `<span class="meal-name">${esc(m.name)}</span>`;
    return `
      <li class="meal is-family">
        ${top}
        ${name}
        <p class="meal-meta"><span class="tag-fam">Family dish</span><span>${esc(portionWord(m.servings))}</span>${e ? `<span class="sr-only">. Activate the name to open the recipe.</span>` : ""}</p>
      </li>`;
  }
  const ings = (m.ingredients || []).map((g) => `<li><span class="ing-amt">${esc(grams(g.grams))}</span><span class="ing-name">${esc(g.item)}</span></li>`).join("");
  const how = String(m.how || "").trim();
  return `
    <li class="meal is-suggested">
      ${top}
      <details class="meal-more" data-meal="${dayIndex}-${mealIndex}">
        <summary><span class="meal-name">${esc(m.name)}</span><span class="meal-meta"><span class="tag-sug">Suggested</span><span class="meal-open"><span class="when-closed">How to make it</span><span class="when-open">Hide</span></span></span></summary>
        <div class="meal-body">
          ${ings ? `<p class="rc-h">For one person</p><ul class="ing-list">${ings}</ul>` : ""}
          ${how ? `<p class="meal-how">${esc(how)}</p>` : ""}
        </div>
      </details>
    </li>`;
}

function dayCard(d, i, plan) {
  const tot = d.totals || {};
  const target = num(plan.target?.kcal);
  const [k, label, unit] = keyNumbers(plan)[0];
  return `
    <article class="day-card${i === state.weekDay ? " is-current" : ""}" id="day-${i}" aria-labelledby="dayh-${i}">
      <h3 id="dayh-${i}" class="day-h">${esc(DAY_NAMES[d.day] || d.day)}</h3>
      <ul class="meals">${(d.meals || []).map((m, j) => mealRow(m, i, j)).join("")}</ul>
      <p class="day-total"><span class="day-total-l">Day total</span><span><b>${esc(kcal(tot.kcal))} kcal</b>${target ? `<span class="muted"> · target ${esc(kcal(target))}</span>` : ""}</span></p>
      <p class="day-key">${esc(label)}: ${esc(unit === "mg" ? kcal(tot[k]) : fmt(tot[k], unit))} ${esc(unit)}</p>
    </article>`;
}

function weekTabs(plan) {
  const tabs = [["meals", "Meals"], ["shop", "Shopping list"]];
  if (hasNote(plan)) tabs.push(["note", `Note for ${parentWord()}`]);
  if ((plan.tips || []).some((t) => String(t || "").trim())) tabs.push(["tips", "Tips"]);
  return tabs;
}

function todayIndex(plan) {
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
  const i = (plan.days || []).findIndex((d) => d.day === short);
  return i >= 0 ? i : 0;
}

function renderPlan() {
  const out = $("planOut");
  const plan = state.plan;
  renderNames();
  if (state.planning) { refreshButtons(); return; } // the progress card owns #planOut until the reply
  const err = state.planErrorMsg ? `
    <div class="msg error plan-err" role="alert">
      <p>${esc(state.planErrorMsg)}</p>
      <div class="plan-err-btns">
        <button type="button" class="btn btn-quiet btn-small" data-retry-plan>Try again</button>
        <button type="button" class="btn-link" data-prefs>Change preferences</button>
      </div>
    </div>` : "";
  if (!plan) { out.innerHTML = err; refreshButtons(); return; }
  const days = plan.days || [];
  if (state.weekDay >= days.length) state.weekDay = 0;
  const shopping = plan.shopping_list || [];
  const unadapted = state.recipes.filter((e) => !e.adapted).length;
  const tabs = weekTabs(plan);
  const tab = tabs.some(([k]) => k === state.weekTab) ? state.weekTab : "meals";
  const tips = (plan.tips || []).filter((t) => String(t || "").trim());
  const hh = Math.max(1, num(plan.household) || 1);

  const meals = `
    <div class="day-chips" role="group" aria-label="Choose a day">
      ${days.map((d, i) => `<button type="button" class="day-chip" data-day="${i}" aria-pressed="${i === state.weekDay}" aria-controls="day-${i}" aria-label="${esc(DAY_NAMES[d.day] || d.day)}">${esc(d.day)}</button>`).join("")}
    </div>
    <div class="days-grid">${days.map((d, i) => dayCard(d, i, plan)).join("")}</div>`;
  const shop = `
    <div class="panel-head"><p class="muted">For ${esc(people(hh))}, the whole week. Raw weights; tick as you shop.</p>
      <button type="button" class="btn btn-quiet btn-small" data-copy="shop">Copy list</button></div>
    ${shopGroups(plan).map(([k, items]) => `
      <div class="shop-group"><h3>${esc(SHOP_GROUPS[k])}</h3>
        <ul class="shop">${items.map((s) => `<li><label><input type="checkbox"><span class="shop-item"><span>${esc(s.item)}</span><span class="shop-qty">${esc(grams(s.grams))}</span></span></label></li>`).join("")}</ul>
      </div>`).join("")}`;
  const note = hasNote(plan) ? `
    <article class="letter" aria-labelledby="noteTitle">
      <h3 id="noteTitle" class="letter-label">${esc(noteLabel(plan))}</h3>
      <p class="letter-text" id="parentMsg">${esc(plan.message_for_parent)}</p>
      <div class="letter-btns">
        <button type="button" class="btn btn-quiet btn-small" data-copy="parentMsg">Copy the note</button>
        <button type="button" class="btn btn-quiet btn-small" data-act="share-note">Send the note to ${esc(parentWord())}</button>
      </div>
    </article>` : "";
  const tipsPanel = tips.length ? `<ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  const panels = { meals, shop, note, tips: tipsPanel };

  out.innerHTML = `
    ${err}
    <p class="msg warn stale" ${state.planStale ? "" : "hidden"}>Your dishes changed. Tap “Update my week” to include them.</p>
    ${unadapted ? `<p class="hint">${unadapted} dish${unadapted === 1 ? " is" : "es are"} still the original. Make ${unadapted === 1 ? "it" : "them"} lighter, then plan again.</p>` : ""}
    ${weekSummary(plan)}
    ${notesBlock(plan)}
    <div class="tabs" role="tablist" aria-label="Your week">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" data-tab="${k}">${esc(l)}${k === "shop" ? ` <span class="count">${shopping.length}</span>` : ""}</button>`).join("")}
    </div>
    ${tabs.map(([k]) => `<div class="tab-panel${k === "note" ? " is-note" : ""}${k === "meals" ? " is-meals" : ""}" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" tabindex="0" ${k === tab ? "" : "hidden"}>${panels[k]}</div>`).join("")}
    <div class="wk-actions">
      <button type="button" class="btn ${state.planStale ? "btn-primary" : "btn-quiet"}" data-replan>${state.planStale ? "Update my week" : "Plan another week"}</button>
      <button type="button" class="btn-link" data-prefs>Change preferences</button>
    </div>`;
  refreshButtons();
}

function selectTab(k, focus) {
  state.weekTab = k;
  document.querySelectorAll("#planOut [role=tab]").forEach((t) => {
    const on = t.dataset.tab === k;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  document.querySelectorAll("#planOut [role=tabpanel]").forEach((p) => { p.hidden = p.id !== `panel-${k}`; });
}

function selectDay(i) {
  state.weekDay = i;
  document.querySelectorAll("#planOut .day-chip").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.day) === i)));
  document.querySelectorAll("#planOut .day-card").forEach((c) => c.classList.toggle("is-current", c.id === `day-${i}`));
}

function progressHTML(title, stages) {
  return `
    <div class="planning" role="group" aria-labelledby="planningTitle">
      <h3 id="planningTitle" class="planning-title" tabindex="-1">${esc(title)}</h3>
      <ol class="stages">${stages.map((s, i) => `<li data-stage="${i}"><span class="stage-mark" aria-hidden="true"></span><span class="stage-text">${esc(s)}</span><span class="sr-only stage-state"></span></li>`).join("")}</ol>
      <div class="planning-foot">
        <p class="muted">Usually takes 30–40 seconds <span class="secs" aria-hidden="true"></span></p>
        <button type="button" class="btn btn-quiet btn-small" data-cancel-plan>Cancel</button>
      </div>
    </div>`;
}

function drawStages(now) {
  document.querySelectorAll("#planOut .stages li").forEach((li, i) => {
    li.classList.toggle("is-done", i < now);
    li.classList.toggle("is-now", i === now);
    li.querySelector(".stage-state").textContent = i < now ? " (done)" : i === now ? " (in progress)" : "";
  });
}

async function makePlan() {
  if (state.planning) return;
  const p = cleanProfile(profile());
  state.profile = p;
  const lang = planLanguage();
  const ctrl = new AbortController();
  const version = state.cookbookVersion;
  const n = state.recipes.length;
  const meals = 7 * (p.snacks ? 4 : 3);
  const hasBody = Boolean(p.sex && p.age && p.height_cm && p.weight_kg);
  const title = n ? `Planning ${meals} meals around your family's dishes…` : `Planning ${meals} meals${hasParent() ? ` for ${state.parentName.trim()}` : ""}…`;
  const stages = PLAN_STAGES.map(([label], i) => {
    if (i === 0 && !hasBody) return "Reading the preferences";
    if (i === 1 && n) return "Choosing meals around your dishes";
    return label;
  });
  state.planCtrl = ctrl;
  state.planning = true; state.planError = false; state.planErrorMsg = ""; state.intakeOpen = false;
  state.saved = null; renderResume(); // this visit's week replaces the saved one
  const out = $("planOut");
  out.innerHTML = progressHTML(title, stages);
  refreshButtons();
  scrollToEl($("week"));
  $("planningTitle").focus({ preventScroll: true });
  const start = Date.now();
  let stage = -1;
  const tick = () => {
    const s = (Date.now() - start) / 1000;
    let now = 0;
    PLAN_STAGES.forEach(([, at], i) => { if (s >= at) now = i; });
    if (now !== stage) { stage = now; drawStages(now); if (now > 0) announce(`${stages[now]}…`); }
    const secs = out.querySelector(".secs");
    if (secs && s >= 2) secs.textContent = `· ${Math.floor(s)} s`;
  };
  tick();
  const timer = setInterval(tick, 500);
  const finish = () => { clearInterval(timer); if (state.planCtrl === ctrl) { state.planning = false; state.planCtrl = null; } };
  try {
    const recipes = state.recipes.map((e) => baseFields(current(e)));
    const { week } = await api("/api/week", { recipes, profile: p, language: lang, week: state.week, household: state.household }, 150000, ctrl.signal);
    if (state.planCtrl !== ctrl) { clearInterval(timer); return; }
    finish();
    state.plan = week;
    // Dishes that changed while planning are kept in the week as they were; offer an update.
    state.planStale = state.cookbookVersion !== version;
    state.profileSet = true; state.profileTouched = false;
    state.weekTab = "meals";
    state.weekDay = todayIndex(week);
    renderPlan();
    saveBook();
    $("weekTitle").focus({ preventScroll: true });
    announce(`Your week is ready: ${targetLine(week)}. ${hasNote(week) ? "With a shopping list and a note." : "With a shopping list."}`);
  } catch (err) {
    if (state.planCtrl !== ctrl) { clearInterval(timer); return; }
    finish();
    if (err.cancelled) {
      if (!state.plan) state.intakeOpen = true;
      renderPlan();
      if (state.intakeOpen) { renderIntake(); refreshButtons(); scrollToEl($("intake")); $("intakeTitle").focus({ preventScroll: true }); }
      else { $("weekTitle").focus({ preventScroll: true }); }
      announce("Stopped planning. Nothing was changed.");
      return;
    }
    if (err.guard) {
      // The foods-to-avoid box held something we can't use: back to the form, message under that box.
      state.intakeOpen = true;
      renderPlan();
      renderIntake();
      refreshButtons();
      showGuard("avoidGuard", "pAvoid", err.guard, "mushrooms, peanuts");
      $("pAvoid").focus({ preventScroll: true });
      return;
    }
    state.planError = true;
    state.planErrorMsg = err.message;
    renderPlan();
    out.querySelector(".plan-err")?.scrollIntoView({ block: "nearest" });
  }
}

function cancelPlan() {
  if (state.planCtrl) state.planCtrl.abort();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// Shared links always open on the home page (#home), never on whichever side the sender was using.
function homeLink() {
  return /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}#home` : "";
}
function withHomeLink(text) {
  const link = homeLink();
  return link ? `${text}\n\nMade with Heritage: ${link}` : text;
}

async function shareText(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (err) {
      if (err && err.name === "AbortError") return; // the person closed the share sheet
    }
  }
  const ok = await copyText(text);
  toast(ok ? "Copied as text. Paste it anywhere." : "Couldn't copy. Please select the text and copy it.");
}

// ---------- the family cookbook ----------
function focusLine(r) {
  const f = focusNumbers(r);
  if (r.suggested) return { f, text: `${f.label.charAt(0).toUpperCase() + f.label.slice(1)} per serving: ${fmt(f.after, f.unit)} ${f.unit}` };
  const pct = r.comparable !== false && f.pct > 0 ? ` (${f.pct}% less)` : "";
  return { f, text: `${f.label.charAt(0).toUpperCase() + f.label.slice(1)} per serving: ${fmt(f.before, f.unit)} → ${fmt(f.after, f.unit)} ${f.unit}${pct}` };
}

function cookbookHTML() {
  const plan = state.plan;
  const stale = Boolean(plan && state.planStale);
  const shareWord = navigator.share ? "Share" : "Copy as text";
  const note = plan && hasNote(plan);
  const care = typeof careBookHTML === "function" ? careBookHTML() : ""; // Heritage Care's pages (static/care.js)
  const fromCare = typeof careBookFromCare === "function" && careBookFromCare();
  const dishes = state.recipes.map((e) => {
    const r = current(e);
    const adapted = Boolean(e.adapted);
    const steps = (Array.isArray(r.method) ? r.method : []).filter((s) => String(s || "").trim()).slice(0, 10);
    const portion = String(r.portion_tip || "").trim();
    const changes = adapted ? (r.changes || []).slice(0, 4) : [];
    const facts = adapted ? (Array.isArray(r.facts) ? r.facts : []).filter((x) => x && x.text).slice(0, 2) : [];
    return `
      <article class="cb-dish">
        <p class="cb-kicker">${esc(mealWord(r))} · Serves ${esc(r.servings)}${e.origin === "suggested" ? " · Suggested for you" : adapted ? "" : " · original, not yet made lighter"}</p>
        <h3>${esc(r.name)}</h3>
        ${adapted ? `<p class="cb-focus">${esc(focusLine(r).text)}</p>` : ""}
        <div class="cb-cols">
          <div><h4 class="rc-h">Ingredients</h4>${ingredientsBlock(r, { compare: adapted && !r.suggested })}</div>
          ${steps.length ? `<div><h4 class="rc-h">Method</h4><ol class="method">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>` : ""}
        </div>
        ${portion ? `<div class="portion"><p class="portion-h">Portion</p><p>${esc(portion)}</p></div>` : ""}
        ${r.suggested && String(r.why || "").trim() ? `<div class="cb-why"><h4 class="rc-h">Why it fits</h4><p>${esc(r.why)}</p></div>` : ""}
        ${changes.length ? `<div class="cb-why"><h4 class="rc-h">What we changed and why</h4><ul>${changes.map((c) => `<li><b>${esc(c.what)}.</b> ${esc(c.why)}</li>`).join("")}</ul></div>` : ""}
        ${facts.length ? `<div class="cb-facts"><h4 class="rc-h">Good to know</h4><ul>${facts.map((x) => `<li>${esc(x.text)}${x.source ? ` <span class="cb-src">Source: ${esc(x.source)}${safeUrl(x.url) ? `, ${esc(safeUrl(x.url))}` : ""}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      </article>`;
  }).join("");
  const slots = plan ? planSlots(plan) : [];
  const cell = (d, k) => {
    const m = (d.meals || []).find((x) => x.slot === k);
    if (!m) return "–";
    return m.source === "family" ? `<b>${esc(m.name)}</b>` : esc(m.name);
  };
  const hh = plan ? Math.max(1, num(plan.household) || 1) : 1;
  const notes = plan ? (plan.notes || []).filter((x) => String(x || "").trim()) : [];
  const week = plan ? `
    <section class="cb-sec cb-week-sec">
      <h3>This week's meals</h3>
      ${stale ? `<p class="msg warn cb-stale">Your dishes changed since this week was planned. Go back and tap “Update my week” to include them.</p>` : ""}
      <p class="cb-target">${esc(targetLine(plan))} · ${esc(profileWords(plan).join(" · "))}</p>
      ${bodyLine(plan.target?.body) ? `<p class="cb-legend">${esc(bodyLine(plan.target.body))}</p>` : ""}
      <table class="cb-week">
        <thead><tr><th scope="col">Day</th>${slots.map((k) => `<th scope="col">${esc(SLOT_NAMES[k])}</th>`).join("")}<th scope="col" class="cb-num">kcal</th></tr></thead>
        <tbody>${(plan.days || []).map((d) => `<tr><th scope="row">${esc(d.day)}</th>${slots.map((k) => `<td>${cell(d, k)}</td>`).join("")}<td class="cb-num">${esc(kcal(d.totals?.kcal))}</td></tr>`).join("")}</tbody>
      </table>
      <p class="cb-legend">${state.recipes.length ? "Family dishes in bold. " : ""}Calories per person per day, from food tables.</p>
      ${notes.length ? `<ul class="cb-notes">${notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="cb-sec">
      <h3>Shopping list <span class="cb-h-sub">for ${esc(people(hh))}</span></h3>
      <div class="cb-shop">${shopGroups(plan).map(([k, items]) => `<div><h4 class="rc-h">${esc(SHOP_GROUPS[k])}</h4><ul>${items.map((s) => `<li><span>${esc(s.item)}</span><span>${esc(grams(s.grams))}</span></li>`).join("")}</ul></div>`).join("")}</div>
    </section>
    ${note ? `<section class="cb-sec cb-note"><h3>${esc(noteLabel(plan))}</h3><p class="cb-note-text">${esc(plan.message_for_parent)}</p></section>` : ""}` : `
    ${state.recipes.length ? `<p class="cb-noplan no-print">Plan the week to add meals, a shopping list and a note.</p>` : ""}`;
  return `
    <div class="wrap cb-wrap">
      <div class="cb-toolbar">
        <button type="button" class="btn-link" data-act="close-cookbook"><span aria-hidden="true">←</span> ${fromCare ? "Back" : "Back to your week"}</button>
        <div class="cb-btns">
          <button type="button" class="btn btn-primary btn-small" data-act="print">Print or save PDF</button>
          <button type="button" class="btn btn-quiet btn-small" data-act="share">${shareWord}</button>
          ${note ? `<button type="button" class="btn btn-quiet btn-small" data-act="share-note">Send the note to ${esc(parentWord())}</button>` : ""}
        </div>
      </div>
      <header class="cb-cover">
        <p class="eyebrow">Heritage</p>
        <h2 id="cbTitle" tabindex="-1">${esc(cookbookTitle())}</h2>
        <p class="cb-line">${esc(coverLine())}</p>
      </header>
      ${state.recipes.length ? dishes : plan || care ? "" : `<p class="cb-noplan">Nothing in your family book yet.</p>`}
      ${week}
      ${care}
      ${state.recipes.length || plan ? `<footer class="cb-foot">${esc(SOURCES_LINE)}</footer>` : ""}
    </div>`;
}

function cookbookText() {
  const plan = state.plan;
  const L = [cookbookTitle(), coverLine(), ""];
  state.recipes.forEach((e) => {
    const r = current(e);
    L.push(`== ${r.name} (serves ${r.servings}) ==`);
    if (e.adapted) L.push(focusLine(r).text);
    L.push("Ingredients:");
    (r.ingredients || []).forEach((g) => L.push(`- ${grams(g.grams)} ${g.item}${g.home_measure ? ` (${g.home_measure})` : ""}`));
    const steps = (Array.isArray(r.method) ? r.method : []).filter((s) => String(s || "").trim());
    if (steps.length) { L.push("Method:"); steps.forEach((s, i) => L.push(`${i + 1}. ${s}`)); }
    if (r.portion_tip) L.push(`Portion: ${r.portion_tip}`);
    if (r.suggested && r.why) L.push(`Why it fits: ${r.why}`);
    if (e.adapted && r.changes?.length) { L.push("What we changed:"); r.changes.slice(0, 4).forEach((c) => L.push(`- ${c.what}: ${c.why}`)); }
    L.push("");
  });
  if (plan) {
    L.push("== This week ==", `${targetLine(plan)} · ${profileWords(plan).join(" · ")}`);
    if (state.planStale) L.push("Note: your dishes changed since this week was planned. Update the week to include them.");
    if (bodyLine(plan.target?.body)) L.push(bodyLine(plan.target.body));
    (plan.days || []).forEach((d) => L.push(`${DAY_NAMES[d.day] || d.day} (${kcal(d.totals?.kcal)} kcal): ${(d.meals || []).map((m) => `${SLOT_NAMES[m.slot] || m.slot} ${m.name}${m.source === "family" ? " (family dish)" : ""}`).join(" · ")}`));
    (plan.notes || []).forEach((x) => L.push(`Note: ${x}`));
    L.push("", `== Shopping list (for ${people(Math.max(1, num(plan.household) || 1))}) ==`);
    (plan.shopping_list || []).forEach((s) => L.push(`- ${s.item}: ${grams(s.grams)}`));
    if (hasNote(plan)) L.push("", `== ${noteLabel(plan)} ==`, plan.message_for_parent);
    L.push("");
  }
  if (typeof careBookText === "function") { const c = careBookText(); if (c) L.push(c, ""); }
  if (state.recipes.length || plan) L.push(SOURCES_LINE); // food numbers only when the book has Plate pages
  return L.join("\n").trim();
}

function renderCookbookView() { $("cookbookView").innerHTML = cookbookHTML(); }

function openCookbook() {
  renderCookbookView();
  document.body.classList.add("cb-open");
  window.scrollTo(0, 0);
  $("cbTitle").focus({ preventScroll: true });
  announce("Your family book.");
}
function closeCookbook() {
  if (typeof careCloseBook === "function" && careCloseBook()) return; // opened from Care: go back there
  document.body.classList.remove("cb-open");
  const target = state.plan ? $("week") : $("dishes");
  if (!target.hidden) { scrollToEl(target); (state.plan ? $("weekTitle") : $("dishesTitle")).focus({ preventScroll: true }); }
}
function printCookbook() {
  renderCookbookView();
  window.print();
}

// ---------- events ----------
document.querySelectorAll('input[name="condition"]').forEach((r) => r.addEventListener("change", () => toggleCondition(r.value, r.checked)));
$("goalChips").addEventListener("change", (e) => { if (e.target.name === "goalChip") toggleCondition(e.target.value, e.target.checked); });
$("cuisine").addEventListener("change", (e) => { state.cuisine = e.target.value; syncControls(); saveBook(); });
$("speechLang").addEventListener("change", (e) => { state.speechLang = e.target.value; updateMicHint(); });

$("heroSuggest").addEventListener("click", () => openComposer({ mode: "suggest" }));
$("heroWeek").addEventListener("click", openIntake);
$("composerSkip").addEventListener("click", openIntake);
$("heroSample").addEventListener("click", (e) => {
  e.preventDefault();
  scrollToEl($("samples"));
  $("samples").focus({ preventScroll: true });
});
$("composerClose").addEventListener("click", closeComposer);
$("plateExamples").addEventListener("click", (e) => {
  const b = e.target.closest("[data-plate-example]");
  if (b) runPlateExample(b.dataset.plateExample);
});
$("addAnother").addEventListener("click", () => openComposer({ mode: "type" }));

$("families").addEventListener("click", (e) => {
  if (e.target.closest("[data-retry]")) { loadFamilies(); return; }
  const btn = e.target.closest("[data-family]");
  if (btn && !btn.hasAttribute("aria-busy")) loadFamily(btn.dataset.family, btn);
});

$("resume").addEventListener("click", (e) => {
  const b = e.target.closest("[data-resume]");
  if (!b || !state.saved) return;
  const d = state.saved;
  if (b.dataset.resume === "clear") {
    clearBook(); state.saved = null; renderResume();
    announce("Cleared the saved family book.");
    $("recipeText").focus({ preventScroll: true });
    return;
  }
  if (!restoreBook(d)) { $("recipeText").focus({ preventScroll: true }); return; }
  if (b.dataset.resume === "add") { openComposer({ mode: "type" }); return; }
  if (state.recipes.some((x) => !x.adapted)) {
    // Something changed since last time (e.g. a dish never finished): make it lighter first.
    scrollToEl($("dishes")); $("dishesTitle").focus({ preventScroll: true });
    adaptAll($("adaptAll"));
    return;
  }
  if (!state.profileSet) { openIntake(); return; }
  if (state.plan) state.week += 1; // a fresh rotation, not last week's again
  makePlan(); // one tap: the saved profile plans this week
});

document.querySelectorAll(".stepper-btn").forEach((b) => b.addEventListener("click", () => {
  const input = $("servings");
  input.value = Math.min(20, Math.max(1, (Math.round(num(input.value)) || 4) + Number(b.dataset.step)));
}));

$("parse").addEventListener("click", (e) => submitComposer(e.currentTarget));
$("recipeText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("parse").click(); }
});

// Remember which cards are expanded so a re-render doesn't snap them shut.
$("cookbook").addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches || !d.matches("details[data-more]")) return;
  const entry = findEntry(d.dataset.more);
  if (entry) entry.open = d.open;
}, true);

$("cookbook").addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-ask]");
  if (!f) return;
  e.preventDefault();
  askDish(f.dataset.ask, f.querySelector("input").value);
});
$("cookbook").addEventListener("input", (e) => {
  const f = e.target.closest("form[data-ask]");
  if (!f) return;
  const entry = findEntry(f.dataset.ask);
  if (!entry) return;
  entry.askDraft = e.target.value;
  if (entry.askGuard || entry.askError) { entry.askGuard = null; entry.askError = ""; f.querySelector(".guard-slot, .msg.error")?.remove(); }
});

$("cookbook").addEventListener("click", (e) => {
  const tryAsk = e.target.closest("form[data-ask] [data-guard-example]");
  if (tryAsk) { e.stopPropagation(); askDish(tryAsk.closest("form[data-ask]").dataset.ask, tryAsk.dataset.guardExample); return; }
  const chip = e.target.closest("[data-chip]");
  if (chip) { askDish(chip.closest("form[data-ask]").dataset.ask, chip.dataset.chip); return; }
  const x = e.target.closest("[data-ask-remove]");
  if (x) { dropAsk(x.dataset.askRemove, Number(x.dataset.i)); return; }
  const undo = e.target.closest("[data-ask-undo]");
  if (undo) {
    const entry = findEntry(undo.dataset.askUndo);
    if (entry && entry.prev && !entry.asking) {
      entry.adapted = entry.prev; entry.prev = null;
      markCookbookChanged(); renderCard(entry.id); renderPlanStale(); saveBook();
      document.querySelector(`[data-card="${CSS.escape(entry.id)}"] h3`)?.focus({ preventScroll: true });
      announce("Back to the previous version.");
    }
    return;
  }
  const a = e.target.closest("[data-adapt]");
  if (a) { adaptOne(a.dataset.adapt); return; }
  const ed = e.target.closest("[data-edit]");
  if (ed) { openComposer({ mode: "type", editId: ed.dataset.edit }); return; }
  const rm = e.target.closest("[data-remove]");
  if (rm) removeDish(rm.dataset.remove);
});

// Remove is one tap, so it can be undone from the toast: the dish comes back in the same place.
function removeDish(id) {
  const entry = findEntry(id);
  if (!entry) return;
  const index = state.recipes.indexOf(entry);
  const family = state.family?.id || null;
  state.recipes = state.recipes.filter((x) => x !== entry);
  // The dish open in "Edit the recipe" is gone, so the editor closes rather than making a new dish.
  if (state.editingId === id) {
    stopListening();
    resetComposer();
    $("recipeText").value = "";
    $("parseMsg").className = "msg"; $("parseMsg").textContent = "";
  }
  markCookbookChanged();
  renderCookbook(); renderPlan();
  saveBook();
  if (state.recipes.length) $("dishesTitle").focus({ preventScroll: true });
  else $("recipeText").focus();
  const name = current(entry).name;
  announce(`Removed ${name}. Undo is in the message at the bottom of the screen.`);
  toast(`Removed ${name}.`, {
    label: "Undo",
    run: () => {
      // Too late if a sample family's dishes were swapped out, the dish is back, or the cookbook is full.
      if (findEntry(id) || state.recipes.length >= MAX_DISHES) return;
      if (entry.origin !== "own" && entry.origin !== "suggested" && (state.family?.id || null) !== family) return;
      if (entry.adapted && entry.origin !== "suggested" && adaptedKey(entry.adapted) !== condKey()) { entry.adapted = null; entry.prev = null; }
      entry.status = "idle"; entry.error = ""; entry.req = null; entry.asking = false;
      state.recipes.splice(Math.min(index, state.recipes.length), 0, entry);
      state.saved = null;
      markCookbookChanged();
      renderResume(); renderCookbook(); renderPlan();
      saveBook();
      const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
      if (card) { scrollToEl(card); card.querySelector("h3")?.focus({ preventScroll: true }); }
      announce(`${name} is back.`);
      if (!entry.adapted) adaptOne(id);
    },
  });
}

$("adaptAll").addEventListener("click", (e) => adaptAll(e.currentTarget));
$("plan").addEventListener("click", () => { if (state.profileSet) makePlan(); else openIntake(); });

// ---------- intake events ----------
$("intakeForm").addEventListener("submit", (e) => { e.preventDefault(); submitIntake(); });
$("intakeCancel").addEventListener("click", closeIntake);
$("intakeForm").addEventListener("input", (e) => {
  state.profileTouched = true;
  const id = e.target.id;
  if (id === "pHeight") setHeightFromCm();
  else if (id === "pFt" || id === "pIn") setHeightFromFtIn();
  else if (id === "pWeight") setLbFromKg();
  else if (id === "pLb") setKgFromLb();
  const msg = $("intakeMsg");
  if (msg.classList.contains("error")) { msg.className = "msg"; msg.textContent = ""; }
});
$("intakeForm").addEventListener("change", (e) => {
  if (e.target.name === "goal") onGoalToggle(e.target);
  if (e.target.name === "diet") $("dietNote").textContent = DIET_NOTES[e.target.value] || "";
  if (e.target.name === "sex") {
    $("pPregWrap").hidden = e.target.value !== "female";
    if (e.target.value !== "female") $("pPregnant").checked = false;
  }
});
$("intakeForm").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hh]");
  if (!b) return;
  const input = $("pHousehold");
  input.value = Math.min(12, Math.max(1, (Math.round(num(input.value)) || 1) + Number(b.dataset.hh)));
  state.profileTouched = true;
});

function gotoDish(id) {
  const entry = findEntry(id);
  if (!entry) return;
  entry.open = true;
  renderCard(id);
  const card = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
  if (card) { scrollToEl(card); card.querySelector("h3")?.focus({ preventScroll: true }); }
}

$("planOut").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab]");
  if (t) { selectTab(t.dataset.tab, false); return; }
  const day = e.target.closest("[data-day]");
  if (day) { selectDay(Number(day.dataset.day)); return; }
  const g = e.target.closest("[data-goto-dish]");
  if (g) { gotoDish(g.dataset.gotoDish); return; }
  if (e.target.closest("[data-cancel-plan]")) { cancelPlan(); return; }
  const nt = e.target.closest("[data-notes-toggle]");
  if (nt) {
    state.notesOpen = !state.notesOpen;
    $("wkNotesRest").hidden = !state.notesOpen;
    nt.setAttribute("aria-expanded", String(state.notesOpen));
    nt.textContent = state.notesOpen ? "Show fewer" : `Show all ${(state.plan?.notes || []).filter((x) => String(x || "").trim()).length} notes`;
    return;
  }
  if (e.target.closest("[data-retry-plan]")) { makePlan(); return; }
  if (e.target.closest("[data-prefs]")) { openIntake(); return; }
  if (e.target.closest("[data-replan]")) {
    if (state.plan && !state.planStale) state.week += 1; // "Plan another week" gives a new rotation
    makePlan();
    return;
  }
  if (e.target.closest("[data-act=share-note]")) { shareText(noteLabel(state.plan), state.plan?.message_for_parent || ""); return; }
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  let text = "";
  if (b.dataset.copy === "parentMsg") text = state.plan?.message_for_parent || "";
  else text = (state.plan?.shopping_list || []).map((s) => `${s.item}: ${grams(s.grams)}`).join("\n");
  const ok = await copyText(text);
  toast(ok ? "Copied. Paste it anywhere." : "Couldn't copy. Please select the text and copy it.");
});

$("planOut").addEventListener("keydown", (e) => {
  const t = e.target.closest("[role=tab]");
  if (!t) return;
  const keys = Array.from(document.querySelectorAll("#planOut [role=tab]")).map((x) => x.dataset.tab);
  let i = keys.indexOf(t.dataset.tab);
  if (e.key === "ArrowRight") i = (i + 1) % keys.length;
  else if (e.key === "ArrowLeft") i = (i - 1 + keys.length) % keys.length;
  else if (e.key === "Home") i = 0;
  else if (e.key === "End") i = keys.length - 1;
  else return;
  e.preventDefault();
  selectTab(keys[i], true);
});

function onAction(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "print") printCookbook();
  else if (act === "share") shareText(cookbookTitle(), withHomeLink(cookbookText()));
  else if (act === "share-note" && state.plan) shareText(noteLabel(state.plan), state.plan.message_for_parent || "");
  else if (act === "open-cookbook") openCookbook();
  else if (act === "close-cookbook") closeCookbook();
}
$("readyBar").addEventListener("click", onAction);
$("cookbookView").addEventListener("click", onAction);
window.addEventListener("beforeprint", renderCookbookView);

$("howOpen").addEventListener("click", openHow);
$("howClose").addEventListener("click", closeHow);
$("how").addEventListener("click", (e) => { if (e.target === $("how")) closeHow(); }); // tap outside closes
$("how").addEventListener("close", () => $("howOpen").focus());
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || $("how").open) return;
  if (document.body.classList.contains("cb-open")) closeCookbook();
  else if (state.planning) cancelPlan();
  else if (state.composerOpen) closeComposer();   // same as Cancel
  else if (state.intakeOpen) closeIntake();       // same as Not now
});

// ---------- theme ----------
// System / Light / Dark. "System" means no data-theme attribute, so the CSS follows the device.
// A data-theme set by a host page before we load is respected; storage is optional.
const THEME_KEY = "hp-theme";
const THEME_MODES = ["system", "light", "dark"];
const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function readStoredTheme() {
  try { const v = window.localStorage.getItem(THEME_KEY); return THEME_MODES.includes(v) ? v : null; } catch { return null; }
}
function storeTheme(mode) {
  try { window.localStorage.setItem(THEME_KEY, mode); } catch { /* storage blocked: the choice lasts for this visit */ }
}
function currentThemeMode() {
  const v = document.documentElement.getAttribute("data-theme");
  return v === "light" || v === "dark" ? v : "system";
}
function systemIsDark() { return Boolean(darkQuery && darkQuery.matches); }
function effectiveTheme(mode = currentThemeMode()) { return mode === "system" ? (systemIsDark() ? "dark" : "light") : mode; }
// From System, go to the opposite of what is showing, so every tap changes something.
function nextThemeMode(mode) {
  if (mode === "system") return systemIsDark() ? "light" : "dark";
  if (mode === "light") return systemIsDark() ? "dark" : "system";
  return systemIsDark() ? "system" : "light";
}
const THEME_WORDS = { system: "System", light: "Light", dark: "Dark" };

function syncThemeUI() {
  const btn = $("themeToggle");
  const mode = currentThemeMode();
  if (btn) {
    const next = nextThemeMode(mode);
    btn.dataset.mode = mode;
    const now = mode === "system" ? `system (${effectiveTheme(mode)})` : THEME_WORDS[mode].toLowerCase();
    btn.setAttribute("aria-label", `Colour theme: ${now}. Switch to ${THEME_WORDS[next].toLowerCase()}`);
    btn.title = `Theme: ${THEME_WORDS[mode]}. Tap for ${THEME_WORDS[next]}`;
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute("content", bg); });
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  else root.removeAttribute("data-theme");
  syncThemeUI();
}

function setupTheme() {
  const external = document.documentElement.hasAttribute("data-theme");
  const stored = readStoredTheme();
  if (!external && stored) applyTheme(stored); else syncThemeUI();
  $("themeToggle")?.addEventListener("click", () => {
    const mode = nextThemeMode(currentThemeMode());
    applyTheme(mode);
    storeTheme(mode);
    announce(`${THEME_WORDS[mode]} theme${mode === "system" ? `, following your device (${effectiveTheme(mode)})` : ""}.`);
  });
  // Keep the button honest if a host page changes data-theme, or the device switches.
  try {
    new MutationObserver(syncThemeUI).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  } catch { /* very old browser: the button still works */ }
  if (darkQuery) {
    if (typeof darkQuery.addEventListener === "function") darkQuery.addEventListener("change", syncThemeUI);
    else if (typeof darkQuery.addListener === "function") darkQuery.addListener(syncThemeUI);
  }
}

// ---------- example card: three real results take turns ----------
// The source card sits beside Plate's input card; home and Care get copies (Care's starts on the remedy).
// ~5 s each with a short crossfade. Pauses on hover, on keyboard focus, while off screen or in a hidden tab,
// and for good with the pause button. Reduced motion: the first example stays, the dots still switch.
// Not a live region, so screen readers aren't interrupted; hidden slides are inert.
const ROTATE_MS = 5000;
function setupRotator(root) {
  const slides = Array.from(root.querySelectorAll(".ex-slide"));
  const dots = Array.from(root.querySelectorAll(".ex-dot"));
  const pauseBtn = root.querySelector("[data-pause]");
  if (slides.length < 2) return;
  const start = Math.min(slides.length - 1, Number(root.parentElement?.dataset.start) || 0); // Care's copy opens on its own example
  let i = start, timer = 0, hover = false, focus = false, seen = true;
  let stopped = reduceMotion();
  const show = (n) => {
    const prev = i;
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => {
      const on = k === i;
      s.classList.toggle("is-on", on);
      s.classList.toggle("was-on", !on && k === prev && prev !== i);
      s.setAttribute("aria-hidden", String(!on));
      s.inert = !on;
    });
    dots.forEach((d, k) => d.setAttribute("aria-pressed", String(k === i)));
  };
  const running = () => !stopped && !hover && !focus && seen && !document.hidden;
  const arm = () => {
    clearTimeout(timer);
    if (running()) timer = setTimeout(() => { show(i + 1); arm(); }, ROTATE_MS);
  };
  const syncPause = () => {
    if (!pauseBtn) return;
    pauseBtn.hidden = reduceMotion();
    pauseBtn.setAttribute("aria-pressed", String(stopped));
    pauseBtn.setAttribute("aria-label", stopped ? "Play the examples" : "Pause the examples");
    root.classList.toggle("is-paused", stopped);
  };
  root.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hover = true; arm(); } });
  root.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hover = false; arm(); } });
  root.addEventListener("focusin", () => { focus = true; arm(); });
  root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget)) { focus = false; arm(); } });
  dots.forEach((d) => d.addEventListener("click", () => { show(Number(d.dataset.go)); arm(); }));
  pauseBtn?.addEventListener("click", () => { stopped = !stopped; syncPause(); arm(); });
  document.addEventListener("visibilitychange", arm);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { seen = entries.some((x) => x.isIntersecting); arm(); }).observe(root);
  }
  const rm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  rm?.addEventListener?.("change", () => { stopped = rm.matches; if (stopped) show(start); syncPause(); arm(); });
  show(start);
  syncPause();
  arm();
}

function setupRotators() {
  const plateCard = document.querySelector("#flowView [data-rotator]");
  document.querySelectorAll("[data-rotator-copy]").forEach((slot) => {
    if (plateCard && !slot.children.length) slot.innerHTML = plateCard.outerHTML;
  });
  document.querySelectorAll("[data-rotator]").forEach(setupRotator);
}

// Home's "Try a sample family": one tap opens Plate and loads the first sample family.
async function trySampleFamily() {
  await new Promise((r) => setTimeout(r, 50)); // let the switch to Plate (hashchange) happen first
  for (let n = 0; n < 60 && !state.familiesLoaded; n += 1) await new Promise((r) => setTimeout(r, 100));
  const btn = $("families").querySelector("[data-family]");
  scrollToEl($("samples"));
  if (!btn) { $("samples").focus({ preventScroll: true }); return; }
  if (btn.getAttribute("aria-pressed") !== "true") btn.click();
  else { scrollToEl($("dishes")); $("dishesTitle").focus({ preventScroll: true }); }
}
$("homeSample").addEventListener("click", () => {
  if (location.hash !== "#plate") location.hash = "plate";
  trySampleFamily();
});

// ---------- start ----------
async function loadFamilies() {
  const box = $("families");
  box.innerHTML = Array.from({ length: 4 }, () => `<div class="family skeleton" aria-hidden="true"></div>`).join("");
  try {
    state.families = await api("/api/demo");
  } catch { state.families = []; }
  state.familiesLoaded = true;
  renderFamilies();
}

async function init() {
  setupTheme();
  setupRotators();
  renderPlateExamples();
  fillSelects();
  setupVoice();
  if (!navigator.share) document.querySelectorAll(".share-btn").forEach((b) => { b.textContent = "Copy as text"; });
  state.saved = readBook();
  renderResume();
  renderCookbook();
  try {
    state.health = await api("/api/health");
    fillSelects();
  } catch {
    state.healthFailed = true;
  }
  await loadFamilies();
}

init();
