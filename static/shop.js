// One household shopping list: the week plan's groceries plus scanned or added food and skin & hair products,
// with "To buy" and "At home". Saved on this device with the household.

const shopUI = { tab: "buy" };

// Kitchen units: how many lemons, eggs or onions rather than grams, from typical weights (edible part).
const PIECES = {
  "lemon juice": [30, "lemon", "lemons"], "lime juice": [15, "lime", "limes"], lemon: [60, "lemon", "lemons"],
  egg: [50, "egg", "eggs"], onion: [110, "onion", "onions"], tomato: [100, "tomato", "tomatoes"],
  potato: [150, "potato", "potatoes"], "sweet potato": [200, "sweet potato", "sweet potatoes"], carrot: [60, "carrot", "carrots"],
  apple: [180, "apple", "apples"], banana: [120, "banana", "bananas"], orange: [130, "orange", "oranges"],
  cucumber: [300, "cucumber", "cucumbers"], "bell pepper": [150, "pepper", "peppers"], avocado: [150, "avocado", "avocados"],
  mango: [200, "mango", "mangoes"], pineapple: [900, "pineapple", "pineapples"], garlic: [5, "clove", "cloves"],
  "green chili": [5, "chilli", "chillies"], lettuce: [300, "lettuce", "lettuces"], cauliflower: [600, "cauliflower", "cauliflowers"],
  broccoli: [300, "head of broccoli", "heads of broccoli"], cabbage: [900, "cabbage", "cabbages"], ginger: [30, "thumb", "thumbs"],
};
function kitchenAmount(item, g) {
  const p = PIECES[String(item).toLowerCase()];
  if (!p || !(g > 0)) return grams(g);
  const n = g / p[0];
  const count = n < 0.4 ? (n <= 0.25 ? "¼" : "½") : n < 0.75 ? "½" : n < 1.25 ? "1" : String(Math.ceil(n * 2) / 2).replace(".5", "½");
  const word = count === "1" || count === "½" || count === "¼" ? p[1] : p[2];
  return `${count} ${word} (${grams(g)})`;
}

// The week's groceries, less what's already at home (pantry, in grams).
function weekItems() {
  const plan = typeof state !== "undefined" ? state.plan : null;
  const who = plan ? (plateWhoMember()?.name || "the week plan") : "";
  const pantry = readFamily().pantry || {};
  return (plan?.shopping_list || []).map((s) => {
    const have = num(pantry[s.item]) || 0;
    const need = Math.max(0, s.grams - have);
    return {
      key: `wk:${s.item}`, item: s.item, kind: "food", need, have, full: s.grams,
      amount: need ? kitchenAmount(s.item, need) : "", group: SHOP_GROUPS[s.category] || "Other", for: [who], week: true,
    };
  });
}

function shopRowHTML(x, home) {
  const have = x.week ? `
      <label class="shop-have"><span>Have</span><input type="number" inputmode="numeric" min="0" step="50" data-have="${esc(x.item)}" value="${x.have || ""}" placeholder="0" aria-label="Grams of ${esc(x.item)} already at home"><span>g</span></label>` : "";
  const sub = [x.amount, x.have && x.need ? `you have ${grams(x.have)}` : "", x.qty > 1 ? `× ${x.qty}` : "", x.for.filter(Boolean).length ? `for ${x.for.join(", ")}` : ""];
  return `
    <li class="shop-row">
      <label class="shop-check"><input type="checkbox" data-shop-key="${esc(x.key)}" ${home ? "checked" : ""}>
        <span class="shop-t"><b>${esc(x.item)}</b><span class="shop-sub">${sub.filter(Boolean).map(esc).join(" · ")}</span></span>
      </label>${have}
      ${x.week ? "" : `<button type="button" class="shop-x" data-shop-del="${esc(x.key)}" aria-label="Remove ${esc(x.item)}">×</button>`}
    </li>`;
}

function openShopList() {
  const dlg = $("shopDlg");
  if (!dlg.open) dlg.showModal();
  renderShopList();
}


function renderShopList() {
  const f = readFamily();
  const home = new Set(f.shopHome);
  const own = f.shopping.map((x) => ({ ...x, key: `own:${x.id}`, amount: "", group: x.kind === "care" ? "Skin & hair" : "From your scans" }));
  const all = [...own, ...weekItems()];
  const isHome = (x) => (x.week ? home.has(x.key) || x.need === 0 : x.home);
  const list = all.filter((x) => (shopUI.tab === "home" ? isHome(x) : !isHome(x)));
  const buyN = all.filter((x) => !isHome(x)).length;
  const homeN = all.length - buyN;
  document.querySelectorAll("#shopDlg [data-shop-tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.shopTab === shopUI.tab));
    b.querySelector(".count").textContent = b.dataset.shopTab === "buy" ? buyN : homeN;
  });
  const groups = {};
  list.forEach((x) => { (groups[x.group] ||= []).push(x); });
  const order = ["From your scans", "Skin & hair", ...Object.values(SHOP_GROUPS)];
  const body = $("shopBody");
  if (!all.length) {
    body.innerHTML = `
      <p class="scan-hint">Your list fills itself: plan the week's meals for the groceries, and scan any food or skin-care product to add it.</p>
      <div class="shop-empty-btns">
        <button type="button" class="btn btn-primary btn-small" data-go="plate-week">Plan the week</button>
        <button type="button" class="btn btn-quiet btn-small" data-go="scan">Scan a product</button>
      </div>`;
    return;
  }
  body.innerHTML = list.length ? Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((g) => `
      <section class="shop-group"><h3 class="shop-gh">${esc(g)}</h3><ul class="shop-ul">${groups[g].map((x) => shopRowHTML(x, isHome(x))).join("")}</ul></section>`).join("")
    : `<p class="scan-hint">${shopUI.tab === "home" ? "Tick things off as you buy them; they move here." : "Everything is at home. Nice."}</p>`;
  if (!weekItems().length) body.insertAdjacentHTML("beforeend", `<p class="shop-note">No week plan yet. <button type="button" class="btn-link" data-go="plate-week">Plan the week</button> to add the groceries.</p>`);
}

function onShopChange(e) {
  if (e.target.dataset.have !== undefined) {
    const item = e.target.dataset.have;
    const g = Math.max(0, Math.round(num(e.target.value) || 0));
    updateShopping((f) => { if (g) f.pantry[item] = g; else delete f.pantry[item]; });
    setTimeout(renderShopList, 150);
    return;
  }
  const key = e.target.dataset.shopKey;
  if (!key) return;
  updateShopping((f) => {
    if (key.startsWith("wk:")) {
      f.shopHome = e.target.checked ? [...new Set([...f.shopHome, key])] : f.shopHome.filter((k) => k !== key);
    } else {
      const it = f.shopping.find((x) => `own:${x.id}` === key);
      if (it) it.home = e.target.checked;
    }
  });
  // The week's Shopping list tab shows the same ticks.
  document.querySelectorAll(`#planOut [data-wk-shop="${CSS.escape(key)}"]`).forEach((x) => { x.checked = e.target.checked; });
  setTimeout(renderShopList, 250); // let the tick show before it moves
}

function onShopClick(e) {
  const dlg = $("shopDlg");
  if (e.target === dlg) { dlg.close(); return; }
  const tab = e.target.closest("[data-shop-tab]")?.dataset.shopTab;
  if (tab) { shopUI.tab = tab; renderShopList(); return; }
  const del = e.target.closest("[data-shop-del]")?.dataset.shopDel;
  if (del) { updateShopping((f) => { f.shopping = f.shopping.filter((x) => `own:${x.id}` !== del); }); renderShopList(); return; }
  if (e.target.closest("[data-shop-act=close]")) { dlg.close(); return; }
  if (e.target.closest("[data-go]")) dlg.close(); // the shortcut handler takes it from here
}

function shopText() {
  const f = readFamily();
  const home = new Set(f.shopHome);
  const items = [...f.shopping.filter((x) => !x.home).map((x) => `${x.item}${x.qty > 1 ? ` × ${x.qty}` : ""}`),
    ...weekItems().filter((x) => !home.has(x.key) && x.need > 0).map((x) => `${x.item}: ${x.amount}`)];
  return `Nouri shopping list\n${items.map((t) => `- ${t}`).join("\n")}`;
}

async function shareShopList() {
  const text = shopText();
  try { if (navigator.share) { await navigator.share({ title: "Shopping list", text }); return; } } catch (err) { if (err.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Shopping list copied."); } catch { toast("Couldn't copy the list."); }
}

// Home: what's saved in the family book (dishes made lighter, the week, remedies), one tap to open it.
function renderHomeBook() {
  const box = $("homeBook");
  if (!box) return;
  const dishes = typeof state !== "undefined" ? state.recipes.map((e) => current(e).name) : [];
  const saved = typeof state !== "undefined" && !dishes.length && state.saved ? (state.saved.recipes || []).map((r) => (r.adapted || r.base)?.name).filter(Boolean) : [];
  const names = (dishes.length ? dishes : saved).slice(0, 6);
  const week = typeof state !== "undefined" && (state.plan || state.saved?.plan);
  const remedies = readFamily().careBook.remedies.length;
  box.hidden = !names.length && !week && !remedies;
  if (box.hidden) return;
  $("bookList").innerHTML = [
    ...names.map((n) => `<li><span class="book-ic" aria-hidden="true">🍲</span>${esc(n)}</li>`),
    week ? `<li><span class="book-ic" aria-hidden="true">📅</span>This week's meals and shopping list</li>` : "",
    remedies ? `<li><span class="book-ic" aria-hidden="true">🌿</span>${remedies} home ${remedies === 1 ? "remedy" : "remedies"} checked</li>` : "",
  ].join("");
}

(function initShop() {
  const dlg = $("shopDlg");
  if (!dlg) return;
  dlg.addEventListener("click", onShopClick);
  dlg.addEventListener("change", onShopChange);
  $("shopShare").addEventListener("click", shareShopList);
})();
