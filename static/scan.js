// Scan & check: a photo of a label (food, skin or hair care), checked for everyone at home.
// Uses globals from family.js, app.js and care.js: $, esc, api, toast, announce, careMembers, memberLabel.

const scanState = { busy: false, image: "", read: "", who: null };
const SCAN_MAX_PX = 1024;
const VERDICT_WORDS = { fine: "Fine", sometimes: "Now and then", avoid: "Not for them" };

function openScan() {
  const dlg = $("scanDlg");
  if (!dlg.open) dlg.showModal();
  scanState.who = null;
  renderScanWho();
  if (!scanState.read) { $("scanOut").innerHTML = ""; $("scanStatus").textContent = ""; }
  dlg.querySelector(".scan-drop")?.focus();
}

function closeScan() { $("scanDlg").close(); }

function scanPeople() {
  const ms = careMembers();
  const chosen = scanState.who ? ms.filter((m) => scanState.who.has(m.id)) : ms;
  return chosen.map((m, i) => ({
    name: memberLabel(m, ms.indexOf(m) >= 0 ? ms.indexOf(m) : i).slice(0, 30),
    age: m.age, pregnant: m.pregnant, diet: m.diet || "non_veg", allergies: m.allergies || "",
    conditions: m.conditions || [], concerns: m.care?.concerns || [],
  }));
}

function renderScanWho() {
  const ms = careMembers();
  const box = $("scanWho");
  if (!ms.length) {
    box.innerHTML = `<p class="scan-hint">Checking for you. <button type="button" class="btn-link" data-scan-act="family">Add your household</button> to check for everyone at once.</p>`;
    return;
  }
  box.innerHTML = `<fieldset class="scan-fs"><legend class="field-label">Check it for</legend><div class="pick pick-sm">${ms.map((m, i) => `
    <label class="pick-opt"><input type="checkbox" name="scanWho" value="${esc(m.id)}" ${!scanState.who || scanState.who.has(m.id) ? "checked" : ""}><span>${esc(memberLabel(m, i))}</span></label>`).join("")}</div></fieldset>`;
}

// Shrink the photo in the browser first: faster to send, cheaper to read, and well under the size cap.
async function downscale(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That photo couldn't be opened. Please try another."));
      el.src = url;
    });
    const scale = Math.min(1, SCAN_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

async function runScan({ image = "", text = "" }) {
  if (scanState.busy) return;
  scanState.busy = true;
  const status = $("scanStatus");
  $("scanOut").innerHTML = "";
  status.className = "scan-status busy";
  status.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${image ? "Reading the label…" : "Checking…"}`;
  try {
    // Notes stay in English: the label itself is usually in English, and it keeps the check simple.
    const data = await api("/api/scan", { image, text, members: scanPeople(), language: "" }, 60000);
    scanState.read = data.read || text;
    status.className = "scan-status";
    status.textContent = "";
    renderScanResult(data.result);
    announce(`${data.result.product || "Label"} checked.`);
  } catch (err) {
    status.className = "scan-status err";
    status.textContent = err.message || "Something went wrong. Please try again.";
  } finally { scanState.busy = false; }
}

function renderScanResult(r) {
  const people = (r.people || []).map((p) => `
    <li class="sv sv-${esc(p.verdict)}">
      <span class="sv-name">${esc(p.name)}</span>
      <span class="sv-pill">${esc(VERDICT_WORDS[p.verdict] || p.verdict)}</span>
      <span class="sv-why">${(p.reasons || []).map(esc).join(" ")}</span>
    </li>`).join("");
  const danger = (r.danger || []).map((d) => `<li><b>${esc(d.name)}:</b> ${esc(d.why)}</li>`).join("");
  $("scanOut").innerHTML = `
    <article class="scan-card">
      <p class="scan-kind">${r.kind === "food" ? "Food" : "Skin &amp; hair care"}</p>
      <h3 class="scan-product">${esc(r.product || "This product")}</h3>
      ${r.summary ? `<p class="scan-summary">${esc(r.summary)}</p>` : ""}
      ${danger ? `<div class="scan-danger" role="alert"><b>Warning</b><ul>${danger}</ul></div>` : ""}
      <ul class="sv-list" aria-label="For each person">${people}</ul>
      ${r.watch?.length ? `<h4 class="scan-h">Worth knowing</h4><ul class="scan-watch">${r.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${r.instead ? `<p class="scan-instead"><b>Try instead:</b> ${esc(r.instead)}</p>` : ""}
    </article>
    <details class="scan-read">
      <summary>What we read <span class="opt">fix anything we misread</span></summary>
      <label class="sr-only" for="scanText">Label text</label>
      <textarea id="scanText" rows="6" maxlength="3000">${esc(scanState.read)}</textarea>
      <button type="button" class="btn btn-quiet btn-small" data-scan-act="recheck">Check again</button>
    </details>
    <div class="scan-again"><button type="button" class="btn btn-primary btn-small" data-scan-act="new">Scan another</button></div>`;
}

function onScanClick(e) {
  const act = e.target.closest("[data-scan-act]")?.dataset.scanAct;
  if (act === "close") closeScan();
  else if (act === "type") {
    scanState.read = "";
    $("scanOut").innerHTML = `
      <label class="field"><span class="field-label">Ingredients, as printed on the label</span>
        <textarea id="scanText" rows="5" maxlength="3000" placeholder="Ingredients: wheat flour, sugar, palm oil, milk solids…"></textarea></label>
      <button type="button" class="btn btn-primary btn-small" data-scan-act="recheck">Check it</button>`;
    $("scanText").focus();
  } else if (act === "recheck") {
    const text = ($("scanText")?.value || "").trim();
    if (text.length < 3) { $("scanText")?.focus(); return; }
    runScan({ text });
  } else if (act === "new") {
    scanState.read = "";
    $("scanOut").innerHTML = "";
    $("scanFile").click();
  } else if (act === "family") {
    closeScan();
    runShortcut("get-started");
  }
}

function onScanWhoChange(e) {
  if (e.target.name !== "scanWho") return;
  scanState.who = new Set([...document.querySelectorAll('#scanWho input[name="scanWho"]:checked')].map((x) => x.value));
}

async function onScanFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast("Please choose a photo."); return; }
  try {
    const image = await downscale(file);
    runScan({ image });
  } catch (err) {
    $("scanStatus").className = "scan-status err";
    $("scanStatus").textContent = err.message;
  }
}

(function initScan() {
  const dlg = $("scanDlg");
  if (!dlg) return;
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeScan(); else onScanClick(e); });
  dlg.addEventListener("change", onScanWhoChange);
  $("scanFile").addEventListener("change", onScanFile);
})();
