// Scan & check: a photo of a label (food, skin or hair care), checked for everyone at home.
// Uses globals from family.js, app.js and care.js: $, esc, api, toast, announce, careMembers, memberLabel.

const scanState = { busy: false, image: "", read: "", who: null };
const SCAN_MAX_PX = 1024;
const VERDICT_WORDS = { fine: "Fine", sometimes: "Now and then", check: "Check the label", avoid: "Not for them" };

function openScan() {
  const dlg = $("scanDlg");
  if (!dlg.open) dlg.showModal();
  scanState.who = null;
  renderScanWho();
  if (!scanState.read) { $("scanOut").innerHTML = ""; $("scanStatus").textContent = ""; }
  $("scanFile")?.focus();
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
    const data = await api("/api/scan", { image, text, members: scanPeople(), language: "" }, 130000);
    scanState.read = data.read || text;
    status.className = "scan-status";
    status.textContent = "";
    renderScanResult(data.result);
    loadNews(data.result.product);
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
      ${r.partial ? `<p class="scan-partial" role="alert">We could only read part of this label. Check "What we read" below, or take a closer photo.</p>` : ""}
      ${danger ? `<div class="scan-danger" role="alert"><b>Warning</b><ul>${danger}</ul></div>` : ""}
      <ul class="sv-list" aria-label="For each person">${people}</ul>
      ${r.watch?.length ? `<h4 class="scan-h">Worth knowing</h4><ul class="scan-watch">${r.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${r.instead ? `<p class="scan-instead"><b>Try instead:</b> ${esc(r.instead)}</p>` : ""}
      ${ingredientsHTML(r.ingredients || [])}
      ${addToListHTML(r)}
    </article>
    <details class="scan-read">
      <summary>What we read <span class="opt">fix anything we misread</span></summary>
      <label class="sr-only" for="scanText">Label text</label>
      <textarea id="scanText" rows="6" maxlength="3000">${esc(scanState.read)}</textarea>
      <button type="button" class="btn btn-quiet btn-small" data-scan-act="recheck">Check again</button>
    </details>
    <div class="scan-again"><button type="button" class="btn btn-primary btn-small" data-scan-act="new">Scan another</button></div>`;
}

const TAG_WORDS = { good: "Good", caution: "Caution", avoid: "Avoid", plain: "" };

function ingredientsHTML(list) {
  const shown = list.filter((i) => i.tag !== "plain");
  if (!list.length) return "";
  const counts = ["good", "caution", "avoid"].map((t) => [t, list.filter((i) => i.tag === t).length]).filter(([, n]) => n);
  return `
    <details class="scan-ings" ${shown.some((i) => i.tag === "avoid") ? "open" : ""}>
      <summary>Ingredients <span class="ing-counts">${counts.map(([t, n]) => `<span class="ing-tag ing-${t}">${n} ${TAG_WORDS[t].toLowerCase()}</span>`).join("")}</span></summary>
      <ul class="ing-list">${list.map((i) => `
        <li class="ing-row"><span class="ing-dot ing-${esc(i.tag)}" aria-hidden="true"></span>
          <span class="ing-t"><b>${esc(i.name)}</b>${i.tag !== "plain" ? ` <span class="ing-tag ing-${esc(i.tag)}">${TAG_WORDS[i.tag]}</span>` : ""}${i.note ? `<span class="ing-note">${esc(i.note)}</span>` : ""}</span></li>`).join("")}</ul>
    </details>`;
}

// Add the scanned product to the household list, for the people it suits (they can untick anyone).
function addToListHTML(r) {
  const fits = (r.people || []).filter((p) => p.verdict !== "avoid").map((p) => p.name);
  scanState.last = { item: r.product || "Scanned product", kind: r.kind === "food" ? "food" : "care" };
  const people = (r.people || []).length > 1 || careMembers().length ? `<div class="pick pick-sm scan-for">${(r.people || []).map((p) => `
    <label class="pick-opt"><input type="checkbox" name="scanFor" value="${esc(p.name)}" ${fits.includes(p.name) ? "checked" : ""}><span>${esc(p.name)}</span></label>`).join("")}</div>` : "";
  return `
    <div class="scan-add">
      <p class="scan-h">Add to the shopping list for</p>
      ${people}
      <button type="button" class="btn btn-primary btn-small" data-scan-act="add">Add to list</button>
    </div>`;
}

// "In the news": web results on recalls or recipe changes for this product (Tavily). Never part of the verdict;
// if the search is off, slow or empty, nothing shows.
async function loadNews(product) {
  if (!product || product.length < 3 || /^scanned product$/i.test(product)) return;
  try {
    const items = ((await api("/api/scan/news", { product }, 9000)).items || []).filter((x) => /^https?:\/\//i.test(x.url || ""));
    if (!items.length || !$("scanOut").querySelector(".scan-card")) return;
    $("scanOut").querySelector(".scan-card").insertAdjacentHTML("beforeend", `
      <div class="scan-news"><h4 class="scan-h">In the news</h4>
        <ul>${items.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></li>`).join("")}</ul>
        <p class="scan-news-src">Web search by Tavily; check the source.</p></div>`);
  } catch { /* the scan answer stands on its own */ }
}

function onScanClick(e) {
  const act = e.target.closest("[data-scan-act]")?.dataset.scanAct;
  if (act === "close") closeScan();
  else if (act === "add" && scanState.last) {
    const who = [...document.querySelectorAll('#scanOut input[name="scanFor"]:checked')].map((x) => x.value);
    addShopping({ ...scanState.last, for: who });
    toast(`Added ${scanState.last.item} to the shopping list.`, { label: "View list", run: () => { closeScan(); openShopList(); } });
    e.target.closest("[data-scan-act]").disabled = true;
  }
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
