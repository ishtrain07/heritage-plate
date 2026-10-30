// Household insights: each person's daily aims (calories, protein, fibre, sodium...), worked out in code by
// /api/insights from published guidance, plus how this week's plan compares. No AI, so it's instant.

const BMI_WORDS = { low: "below the healthy range", healthy: "in the healthy range", overweight: "above the healthy range", obese: "well above the healthy range" };

// The person Plate's week planner knows best gets their height, weight, activity and goals from there.
function insightMember(m, i) {
  const base = { name: memberLabel(m, i), sex: m.sex, age: m.age, pregnant: m.pregnant, conditions: m.conditions || [], goals: [] };
  const plateMember = typeof plateWhoMember === "function" ? plateWhoMember() : null;
  const p = typeof state !== "undefined" && state.profileSet ? state.profile : null;
  if (p && plateMember && plateMember.id === m.id) {
    Object.assign(base, { height_cm: p.height_cm, weight_kg: p.weight_kg, activity: p.activity, ethnicity: p.ethnicity,
      goals: (p.goals || []).filter((g) => g !== "maintain"), sex: p.sex || base.sex, age: p.age || base.age });
  }
  for (const k of Object.keys(base)) if (base[k] === null || base[k] === undefined) delete base[k];
  return base;
}

function insWeekSummary() {
  const plan = typeof state !== "undefined" ? state.plan : null;
  const days = (plan?.days || []).filter((d) => d.totals);
  if (!days.length) return "";
  const avg = (k) => Math.round(days.reduce((s, d) => s + (d.totals[k] || 0), 0) / days.length);
  const who = plateWhoMember()?.name || "the planned person";
  return `
    <div class="ins-week">
      <p class="ins-h">This week's plan for ${esc(who)}, average per day</p>
      <ul class="ins-stats">
        <li><b>${avg("kcal").toLocaleString()}</b><span>kcal${plan.target?.kcal ? ` of ${Number(plan.target.kcal).toLocaleString()}` : ""}</span></li>
        <li><b>${avg("protein_g")} g</b><span>protein</span></li>
        <li><b>${avg("fiber_g")} g</b><span>fibre</span></li>
        <li><b>${avg("sodium_mg").toLocaleString()} mg</b><span>sodium</span></li>
      </ul>
    </div>`;
}

function insPersonCard(p, m, i) {
  const body = p.body ? `BMI ${p.body.bmi}, ${BMI_WORDS[p.body.band] || p.body.band} (${esc(p.body.cutoffs)})` : "";
  const sub = [m.age != null ? `${m.age} years` : "", ...memberLine(m)].filter(Boolean).join(" · ");
  return `
    <article class="ins-person">
      <header class="ins-head">
        <span class="av fam-${(i % 4) + 1}" aria-hidden="true">${esc((p.name[0] || "?").toUpperCase())}</span>
        <span><b class="ins-name">${esc(p.name)}</b><span class="ins-sub">${esc(sub || "No details yet")}</span>${body ? `<span class="ins-sub">${esc(body)}</span>` : ""}</span>
      </header>
      <ul class="ins-aims">${p.aims.map((a) => `
        <li class="ins-aim ins-${esc(a.key)}" title="${esc(a.why)} (${esc(a.source)})">
          <span class="ins-label">${esc(a.label)}</span>
          <b class="ins-val">${esc(a.value)}</b>
          <span class="ins-why">${esc(a.why)} <i>${esc(a.source)}</i></span>
        </li>`).join("")}</ul>
      ${p.focus.length ? `<ul class="ins-focus">${p.focus.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${p.notes.length ? `<details class="ins-notes"><summary>Good to know</summary><ul>${p.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
      ${p.missing.some((k) => k === "height" || k === "weight") && !(m.age != null && m.age < 18)
        ? `<button type="button" class="btn-link ins-more" data-ins-act="details" data-id="${esc(m.id)}">Add height and weight for a personal calorie target</button>` : ""}
    </article>`;
}

async function openInsights() {
  const dlg = $("insightsDlg");
  if (!dlg.open) dlg.showModal();
  const ms = careMembers();
  const body = $("insBody");
  document.querySelector("#insightsDlg .ins-btns").hidden = !ms.length;
  if (!ms.length) {
    body.innerHTML = `<p class="scan-hint">Add the people at home to see their daily aims.</p>
      <button type="button" class="btn btn-primary" data-ins-act="setup">Set up your household</button>`;
    return;
  }
  body.innerHTML = `<p class="scan-status busy"><span class="spinner" aria-hidden="true"></span> Working out everyone's aims…</p>`;
  try {
    const data = await api("/api/insights", { members: ms.map(insightMember) }, 15000);
    const conds = data.household.conditions.map((c) => COND_WORDS[c]);
    body.innerHTML = `
      <div class="ins-summary">
        <span class="ins-chip"><b>${ms.length}</b> ${ms.length === 1 ? "person" : "people"}</span>
        ${conds.length ? `<span class="ins-chip">Cooking for ${esc(conds.join(", "))}</span>` : `<span class="ins-chip">No health conditions noted</span>`}
      </div>
      ${insWeekSummary()}
      ${data.people.map((p, i) => insPersonCard(p, ms[i], i)).join("")}`;
  } catch (err) {
    body.innerHTML = `<p class="scan-status err">${esc(err.message)}</p>`;
  }
}

(function initInsights() {
  const dlg = $("insightsDlg");
  if (!dlg) return;
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    const el = e.target.closest("[data-ins-act]");
    const act = el?.dataset.insAct;
    if (!act) return;
    dlg.close();
    if (act === "book") openCookbook();
    else if (act === "week") runShortcut("plate-week");
    else if (act === "details") goMealsFor(el.dataset.id);
    else if (act === "setup") runShortcut("get-started");
  });
})();
