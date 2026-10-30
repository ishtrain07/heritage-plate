// One household shopping list: the week plan's groceries plus scanned or added food and skin & hair products,
// with "To buy" and "At home". Saved on this device with the household.

const shopUI = { tab: "buy" };

function weekItems() {
  const plan = typeof state !== "undefined" ? state.plan : null;
  const who = plan ? (plateWhoMember()?.name || "the week plan") : "";
  return (plan?.shopping_list || []).map((s) => ({
    key: `wk:${s.item}`, item: s.item, kind: "food", amount: grams(s.grams), group: SHOP_GROUPS[s.category] || "Other", for: [who], week: true,
  }));
}

function openShopList() {
  const dlg = $("shopDlg");
  if (!dlg.open) dlg.showModal();
  renderShopList();
}

function shopRowHTML(x, home) {
  return `
    <li class="shop-row">
      <label class="shop-check"><input type="checkbox" data-shop-key="${esc(x.key)}" ${home ? "checked" : ""}>
        <span class="shop-t"><b>${esc(x.item)}</b><span class="shop-sub">${[x.amount, x.qty > 1 ? `× ${x.qty}` : "", x.for.filter(Boolean).length ? `for ${x.for.join(", ")}` : ""].filter(Boolean).map(esc).join(" · ")}</span></span>
      </label>
      ${x.week ? "" : `<button type="button" class="shop-x" data-shop-del="${esc(x.key)}" aria-label="Remove ${esc(x.item)}">×</button>`}
    </li>`;
}

function renderShopList() {
  const f = readFamily();
  const home = new Set(f.shopHome);
  const own = f.shopping.map((x) => ({ ...x, key: `own:${x.id}`, amount: "", group: x.kind === "care" ? "Skin & hair" : "From your scans" }));
  const all = [...own, ...weekItems()];
  const isHome = (x) => (x.week ? home.has(x.key) : x.home);
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
    ...weekItems().filter((x) => !home.has(x.key)).map((x) => `${x.item}: ${x.amount}`)];
  return `Nouri shopping list\n${items.map((t) => `- ${t}`).join("\n")}`;
}

async function shareShopList() {
  const text = shopText();
  try { if (navigator.share) { await navigator.share({ title: "Shopping list", text }); return; } } catch (err) { if (err.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Shopping list copied."); } catch { toast("Couldn't copy the list."); }
}

(function initShop() {
  const dlg = $("shopDlg");
  if (!dlg) return;
  dlg.addEventListener("click", onShopClick);
  dlg.addEventListener("change", onShopChange);
  $("shopShare").addEventListener("click", shareShopList);
})();
