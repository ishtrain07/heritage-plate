// First-run setup: who's at home, their names and ages, then goals. Three short steps, all skippable.
// Weight, height, skin and hair are asked later, only when a feature needs them.

const setup = { step: 1, kind: "family", count: 3, people: [] };
const SETUP_COUNTS = [[1, "Just me"], [2, "2 people"], [3, "3–4 people"], [5, "5 or more"]];
const SETUP_COND_PICK = [["diabetes", "Diabetes"], ["bp", "Blood pressure"], ["cholesterol", "Cholesterol"]];
const SETUP_GOAL_PICK = [["lose_weight", "Lose weight"], ["build_muscle", "Build muscle"], ["steady_sugar", "Steady energy"]];
const SETUP_CONDS = ["diabetes", "bp", "cholesterol"];

function openSetup() {
  Object.assign(setup, { step: 1, kind: "family", count: 3, people: [] });
  renderSetup();
  $("setupDlg").showModal();
}

function renderSetup() {
  const body = $("setupBody");
  $("setupStep").textContent = `Step ${setup.step} of 3`;
  document.querySelectorAll(".setup-prog span").forEach((s, i) => s.classList.toggle("on", i < setup.step));
  $("setupMsg").textContent = "";
  if (setup.step === 1) {
    body.innerHTML = `
      <h3 class="setup-q">Who's at home?</h3>
      <p class="setup-sub">You can add or edit people later.</p>
      <div class="pick pick-sm setup-kind">${[["family", "Family"], ["flatmates", "Flatmates"]].map(([v, l]) => `
        <label class="pick-opt"><input type="radio" name="setupKind" value="${v}" ${setup.kind === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
      <div class="setup-radios">${SETUP_COUNTS.map(([n, l]) => `
        <label class="setup-radio"><input type="radio" name="setupCount" value="${n}" ${setup.count === n ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>`;
  } else if (setup.step === 2) {
    const n = Math.min(setup.count === 5 ? 5 : setup.count === 3 ? 4 : setup.count, FAMILY_MAX);
    const hints = setup.kind === "flatmates" ? ["Me", "Flatmate", "Flatmate", "Flatmate", "Flatmate"] : ["Me", "Mum", "Dad", "Nani", "Brother"];
    while (setup.people.length < n) setup.people.push({ name: "", age: "" });
    setup.people.length = n;
    body.innerHTML = `
      <h3 class="setup-q">What do you call them?</h3>
      <p class="setup-sub">Leave a row empty to skip it. Age is needed for safe portions and skin products, especially for children.</p>
      <div class="setup-people">${setup.people.map((p, i) => `
        <div class="setup-person">
          <label class="field"><span class="field-label">Name</span><input type="text" maxlength="30" data-p="${i}" data-k="name" value="${esc(p.name)}" placeholder="${hints[i]}"></label>
          <label class="field setup-age"><span class="field-label">Age</span><input type="number" inputmode="numeric" min="0" max="120" data-p="${i}" data-k="age" value="${esc(p.age)}"></label>
        </div>`).join("")}</div>`;
  } else {
    const named = setup.people.filter((p) => p.name.trim());
    body.innerHTML = `
      <h3 class="setup-q">Health conditions and goals</h3>
      <p class="setup-sub">Pick any for each person, or skip. Meals, scans and daily aims use them.</p>
      ${named.map((p, i) => {
        const chips = (list) => list.map(([v, l]) => `
          <label class="pick-opt"><input type="checkbox" data-g="${i}" value="${v}"><span>${l}</span></label>`).join("");
        return `
        <div class="setup-goals" role="group" aria-label="${esc(p.name.trim())}">
          <p class="setup-person-name">${esc(p.name.trim())}</p>
          <fieldset class="setup-sub-fs"><legend class="field-label">Health conditions</legend><div class="pick pick-sm">${chips(SETUP_COND_PICK)}</div></fieldset>
          <fieldset class="setup-sub-fs"><legend class="field-label">Goals</legend><div class="pick pick-sm">${chips(SETUP_GOAL_PICK)}</div></fieldset>
        </div>`;
      }).join("")}`;
  }
  body.querySelector("input")?.focus();
}

function readSetupStep() {
  if (setup.step === 1) {
    setup.kind = document.querySelector('input[name="setupKind"]:checked')?.value || "family";
    setup.count = Number(document.querySelector('input[name="setupCount"]:checked')?.value || 3);
  } else if (setup.step === 2) {
    document.querySelectorAll("#setupBody [data-p]").forEach((el) => { setup.people[Number(el.dataset.p)][el.dataset.k] = el.value; });
  }
}

function finishSetup() {
  const named = setup.people.filter((p) => p.name.trim());
  named.forEach((p, i) => {
    const picked = [...document.querySelectorAll(`#setupBody input[data-g="${i}"]:checked`)].map((x) => x.value);
    const conditions = picked.filter((v) => SETUP_CONDS.includes(v));
    const goals = picked.filter((v) => !SETUP_CONDS.includes(v));
    const word = p.name.trim().toLowerCase();
    const relation = { me: "me", mum: "mum", mom: "mum", mother: "mum", maa: "mum", dad: "dad", papa: "dad", father: "dad",
      nani: "grandparent", nana: "grandparent", dadi: "grandparent", dada: "grandparent", flatmate: "flatmate", partner: "partner" }[word] || (setup.kind === "flatmates" ? "flatmate" : "");
    upsertMember({ name: p.name.trim(), relation, age: p.age === "" ? null : Number(p.age), conditions, goals, care: {} });
  });
  $("setupDlg").close();
  care.famAdding = false;
  renderHomeFamily();
  renderWho();
  scrollToEl($("homeFamily"));
  toast(named.length ? `Your household is set up: ${named.map((p) => p.name.trim()).join(", ")}.` : "You can add people any time.");
}

function onSetupSubmit(e) {
  e.preventDefault();
  readSetupStep();
  const noAge = setup.step === 2 ? setup.people.findIndex((p) => p.name.trim() && (p.age === "" || !(Number(p.age) >= 0 && Number(p.age) <= 120))) : -1;
  if (noAge >= 0) {
    $("setupMsg").className = "msg warn";
    $("setupMsg").textContent = `Add ${setup.people[noAge].name.trim()}'s age.`;
    $("setupBody").querySelector(`input[data-p="${noAge}"][data-k="age"]`)?.focus();
    return;
  }
  if (setup.step === 2 && !setup.people.some((p) => p.name.trim())) {
    $("setupMsg").className = "msg warn";
    $("setupMsg").textContent = "Add at least one name, like Me or Mum.";
    $("setupBody").querySelector("input")?.focus();
    return;
  }
  if (setup.step === 1 && setup.count === 1) { setup.people = [{ name: "Me", age: "" }]; setup.step = 3; renderSetup(); return; }
  if (setup.step < 3) { setup.step++; renderSetup(); } else finishSetup();
}

function onSetupClick(e) {
  const act = e.target.closest("[data-setup-act]")?.dataset.setupAct;
  if (act === "close") $("setupDlg").close();
  else if (act === "skip") {
    readSetupStep();
    if (setup.step === 3) finishSetup();
    else if (setup.step === 2 && setup.people.some((p) => p.name.trim())) { setup.step = 3; renderSetup(); }
    else { $("setupDlg").close(); runShortcut("get-started-form"); }
  }
}

(function initSetup() {
  const dlg = $("setupDlg");
  if (!dlg) return;
  $("setupForm").addEventListener("submit", onSetupSubmit);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); else onSetupClick(e); });
})();
