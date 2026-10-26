// Heritage Care: skin & hair, plus the umbrella home and the Plate | Care switch.
// Loads after app.js and reuses its helpers ($, esc, safeUrl, api, busy, toast, announce, ticker, scrollToEl,
// copyText, shareText, openCookbook, printCookbook, stopListening, SPEECH_LANG, VOICE_FALLBACK, DEFAULT_LANGUAGES, state).
// Care clicks use data-care-act on Care's own containers, so app.js's data-act handlers never see them.
"use strict";

const CARE_COUNTRIES_FALLBACK = {
  IN: "India", US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia",
  PH: "Philippines", MX: "Mexico", CN: "China", AE: "United Arab Emirates", OTHER: "elsewhere",
};
const CARE_CONCERNS_FALLBACK = {
  acne: "Acne or spots", oily: "Oily skin", dry: "Dry or tight skin", sensitive: "Sensitive or eczema-prone skin",
  dark_spots: "Dark spots or uneven tone", sun: "Sun protection", dandruff: "Dandruff or itchy scalp",
  thinning_hair: "Thinning hair", dry_hair: "Dry or damaged hair", body_dry: "Dry skin on the body",
};
const CARE_SKIN_GROUP = ["acne", "oily", "dry", "sensitive", "dark_spots", "sun", "body_dry"];
const CARE_HAIR_GROUP = ["dandruff", "thinning_hair", "dry_hair"];
const SKIN_TYPE_WORDS = [["", "Not sure"], ["oily", "Oily"], ["dry", "Dry"], ["combination", "Combination"], ["normal", "Normal"], ["sensitive", "Sensitive"]];
const CARE_EXAMPLES = [
  ["Besan haldi ka lep", "besan haldi ka lep"],
  ["Nimbu on dark spots", "nimbu on dark spots"],
  ["Coconut oil every night", "coconut oil in hair every night"],
  ["Toothpaste on a pimple", "toothpaste on a pimple"],
];
// The sample family: also precomputed by scripts/build_preview.py, so keep the two in step.
const CARE_SAMPLE = [
  { name: "Dad", age: 58, sex: "male", pregnant: false, concerns: ["dandruff", "body_dry"], skin_type: null, wants: "men's body wash", details: "hair falling out in patches lately", allergies: "" },
  { name: "Mum", age: 54, sex: "female", pregnant: false, concerns: ["dark_spots", "dry"], skin_type: "dry", wants: "", details: "", allergies: "" },
  { name: "Priya", age: 29, sex: "female", pregnant: true, concerns: ["acne", "dark_spots"], skin_type: "oily", wants: "", details: "", allergies: "" },
];
const LABEL_EXAMPLE = "Aqua, Glycerin, Niacinamide, Parfum, Alcohol Denat., Cetearyl Alcohol, Salicylic Acid, Lavandula Angustifolia Oil";
const VERDICTS = {
  keep: { word: "Keep", icon: "✓" },
  care: { word: "Fine with care", icon: "!" },
  swap: { word: "Swap", icon: "⇄" },
  stop: { word: "Stop", icon: "✕" },
};
const EVIDENCE_WORDS = { strong: "Strong evidence", some: "Some evidence", little: "Little evidence", none: "No good evidence" };
const TIME_WORDS = { am: "morning", pm: "night", both: "morning and night", shower: "in the shower" };
const CARE_LINES = {
  remedy: ["Checking what the evidence says…", "Looking for safer options…", "Choosing what does the job…"],
  label: ["Reading the label…"],
};
const CARE_DISCLAIMER = "General skincare information, not medical advice. If something hurts, spreads or changes, see a doctor.";

const care = {
  side: "",
  screen: "care",
  library: null,
  remedyWho: "",      // member id, "" = anyone
  labelWho: "",
  remedy: null,       // {text, who, result, saved}
  remedyRunning: false,
  plan: null,         // last /api/care/plan result {result, saved}
  planRunning: false,
  label: null,
  bookFromCare: false,
  mic: null,
  saveTimer: 0,
};

// ---------- small helpers ----------
function careFamily() { return readFamily(); }
function careMembers() { return careFamily().members; }
function careConcerns() { return care.library?.concerns || CARE_CONCERNS_FALLBACK; }
function careCountries() { return care.library?.countries || CARE_COUNTRIES_FALLBACK; }
function memberLabel(m, i) { return (m.name || "").trim() || `Person ${i + 1}`; }
function findMember(id) { return careMembers().find((m) => m.id === id) || null; }

function guessCountry() {
  const lang = String((navigator.languages && navigator.languages[0]) || navigator.language || "");
  const region = (lang.split("-")[1] || "").toUpperCase();
  return CARE_COUNTRIES_FALLBACK[region] && region !== "OTHER" ? region : "IN";
}
function careCountry() {
  const c = careFamily().country;
  return c || guessCountry();
}
function careLanguage() {
  const l = careFamily().language;
  return SPEECH_LANG[l] ? l : "English";
}

// The member as the API wants it.
function apiMember(m) {
  if (!m) return {};
  const c = m.care || {};
  return {
    name: m.name || "", age: m.age, sex: m.sex, pregnant: Boolean(m.pregnant),
    concerns: c.concerns || [], skin_type: c.skin_type || null, wants: c.wants || "", details: c.details || "",
    allergies: m.allergies || "",
  };
}

// Calm waiting: a skeleton and one plain line that changes every ~2 s, plus a seconds counter.
function calmWait(box, lines, label) {
  box.innerHTML = `
    <div class="care-wait" aria-busy="true">
      <p class="sr-only" role="status">${esc(label || lines[0])}</p>
      <p class="working care-wait-line" aria-hidden="true"><span class="spinner"></span><span class="cw-text"></span></p>
      <div class="care-skel" aria-hidden="true"><span class="sk-a"></span><span class="sk-b"></span><span class="sk-c"></span></div>
    </div>`;
  const line = box.querySelector(".cw-text");
  let i = 0;
  const stopTick = ticker(line, esc(lines[0]));
  const rotate = setInterval(() => {
    i = (i + 1) % lines.length;
    const t = line.firstChild;
    if (t && t.nodeType === 3) t.textContent = lines[i] + " ";
  }, 2000);
  return () => { clearInterval(rotate); stopTick(); };
}

function careError(box, text, act) {
  box.innerHTML = `
    <div class="care-error" role="alert">
      <p><b>We couldn't check that just now.</b> ${esc(text && !/^Request failed/.test(text) ? text : "Try again.")}</p>
      <button type="button" class="btn btn-quiet btn-small" data-care-act="${esc(act)}">Try again</button>
    </div>`;
}

// ---------- voice: Care's own mic (same behaviour as Plate's) ----------
function micFor({ btn, box, hint, msg, idle }) {
  const m = { rec: null, listening: false, base: "" };
  const label = btn.querySelector(".mic-label");
  const lang = () => careLanguage();
  function updateHint() {
    if (!m.rec) { noVoiceHint(hint); return; }
    hint.classList.remove("is-novoice"); hint.closest(".mic-wrap")?.classList.remove("no-voice");
    hint.textContent = m.listening ? `Listening in ${lang()}. Tap Done when you've finished.` : `Listens in ${lang()}. Check the words before you go on.`;
  }
  function set(on) {
    m.listening = on;
    btn.setAttribute("aria-pressed", String(on));
    label.textContent = on ? "Done" : idle;
    btn.closest(".mic-wrap").classList.toggle("is-listening", on);
    updateHint();
  }
  function start() {
    if (!m.rec) { noVoiceHint(hint, true); box.focus(); return; }
    if (m.listening) return;
    m.base = box.value.trim();
    m.rec.lang = SPEECH_LANG[lang()] || "en-IN";
    msg.className = "msg"; msg.textContent = "";
    try { m.rec.start(); set(true); } catch {
      try { m.rec.abort(); } catch { /* ignore */ }
      set(false);
    }
  }
  function stop() {
    if (!m.rec || !m.listening) return;
    try { m.rec.stop(); } catch { /* already stopped */ }
  }
  btn.addEventListener("click", () => { if (m.listening) stop(); else start(); });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try { m.rec = new SR(); } catch { m.rec = null; }
  }
  if (m.rec) {
    const rec = m.rec;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const said = Array.from(ev.results).map((r) => r[0]?.transcript || "").join(" ").replace(/\s+/g, " ").trim();
      box.value = ((m.base ? m.base + " " : "") + said).slice(0, Number(box.maxLength) > 0 ? box.maxLength : 400);
    };
    rec.onerror = (ev) => {
      const reasons = {
        "not-allowed": "Microphone access was blocked. Allow it in your browser settings, or type instead.",
        "service-not-allowed": "Voice typing isn't available here. Please type instead.",
        "no-speech": "We didn't hear anything. Tap the mic and try again.",
        "audio-capture": "No microphone found. Please type instead.",
        "network": "Voice typing needs an internet connection. Please type instead.",
        "language-not-supported": `Voice typing doesn't support ${lang()} in this browser. Try English, or type instead.`,
      };
      if (ev.error !== "aborted") { msg.className = "msg error"; msg.textContent = reasons[ev.error] || "Voice typing stopped. Please try again or type instead."; }
      set(false);
    };
    rec.onend = () => set(false);
  }
  updateHint();
  return { stop, updateHint, get listening() { return m.listening; } };
}

// ---------- chips: who is it for, examples, country & language ----------
function whoChipsHTML(name, selected) {
  const ms = careMembers();
  const opt = (v, l) => `<label class="pick-opt"><input type="radio" name="${name}" value="${esc(v)}"${v === selected ? " checked" : ""}><span>${esc(l)}</span></label>`;
  return [opt("", "Anyone"), ...ms.map((m, i) => opt(m.id, memberLabel(m, i)))].join("")
    + (ms.length < FAMILY_MAX ? `<button type="button" class="chip-add" data-care-act="quick-add" data-for="${esc(name)}"><span aria-hidden="true">+</span> Add</button>` : "");
}
function renderWho() {
  if (care.remedyWho && !findMember(care.remedyWho)) care.remedyWho = "";
  if (care.labelWho && !findMember(care.labelWho)) care.labelWho = "";
  $("careWho").innerHTML = whoChipsHTML("careWhoPick", care.remedyWho);
  $("labelWho").innerHTML = whoChipsHTML("labelWhoPick", care.labelWho);
}
function quickAddForm(forName) {
  const holder = forName === "labelWhoPick" ? $("labelWho") : $("careWho");
  const add = holder.querySelector(".chip-add");
  if (!add) return;
  const form = document.createElement("span");
  form.className = "quick-add";
  form.innerHTML = `<label class="sr-only" for="qa-${esc(forName)}">Name, e.g. Dad or Riya</label>
    <input id="qa-${esc(forName)}" type="text" maxlength="30" autocomplete="off" placeholder="Dad, Riya…">
    <button type="button" class="btn btn-quiet btn-small" data-care-act="quick-add-save" data-for="${esc(forName)}">Add</button>`;
  add.replaceWith(form);
  form.querySelector("input").focus();
}
function quickAddSave(forName) {
  const holder = forName === "labelWhoPick" ? $("labelWho") : $("careWho");
  const input = holder.querySelector(".quick-add input");
  const name = (input?.value || "").trim();
  if (!name) { input?.focus(); return; }
  const m = upsertMember({ name, care: {} });
  if (!m) { toast("Your family book holds up to 6 people."); return; }
  if (forName === "labelWhoPick") care.labelWho = m.id; else care.remedyWho = m.id;
  renderWho();
  renderPeople();
  holder.querySelector(`input[value="${CSS.escape(m.id)}"]`)?.focus();
  announce(`Added ${name}.`);
}

function renderExamples() {
  $("careExamples").innerHTML = CARE_EXAMPLES.map(([label, text]) =>
    `<button type="button" class="chip-btn" data-care-act="example" data-text="${esc(text)}">${esc(label)}</button>`).join("");
}

function renderWhere() {
  const countries = careCountries();
  const country = careCountry();
  const lang = careLanguage();
  const langs = (state.health?.languages || DEFAULT_LANGUAGES).filter((l) => SPEECH_LANG[l]);
  document.querySelectorAll(".care-country").forEach((sel) => {
    sel.innerHTML = Object.entries(countries).map(([k, v]) => `<option value="${esc(k)}">${esc(k === "OTHER" ? "Somewhere else" : v)}</option>`).join("");
    sel.value = country;
  });
  document.querySelectorAll(".care-lang").forEach((sel) => {
    sel.innerHTML = langs.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
    sel.value = lang;
  });
  const cname = country === "OTHER" ? "Somewhere else" : countries[country] || country;
  document.querySelectorAll(".care-where-sum").forEach((s) => { s.textContent = `${cname} · ${lang}`; });
  care.mic?.updateHint();
}

// A strength inside brackets: "10% (15-20% on prescription)" becomes "10%", so the text never shows "((".
function shortStrength(strength) {
  return String(strength || "").replace(/\s*\([^()]*\)/g, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}

// "shampoo" + "Ketoconazole shampoo" reads as "Ketoconazole shampoo (1-2%)", never "shampoo with ketoconazole shampoo".
function productWith(product, name, strength) {
  const prod = String(product || "").trim();
  const n = String(name || "").trim();
  const short = shortStrength(strength);
  const str = short ? ` (${short})` : "";
  if (!n) return prod;
  const first = prod.toLowerCase().split(/[\s,(]+/)[0];
  if (!prod || (first && n.toLowerCase().includes(first))) return `${n}${str}`;
  return `${prod} with ${n.toLowerCase()}${str}`;
}

// ---------- routing: home | plate | care ----------
const CARE_SCREENS = { care: "careMain", "care-plan": "carePlan", "care-label": "careLabel" };

function stopAllMics() {
  try { stopListening(); } catch { /* ignore */ }
  care.mic?.stop();
}

function setSide(side) {
  const changed = care.side !== side;
  care.side = side;
  // Both carry it: <html> is set before first paint by the inline script in index.html, <body> by us.
  document.documentElement.dataset.side = side;
  document.body.dataset.side = side;
  document.querySelectorAll("[data-side-link]").forEach((a) => {
    if (a.dataset.sideLink === side) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (side === "plate" || side === "care") setMode(side);
  if (changed) stopAllMics();
  return changed;
}

function route(initial = false) {
  const h = location.hash.replace(/^#/, "");
  if (document.body.classList.contains("cb-open") && !initial) {
    document.body.classList.remove("cb-open");
    care.bookFromCare = false;
  }
  let side;
  if (h === "home") side = "home";
  else if (h === "plate") side = "plate";
  else if (CARE_SCREENS[h]) side = "care";
  else if (h === "") side = careFamily().mode || "home";
  else if (initial) side = careFamily().mode || "home"; // e.g. #samples on first load
  else return; // in-page anchors (e.g. #samples) leave the side alone
  const changed = setSide(side);
  if (side === "care") {
    const screen = CARE_SCREENS[h] ? h : care.screen || "care";
    showCareScreen(screen, !initial);
  } else if (changed && !initial) {
    window.scrollTo(0, 0);
    const title = side === "home" ? $("homeTitle") : $("heroTitle");
    if (side === "plate") title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
  }
  if (side === "home") document.title = "Heritage: family recipes made lighter, home remedies checked";
  else if (side === "plate") document.title = "Heritage Plate: your family's recipes, made lighter";
}

function showCareScreen(screen, focus) {
  care.screen = screen;
  Object.entries(CARE_SCREENS).forEach(([k, id]) => { $(id).hidden = k !== screen; });
  document.title = screen === "care-plan" ? "Heritage Care: a skin & hair plan for the family"
    : screen === "care-label" ? "Heritage Care: check a product label" : "Heritage Care: home remedies, checked";
  if (screen === "care-plan") renderPeople();
  renderWho();
  renderBookLink();
  if (focus) {
    window.scrollTo(0, 0);
    const title = { care: "careTitle", "care-plan": "carePlanTitle", "care-label": "careLabelTitle" }[screen];
    $(title).focus({ preventScroll: true });
  }
}

function renderBookLink() {
  const has = hasCareBook() || Boolean(readPlateRaw());
  document.querySelectorAll(".care-book-link").forEach((b) => { b.hidden = !has; });
}

// ---------- job 1: remedy check ----------
function verdictPill(v) {
  const x = VERDICTS[v] || VERDICTS.care;
  return `<span class="verdict v-${esc(v in VERDICTS ? v : "care")}"><span class="v-icon" aria-hidden="true">${x.icon}</span>${esc(x.word)}</span>`;
}

function sourcesBadge(item) {
  const src = (item.sources || []).filter((s) => s && (s.name || s.url));
  if (!item.checked || !src.length) return `<p class="ai-badge">AI-assessed, not in our checked library</p>`;
  return `
    <details class="checked-badge">
      <summary><span aria-hidden="true">✓</span> Backed by ${src.length} source${src.length === 1 ? "" : "s"}</summary>
      <ul>${src.map((s) => {
        const u = safeUrl(s.url);
        return `<li>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(s.name || u)}</a>` : esc(s.name)}</li>`;
      }).join("")}</ul>
    </details>`;
}

function ingredientCard(c) {
  const products = (c.products || []).filter(Boolean);
  const when = TIME_WORDS[c.time] || "";
  return `
    <div class="ing-card">
      <p class="ing-name">${esc(c.name)} ${c.strength ? `<span class="ing-strength">${esc(c.strength)}</span>` : ""}</p>
      ${c.how ? `<p>${esc(c.how)}</p>` : ""}
      ${c.why ? `<p class="ing-why">${esc(c.why)}</p>` : ""}
      ${products.length || when ? `<p class="ing-meta"><b>Use:</b> ${esc(products.join(" or "))}${when ? `${products.length ? ", " : ""}${esc(when)}` : ""}</p>` : ""}
      ${c.find ? `<p class="ing-meta"><b>Where to find it:</b> ${esc(c.find)}</p>` : ""}
      ${c.cautions ? `<p class="ing-meta"><b>Go gently:</b> ${esc(c.cautions)}</p>` : ""}
      ${c.pregnancy_note ? `<p class="ing-preg">${esc(c.pregnancy_note)}</p>` : ""}
    </div>`;
}

function redFlagsCallout(flags) {
  const list = (flags || []).filter(Boolean);
  if (!list.length) return "";
  return `
    <div class="care-callout care-callout-doctor" role="note">
      <p class="callout-h"><span aria-hidden="true">⚕</span> Worth a doctor's visit first</p>
      <ul>${list.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </div>`;
}

function remedyCard(item, i, total) {
  const better = item.better || [];
  const keepish = item.verdict === "keep" || item.verdict === "care";
  const notes = (item.notes || []).filter(Boolean);
  return `
    <article class="care-card remedy-card" aria-labelledby="remedyH${i}">
      <div class="verdict-row">${verdictPill(item.verdict)}<span class="evidence-word">${esc(EVIDENCE_WORDS[item.evidence] || EVIDENCE_WORDS.little)}</span></div>
      ${item.safety_rule ? `<p class="safety-rule"><span aria-hidden="true">✕</span> Safety rule: we always say stop to this.</p>` : ""}
      <h2 id="remedyH${i}" class="remedy-name" tabindex="-1">“${esc(item.remedy)}”</h2>
      ${item.why ? `<h3 class="rc-h">What the evidence says</h3><p class="care-p">${esc(item.why)}</p>` : ""}
      ${keepish ? `<h3 class="rc-h">How to keep it safely</h3><p class="care-p">Patch-test on a small area for 2 days first, and stop if it stings, itches or turns red.</p>` : ""}
      ${better.length ? `<h3 class="rc-h">${keepish ? "What does the job" : "Do this instead"}</h3>
        ${item.how_better ? `<p class="care-p">${esc(item.how_better)}</p>` : ""}
        <div class="ing-cards">${better.map(ingredientCard).join("")}</div>` : ""}
      ${notes.length ? `<ul class="doctor-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${sourcesBadge(item)}
      ${total > 1 ? "" : ""}
    </article>`;
}

function renderRemedy() {
  const box = $("careResult");
  const r = care.remedy;
  if (!r) { box.innerHTML = ""; return; }
  const res = r.result;
  const items = res.remedies || [];
  const who = r.who ? findMember(r.who) : null;
  box.innerHTML = `
    <div class="care-result-inner">
      <p class="care-for">${who ? `For <b>${esc(memberLabel(who, careMembers().indexOf(who)))}</b> · ` : ""}You said: “${esc(r.text)}”</p>
      ${redFlagsCallout(res.red_flags)}
      ${items.map((it, i) => remedyCard(it, i, items.length)).join("")}
      ${res.note ? `<div class="care-letter"><p class="rc-h">A note for the family${r.language && r.language !== "English" ? ` · ${esc(r.language)}` : ""}</p><p class="care-letter-text">${esc(res.note)}</p></div>` : ""}
      <div class="care-actions">
        ${r.saved ? `<button type="button" class="btn btn-done" disabled><span aria-hidden="true">✓</span> Saved to family book</button>
          <button type="button" class="btn btn-quiet" data-care-act="open-book">See your family book</button>`
          : `<button type="button" class="btn btn-primary" data-care-act="save-remedy">Save to family book</button>`}
        <button type="button" class="btn-link" data-care-act="another">Check another</button>
      </div>
    </div>`;
}

async function checkRemedy(textOverride) {
  if (care.remedyRunning) return;
  const box = $("careText");
  if (typeof textOverride === "string") box.value = textOverride;
  const text = box.value.trim();
  const msg = $("careMsg");
  msg.className = "msg"; msg.textContent = "";
  clearGuard("careGuard");
  care.mic?.stop();
  if (text.length < 3) {
    msg.className = "msg warn";
    msg.textContent = "Say or type a remedy first, the way it's said at home.";
    box.focus();
    return;
  }
  const who = care.remedyWho;
  const member = who ? apiMember(findMember(who)) : {};
  const country = careCountry();
  const language = careLanguage();
  const out = $("careResult");
  care.remedyRunning = true;
  const stop = calmWait(out, CARE_LINES.remedy, "Checking what the evidence says.");
  scrollToEl(out);
  try {
    const data = await busy($("careGo"), "Checking…", () => api("/api/care/remedy", { text: text.slice(0, 400), member, country, language }, 90000));
    stop();
    const res = data && data.result;
    if (!res || !Array.isArray(res.remedies) || !res.remedies.length) throw new Error("");
    care.remedy = { text, who, result: res, saved: false, language };
    renderRemedy();
    const v = VERDICTS[res.remedies[0].verdict] || VERDICTS.care;
    if (care.side === "care") announce(`${v.word}: ${res.remedies[0].remedy}.`); // not over Plate or home
    out.querySelector(".remedy-name")?.focus({ preventScroll: true });
  } catch (err) {
    stop();
    if (err.guard) { out.innerHTML = ""; showGuard("careGuard", "careText", err.guard, CARE_EXAMPLES[0][1]); return; }
    careError(out, err.message, "check");
  } finally {
    care.remedyRunning = false;
  }
}

function saveRemedy() {
  const r = care.remedy;
  if (!r || r.saved) return;
  const who = r.who ? findMember(r.who) : null;
  const ok = saveRemedyCheck({ text: r.text, who: who ? memberLabel(who, careMembers().indexOf(who)) : "", result: r.result });
  if (!ok) { toast("Couldn't save that one. Please try again."); return; }
  r.saved = true;
  renderRemedy();
  renderBookLink();
  $("careResult").querySelector('[data-care-act="open-book"]')?.focus();
  toast("Saved to your family book.", { label: "See it", run: openBookFromCare });
}

// ---------- job 2: the family care plan ----------
function personCard(m, i) {
  const c = m.care || {};
  const concerns = careConcerns();
  const chip = (k) => `<label class="pick-opt"><input type="checkbox" data-field="concern" value="${esc(k)}"${(c.concerns || []).includes(k) ? " checked" : ""}><span>${esc(concerns[k] || k)}</span></label>`;
  const pid = esc(m.id);
  return `
    <fieldset class="person care-card" data-person="${pid}">
      <legend class="sr-only">${esc(memberLabel(m, i))}</legend>
      <div class="person-head">
        <p class="person-title" aria-hidden="true"><span class="avatar fam-${(i % 4) + 1}">${esc((memberLabel(m, i)[0] || "?").toUpperCase())}</span><span class="person-name">${esc(memberLabel(m, i))}</span></p>
        <button type="button" class="btn-link danger" data-care-act="remove-person" data-id="${pid}">Remove<span class="sr-only"> ${esc(memberLabel(m, i))}</span></button>
      </div>
      <div class="person-grid">
        <label class="field"><span class="field-label">What you call them</span>
          <input type="text" data-field="name" maxlength="30" autocomplete="off" value="${esc(m.name)}" placeholder="Dad, Nani, Riya…"></label>
        <label class="field field-age"><span class="field-label">Age <span class="opt">optional</span></span>
          <input type="number" data-field="age" inputmode="numeric" min="0" max="120" step="1" value="${m.age ?? ""}"></label>
      </div>
      <div class="person-row">
        <div class="pick pick-sm" role="radiogroup" aria-label="Sex for ${esc(memberLabel(m, i))}">
          ${[["female", "Female"], ["male", "Male"], ["", "Rather not say"]].map(([v, l]) => `<label class="pick-opt"><input type="radio" name="sex-${pid}" data-field="sex" value="${v}"${(m.sex || "") === v ? " checked" : ""}><span>${l}</span></label>`).join("")}
        </div>
        <label class="check-row preg-row"${m.sex === "male" ? " hidden" : ""}><input type="checkbox" data-field="pregnant"${m.pregnant ? " checked" : ""}><span>Pregnant or breastfeeding</span></label>
      </div>
      <fieldset class="person-fs"><legend class="field-label">Skin</legend><div class="pick pick-sm">${CARE_SKIN_GROUP.map(chip).join("")}</div></fieldset>
      <fieldset class="person-fs"><legend class="field-label">Hair &amp; scalp</legend><div class="pick pick-sm">${CARE_HAIR_GROUP.map(chip).join("")}</div></fieldset>
      <div class="person-grid">
        <label class="field"><span class="field-label">Skin type</span>
          <select data-field="skin_type">${SKIN_TYPE_WORDS.map(([v, l]) => `<option value="${v}"${(c.skin_type || "") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">Looking for <span class="opt">optional</span></span>
          <input type="text" data-field="wants" maxlength="120" autocomplete="off" value="${esc(c.wants)}" placeholder="men's body wash, a shampoo"></label>
      </div>
      <label class="field"><span class="field-label">Allergies <span class="opt">optional</span></span>
        <input type="text" data-field="allergies" maxlength="200" autocomplete="off" value="${esc(m.allergies)}" placeholder="e.g. fragrance, nuts"></label>
      <label class="field"><span class="field-label">Anything else? <span class="opt">optional</span></span>
        <textarea data-field="details" rows="2" maxlength="300" placeholder="e.g. hair falling out in patches">${esc(c.details)}</textarea></label>
    </fieldset>`;
}

function renderPeople() {
  const box = $("carePeople");
  if (!box) return;
  const ms = careMembers();
  box.innerHTML = ms.length ? ms.map(personCard).join("") : `
    <div class="empty care-empty">
      <b>Who are we planning for?</b>
      <span>Add each person, or try a sample family to see how it works.</span>
    </div>`;
  const add = document.querySelector('[data-care-act="add-person"]');
  if (add) add.hidden = ms.length >= FAMILY_MAX;
}

function readPerson(card) {
  const id = card.dataset.person;
  const old = findMember(id);
  if (!old) return null;
  const val = (f) => card.querySelector(`[data-field="${f}"]`);
  const sex = card.querySelector('[data-field="sex"]:checked')?.value || null;
  const ageRaw = val("age").value.trim();
  return {
    ...old,
    name: val("name").value.trim(),
    age: ageRaw === "" ? null : Number(ageRaw),
    sex,
    pregnant: sex !== "male" && val("pregnant").checked,
    allergies: val("allergies").value,
    care: {
      concerns: [...card.querySelectorAll('[data-field="concern"]:checked')].map((x) => x.value),
      skin_type: val("skin_type").value || null,
      wants: val("wants").value,
      details: val("details").value,
    },
  };
}

function onPersonEdit(e) {
  const card = e.target.closest("[data-person]");
  if (!card) return;
  if (e.target.dataset.field === "concern") {
    const on = card.querySelectorAll('[data-field="concern"]:checked');
    if (on.length > 6) { e.target.checked = false; toast("Pick up to 6 for each person."); return; }
  }
  if (e.target.dataset.field === "sex") card.querySelector(".preg-row").hidden = e.target.value === "male";
  if (e.target.dataset.field === "name") {
    const n = card.querySelector(".person-name");
    const i = [...$("carePeople").children].indexOf(card);
    if (n) n.textContent = e.target.value.trim() || `Person ${i + 1}`;
  }
  clearTimeout(care.saveTimer);
  const save = () => {
    const m = readPerson(card);
    if (m) upsertMember(m);
    renderWho();
  };
  if (e.type === "change") save(); else care.saveTimer = setTimeout(save, 300);
}

function addPerson() {
  const m = upsertMember({ name: "", care: {} });
  if (!m) { toast("Your family book holds up to 6 people."); return; }
  renderPeople();
  renderWho();
  const card = $("carePeople").querySelector(`[data-person="${CSS.escape(m.id)}"]`);
  card?.querySelector('[data-field="name"]')?.focus();
}

function removePersonById(id) {
  const m = findMember(id);
  if (!m) return;
  const i = careMembers().indexOf(m);
  const snapshot = JSON.parse(JSON.stringify(careMembers()));
  removeMember(id);
  renderPeople();
  renderWho();
  toast(`Removed ${memberLabel(m, i)}.`, { label: "Undo", run: () => { writeFamily({ members: snapshot }); renderPeople(); renderWho(); } });
  const next = $("carePeople").querySelector('[data-field="name"]') || document.querySelector('[data-care-act="add-person"]');
  next?.focus();
}

function loadSample() {
  const f = careFamily();
  const keep = f.members.filter((m) => m.fromPlate && !CARE_SAMPLE.some((s) => s.name === m.name));
  const sample = CARE_SAMPLE.map((s) => cleanMember({ name: s.name, age: s.age, sex: s.sex, pregnant: s.pregnant, allergies: s.allergies,
    care: { concerns: s.concerns, skin_type: s.skin_type, wants: s.wants, details: s.details } }));
  // The sample replaces everyone except Plate's person, who stays out of this plan's way (moved last).
  writeFamily({ members: [...sample, ...keep].slice(0, FAMILY_MAX) });
  renderPeople();
  renderWho();
  announce("Sample family added: Dad, Mum and Priya.");
  $("carePeople").querySelector('[data-field="name"]')?.focus();
}

function personPlanHTML(p, i) {
  const byId = Object.fromEntries((p.ingredients || []).map((c) => [c.id, c]));
  const steps = (list) => (list || []).map((s) => {
    const c = byId[s.active];
    return `<li><span class="step-product">${esc(c ? productWith(s.product, c.name, c.strength) : s.product)}</span>${s.tip ? `<span class="step-tip">${esc(s.tip)}</span>` : ""}</li>`;
  }).join("");
  const slot = (title, key) => (p.routine?.[key] || []).length ? `<div class="routine-slot"><h4 class="rc-h">${title}</h4><ol class="routine">${steps(p.routine[key])}</ol></div>` : "";
  const concerns = careConcerns();
  const notes = (p.doctor_notes || []).filter(Boolean);
  const routines = slot("Morning", "am") + slot("Night", "pm") + slot("In the shower", "shower");
  return `
    <article class="care-card person-plan" aria-labelledby="planH${i}">
      <p class="person-title"><span class="avatar fam-${(i % 4) + 1}" aria-hidden="true">${esc((p.name[0] || "?").toUpperCase())}</span><span><span id="planH${i}" class="person-name" role="heading" aria-level="3">${esc(p.name)}</span>
        <span class="person-sub">${esc((p.concerns || []).map((c) => concerns[c] || c).join(" · "))}</span></span></p>
      ${redFlagsCallout(p.red_flags)}
      ${notes.length ? `<ul class="doctor-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${routines ? `<div class="routine-grid">${routines}</div>` : `<p class="care-p muted">Nothing to add for now.</p>`}
      ${routines && p.summary ? `<p class="care-p person-summary">${esc(p.summary)}</p>` : ""}
      ${(p.ingredients || []).length ? `
        <details class="why-these">
          <summary>Why these, and where to find them</summary>
          <div class="ing-cards">${p.ingredients.map(ingredientCard).join("")}</div>
          ${sourcesBadge({ checked: true, sources: Object.values(Object.fromEntries(p.ingredients.flatMap((c) => c.sources || []).map((s) => [s.url, s]))) })}
        </details>` : ""}
    </article>`;
}

function shoppingHTML(list) {
  if (!list || !list.length) return "";
  return `
    <section class="care-card care-shop" aria-labelledby="careShopH">
      <h3 id="careShopH" class="care-h3">Skin &amp; hair shopping</h3>
      <p class="care-p muted">Product types and ingredients, no brands. Look for the ingredient on the label.</p>
      <ul class="shop-list">${list.map((s) => `
        <li><span class="shop-main"><b>${esc(productWith(s.products, s.name, ""))}</b>${s.strength ? ` <span class="ing-strength">${esc(s.strength)}</span>` : ""}</span>
          <span class="shop-for">For ${esc((s.for || []).join(", "))}</span></li>`).join("")}</ul>
    </section>`;
}

function renderPlanOut() {
  const box = $("carePlanOut");
  const p = care.plan;
  if (!p) { box.innerHTML = ""; return; }
  const r = p.result;
  box.innerHTML = `
    <div class="care-result-inner">
      <h2 id="planOutTitle" class="care-h2" tabindex="-1">Their routines</h2>
      ${(r.people || []).map(personPlanHTML).join("")}
      ${shoppingHTML(r.shopping)}
      ${r.note_for_family ? `<div class="care-letter"><p class="rc-h">A note for the family${r.language && r.language !== "English" ? ` · ${esc(r.language)}` : ""}</p><p class="care-letter-text">${esc(r.note_for_family)}</p></div>` : ""}
      <div class="care-actions">
        ${p.saved ? `<button type="button" class="btn btn-done" disabled><span aria-hidden="true">✓</span> Saved to family book</button>
          <button type="button" class="btn btn-quiet" data-care-act="open-book">See your family book</button>`
          : `<button type="button" class="btn btn-primary" data-care-act="save-plan">Save to family book</button>`}
        <button type="button" class="btn-link" data-care-act="edit-plan">Edit answers</button>
      </div>
    </div>`;
}

async function makeCarePlan() {
  if (care.planRunning) return;
  const msg = $("carePlanMsg");
  msg.className = "msg"; msg.textContent = "";
  clearGuard("carePlanGuard");
  // Save any edit still waiting on the debounce.
  clearTimeout(care.saveTimer);
  $("carePeople").querySelectorAll("[data-person]").forEach((card) => { const m = readPerson(card); if (m) upsertMember(m); });
  const ms = careMembers();
  if (!ms.length) {
    msg.className = "msg warn"; msg.textContent = "Add someone first, or try a sample family.";
    document.querySelector('[data-care-act="add-person"]')?.focus();
    return;
  }
  const missing = ms.findIndex((m) => !(m.care?.concerns || []).length && !(m.care?.details || "").trim() && !(m.care?.wants || "").trim());
  if (missing >= 0) {
    msg.className = "msg warn";
    msg.textContent = `Pick at least one thing for ${memberLabel(ms[missing], missing)}, like dry skin or dandruff.`;
    $("carePeople").children[missing]?.querySelector('[data-field="concern"]')?.focus();
    return;
  }
  const members = ms.map((m, i) => ({ ...apiMember(m), name: memberLabel(m, i) }));
  const out = $("carePlanOut");
  const names = members.map((m) => m.name);
  care.planRunning = true;
  const stop = calmWait(out, names.map((n) => `Building ${n}'s routine…`), "Building their routines.");
  scrollToEl(out);
  try {
    const data = await busy($("carePlanGo"), "Building…", () => api("/api/care/plan", { members, country: careCountry(), language: careLanguage() }, 120000));
    stop();
    const res = data && data.result;
    if (!res || !Array.isArray(res.people) || !res.people.length) throw new Error("");
    care.plan = { result: res, saved: false };
    renderPlanOut();
    announce("Their routines are ready.");
    $("planOutTitle")?.focus({ preventScroll: true });
  } catch (err) {
    stop();
    if (err.guard) { out.innerHTML = ""; showGuard("carePlanGuard", "", err.guard); return; }
    careError(out, err.message, "plan");
  } finally {
    care.planRunning = false;
  }
}

function savePlan() {
  const p = care.plan;
  if (!p || p.saved) return;
  if (!saveCarePlan(p.result)) { toast("Couldn't save the plan. Please try again."); return; }
  p.saved = true;
  renderPlanOut();
  renderBookLink();
  $("carePlanOut").querySelector('[data-care-act="open-book"]')?.focus();
  toast("Saved to your family book.", { label: "See it", run: openBookFromCare });
}

// ---------- job 3: label check ----------
function renderLabel() {
  const box = $("labelOut");
  const l = care.label;
  if (!l) { box.innerHTML = ""; return; }
  const r = l.result;
  const concerns = careConcerns();
  const who = l.who ? findMember(l.who) : null;
  const whoName = who ? memberLabel(who, careMembers().indexOf(who)) : "";
  const helps = r.actives || [];
  const watch = r.irritants || [];
  const danger = (Array.isArray(r.danger) ? r.danger : []).filter((x) => x && x.name);
  // Dangerous ingredients get their own red callout, so drop their copy ("Name: why") from the warnings.
  const warnings = (r.warnings || []).filter((w) => !danger.some((x) => w === `${x.name}: ${x.why}`));
  box.innerHTML = `
    <article class="care-card label-card" aria-labelledby="labelOutTitle">
      <h2 id="labelOutTitle" class="care-h2" tabindex="-1">Read ${esc(r.count)} ingredient${r.count === 1 ? "" : "s"}</h2>
      <ul class="label-tally" aria-label="At a glance">
        ${danger.length ? `<li class="lt-stop"><b>${danger.length}</b> ${danger.length === 1 ? "needs" : "need"} a doctor</li>` : ""}
        ${helps.length ? `<li class="lt-help"><b>${helps.length}</b> help${helps.length === 1 ? "s" : ""}</li>` : ""}
        ${watch.length ? `<li class="lt-watch"><b>${watch.length}</b> to watch</li>` : ""}
        ${!danger.length && !watch.length ? `<li class="lt-help">Nothing on our watch list</li>` : ""}
      </ul>
      ${r.fits?.length && whoName ? `<p class="label-fit"><span class="verdict v-keep"><span class="v-icon" aria-hidden="true">✓</span>Good fit</span> for ${esc(whoName)}: ${esc(r.fits.map((x) => x.toLowerCase()).join(", "))}</p>` : ""}
      ${danger.length ? `<div class="care-callout care-callout-danger" role="note"><p class="callout-h"><span aria-hidden="true">✕</span> Don't use this without a doctor</p><ul>${danger.map((x) => `<li><b>${esc(x.name)}</b>${x.position ? ` <span class="pos">#${esc(x.position)} on the list</span>` : ""}${x.why ? `<span class="label-sub">${esc(x.why)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      ${warnings.length ? `<div class="care-callout care-callout-warn" role="note"><p class="callout-h"><span aria-hidden="true">!</span> ${whoName ? `Not ideal for ${esc(whoName)}` : "Worth knowing"}</p><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      <div class="label-cols">
        <div>
          <h3 class="rc-h rc-h-good">Helps with</h3>
          ${helps.length ? `<ul class="label-list">${helps.map((a) => `<li><b>${esc(a.name)}</b> <span class="pos">#${esc(a.position)} on the list</span><span class="label-sub">${esc((a.helps || []).map((c) => concerns[c] || c).join(" · "))}</span>${a.how ? `<span class="label-sub">${esc(a.how)}</span>` : ""}</li>`).join("")}</ul>`
            : `<p class="care-p muted">No proven actives we know of. It may still be a fine basic product.</p>`}
        </div>
        <div>
          <h3 class="rc-h rc-h-watch">Watch out</h3>
          ${watch.length ? `<ul class="label-list">${watch.map((x) => `<li><b>${esc(x.name)}</b> <span class="pos">#${esc(x.position)} on the list</span>${x.high ? ` <span class="tag-high">in the first five</span>` : ""}<span class="label-sub">${esc(x.why)}</span></li>`).join("")}</ul>`
            : `<p class="care-p muted">Nothing on our watch list.</p>`}
        </div>
      </div>
      <p class="care-p muted label-note">Ingredients are listed from most to least. Read in code from our checked list, with no AI.</p>
    </article>`;
}

async function checkLabel() {
  const text = $("labelText").value.trim();
  const msg = $("labelMsg");
  msg.className = "msg"; msg.textContent = "";
  clearGuard("labelGuard");
  if (text.length < 3) {
    msg.className = "msg warn"; msg.textContent = "Paste the ingredients list first, or use the example.";
    $("labelText").focus();
    return;
  }
  const who = care.labelWho;
  const out = $("labelOut");
  const stop = calmWait(out, CARE_LINES.label, "Reading the label.");
  try {
    const data = await busy($("labelGo"), "Reading…", () => api("/api/care/label", { text: text.slice(0, 3000), member: who ? apiMember(findMember(who)) : {} }, 30000));
    stop();
    if (!data || !data.result) throw new Error("");
    care.label = { who, result: data.result };
    renderLabel();
    announce(`Read ${data.result.count} ingredients.`);
    $("labelOutTitle")?.focus({ preventScroll: true });
    scrollToEl(out);
  } catch (err) {
    stop();
    if (err.guard) { out.innerHTML = ""; showGuard("labelGuard", "labelText", err.guard, LABEL_EXAMPLE, "the example list"); return; }
    careError(out, err.message, "label");
  }
}

// ---------- the family book: Care's pages (used by app.js cookbookHTML / cookbookText) ----------
function careBookHTML() {
  const cb = careFamily().careBook;
  if (!cb.plan && !cb.remedies.length) return "";
  const plan = cb.plan;
  const concerns = careConcerns();
  const stepText = (p, s) => {
    const c = (p.ingredients || []).find((x) => x.id === s.active);
    return `${esc(c ? productWith(s.product, c.name, c.strength) : s.product)}${s.tip ? ` · ${esc(s.tip)}` : ""}`;
  };
  const people = plan ? plan.people.map((p) => {
    const slot = (title, key) => (p.routine[key] || []).length ? `<div><h5 class="rc-h">${title}</h5><ol class="method">${p.routine[key].map((s) => `<li>${stepText(p, s)}</li>`).join("")}</ol></div>` : "";
    return `
      <article class="cb-person">
        <p class="cb-kicker">Skin &amp; hair · ${esc((p.concerns || []).map((c) => concerns[c] || c).join(" · "))}</p>
        <h4>${esc(p.name)}</h4>
        ${(p.red_flags || []).length ? `<div class="cb-callout"><b>Worth a doctor's visit first.</b><ul>${p.red_flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        ${(p.doctor_notes || []).length ? `<ul class="cb-notes">${p.doctor_notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        <div class="cb-cols cb-routine">${slot("Morning", "am")}${slot("Night", "pm")}${slot("In the shower", "shower")}</div>
        ${p.summary && ["am", "pm", "shower"].some((k) => (p.routine[k] || []).length) ? `<p class="cb-legend">${esc(p.summary)}</p>` : ""}
      </article>`;
  }).join("") : "";
  const remedies = cb.remedies.length ? `
    <section class="cb-sec cb-remedies">
      <h3>Home remedies we looked at</h3>
      <ul class="cb-remedy-list">${cb.remedies.map((x) => x.result.remedies.map((r) => `
        <li><p><span class="verdict v-${esc(r.verdict)}"><span class="v-icon" aria-hidden="true">${VERDICTS[r.verdict].icon}</span>${esc(VERDICTS[r.verdict].word)}</span> <b>“${esc(r.remedy)}”</b>${x.who ? ` <span class="cb-h-sub">for ${esc(x.who)}</span>` : ""}</p>
          ${r.safety_rule ? `<p><b>Safety rule:</b> we always say stop to this.</p>` : ""}
          ${r.why ? `<p>${esc(r.why)}</p>` : ""}
          ${r.better.length ? `<p><b>${r.verdict === "keep" || r.verdict === "care" ? "What does the job" : "Do this instead"}:</b> ${esc(r.better.map((c) => `${c.name}${shortStrength(c.strength) ? ` (${shortStrength(c.strength)})` : ""}`).join("; "))}</p>` : ""}
          ${r.sources.length ? `<p class="cb-src">Sources: ${esc(r.sources.map((s) => s.name).join("; "))}</p>` : ""}</li>`).join("")).join("")}</ul>
    </section>` : "";
  const shop = plan && plan.shopping.length ? `
    <section class="cb-sec">
      <h3>Shopping list <span class="cb-h-sub">skin &amp; hair</span></h3>
      <div class="cb-shop cb-shop-care"><ul>${plan.shopping.map((s) => `<li><span>${esc(productWith(s.products, s.name, s.strength))}</span><span>${esc(s.for.join(", "))}</span></li>`).join("")}</ul></div>
    </section>` : "";
  const note = plan && plan.note_for_family ? `<section class="cb-sec cb-note"><h3>A note for the family</h3><p class="cb-note-text">${esc(plan.note_for_family)}</p></section>` : "";
  return `
    ${plan ? `<section class="cb-sec cb-care"><h3>Skin &amp; hair <span class="cb-h-sub">a page for each person</span></h3>${people}</section>` : ""}
    ${remedies}
    ${shop}
    ${note}
    <p class="cb-foot cb-care-foot">${esc(CARE_DISCLAIMER)}</p>`;
}

function careBookText() {
  const cb = careFamily().careBook;
  if (!cb.plan && !cb.remedies.length) return "";
  const L = ["== Skin & hair =="];
  const plan = cb.plan;
  if (plan) {
    plan.people.forEach((p) => {
      L.push("", `-- ${p.name} --`);
      (p.red_flags || []).forEach((f) => L.push(`Worth a doctor's visit first: ${f}`));
      (p.doctor_notes || []).forEach((n) => L.push(`Note: ${n}`));
      [["Morning", "am"], ["Night", "pm"], ["In the shower", "shower"]].forEach(([t, k]) => {
        const steps = p.routine[k] || [];
        if (!steps.length) return;
        L.push(`${t}:`);
        steps.forEach((s) => {
          const c = (p.ingredients || []).find((x) => x.id === s.active);
          L.push(`- ${c ? productWith(s.product, c.name, c.strength) : s.product}${s.tip ? `: ${s.tip}` : ""}`);
        });
      });
      if (p.summary && ["am", "pm", "shower"].some((k) => (p.routine[k] || []).length)) L.push(p.summary);
    });
  }
  if (cb.remedies.length) {
    L.push("", "== Home remedies we looked at ==");
    cb.remedies.forEach((x) => x.result.remedies.forEach((r) => {
      L.push(`${VERDICTS[r.verdict].word}: "${r.remedy}"${x.who ? ` (for ${x.who})` : ""}`);
      if (r.safety_rule) L.push("Safety rule: we always say stop to this.");
      if (r.why) L.push(r.why);
      if (r.better.length) L.push(`${r.verdict === "keep" || r.verdict === "care" ? "What does the job" : "Do this instead"}: ${r.better.map((c) => `${c.name}${shortStrength(c.strength) ? ` (${shortStrength(c.strength)})` : ""}`).join("; ")}`);
    }));
  }
  if (plan && plan.shopping.length) {
    L.push("", "== Shopping list: skin & hair ==");
    plan.shopping.forEach((s) => L.push(`- ${productWith(s.products, s.name, s.strength)}: for ${s.for.join(", ")}`));
  }
  if (plan && plan.note_for_family) L.push("", "== A note for the family ==", plan.note_for_family);
  L.push("", CARE_DISCLAIMER);
  return L.join("\n");
}

function careBookFromCare() { return care.bookFromCare; }

function openBookFromCare() {
  care.mic?.stop();
  care.bookFromCare = true;
  openCookbook();
}

// Called first by app.js closeCookbook(): when the book was opened from Care, go back to Care.
function careCloseBook() {
  if (!care.bookFromCare) return false;
  care.bookFromCare = false;
  document.body.classList.remove("cb-open");
  const title = { care: "careTitle", "care-plan": "carePlanTitle", "care-label": "careLabelTitle" }[care.screen] || "careTitle";
  window.scrollTo(0, 0);
  $(title).focus({ preventScroll: true });
  return true;
}

// ---------- events ----------
function onCareClick(e) {
  const b = e.target.closest("[data-care-act]");
  if (!b) return;
  const act = b.dataset.careAct;
  if (act === "check") checkRemedy();
  else if (act === "example") { clearGuard("careGuard"); checkRemedy(b.dataset.text || ""); }
  else if (act === "save-remedy") saveRemedy();
  else if (act === "another") {
    care.remedy = null; renderRemedy();
    clearGuard("careGuard");
    $("careText").value = "";
    window.scrollTo(0, 0);
    $("careText").focus();
  } else if (act === "open-book") openBookFromCare();
  else if (act === "quick-add") quickAddForm(b.dataset.for);
  else if (act === "quick-add-save") quickAddSave(b.dataset.for);
  else if (act === "sample") loadSample();
  else if (act === "add-person") addPerson();
  else if (act === "remove-person") removePersonById(b.dataset.id);
  else if (act === "plan") makeCarePlan();
  else if (act === "save-plan") savePlan();
  else if (act === "edit-plan") {
    const first = $("carePeople").querySelector('[data-field="name"]');
    if (first) { scrollToEl($("carePeople")); first.focus({ preventScroll: true }); }
  } else if (act === "label-example") { clearGuard("labelGuard"); $("labelText").value = LABEL_EXAMPLE; $("labelText").focus(); }
  else if (act === "label") checkLabel();
}

function setupCare() {
  $("careView").addEventListener("click", onCareClick);
  $("careView").addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "careWhoPick") care.remedyWho = t.value;
    else if (t.name === "labelWhoPick") care.labelWho = t.value;
    else if (t.classList.contains("care-country")) { writeFamily({ country: t.value }); renderWhere(); }
    else if (t.classList.contains("care-lang")) { writeFamily({ language: t.value }); renderWhere(); }
  });
  $("carePeople").addEventListener("input", onPersonEdit);
  $("carePeople").addEventListener("change", onPersonEdit);
  $("careView").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest(".quick-add")) { e.preventDefault(); quickAddSave(e.target.id.replace(/^qa-/, "")); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.id === "careText") { e.preventDefault(); checkRemedy(); }
  });
  window.addEventListener("hashchange", () => route(false));
  // Capture phase: on the home and Care sides, Escape is ours, so app.js never closes hidden Plate panels.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || care.side === "plate") return;
    if ($("how").open || document.body.classList.contains("cb-open")) return;
    e.stopPropagation();
    if (care.mic?.listening) care.mic.stop();
    else {
      const qa = document.activeElement?.closest?.(".quick-add");
      if (qa) renderWho();
    }
  }, true);
  care.mic = micFor({ btn: $("careMic"), box: $("careText"), hint: $("careMicHint"), msg: $("careMsg"), idle: "Say a remedy" });
}

async function loadCareLibrary() {
  try {
    const lib = await api("/api/care/library", null, 20000);
    if (lib && lib.concerns && lib.countries) {
      care.library = { concerns: lib.concerns, countries: lib.countries };
      renderWhere();
      if (care.screen === "care-plan" && !$("carePlan").hidden && !$("carePeople").contains(document.activeElement)) renderPeople();
    }
  } catch { /* the built-in lists stand in */ }
}

function initCare() {
  setupCare();
  renderExamples();
  renderWhere();
  renderWho();
  route(true);
  loadCareLibrary();
}

initCare();
