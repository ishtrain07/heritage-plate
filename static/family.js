// Nouri: the shared family store (this device only). Plate and Care both read and write it.
// Shape (v2): {v, savedAt, mode, language, country, members[], plate, careBook}
//   plate    = Plate's saved book (the old hp-cookbook-v1 payload), or null
//   careBook = {remedies: [saved remedy checks], plan: last saved care plan or null}
// A v1 save is migrated once: it becomes `plate`, and its person becomes members[0]. The v2 copy is marked
// `migratedFrom: 1`, and v1 is removed after the first successful v2 write, so it can never come back later
// (e.g. after "Start over" and a corrupt v2).
"use strict";

const FAMILY_KEY = "hp-family-v2";
const V1_KEY = "hp-cookbook-v1";
const FAMILY_MAX = 6;
const CARE_CONCERN_KEYS = ["acne", "oily", "dry", "sensitive", "dark_spots", "sun", "dandruff", "thinning_hair", "dry_hair", "body_dry"];
const SKIN_TYPES = ["oily", "dry", "combination", "normal", "sensitive"];
const PLATE_CONDITIONS = ["diabetes", "bp", "cholesterol"];
const MEMBER_RELATIONS = ["me", "partner", "mum", "dad", "child", "grandparent", "sibling", "flatmate", "other"];
const MEMBER_DIETS = ["non_veg", "pescatarian", "eggetarian", "vegetarian", "vegan", "halal", "kosher", "jain"];
const CARE_VERDICTS = ["keep", "care", "stop", "swap"];
const CARE_EVIDENCE = ["strong", "some", "little", "none"];
const CARE_COUNTRY_KEYS = ["IN", "US", "GB", "CA", "AU", "PH", "MX", "CN", "AE", "OTHER"];

let familyCache = null;

const fIsObj = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);
// Only strings and finite numbers become text: objects, arrays, booleans and NaN become "".
const fStr = (v, max) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "").slice(0, max);
const fList = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function familyId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyFamily() {
  return { v: 2, savedAt: 0, mode: "", language: "English", country: "", members: [], plate: null, careBook: { remedies: [], plan: null } };
}

// Clamped to what /api/care and /api/week accept, so a saved person never causes a 422.
function cleanMember(m) {
  if (!fIsObj(m)) return null;
  const age = typeof m.age === "number" || (typeof m.age === "string" && m.age.trim()) ? Number(m.age) : NaN;
  const sex = m.sex === "female" || m.sex === "male" ? m.sex : null;
  const care = fIsObj(m.care) ? m.care : {};
  return {
    id: typeof m.id === "string" && /^[\w-]{1,40}$/.test(m.id) ? m.id : familyId(),
    name: fStr(m.name, 30).trim(),
    age: Number.isFinite(age) && age >= 0 && age <= 120 ? Math.round(age) : null,
    sex,
    pregnant: sex !== "male" && m.pregnant === true,
    conditions: PLATE_CONDITIONS.filter((c) => Array.isArray(m.conditions) && m.conditions.includes(c)),
    allergies: fStr(m.allergies, 200),
    diet: MEMBER_DIETS.includes(m.diet) ? m.diet : "",
    relation: MEMBER_RELATIONS.includes(m.relation) ? m.relation : "",
    fromPlate: m.fromPlate === true,
    care: {
      concerns: CARE_CONCERN_KEYS.filter((c) => Array.isArray(care.concerns) && care.concerns.includes(c)).slice(0, 6),
      skin_type: SKIN_TYPES.includes(care.skin_type) ? care.skin_type : null,
      wants: fStr(care.wants, 120),
      details: fStr(care.details, 300),
    },
  };
}

function cleanSources(list) {
  return fList(list, 8).filter(fIsObj).map((s) => ({ name: fStr(s.name, 160), url: fStr(s.url, 400) })).filter((s) => s.name || s.url);
}
function cleanCard(c) {
  if (!fIsObj(c)) return null;
  return {
    id: fStr(c.id, 60), name: fStr(c.name, 120), strength: fStr(c.strength, 120), how: fStr(c.how, 300), why: fStr(c.why, 300),
    cautions: fStr(c.cautions, 400), products: fList(c.products, 4).map((p) => fStr(p, 80)), time: fStr(c.time, 10),
    find: fStr(c.find, 300), pregnancy_note: fStr(c.pregnancy_note, 200), sources: cleanSources(c.sources),
  };
}
function cleanRemedyItem(r) {
  if (!fIsObj(r)) return null;
  return {
    remedy: fStr(r.remedy, 120),
    verdict: CARE_VERDICTS.includes(r.verdict) ? r.verdict : "care",
    evidence: CARE_EVIDENCE.includes(r.evidence) ? r.evidence : "little",
    why: fStr(r.why, 500), how_better: fStr(r.how_better, 300),
    better: fList(r.better, 3).map(cleanCard).filter(Boolean),
    notes: fList(r.notes, 3).map((n) => fStr(n, 300)),
    checked: r.checked === true,
    safety_rule: r.safety_rule === true,
    sources: cleanSources(r.sources),
  };
}
function cleanRemedyCheck(x) {
  if (!fIsObj(x) || !fIsObj(x.result)) return null;
  const remedies = fList(x.result.remedies, 4).map(cleanRemedyItem).filter(Boolean);
  if (!remedies.length) return null;
  return {
    id: typeof x.id === "string" ? x.id.slice(0, 40) : familyId(),
    savedAt: Number(x.savedAt) || 0,
    text: fStr(x.text, 400),
    who: fStr(x.who, 30),
    result: { remedies, red_flags: fList(x.result.red_flags, 6).map((s) => fStr(s, 300)), note: fStr(x.result.note, 400) },
  };
}
function cleanSteps(list) {
  return fList(list, 6).filter(fIsObj).map((s) => ({ active: fStr(s.active, 60), product: fStr(s.product, 80), tip: fStr(s.tip, 200) }));
}
function cleanCarePlan(p) {
  if (!fIsObj(p) || !Array.isArray(p.people)) return null;
  const people = p.people.slice(0, FAMILY_MAX).filter(fIsObj).map((x) => {
    const r = fIsObj(x.routine) ? x.routine : {};
    return {
      name: fStr(x.name, 30), concerns: fList(x.concerns, 6).map((c) => fStr(c, 30)),
      red_flags: fList(x.red_flags, 6).map((s) => fStr(s, 300)), doctor_notes: fList(x.doctor_notes, 6).map((s) => fStr(s, 300)),
      routine: { am: cleanSteps(r.am), pm: cleanSteps(r.pm), shower: cleanSteps(r.shower) },
      summary: fStr(x.summary, 400), ingredients: fList(x.ingredients, 10).map(cleanCard).filter(Boolean),
    };
  });
  if (!people.length) return null;
  return {
    savedAt: Number(p.savedAt) || 0,
    people,
    shopping: fList(p.shopping, 20).filter(fIsObj).map((s) => ({
      name: fStr(s.name, 120), strength: fStr(s.strength, 120), products: fStr(s.products, 80), find: fStr(s.find, 300),
      for: fList(s.for, FAMILY_MAX).map((n) => fStr(n, 30)),
    })),
    note_for_family: fStr(p.note_for_family, 600),
    language: fStr(p.language, 30),
  };
}

function cleanFamily(d) {
  const out = emptyFamily();
  if (!fIsObj(d)) return out;
  out.savedAt = Number(d.savedAt) || 0;
  out.mode = d.mode === "plate" || d.mode === "care" ? d.mode : "";
  out.language = typeof d.language === "string" && d.language.length <= 30 ? d.language : "English";
  out.country = CARE_COUNTRY_KEYS.includes(d.country) ? d.country : "";
  const seen = new Set(); // same id twice is a broken save; same name is allowed here (it's only merged when adding)
  out.members = fList(d.members, FAMILY_MAX).map(cleanMember).filter((m) => m && !seen.has(m.id) && seen.add(m.id));
  out.plate = fIsObj(d.plate) && d.plate.v === 1 ? d.plate : null;
  if (d.migratedFrom === 1) out.migratedFrom = 1;
  const cb = fIsObj(d.careBook) ? d.careBook : {};
  out.careBook = {
    remedies: fList(cb.remedies, 20).map(cleanRemedyCheck).filter(Boolean),
    plan: cleanCarePlan(cb.plan),
  };
  return out;
}

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function persistFamily() {
  const f = familyCache;
  if (!f) return;
  f.savedAt = Date.now();
  try { window.localStorage.setItem(FAMILY_KEY, JSON.stringify(f)); } catch { return; /* storage blocked or full: lasts for this visit */ }
  // v2 is safely written: drop the old v1 save so it can't be migrated again over a cleared or broken v2.
  try { if (storageGet(V1_KEY) !== null) window.localStorage.removeItem(V1_KEY); } catch { /* ignore */ }
}

// Plate's person, from a saved Plate book (parentName + profile).
function memberFromPlate(plate, old) {
  const p = fIsObj(plate.profile) ? plate.profile : {};
  const base = old || { id: familyId(), care: {} };
  const name = fStr(plate.parentName, 20).trim();
  return cleanMember({
    ...base,
    name: name || base.name,
    age: p.age ?? base.age,
    sex: p.sex ?? base.sex,
    pregnant: p.pregnant === true || (p.pregnant === undefined && base.pregnant === true),
    conditions: Array.isArray(p.conditions) ? p.conditions : base.conditions,
    fromPlate: true,
  });
}

function readFamily() {
  if (familyCache) return familyCache;
  let d = null;
  try { d = JSON.parse(storageGet(FAMILY_KEY) || "null"); } catch { d = null; }
  if (fIsObj(d) && d.v === 2) {
    familyCache = cleanFamily(d);
    return familyCache;
  }
  familyCache = emptyFamily();
  let v1 = null;
  try { v1 = JSON.parse(storageGet(V1_KEY) || "null"); } catch { v1 = null; }
  if (fIsObj(v1)) {
    const plate = typeof checkBook === "function" ? checkBook(v1) : null;
    if (plate) {
      familyCache.plate = plate;
      familyCache.mode = "plate";
      familyCache.migratedFrom = 1;
      familyCache.language = typeof plate.language === "string" ? plate.language : "English";
      if (String(plate.parentName || "").trim() || fIsObj(plate.profile)) {
        const m = memberFromPlate(plate, null);
        if (m) familyCache.members = [m];
      }
      persistFamily(); // removes v1 once v2 is written
    }
  }
  return familyCache;
}

function writeFamily(patch) {
  const f = readFamily();
  Object.assign(f, patch || {});
  persistFamily();
  return f;
}

function readPlateRaw() { return readFamily().plate; }

// Called by Plate's saveBook()/clearBook(). Keeps members[0] (Plate's person) in step with Plate's answers.
function writePlate(data) {
  const f = readFamily();
  f.plate = fIsObj(data) ? data : null;
  if (f.plate) {
    const hasPerson = String(f.plate.parentName || "").trim() || fIsObj(f.plate.profile);
    const i = f.members.findIndex((m) => m.fromPlate);
    if (i >= 0) {
      const m = memberFromPlate(f.plate, f.members[i]);
      if (m) f.members[i] = m;
    } else if (hasPerson && f.members.length < FAMILY_MAX) {
      const m = memberFromPlate(f.plate, null);
      if (m) f.members.unshift(m);
    }
    if (typeof f.plate.language === "string") f.language = f.plate.language;
  }
  persistFamily();
}

function setMode(mode) {
  const f = readFamily();
  if (f.mode === mode) return;
  f.mode = mode === "plate" || mode === "care" ? mode : "";
  persistFamily();
}

// "peanut" + "shellfish" → "peanut, shellfish"; if one already contains the other, keep the longer one.
function joinNotes(a, b) {
  const x = (a || "").trim(), y = (b || "").trim();
  if (!x || !y) return x || y;
  if (x.toLowerCase().includes(y.toLowerCase())) return x;
  if (y.toLowerCase().includes(x.toLowerCase())) return y;
  return `${x}, ${y}`.slice(0, 200);
}

function upsertMember(m) {
  const f = readFamily();
  const clean = cleanMember(m);
  if (!clean) return null;
  let i = f.members.findIndex((x) => x.id === clean.id);
  const key = clean.name.toLowerCase();
  if (i < 0 && key) { // adding someone who's already here (same name): update them instead of a duplicate
    i = f.members.findIndex((x) => x.name.trim().toLowerCase() === key);
    if (i >= 0) {
      const old = f.members[i];
      const given = (k) => fIsObj(m) && m[k] !== undefined && m[k] !== null && m[k] !== "";
      const careIn = fIsObj(m.care) ? m.care : {};
      const newCare = Object.fromEntries(Object.entries(clean.care).filter(([k, v]) => careIn[k] !== undefined && (Array.isArray(v) ? v.length : v)));
      // Keep everything we knew; nothing given here wipes it. Allergies are joined, never replaced.
      const merged = cleanMember({
        ...old, id: old.id,
        age: given("age") ? clean.age : old.age,
        sex: given("sex") ? clean.sex : old.sex,
        pregnant: given("pregnant") ? clean.pregnant : old.pregnant,
        conditions: [...new Set([...old.conditions, ...clean.conditions])],
        allergies: joinNotes(old.allergies, clean.allergies),
        diet: given("diet") ? clean.diet : old.diet,
        relation: given("relation") ? clean.relation : old.relation,
        care: { ...old.care, ...newCare },
      });
      f.members[i] = merged;
      persistFamily();
      return merged;
    }
  }
  if (i >= 0) f.members[i] = clean;
  else if (f.members.length < FAMILY_MAX) f.members.push(clean);
  else return null;
  persistFamily();
  return clean;
}

function removeMember(id) {
  const f = readFamily();
  f.members = f.members.filter((m) => m.id !== id);
  persistFamily();
}

function saveRemedyCheck(entry) {
  const f = readFamily();
  const clean = cleanRemedyCheck({ ...entry, id: familyId(), savedAt: Date.now() });
  if (!clean) return null;
  f.careBook.remedies = [clean, ...f.careBook.remedies].slice(0, 20);
  persistFamily();
  return clean;
}

function removeRemedyCheck(id) {
  const f = readFamily();
  f.careBook.remedies = f.careBook.remedies.filter((r) => r.id !== id);
  persistFamily();
}

function saveCarePlan(plan) {
  const f = readFamily();
  const clean = cleanCarePlan({ ...plan, savedAt: Date.now() });
  if (!clean) return null;
  f.careBook.plan = clean;
  persistFamily();
  return clean;
}

function hasCareBook() {
  const cb = readFamily().careBook;
  return Boolean(cb.plan || cb.remedies.length);
}
