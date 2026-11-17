// Orders tab: order list, order editor, courier hand-off, customer messages, invoices.
import { formatPrice } from "./catalog.js";
import {
  COURIERS, COURIER_COLUMNS, DISTRICTS, PAYMENT_METHODS, STATUSES, allowedStatuses, courierRows, customerChatLink,
  deliveryCharge, isOpen, itemFor, localPhone, newOrder, nextStatus, orderIssues, orderTotals, setStatus, statusLabel, summary,
} from "./orders.js";
import { parseAmount } from "./parser.js";

const $ = id => document.getElementById(id);
let shop = null;
let ctx = null;
let editing = null;
let editingIsNew = false;
let chargeTouched = false;
const view = { status: "open", text: "" };

const NEXT_ACTION = { new: "Confirm", confirmed: "Mark packed", packed: "Hand to courier", shipped: "Mark delivered" };

function money(amount) {
  const value = Number(parseAmount(amount) ?? amount) || 0;
  if (shop.currency === "BDT") return `৳${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: shop.currency }).format(value); } catch { return formatPrice(value, shop.currency); }
}

const fill = (select, options, placeholder) => {
  select.replaceChildren(...(placeholder ? [new Option(placeholder, "")] : []), ...options.map(([v, l]) => new Option(l, v)));
};

// ------------------------------------------------------------------ setup

export function initOrders(context) {
  ctx = context; // { status, download, save, products: () => [] }
  $("new-order").addEventListener("click", () => openOrder(newOrder(shop, {
    customer: { name: "", phone: "", address: "", district: "", area: "" },
    courier: { name: shop.courier || "", trackingId: "", trackingUrl: "", charge: "" },
  }), true));
  $("order-search").addEventListener("input", e => { view.text = e.target.value.trim().toLowerCase(); renderOrders(); });
  $("courier-sheet").addEventListener("click", exportCourierSheet);
  $("export-orders").addEventListener("click", exportOrders);

  const form = $("order-form");
  const district = form.elements.district;
  district.replaceChildren(new Option("Choose district", ""), ...Object.entries(DISTRICTS).map(([division, list]) => {
    const group = document.createElement("optgroup");
    group.label = `${division} division`;
    group.append(...list.map(d => new Option(d, d)));
    return group;
  }));
  fill(form.elements.method, PAYMENT_METHODS);
  fill(form.elements.courier, COURIERS.map(c => [c, c]), "Not yet");
  fill($("ship-form").elements.courier, COURIERS.map(c => [c, c]));

  form.addEventListener("input", event => {
    readForm();
    if (event.target.name === "deliveryCharge") chargeTouched = true;
    renderTotals();
    renderIssues();
  });
  district.addEventListener("change", () => {
    if (!chargeTouched) {
      editing.deliveryCharge = deliveryCharge(shop, district.value);
      form.elements.deliveryCharge.value = editing.deliveryCharge;
      renderTotals();
    }
  });
  $("pick-product").addEventListener("change", renderVariantPicker);
  $("pick-add").addEventListener("click", addPickedItem);
  form.addEventListener("submit", event => {
    event.preventDefault();
    readForm();
    saveOrder();
    $("order-dialog").close();
  });
  $("order-delete").addEventListener("click", () => {
    if (editingIsNew) { $("order-dialog").close(); return; }
    if (!confirm(`Delete order ${editing.number}? Stock taken by it is put back.`)) return;
    const changed = setStatus(editing, "cancelled", ctx.products());
    shop.orders = shop.orders.filter(o => o.id !== editing.id);
    persist(changed.length > 0);
    $("order-dialog").close();
    ctx.status(`Order ${editing.number} deleted.`);
  });
  $("order-print").addEventListener("click", () => { readForm(); printInvoice(editing); });

  $("ship-form").addEventListener("submit", event => {
    event.preventDefault();
    const order = shop.orders.find(o => o.id === $("ship-form").dataset.order);
    const data = Object.fromEntries(new FormData(event.target));
    Object.assign(order.courier, { name: data.courier, trackingId: data.trackingId.trim(), trackingUrl: data.trackingUrl.trim() });
    shop.courier = data.courier;
    const changed = setStatus(order, "shipped", ctx.products());
    persist(changed.length > 0);
    $("ship-dialog").close();
    if (data.notify) openChat(order);
    ctx.status(`${order.number} is with ${order.courier.name}.`);
  });
}

export function openOrders(catalog) {
  shop = catalog;
  shop.orders ||= [];
  view.status = "open";
  view.text = "";
  $("order-search").value = "";
  renderOrders();
}

function persist(productsChanged = false) {
  ctx.save(shop);
  renderOrders();
  if (productsChanged) ctx.productsChanged();
}

// ------------------------------------------------------------------ list

const FILTERS = [["open", "Open"], ["new", "New"], ["confirmed", "Confirmed"], ["packed", "Packed"], ["shipped", "With courier"],
  ["delivered", "Delivered"], ["returned", "Returned"], ["cancelled", "Cancelled"], ["all", "All"]];

function matches(order) {
  if (view.status === "open" && !isOpen(order.status)) return false;
  if (!["open", "all"].includes(view.status) && order.status !== view.status) return false;
  if (!view.text) return true;
  const c = order.customer;
  return [order.number, c.name, c.phone, localPhone(c.phone), c.district, c.area, order.courier.trackingId]
    .join(" ").toLowerCase().includes(view.text);
}

export function renderOrders() {
  if (!shop) return;
  const orders = shop.orders;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const s = summary(orders, startOfDay.getTime());
  $("tab-orders-count").textContent = orders.filter(o => isOpen(o.status)).length || "";
  const stat = (label, value, filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stat";
    button.innerHTML = "<strong></strong><span></span>";
    button.querySelector("strong").textContent = value;
    button.querySelector("span").textContent = label;
    if (filter) button.addEventListener("click", () => { view.status = filter; renderOrders(); });
    else button.disabled = true;
    return button;
  };
  $("order-stats").replaceChildren(
    stat("to confirm", s.toConfirm, "new"),
    stat("to pack and ship", s.toShip, "confirmed"),
    stat("with courier", s.withCourier, "shipped"),
    stat("cash to collect", money(s.codPending), "shipped"),
  );
  $("order-stats").hidden = orders.length === 0;

  const counts = Object.fromEntries(FILTERS.map(([key]) => [key,
    key === "all" ? orders.length : key === "open" ? orders.filter(o => isOpen(o.status)).length : orders.filter(o => o.status === key).length]));
  $("status-filter").replaceChildren(...FILTERS.filter(([key]) => ["open", "all"].includes(key) || counts[key]).map(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.setAttribute("aria-pressed", String(view.status === key));
    button.textContent = `${label} ${counts[key]}`;
    button.addEventListener("click", () => { view.status = key; renderOrders(); });
    return button;
  }));
  $("status-filter").hidden = orders.length === 0;

  const shown = orders.filter(matches).sort((a, b) => b.created - a.created);
  $("order-list").replaceChildren(...shown.map(orderCard));
  $("orders-empty").hidden = orders.length > 0;
  if (orders.length && !shown.length) {
    const none = document.createElement("p");
    none.className = "empty";
    none.textContent = "No orders match.";
    $("order-list").append(none);
  }
}

function orderCard(order) {
  const totals = orderTotals(order);
  const card = document.createElement("article");
  card.className = `order-card status-${order.status}`;

  const head = document.createElement("div");
  head.className = "order-head";
  const number = document.createElement("strong");
  number.textContent = order.number;
  const pill = document.createElement("span");
  pill.className = `pill ${order.status}`;
  pill.textContent = statusLabel(order.status);
  const date = document.createElement("span");
  date.className = "help";
  date.textContent = new Date(order.created).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  head.append(number, pill, date);

  const who = document.createElement("p");
  who.className = "order-who";
  who.textContent = [order.customer.name || "No name", localPhone(order.customer.phone), [order.customer.area, order.customer.district].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const items = document.createElement("p");
  items.className = "help order-items-line";
  items.textContent = order.items.map(i => `${i.title}${i.option ? ` (${i.option})` : ""} × ${i.qty}`).join(", ") || "No products";
  const money_ = document.createElement("p");
  money_.className = "order-money";
  money_.textContent = `Total ${money(totals.total)}` + (totals.collect ? ` · collect ${money(totals.collect)}` : " · paid");
  if (order.status === "shipped" && order.courier.name) money_.textContent += ` · ${order.courier.name}${order.courier.trackingId ? ` ${order.courier.trackingId}` : ""}`;

  const actions = document.createElement("div");
  actions.className = "actions";
  const next = nextStatus(order.status);
  if (next) {
    const advance = document.createElement("button");
    advance.type = "button";
    advance.textContent = NEXT_ACTION[order.status];
    advance.addEventListener("click", () => advanceOrder(order));
    actions.append(advance);
  }
  if (customerChatLink(order, shop, shop.language || "bn")) {
    const chat = document.createElement("button");
    chat.type = "button";
    chat.className = "secondary";
    chat.textContent = "WhatsApp customer";
    chat.addEventListener("click", () => openChat(order));
    actions.append(chat);
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary";
  edit.textContent = "Open";
  edit.addEventListener("click", () => openOrder(structuredClone(order), false));
  actions.append(edit);

  card.append(head, who, items, money_, actions);
  return card;
}

function advanceOrder(order) {
  const next = nextStatus(order.status);
  if (next === "confirmed") {
    const issues = orderIssues(order);
    if (issues.length) { ctx.status(`${order.number}: ${issues[0]}.`, true); openOrder(structuredClone(order), false); return; }
  }
  if (next === "shipped") {
    const form = $("ship-form");
    form.dataset.order = order.id;
    form.elements.courier.value = order.courier.name || shop.courier || COURIERS[0];
    form.elements.trackingId.value = order.courier.trackingId || "";
    form.elements.trackingUrl.value = order.courier.trackingUrl || "";
    $("ship-summary").textContent = `${order.number} · ${order.customer.name} · ${order.customer.district} · collect ${money(orderTotals(order).collect)}`;
    $("ship-dialog").showModal();
    form.elements.trackingId.focus();
    return;
  }
  const changed = setStatus(order, next, ctx.products());
  persist(changed.length > 0);
  ctx.status(`${order.number}: ${statusLabel(next)}.`);
  if (["confirmed", "delivered"].includes(next) && normalizeOk(order)) openChat(order);
}

const normalizeOk = order => Boolean(customerChatLink(order, shop, "en"));

function openChat(order) {
  const link = customerChatLink(order, shop, shop.language || "bn");
  if (!link) { ctx.status("Add the customer's mobile number to message them.", true); return; }
  window.open(link, "_blank", "noopener");
}

// ------------------------------------------------------------------ editor

function openOrder(order, isNew) {
  editing = order;
  editingIsNew = isNew;
  chargeTouched = !isNew;
  const form = $("order-form");
  const c = order.customer;
  Object.entries({ name: c.name, phone: c.phone, district: c.district, area: c.area, address: c.address, note: order.note,
    deliveryCharge: order.deliveryCharge, discount: order.discount || "", method: order.payment.method,
    advance: order.payment.advance || "", transactionId: order.payment.transactionId || "",
    courier: order.courier.name, trackingId: order.courier.trackingId, trackingUrl: order.courier.trackingUrl })
    .forEach(([name, value]) => { form.elements[name].value = value ?? ""; });
  const statuses = [order.status, ...allowedStatuses(order.status)];
  fill(form.elements.status, STATUSES.filter(([s]) => statuses.includes(s)));
  form.elements.status.value = order.status;
  $("order-title").textContent = isNew ? "New order" : "Order";
  $("order-number").textContent = order.number;
  $("order-delete").textContent = isNew ? "Discard" : "Delete";
  renderProductPicker();
  renderItems();
  renderTotals();
  renderIssues();
  renderHistory();
  $("order-dialog").showModal();
  if (isNew) form.elements.name.focus();
}

function readForm() {
  const f = $("order-form").elements;
  Object.assign(editing.customer, { name: f.name.value, phone: f.phone.value, district: f.district.value, area: f.area.value, address: f.address.value });
  editing.note = f.note.value;
  editing.deliveryCharge = f.deliveryCharge.value;
  editing.discount = f.discount.value;
  Object.assign(editing.payment, { method: f.method.value, advance: f.advance.value, transactionId: f.transactionId.value });
  Object.assign(editing.courier, { name: f.courier.value, trackingId: f.trackingId.value.trim(), trackingUrl: f.trackingUrl.value.trim() });
  editing.wantedStatus = f.status.value;
}

function saveOrder() {
  const wanted = editing.wantedStatus;
  delete editing.wantedStatus;
  if (wanted !== editing.status && wanted === "confirmed" && orderIssues(editing).length) {
    ctx.status(`Saved as ${statusLabel(editing.status)}: ${orderIssues(editing)[0]}.`, true);
  }
  let changed = [];
  const index = shop.orders.findIndex(o => o.id === editing.id);
  const stored = index >= 0 ? shop.orders[index] : null;
  // Stock follows the stored order, so edit the stored copy's status through setStatus.
  if (wanted && wanted !== editing.status && !(wanted === "confirmed" && orderIssues(editing).length)) {
    changed = setStatus(editing, wanted, ctx.products());
  }
  if (stored) shop.orders[index] = editing;
  else shop.orders.push(editing);
  persist(changed.length > 0);
  ctx.status(`Order ${editing.number} saved.`);
}

function renderProductPicker() {
  const select = $("pick-product");
  const products = ctx.products().filter(p => p.title);
  select.replaceChildren(new Option(products.length ? "Choose a product…" : "Add products first", ""),
    ...products.map(p => new Option(`${p.title} — ${money(p.salePrice || p.price)}`, p.id)));
  renderVariantPicker();
}

function renderVariantPicker() {
  const product = ctx.products().find(p => p.id === $("pick-product").value);
  const select = $("pick-variant");
  const variants = product?.variants || [];
  select.replaceChildren(...variants.map(v => {
    const stock = v.quantity === "" || v.quantity === undefined ? "" : ` · ${v.quantity} left`;
    return new Option(`${[v.color, v.size].filter(Boolean).join(" / ")}${stock}`, v.sku);
  }));
  select.parentElement.hidden = variants.length === 0;
}

function addPickedItem() {
  const product = ctx.products().find(p => p.id === $("pick-product").value);
  if (!product) { ctx.status("Choose a product first.", true); return; }
  const variant = product.variants.find(v => v.sku === $("pick-variant").value) || null;
  const qty = Math.max(1, Number($("pick-qty").value) || 1);
  const same = editing.items.find(i => i.sku === (variant ? variant.sku : product.sku));
  if (same) same.qty = Number(same.qty) + qty;
  else editing.items.push(itemFor(product, variant, qty));
  $("pick-qty").value = 1;
  renderItems();
  renderTotals();
  renderIssues();
}

function renderItems() {
  $("order-items").replaceChildren(...editing.items.map((item, index) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = item.title + (item.option ? ` (${item.option})` : "");
    const small = document.createElement("div");
    small.className = "sku";
    small.textContent = item.sku;
    name.append(small);
    const cell = (field, attrs) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      Object.assign(input, attrs);
      input.value = item[field];
      input.setAttribute("aria-label", `${field} of ${item.title}`);
      input.addEventListener("input", () => { item[field] = field === "qty" ? Math.max(1, Number(input.value) || 1) : input.value; renderAmount(); renderTotals(); });
      td.append(input);
      return td;
    };
    const amount = document.createElement("td");
    const renderAmount = () => { amount.textContent = money((Number(parseAmount(item.price)) || 0) * item.qty); };
    renderAmount();
    const remove = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.textContent = "✕";
    button.setAttribute("aria-label", `Remove ${item.title}`);
    button.addEventListener("click", () => { editing.items.splice(index, 1); renderItems(); renderTotals(); renderIssues(); });
    remove.append(button);
    tr.append(name, cell("qty", { type: "number", min: 1, className: "w-qty" }), cell("price", { inputMode: "decimal", className: "w-price" }), amount, remove);
    return tr;
  }));
}

function renderTotals() {
  const t = orderTotals(editing);
  const rows = [["Products", money(t.subtotal)], ["Delivery", money(editing.deliveryCharge || 0)]];
  if (Number(parseAmount(editing.discount)) > 0) rows.push(["Discount", `− ${money(editing.discount)}`]);
  rows.push(["Total", money(t.total)]);
  if (t.advance) rows.push(["Paid in advance", money(t.advance)]);
  rows.push([editing.payment.method === "cod" ? "Courier collects" : "To collect", money(t.collect)]);
  $("order-totals").replaceChildren(...rows.flatMap(([label, value], i) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (label === "Total" || i === rows.length - 1) { dt.className = dd.className = "strong"; }
    return [dt, dd];
  }));
}

/** Items asking for more than the stock left (only before the order has taken its stock). */
function stockWarnings(order) {
  if (order.stockTaken) return [];
  return order.items.flatMap(item => {
    const product = ctx.products().find(p => p.id === item.productId);
    const target = product?.variants.find(v => v.sku === item.sku) || (product?.sku === item.sku ? product : null);
    if (!target || target.quantity === "" || target.quantity === undefined) return [];
    const left = Number(target.quantity) || 0;
    const name = `${item.title}${item.option ? ` (${item.option})` : ""}`;
    return Number(item.qty) > left ? [left ? `Only ${left} of ${name} left in stock` : `${name} is out of stock`] : [];
  });
}

function renderIssues() {
  $("order-issues").replaceChildren(...[...stockWarnings(editing), ...orderIssues(editing)].map(text => {
    const li = document.createElement("li");
    li.className = "warning";
    li.textContent = text;
    return li;
  }));
}

function renderHistory() {
  $("order-history").replaceChildren(...editing.history.map(h => {
    const li = document.createElement("li");
    li.textContent = `${statusLabel(h.status)} · ${new Date(h.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
    return li;
  }));
}

// ------------------------------------------------------------------ exports and printing

function sheet(rows, columns, name) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  ws["!cols"] = columns.map(c => ({ wch: /Address|Description/.test(c) ? 40 : 16 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, name);
  return book;
}

function exportCourierSheet() {
  const packed = shop.orders.filter(o => o.status === "packed");
  if (!packed.length) { ctx.status("No packed orders. Mark orders as packed when they are ready for the courier.", true); return; }
  const problems = packed.filter(o => orderIssues(o).length);
  if (problems.length && !confirm(`${problems.length} packed order${problems.length > 1 ? "s are" : " is"} missing customer details (${problems.map(o => o.number).join(", ")}). Download anyway?`)) return;
  XLSX.writeFile(sheet(courierRows(packed), COURIER_COLUMNS, "Courier"), `${shop.code.toLowerCase()}-courier-${new Date().toISOString().slice(0, 10)}.xlsx`);
  ctx.status(`Courier sheet downloaded with ${packed.length} order${packed.length > 1 ? "s" : ""}.`);
}

function exportOrders() {
  if (!shop.orders.length) { ctx.status("No orders yet.", true); return; }
  const columns = ["Order", "Date", "Status", "Customer", "Phone", "District", "Area", "Address", "Items", "Products", "Delivery", "Discount", "Total",
    "Payment", "Advance", "Collect", "Courier", "Tracking"];
  const rows = shop.orders.map(o => {
    const t = orderTotals(o);
    return {
      Order: o.number, Date: new Date(o.created).toISOString().slice(0, 16).replace("T", " "), Status: statusLabel(o.status),
      Customer: o.customer.name, Phone: localPhone(o.customer.phone), District: o.customer.district, Area: o.customer.area, Address: o.customer.address,
      Items: o.items.map(i => `${i.sku} x${i.qty}`).join(", "), Products: t.subtotal, Delivery: Number(parseAmount(o.deliveryCharge)) || 0,
      Discount: Number(parseAmount(o.discount)) || 0, Total: t.total,
      Payment: (PAYMENT_METHODS.find(([m]) => m === o.payment.method) || [, o.payment.method])[1], Advance: t.advance, Collect: t.collect,
      Courier: o.courier.name, Tracking: o.courier.trackingId,
    };
  });
  XLSX.writeFile(sheet(rows, columns, "Orders"), `${shop.code.toLowerCase()}-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
  ctx.status(`${rows.length} orders downloaded.`);
}

const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

/** A printable invoice and packing slip, printed through a hidden frame. */
function printInvoice(order) {
  const t = orderTotals(order);
  const c = order.customer;
  const rows = order.items.map(i => `<tr><td>${escapeHtml(i.title)}${i.option ? ` <small>(${escapeHtml(i.option)})</small>` : ""}<br><small>${escapeHtml(i.sku)}</small></td>
    <td class="n">${i.qty}</td><td class="n">${money(i.price)}</td><td class="n">${money((Number(parseAmount(i.price)) || 0) * i.qty)}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(order.number)}</title><style>
    body{font:14px/1.45 system-ui,"Noto Sans","Noto Sans Bengali",sans-serif;color:#111;margin:28px}
    h1{font-size:20px;margin:0}.top{display:flex;justify-content:space-between;gap:20px;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left;vertical-align:top}
    .n{text-align:right;white-space:nowrap}.box{border:2px solid #111;padding:10px 12px;border-radius:6px}.big{font-size:18px;font-weight:700}
    small{color:#555}.muted{color:#555}</style></head><body>
    <div class="top"><div><h1>${escapeHtml(shop.name)}</h1><div class="muted">${escapeHtml([shop.whatsapp, shop.website].filter(Boolean).join(" · "))}</div></div>
    <div style="text-align:right"><div class="big">${escapeHtml(order.number)}</div><div class="muted">${new Date(order.created).toLocaleDateString()}</div></div></div>
    <div class="box"><strong>Deliver to:</strong> ${escapeHtml(c.name)} · ${escapeHtml(localPhone(c.phone))}<br>${escapeHtml(c.address)}${c.area ? `, ${escapeHtml(c.area)}` : ""}, ${escapeHtml(c.district)}
    ${order.note ? `<br><strong>Note:</strong> ${escapeHtml(order.note)}` : ""}${order.courier.name ? `<br><strong>Courier:</strong> ${escapeHtml(order.courier.name)} ${escapeHtml(order.courier.trackingId)}` : ""}</div>
    <table><thead><tr><th>Product</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <table style="width:auto;margin-left:auto"><tr><td>Products</td><td class="n">${money(t.subtotal)}</td></tr><tr><td>Delivery</td><td class="n">${money(order.deliveryCharge || 0)}</td></tr>
    ${Number(parseAmount(order.discount)) > 0 ? `<tr><td>Discount</td><td class="n">− ${money(order.discount)}</td></tr>` : ""}
    <tr><td><strong>Total</strong></td><td class="n"><strong>${money(t.total)}</strong></td></tr>${t.advance ? `<tr><td>Paid in advance</td><td class="n">${money(t.advance)}</td></tr>` : ""}
    <tr><td class="big">${order.payment.method === "cod" ? "Cash on delivery" : "To collect"}</td><td class="n big">${money(t.collect)}</td></tr></table>
    <p class="muted">Thank you for shopping with ${escapeHtml(shop.name)}.</p></body></html>`;
  const frame = $("print-frame");
  frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
  frame.srcdoc = html;
}
