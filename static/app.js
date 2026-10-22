// Heritage Plate front end: plain JS, no build step, no external dependencies.
"use strict";

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
const VOICE_FALLBACK = "Voice works in Chrome and Safari. You can type it here instead.";

const FAMILY_SHADES = 4; // .avatar.fam-1 … fam-4, coloured by theme tokens
const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const SLOTS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["dessert", "Sweet"]];
const SHOP_GROUPS = {
  grain: "Grains and flour", legume: "Beans and lentils", vegetable: "Vegetables", fruit: "Fruit", dairy: "Dairy",
  protein: "Meat, fish and eggs", fat: "Oils and fats", nuts: "Nuts", sauce: "Sauces", sweetener: "Sugar and sweeteners",
  spice: "Spices", other: "Other",
};
const MODELS = {
  nano: { name: "Nemotron Nano", job: "Reads your recipe into ingredients and grams." },
  super: { name: "Nemotron Super", job: "Suggests lighter swaps and writes the steps." },
  ultra: { name: "Nemotron Ultra", job: "Plans the week and writes the note." },
};
const ADAPT_CONCURRENCY = 3;
const MAX_DISHES = 30; // matches the /api/plan limit
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
  trace: [],
  health: null,
  healthFailed: false,
  plan: null,
  planStale: false,
  planning: false,
  planError: false,
  whoSkipped: false,
  weekTab: "meals",
  week: 1,               // which week's rotation /api/plan should give; bumps for "Plan this week"
  composerOpen: false,
  editingId: null,
  saved: null,           // a cookbook saved on this device, offered on the home screen
  adaptRun: 0,           // bumps to cancel a running "make every dish lighter"
  cookbookVersion: 0,    // bumps whenever the dishes change; late /api/plan replies are dropped
};

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
  return f ? `The ${f} family cookbook` : "Your family cookbook";
}
function coverLine() {
  if (state.condition === "everyday") return "Lighter family recipes for everyday";
  return `Lighter family recipes for ${hasParent() ? state.parentName.trim() : "the family"} · ${CONDITIONS[state.condition].word}`;
}

function announce(text) {
  const a = $("announce");
  a.textContent = "";
  setTimeout(() => { a.textContent = text; }, 30);
}

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function reduceMotion() { return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
function scrollToEl(el) {
  el.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
}

function readableError(detail, status) {
  if (status === 429) return "Lots of requests right now. Please wait a few minutes and try again.";
  if (Array.isArray(detail)) {
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
  if (status === 502) return "The AI model didn't answer properly. Please try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return `Request failed (${status}).`;
}

async function api(path, body, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "This is taking too long. Please try again." : "Can't reach the server. Check your connection and try again.");
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(readableError(data.detail, res.status));
  if (Array.isArray(data.trace)) addTrace(data.trace);
  return data;
}

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

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  try { return await fn(); } finally {
    btn.removeAttribute("aria-busy");
    btn.innerHTML = old;
    btn.disabled = false;
    refreshButtons();
  }
}

// ---------- saved cookbook (this device only; works without storage) ----------
function saveBook() {
  try {
    if (!state.recipes.length) { window.localStorage.removeItem(BOOK_KEY); return; }
    const data = {
      v: 1, savedAt: Date.now(),
      condition: state.condition, cuisine: state.cuisine, language: state.language, parentName: state.parentName,
      family: state.family ? { id: state.family.id, family: state.family.family, parent: state.family.parent } : null,
      recipes: state.recipes.map((e) => ({ id: e.id, base: e.base, adapted: e.adapted, origin: e.origin })),
      plan: state.plan && !state.planStale ? state.plan : null,
      week: state.week,
    };
    window.localStorage.setItem(BOOK_KEY, JSON.stringify(data));
  } catch { /* storage blocked or full: the cookbook lasts for this visit */ }
}

function readBook() {
  try {
    const d = JSON.parse(window.localStorage.getItem(BOOK_KEY) || "null");
    if (d && d.v === 1 && Array.isArray(d.recipes)) {
      d.recipes = d.recipes.filter((r) => r && r.id && r.base && r.base.name && Array.isArray(r.base.ingredients));
      if (d.recipes.length) return d;
    }
  } catch { /* ignore */ }
  return null;
}

function clearBook() {
  try { window.localStorage.removeItem(BOOK_KEY); } catch { /* ignore */ }
}

function restoreBook(d) {
  state.adaptRun += 1;
  state.condition = d.condition in CONDITIONS ? d.condition : "everyday";
  state.cuisine = typeof d.cuisine === "string" ? d.cuisine : state.cuisine;
  state.language = typeof d.language === "string" ? d.language : "English";
  state.parentName = String(d.parentName || "").slice(0, 20);
  state.family = d.family && d.family.id ? d.family : null;
  state.recipes = d.recipes.slice(0, MAX_DISHES).map((r) => ({
    id: String(r.id), base: r.base, adapted: r.adapted && r.adapted.condition === state.condition ? r.adapted : null,
    status: "idle", error: "", open: null, origin: r.origin || "own",
  }));
  state.plan = d.plan && Array.isArray(d.plan.days) ? d.plan : null;
  state.planStale = false; state.planError = false;
  state.week = Math.max(1, Math.round(num(d.week)) || 1);
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
  const title = f ? `The ${f} family cookbook` : "Your family cookbook";
  const n = d.recipes.length;
  box.innerHTML = `
    <section class="resume" aria-labelledby="resumeTitle">
      <div class="resume-text">
        <h2 id="resumeTitle" class="resume-title">Welcome back.</h2>
        <p>${esc(title)}: ${n} dish${n === 1 ? "" : "es"}</p>
      </div>
      <div class="resume-btns">
        <button type="button" class="btn btn-primary" data-resume="plan">Plan this week</button>
        <button type="button" class="btn btn-outline" data-resume="add"><span aria-hidden="true">+</span> Add a dish</button>
        <button type="button" class="btn-link" data-resume="clear">Start over</button>
      </div>
    </section>`;
}

// ---------- trace / how it works ----------
function addTrace(entries) {
  state.trace.push(...entries.filter((t) => t && typeof t === "object"));
  if ($("how").open) renderTrace();
}

function renderTiers() {
  const models = state.health?.models || {};
  const counts = { nano: 0, super: 0, ultra: 0 };
  state.trace.forEach((t) => { if (t.tier in counts) counts[t.tier] += 1; });
  $("tiers").innerHTML = Object.entries(MODELS).map(([k, t]) => `
    <div class="tier">
      <p class="tier-name">${esc(t.name)}</p>
      <p class="tier-job">${esc(t.job)}</p>
      ${models[k] ? `<code>${esc(models[k])}</code>` : ""}
      <p class="tier-count">${counts[k]} call${counts[k] === 1 ? "" : "s"} so far</p>
    </div>`).join("");
}

function renderTrace() {
  renderTiers();
  const mode = $("howMode");
  if (state.healthFailed) mode.textContent = "Can't reach the server right now.";
  else if (state.health?.mode === "live") mode.textContent = "Running live: NVIDIA Nemotron models on Nebius Token Factory.";
  else if (state.health) mode.textContent = "Running in demo mode: built-in sample answers stand in for the models, so it works without an API key. Numbers are still computed from the food tables. When live, the note is written in their language.";
  else mode.textContent = "";
  if (!state.trace.length) return;
  $("trace").innerHTML = state.trace.slice().reverse().map((t) => {
    const tier = ["nano", "super", "ultra"].includes(t.tier) ? t.tier : "nano";
    const bits = [];
    if (t.ms) bits.push(`${(num(t.ms) / 1000).toFixed(1)} s`);
    if (t.tokens) bits.push(`${num(t.tokens)} tokens`);
    const flags = [];
    if (t.cached) flags.push("from cache");
    if (t.fallback) flags.push("used backup rules");
    return `<li><b>${esc(t.step)}</b> <span class="muted">· ${esc(MODELS[tier].name)}</span>${bits.length ? ` <span class="muted">· ${esc(bits.join(", "))}</span>` : ""}${flags.length ? ` <span class="tflag">(${esc(flags.join(", "))})</span>` : ""}<br><code>${esc(t.model)}</code></li>`;
  }).join("");
}

function openHow() {
  renderTrace();
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
  $("goalSelect").innerHTML = Object.entries(CONDITIONS).map(([k, c]) => `<option value="${esc(k)}">${esc(c.short)}</option>`).join("");
  if (!(state.cuisine in cuisines)) state.cuisine = Object.keys(cuisines)[0];
  if (!langs.includes(state.language)) state.language = langs[0];
  if (!SPEECH_LANG[state.speechLang]) state.speechLang = "English";
  syncControls();
}

function syncControls() {
  document.querySelectorAll('input[name="condition"]').forEach((r) => { r.checked = r.value === state.condition; });
  $("goalSelect").value = state.condition;
  $("cuisine").value = state.cuisine;
  $("speechLang").value = state.speechLang;
  $("styleSummary").textContent = `Cooking style: ${shortCuisine(state.cuisine)}`;
  $("focusHint").textContent = CONDITIONS[state.condition].hint;
  $("micExample").textContent = `“${EXAMPLES[state.cuisine] || EXAMPLES.other}”`;
  renderNames();
  updateMicHint();
}

function renderNames() {
  const bits = [];
  if (state.family) bits.push(`${esc(familyShort())} family`);
  if (hasParent()) bits.push(`for <b>${esc(state.parentName.trim())}</b>`);
  $("dishesWho").innerHTML = bits.length ? `${bits.join(" · ")} <span aria-hidden="true">·</span> ` : "";
}

function setCondition(value) {
  if (!(value in CONDITIONS) || value === state.condition) return;
  state.condition = value;
  state.adaptRun += 1; // stop any running batch; late replies for the old condition are dropped
  state.recipes.forEach((e) => { e.adapted = null; e.prev = null; e.asking = false; e.askError = ""; e.status = "idle"; e.error = ""; e.req = null; });
  $("adaptProgress").hidden = true;
  markCookbookChanged();
  syncControls();
  renderCookbook();
  renderPlan();
  announce(`Now making dishes lighter for ${CONDITIONS[value].label.toLowerCase()}.`);
  if (state.recipes.length) adaptAll($("adaptAll"));
  saveBook();
}

// ---------- which parts of the page show ----------
function renderSections() {
  const n = state.recipes.length;
  const fresh = Boolean(state.plan && !state.planStale);
  $("dishes").hidden = n === 0;
  $("composer").hidden = !state.composerOpen;
  $("dishActions").hidden = n === 0 || state.composerOpen;
  $("dishActions").classList.toggle("is-sticky", !fresh);
  $("week").hidden = !(state.plan || state.planning || state.planError);
  $("readyBar").hidden = !(state.plan && !state.planning);
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
    stopListening();
    state.family = { id: fam.id, family: fam.family, parent: fam.parent };
    state.condition = fam.condition in CONDITIONS ? fam.condition : "diabetes";
    state.cuisine = fam.cuisine;
    state.language = fam.language;
    state.parentName = String(fam.parent || "").split(",")[0].trim().slice(0, 20);
    state.whoSkipped = false;
    state.saved = null;
    // Your own dishes stay; a sample family's dishes replace the previous sample family's.
    const own = state.recipes.filter((e) => e.origin === "own");
    own.forEach((e) => {
      if (e.adapted && e.adapted.condition !== state.condition) e.adapted = null;
      if (e.status !== "idle" || e.asking) { e.status = "idle"; e.error = ""; e.req = null; e.asking = false; }
    });
    const famEntries = (fam.recipes || []).map((r) => ({ id: String(r.id || uid()), base: r, adapted: null, status: "idle", error: "", open: null, origin: fam.id }));
    state.recipes = [...own, ...famEntries].slice(0, MAX_DISHES);
    state.plan = null; state.planStale = false; state.planError = false; state.cookbookVersion += 1; state.week = 1;
    state.composerOpen = false; state.editingId = null;
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
  const plan = $("plan");
  if (!plan.hasAttribute("aria-busy")) {
    // Wait for dishes still being made lighter, or their late replies would make the new week stale.
    plan.disabled = n === 0 || anyBusy || allBusy;
    const fresh = state.plan && !state.planStale;
    plan.textContent = state.plan ? (state.planStale ? "Update our week" : "Plan another week") : "Plan our week";
    plan.classList.toggle("btn-primary", !fresh);
    plan.classList.toggle("btn-quiet", Boolean(fresh));
  }
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

function askedLine(e) {
  const r = e.adapted;
  const q = String(r?.request || "").trim();
  if (!q) return "";
  const first = (r.changes || [])[0];
  const answer = first ? `${first.what}${first.why ? `. ${first.why}` : ""}` : "Done.";
  return `
    <div class="asked" role="status">
      <p class="asked-q"><span class="asked-k">You asked:</span> “${esc(q)}”</p>
      <p class="asked-a"><span aria-hidden="true">→</span> ${esc(answer)}</p>
      ${e.prev ? `<button type="button" class="btn-link" data-ask-undo="${esc(e.id)}">Undo</button>` : ""}
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
      ${e.askError ? `<p class="msg error" role="alert">${esc(e.askError)}</p>` : ""}
    </form>`;
}

async function askDish(id, text) {
  const e = findEntry(id);
  const request = String(text || "").trim().slice(0, 200);
  if (!e || !e.adapted || e.asking) return;
  if (!request) { document.getElementById(`ask-${id}`)?.focus(); return; }
  const condition = state.condition;
  const token = {};
  e.req = token; e.asking = true; e.askError = ""; e.askDraft = request; e.open = true;
  renderCard(id);
  const stale = () => findEntry(id) !== e || state.condition !== condition || e.req !== token;
  try {
    const { recipe } = await api("/api/adapt", { recipe: baseFields(e.base), condition, cuisine: state.cuisine, request });
    if (stale()) return;
    // A server that doesn't echo the request didn't act on it (e.g. the static preview): don't pretend it did.
    if (!String(recipe.request || "").trim()) throw new Error("Couldn't change this dish for that request here. Please try again in the full app.");
    e.prev = e.adapted;
    e.adapted = { ...recipe, condition, id: e.id, request: String(recipe.request) };
    e.asking = false; e.askDraft = "";
    markCookbookChanged();
    renderCard(id);
    renderPlanStale();
    saveBook();
    document.querySelector(`[data-card="${CSS.escape(id)}"] .asked`)?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
    announce(`Updated ${e.adapted.name}.`);
  } catch (err) {
    if (stale()) return;
    e.asking = false; e.askError = err.message;
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

  let numbers, badge = "", secondary = "";
  if (adapted) {
    const f = focusNumbers(r);
    numbers = `
      <p class="nums"><span class="sr-only">${esc(f.label)} per serving: was </span><span class="nums-was">${esc(fmt(f.before, f.unit))}</span><span class="nums-arrow" aria-hidden="true">→</span><span class="sr-only"> now </span><span class="nums-now">${esc(fmt(f.after, f.unit))}<span class="nums-unit"> ${esc(f.unit)}</span></span></p>
      <p class="nums-label" aria-hidden="true">${esc(f.label)} per serving</p>`;
    if (f.key === "kcal" && r.original?.nutrition) {
      secondary = `<ul class="nums-2">${SECONDARY.map(([k, label, unit]) => `<li>${esc(label)} <span class="n2-was">${esc(fmt(r.original.nutrition[k], unit))}</span> <span aria-hidden="true">→</span><span class="sr-only">now</span> <b>${esc(fmt(n[k], unit))} ${esc(unit)}</b></li>`).join("")}</ul>`;
    }
    if (r.comparable === false) badge = `<span class="tag tag-quiet">No % shown</span>`;
    else if (f.pct > 0) badge = `<span class="tag tag-win">${f.pct}% less</span>`;
    else badge = `<span class="tag tag-quiet">Already light</span>`;
  } else {
    numbers = `
      <p class="nums"><span class="nums-now plain">${esc(fmt(n[c.key], c.unit))}<span class="nums-unit"> ${esc(c.unit)}</span></span></p>
      <p class="nums-label">${esc(c.nutrient)} per serving, as cooked now</p>`;
  }

  let status = "";
  if (isBusy) status = `<p class="working"><span class="spinner" aria-hidden="true"></span><span>Making it lighter<span class="dots"></span><span class="working-sub">Keeping the taste, trimming the ${esc(c.nutrient)}</span></span></p>`;
  else if (e.status === "error") status = `<p class="msg error" role="alert">${esc(e.error)}</p>`;
  const retry = !adapted && !isBusy && e.status === "error" ? `<button type="button" class="btn btn-quiet btn-small" data-adapt="${esc(e.id)}">Try again</button>` : "";

  const links = `
    <div class="rc-links">
      <button type="button" class="btn-link" data-edit="${esc(e.id)}">Edit recipe</button>
      <button type="button" class="btn-link danger" data-remove="${esc(e.id)}" aria-label="Remove ${esc(r.name)}">Remove</button>
    </div>`;

  let body = "";
  if (adapted) {
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
          ${changes.length ? `<div class="rc-block"><h4 class="rc-h">What we changed</h4><ul class="changes">${changes.map((ch) => `
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
        ${numbers}
        ${secondary}
        ${adapted ? askedLine(e) : ""}
        ${status}
        ${retry}
      </div>
      ${body}
    </article>`;
}

function renderSummary() {
  const done = state.recipes.filter((e) => e.adapted && e.adapted.condition === state.condition);
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
  const condition = state.condition;
  const token = {};
  e.req = token;
  e.status = "busy"; e.error = "";
  renderCard(id);
  const stale = () => findEntry(id) !== e || state.condition !== condition || e.req !== token;
  try {
    const { recipe } = await api("/api/adapt", { recipe: baseFields(e.base), condition, cuisine: state.cuisine });
    // Drop the reply if the dish was removed/replaced, the health focus changed, or a newer request started.
    if (stale()) return "stale";
    if (recipe.condition && recipe.condition !== condition) return "stale";
    e.adapted = { ...recipe, condition, id: e.id };
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

function openComposer({ mode = "type", editId = null } = {}) {
  const editing = editId ? findEntry(editId) : null;
  state.composerOpen = true;
  state.editingId = editing ? editing.id : null;
  $("composerTitle").textContent = editing ? "Edit the recipe" : "Tell us the recipe";
  $("parse").textContent = editing ? "Update and make it lighter" : "Make it lighter";
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
  state.composerOpen = false;
  state.editingId = null;
  refreshButtons();
  if (state.recipes.length) { scrollToEl($("dishes")); $("dishesTitle").focus({ preventScroll: true }); }
  else { window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); $("heroSay").focus({ preventScroll: true }); }
}

async function submitComposer(btn) {
  stopListening();
  const text = $("recipeText").value.trim();
  const msg = $("parseMsg");
  msg.className = "msg";
  if (text.length < 3) {
    msg.className = "msg error";
    msg.textContent = "Say or type a recipe first.";
    $("recipeText").focus();
    return;
  }
  const editing = state.editingId ? findEntry(state.editingId) : null;
  if (!editing && state.recipes.length >= MAX_DISHES) {
    msg.className = "msg error";
    msg.textContent = `The cookbook holds up to ${MAX_DISHES} dishes. Remove one to add another.`;
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
    state.composerOpen = false; state.editingId = null;
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
    msg.className = "msg error";
    msg.textContent = err.message;
  }
}

// ---------- voice ----------
const voice = { rec: null, listening: false, base: "" };

function updateMicHint() {
  const hint = $("micHint");
  if (!voice.rec) { hint.textContent = VOICE_FALLBACK; return; }
  hint.textContent = voice.listening
    ? `Listening in ${state.speechLang}. Tap Done when you've finished.`
    : `Listens in ${state.speechLang}. Check the words before you go on.`;
}

function setListening(on) {
  voice.listening = on;
  const mic = $("mic");
  mic.setAttribute("aria-pressed", String(on));
  mic.querySelector(".mic-label").textContent = on ? "Done" : "Tap and say it the way she says it";
  mic.closest(".mic-wrap").classList.toggle("is-listening", on);
  updateMicHint();
}

function startListening() {
  if (!voice.rec) { updateMicHint(); return; }
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
    if (!voice.rec) { updateMicHint(); $("recipeText").focus(); return; }
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

// ---------- week ----------
function renderPlanStale() {
  const el = document.querySelector("#planOut .stale");
  if (el) el.hidden = !state.planStale;
  refreshButtons();
}

function entryByName(name) { return state.recipes.find((x) => current(x).name === name); }

function dishLabel(name) {
  if (!name) return `<span class="none">Your choice</span>`;
  const e = entryByName(name);
  if (!e) return esc(name);
  return `<button type="button" class="dish-link" data-goto-dish="${esc(e.id)}">${esc(name)}</button>${!e.adapted ? ` <span class="orig">original</span>` : ""}`;
}

function hasNote(plan) { return Boolean(String(plan?.message_for_parent || "").trim()); }

function weekTabs(plan) {
  const tabs = [["meals", "Meals"], ["shop", "Shopping list"]];
  if (hasNote(plan)) tabs.push(["note", `Note for ${parentWord()}`]);
  return tabs;
}

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

function whoPrompt() {
  if (hasParent() || state.whoSkipped) return "";
  const langs = state.health?.languages || DEFAULT_LANGUAGES;
  return `
    <form class="who" id="whoForm" aria-labelledby="whoTitle">
      <p id="whoTitle" class="who-title">Who are you cooking for? <span class="muted">(optional)</span></p>
      <p class="who-sub">Add a name and we'll write them a note about the week, in their language.</p>
      <div class="who-fields">
        <label class="field"><span class="field-label">What you call them</span>
          <input id="whoName" type="text" maxlength="20" autocomplete="off" placeholder="Mum, Dad, Nani, Lola…"></label>
        <label class="field"><span class="field-label">Their language</span>
          <select id="whoLang">${langs.map((l) => `<option value="${esc(l)}"${l === state.language ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      </div>
      <div class="who-btns">
        <button type="submit" class="btn btn-quiet btn-small">Add a note for them</button>
        <button type="button" class="btn-link" data-who-skip>No thanks</button>
      </div>
    </form>`;
}

function renderPlan() {
  const out = $("planOut");
  const plan = state.plan;
  renderNames();
  if (!plan) { if (!state.planning) out.innerHTML = ""; refreshButtons(); return; }
  const days = plan.days || [];
  const shopping = plan.shopping_list || [];
  const unadapted = state.recipes.filter((e) => !e.adapted).length;
  const tabs = weekTabs(plan);
  const tab = tabs.some(([k]) => k === state.weekTab) ? state.weekTab : "meals";

  const tips = (plan.tips || []).filter((t) => String(t || "").trim());
  const meals = `<ol class="days" aria-label="Meals for the week">
    ${days.map((d) => `<li class="day"><h3 class="day-name">${esc(DAY_NAMES[d.day] || d.day)}</h3><dl class="day-meals">
      ${SLOTS.filter(([k]) => k !== "dessert" || d[k]).map(([k, l]) => `<div><dt>${l}</dt><dd>${dishLabel(d[k])}</dd></div>`).join("")}</dl></li>`).join("")}
  </ol>
  ${tips.length ? `<div class="week-tips"><h3 class="rc-h">Tips for the week</h3><ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}`;
  const shop = `
    <div class="panel-head"><p class="muted">Raw weights for the whole week. Tick as you shop.</p>
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
  const panels = { meals, shop, note };

  out.innerHTML = `
    <p class="msg warn stale" ${state.planStale ? "" : "hidden"}>Your dishes changed. Tap "Update our week" to include them.</p>
    ${unadapted ? `<p class="hint">${unadapted} dish${unadapted === 1 ? " is" : "es are"} still the original. Make ${unadapted === 1 ? "it" : "them"} lighter, then plan again.</p>` : ""}
    ${whoPrompt()}
    <div class="tabs" role="tablist" aria-label="Your week">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" data-tab="${k}">${esc(l)}${k === "shop" ? ` <span class="count">${shopping.length}</span>` : ""}</button>`).join("")}
    </div>
    ${tabs.map(([k]) => `<div class="tab-panel${k === "note" ? " is-note" : ""}" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" tabindex="0" ${k === tab ? "" : "hidden"}>${panels[k]}</div>`).join("")}`;
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

async function makePlan(btn) {
  const out = $("planOut");
  state.planning = true; state.planError = false;
  out.querySelectorAll(":scope > .msg.error").forEach((x) => x.remove());
  renderSections();
  const holder = document.createElement("p");
  holder.className = "working";
  out.prepend(holder);
  const lang = planLanguage();
  const stop = ticker(holder, `<span class="spinner" aria-hidden="true"></span><span>Planning 7 days and the shopping list${lang ? ` and a note in ${esc(lang)}` : ""}<span class="dots"></span></span>`);
  let skel = null;
  if (!state.plan) {
    skel = document.createElement("div");
    skel.className = "plan-skel";
    skel.setAttribute("aria-hidden", "true");
    skel.innerHTML = `<span class="sk-tabs"></span>${"<span class=\"sk-row\"></span>".repeat(4)}`;
    holder.after(skel);
  }
  scrollToEl($("week"));
  const condition = state.condition;
  const version = state.cookbookVersion;
  try {
    const recipes = state.recipes.map((e) => baseFields(current(e)));
    const { plan } = await busy(btn, "Planning…", () => api("/api/plan", { recipes, condition, language: lang, week: state.week }));
    stop();
    skel?.remove();
    state.planning = false;
    // Drop a late reply if the cookbook or health focus changed while Ultra was planning.
    if (state.condition !== condition || state.cookbookVersion !== version) {
      holder.remove();
      refreshButtons();
      if (state.condition === condition) announce('Your dishes changed while planning. Tap "Plan our week" again.');
      return;
    }
    state.plan = plan; state.planStale = false; state.weekTab = hasNote(plan) && lang && !hasNote(state._lastPlan) ? "note" : "meals";
    state._lastPlan = plan;
    renderPlan();
    saveBook();
    $("weekTitle").focus({ preventScroll: true });
    announce(hasNote(plan) ? "Your week is ready, with a shopping list and a note." : "Your week is ready, with a shopping list. Your cookbook is ready too.");
  } catch (err) {
    stop();
    skel?.remove();
    state.planning = false;
    state.planError = !state.plan;
    holder.className = "msg error";
    holder.setAttribute("role", "alert");
    holder.textContent = err.message;
    refreshButtons();
  }
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
  const pct = r.comparable !== false && f.pct > 0 ? ` (${f.pct}% less)` : "";
  return { f, text: `${f.label.charAt(0).toUpperCase() + f.label.slice(1)} per serving: ${fmt(f.before, f.unit)} → ${fmt(f.after, f.unit)} ${f.unit}${pct}` };
}

function cookbookHTML() {
  const plan = state.plan && !state.planStale ? state.plan : state.plan;
  const shareWord = navigator.share ? "Share" : "Copy as text";
  const note = plan && hasNote(plan);
  const dishes = state.recipes.map((e) => {
    const r = current(e);
    const adapted = Boolean(e.adapted);
    const steps = (Array.isArray(r.method) ? r.method : []).filter((s) => String(s || "").trim()).slice(0, 10);
    const portion = String(r.portion_tip || "").trim();
    const changes = adapted ? (r.changes || []).slice(0, 4) : [];
    const facts = adapted ? (Array.isArray(r.facts) ? r.facts : []).filter((x) => x && x.text).slice(0, 2) : [];
    return `
      <article class="cb-dish">
        <p class="cb-kicker">${esc(mealWord(r))} · Serves ${esc(r.servings)}${adapted ? "" : " · original, not yet made lighter"}</p>
        <h3>${esc(r.name)}</h3>
        ${adapted ? `<p class="cb-focus">${esc(focusLine(r).text)}</p>` : ""}
        <div class="cb-cols">
          <div><h4 class="rc-h">Ingredients</h4>${ingredientsBlock(r, { compare: adapted })}</div>
          ${steps.length ? `<div><h4 class="rc-h">Method</h4><ol class="method">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>` : ""}
        </div>
        ${portion ? `<div class="portion"><p class="portion-h">Portion</p><p>${esc(portion)}</p></div>` : ""}
        ${changes.length ? `<div class="cb-why"><h4 class="rc-h">What we changed and why</h4><ul>${changes.map((c) => `<li><b>${esc(c.what)}.</b> ${esc(c.why)}</li>`).join("")}</ul></div>` : ""}
        ${facts.length ? `<div class="cb-facts"><h4 class="rc-h">Good to know</h4><ul>${facts.map((x) => `<li>${esc(x.text)}${x.source ? ` <span class="cb-src">Source: ${esc(x.source)}${safeUrl(x.url) ? `, ${esc(safeUrl(x.url))}` : ""}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      </article>`;
  }).join("");
  const week = plan ? `
    <section class="cb-sec cb-week-sec">
      <h3>This week's plan</h3>
      <table class="cb-week">
        <thead><tr><th scope="col">Day</th>${SLOTS.map(([, l]) => `<th scope="col">${l}</th>`).join("")}</tr></thead>
        <tbody>${(plan.days || []).map((d) => `<tr><th scope="row">${esc(DAY_NAMES[d.day] || d.day)}</th>${SLOTS.map(([k]) => `<td>${esc(d[k] || "–")}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </section>
    <section class="cb-sec">
      <h3>Shopping list</h3>
      <div class="cb-shop">${shopGroups(plan).map(([k, items]) => `<div><h4 class="rc-h">${esc(SHOP_GROUPS[k])}</h4><ul>${items.map((s) => `<li><span>${esc(s.item)}</span><span>${esc(grams(s.grams))}</span></li>`).join("")}</ul></div>`).join("")}</div>
    </section>
    ${note ? `<section class="cb-sec cb-note"><h3>${esc(noteLabel(plan))}</h3><p class="cb-note-text">${esc(plan.message_for_parent)}</p></section>` : ""}` : `
    <p class="cb-noplan no-print">Plan the week to add meals, a shopping list and a note.</p>`;
  return `
    <div class="wrap cb-wrap">
      <div class="cb-toolbar">
        <button type="button" class="btn-link" data-act="close-cookbook"><span aria-hidden="true">←</span> Back to your week</button>
        <div class="cb-btns">
          <button type="button" class="btn btn-primary btn-small" data-act="print">Print or save PDF</button>
          <button type="button" class="btn btn-quiet btn-small" data-act="share">${shareWord}</button>
          ${note ? `<button type="button" class="btn btn-quiet btn-small" data-act="share-note">Send the note to ${esc(parentWord())}</button>` : ""}
        </div>
      </div>
      <header class="cb-cover">
        <p class="eyebrow">Heritage Plate</p>
        <h2 id="cbTitle" tabindex="-1">${esc(cookbookTitle())}</h2>
        <p class="cb-line">${esc(coverLine())}</p>
      </header>
      ${state.recipes.length ? dishes : `<p class="cb-noplan">Nothing in your cookbook yet.</p>`}
      ${week}
      <footer class="cb-foot">${esc(SOURCES_LINE)}</footer>
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
    if (e.adapted && r.changes?.length) { L.push("What we changed:"); r.changes.slice(0, 4).forEach((c) => L.push(`- ${c.what}: ${c.why}`)); }
    L.push("");
  });
  if (plan) {
    L.push("== This week ==");
    (plan.days || []).forEach((d) => L.push(`${DAY_NAMES[d.day] || d.day}: ${SLOTS.filter(([k]) => d[k]).map(([k, l]) => `${l} ${d[k]}`).join(" · ")}`));
    L.push("", "== Shopping list ==");
    (plan.shopping_list || []).forEach((s) => L.push(`- ${s.item}: ${grams(s.grams)}`));
    if (hasNote(plan)) L.push("", `== ${noteLabel(plan)} ==`, plan.message_for_parent);
    L.push("");
  }
  L.push(SOURCES_LINE);
  return L.join("\n");
}

function renderCookbookView() { $("cookbookView").innerHTML = cookbookHTML(); }

function openCookbook() {
  renderCookbookView();
  document.body.classList.add("cb-open");
  window.scrollTo(0, 0);
  $("cbTitle").focus({ preventScroll: true });
  announce("Your family cookbook.");
}
function closeCookbook() {
  document.body.classList.remove("cb-open");
  const target = state.plan ? $("week") : $("dishes");
  if (!target.hidden) { scrollToEl(target); (state.plan ? $("weekTitle") : $("dishesTitle")).focus({ preventScroll: true }); }
}
function printCookbook() {
  renderCookbookView();
  window.print();
}

// ---------- events ----------
document.querySelectorAll('input[name="condition"]').forEach((r) => r.addEventListener("change", () => setCondition(r.value)));
$("goalSelect").addEventListener("change", (e) => setCondition(e.target.value));
$("cuisine").addEventListener("change", (e) => { state.cuisine = e.target.value; syncControls(); saveBook(); });
$("speechLang").addEventListener("change", (e) => { state.speechLang = e.target.value; updateMicHint(); });

$("heroSay").addEventListener("click", () => openComposer({ mode: "say" }));
$("heroType").addEventListener("click", () => openComposer({ mode: "type" }));
$("heroSample").addEventListener("click", (e) => {
  e.preventDefault();
  scrollToEl($("samples"));
  $("samples").focus({ preventScroll: true });
});
$("composerClose").addEventListener("click", closeComposer);
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
    announce("Cleared the saved cookbook.");
    $("heroSay").focus({ preventScroll: true });
    return;
  }
  restoreBook(d);
  if (b.dataset.resume === "add") { openComposer({ mode: "type" }); return; }
  if (state.recipes.some((x) => !x.adapted)) {
    // Something changed since last time (e.g. a dish never finished): make it lighter first.
    scrollToEl($("dishes")); $("dishesTitle").focus({ preventScroll: true });
    adaptAll($("adaptAll"));
    return;
  }
  state.week += 1; // a fresh rotation, not last week's again
  makePlan($("plan"));
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
  if (f) { const entry = findEntry(f.dataset.ask); if (entry) entry.askDraft = e.target.value; }
});

$("cookbook").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-chip]");
  if (chip) { askDish(chip.closest("form[data-ask]").dataset.ask, chip.dataset.chip); return; }
  const undo = e.target.closest("[data-ask-undo]");
  if (undo) {
    const entry = findEntry(undo.dataset.askUndo);
    if (entry && entry.prev) {
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
  if (rm) {
    const entry = findEntry(rm.dataset.remove);
    state.recipes = state.recipes.filter((x) => x.id !== rm.dataset.remove);
    markCookbookChanged();
    if (!state.recipes.length) { state.plan = null; state.planStale = false; state.planError = false; renderPlan(); }
    renderCookbook(); renderPlanStale();
    saveBook();
    if (state.recipes.length) $("dishesTitle").focus({ preventScroll: true });
    else $("heroSay").focus();
    if (entry) announce(`Removed ${entry.base.name}.`);
  }
});

$("adaptAll").addEventListener("click", (e) => adaptAll(e.currentTarget));
$("plan").addEventListener("click", (e) => {
  if (state.plan && !state.planStale) state.week += 1; // "Plan another week" gives a new rotation
  makePlan(e.currentTarget);
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
  const g = e.target.closest("[data-goto-dish]");
  if (g) { gotoDish(g.dataset.gotoDish); return; }
  if (e.target.closest("[data-who-skip]")) {
    state.whoSkipped = true; renderPlan(); $("weekTitle").focus({ preventScroll: true }); return;
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

$("planOut").addEventListener("submit", (e) => {
  if (e.target.id !== "whoForm") return;
  e.preventDefault();
  const name = $("whoName").value.trim().slice(0, 20);
  if (!name) { $("whoName").focus(); toast("Add what you call them, or tap No thanks."); return; }
  state.parentName = name;
  state.language = $("whoLang").value;
  renderNames();
  saveBook();
  makePlan($("plan"));
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
  else if (act === "share") shareText(cookbookTitle(), cookbookText());
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
  if (e.key === "Escape" && document.body.classList.contains("cb-open") && !$("how").open) closeCookbook();
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
