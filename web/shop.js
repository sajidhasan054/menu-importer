// Shop catalog workspace: product grid, product editor, photos and exports.
import {
  AGE_GROUPS, AVAILABILITY, CONDITIONS, GENDERS, MAX_PHOTOS, META_COLUMNS, feedRows, formatPrice, groupPhotoNames,
  isReady, newProduct, photoFileName, productIssues, productsFromRows, syncVariants, toGoogleFeed, toMetaFeed,
  variantSku, whatsappText,
} from "./catalog.js";
import { parseAmount } from "./parser.js";
import * as store from "./store.js";

const $ = id => document.getElementById(id);
let shop = null;
let ctx = null;
let editing = null;      // working copy of the product in the editor
let editingIsNew = false;
const filter = { text: "", category: "", unready: false };

// ------------------------------------------------------------------ setup

export function initShop(context) {
  ctx = context; // { status, download, save, openSettings }
  $("product-search").addEventListener("input", e => { filter.text = e.target.value.trim().toLowerCase(); renderProducts(); });
  $("category-filter").addEventListener("change", e => { filter.category = e.target.value; renderProducts(); });
  $("only-unready").addEventListener("change", e => { filter.unready = e.target.checked; renderProducts(); });
  $("add-product").addEventListener("click", () => openEditor(newProduct(shop), true));
  $("show-import").addEventListener("click", () => {
    const section = $("add-section");
    section.hidden = !section.hidden;
    $("show-import").setAttribute("aria-expanded", String(!section.hidden));
    if (!section.hidden) section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const photos = $("product-photos");
  photos.addEventListener("change", e => { addProductsFromPhotos([...e.target.files]); e.target.value = ""; });
  dropZone($("photo-drop"), files => addProductsFromPhotos(files));
  setupEditor();
  setupExports();
}

export function openShop(catalog) {
  shop = catalog;
  shop.products ||= [];
  filter.text = ""; filter.category = ""; filter.unready = false;
  $("product-search").value = "";
  $("only-unready").checked = false;
  $("add-section").hidden = true;
  $("show-import").setAttribute("aria-expanded", "false");
  renderProducts();
}

export const currentShop = () => shop;

function persist() {
  ctx.save(shop);
  ctx.refreshHeader?.();
}

function dropZone(zone, onFiles) {
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("over");
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (files.length) onFiles(files);
  });
}

// ------------------------------------------------------------------ photos

/** Shrink a photo to at most 1600 px and store it as JPEG. Returns a photo record. */
async function storePhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(/\.(heic|heif)$/i.test(file.name || "")
      ? "This browser cannot open HEIC photos. Share them as JPEG, or set iPhone Camera › Formats › Most Compatible."
      : `${file.name || "This file"} could not be opened as an image.`);
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
  return { blob: await store.putPhoto(blob), width: canvas.width, height: canvas.height };
}

/** Square, padded JPEG for export (WhatsApp and Instagram crop to squares). */
async function squareJpeg(photo, size = 1200) {
  const blob = photo.blob ? await store.getPhoto(photo.blob) : null;
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const side = Math.min(size, Math.max(bitmap.width, bitmap.height, 500));
  const scale = side / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, side, side);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  c.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h);
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function addProductsFromPhotos(files) {
  const groups = groupPhotoNames(files.map(f => f.name || "photo.jpg"));
  let added = 0;
  ctx.status(`Adding ${files.length} photo${files.length === 1 ? "" : "s"}…`);
  try {
    for (const group of groups) {
      const product = newProduct(shop, { title: group.title });
      for (const name of group.names.slice(0, MAX_PHOTOS)) {
        const file = files.find(f => (f.name || "photo.jpg") === name);
        product.photos.push(await storePhoto(file));
      }
      product.edited = true;
      shop.products.push(product);
      added++;
    }
    persist();
    renderProducts();
    ctx.status(`${added} product${added === 1 ? "" : "s"} added from photos. Open each one to add the title, price and description.`);
  } catch (error) {
    persist();
    renderProducts();
    ctx.status(error.message, true);
  }
}

async function setImage(img, photo) {
  img.onerror = () => {
    img.parentElement?.classList.add("broken");
    img.removeAttribute("src");
    img.alt = "Photo link could not be loaded";
  };
  const src = await store.photoSrc(photo);
  if (src) img.src = src;
  else img.removeAttribute("src");
}

// ------------------------------------------------------------------ imports from the shared reader

/**
 * Replace the products that came from one imported file with freshly parsed
 * ones, keeping products the user has edited.
 * rows: [{title|name, price, color, size|portion, …}]
 */
export function applyRows(sourceId, rows, userAction = false) {
  const edited = shop.products.filter(p => p.src === sourceId && p.edited);
  if (userAction && edited.length && !confirm(`Update the products from this file?\n${edited.length} you edited will be kept as they are.`)) return 0;
  const keep = shop.products.filter(p => p.src !== sourceId || p.edited);
  const keptTitles = new Set(edited.map(p => p.title.toLowerCase()));
  shop.products = keep;
  const fresh = productsFromRows(rows.map(row => ({
    ...row,
    title: row.title || row.name,
    size: row.size || row.portion,
    category: row.category || row.section,
  })), shop).filter(p => !keptTitles.has(p.title.toLowerCase()));
  // Avoid SKU clashes with products already in the shop.
  const used = new Set(shop.products.map(p => p.sku));
  for (const p of fresh) {
    if (used.has(p.sku)) {
      const old = p.sku;
      const replacement = newProduct(shop).sku;
      p.sku = replacement;
      for (const v of p.variants) v.sku = v.sku.replace(old, replacement);
    }
    used.add(p.sku);
    p.src = sourceId;
    p.edited = false;
  }
  shop.products.push(...fresh);
  persist();
  renderProducts();
  return fresh.length;
}

export function removeSourceProducts(sourceId) {
  shop.products = shop.products.filter(p => p.src !== sourceId || p.edited);
  persist();
  renderProducts();
}

// ------------------------------------------------------------------ grid

function matches(product) {
  if (filter.category && product.category !== filter.category) return false;
  if (filter.unready && isReady(product, shop)) return false;
  if (!filter.text) return true;
  const hay = [product.title, product.sku, product.category, product.brand, ...product.colors, ...product.sizes,
    ...product.variants.map(v => v.sku)].join(" ").toLowerCase();
  return hay.includes(filter.text);
}

export function renderProducts() {
  if (!shop) return;
  const products = shop.products;
  const ready = products.filter(p => isReady(p, shop)).length;
  $("products-summary").textContent = products.length
    ? `${products.length} product${products.length === 1 ? "" : "s"} · ${ready} ready to share`
    : "";
  $("products-empty").hidden = products.length > 0;
  $("share-section").hidden = products.length === 0;

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const select = $("category-filter");
  select.replaceChildren(new Option("All categories", ""), ...categories.map(c => new Option(c, c)));
  select.value = categories.includes(filter.category) ? filter.category : "";
  select.parentElement.hidden = categories.length === 0;
  $("category-list").replaceChildren(...categories.map(c => new Option(c)));

  const grid = $("product-grid");
  const shown = products.filter(matches);
  grid.replaceChildren(...shown.map(productCard));
  if (products.length && !shown.length) {
    const none = document.createElement("p");
    none.className = "empty";
    none.textContent = "No products match the search or filters.";
    grid.append(none);
  }
  renderChecklist();
}

/** Price for people to read, in their locale: "BDT 1,650.00", "$12.00". Feeds keep Meta's "1650.00 BDT". */
function displayPrice(amount, currency) {
  const value = parseAmount(amount);
  if (value === null) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "symbol" }).format(Number(value));
  } catch {
    return formatPrice(value, currency);
  }
}

function productCard(product) {
  const issues = productIssues(product, shop);
  const errors = issues.filter(i => i.level === "error");
  const card = document.createElement("article");
  card.className = "product-card" + (errors.length ? " unready" : "");
  const open = document.createElement("button");
  open.type = "button";
  open.className = "card-open";
  open.setAttribute("aria-label", `Edit ${product.title || "untitled product"}`);
  open.addEventListener("click", () => openEditor(structuredClone(product), false));

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (product.photos.length) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    setImage(img, product.photos[0]);
    thumb.append(img);
    if (product.photos.length > 1) {
      const count = document.createElement("span");
      count.className = "photo-count";
      count.textContent = `${product.photos.length} photos`;
      thumb.append(count);
    }
  } else {
    thumb.classList.add("no-photo");
    thumb.textContent = "No photo";
  }

  const body = document.createElement("div");
  body.className = "card-body";
  const title = document.createElement("h3");
  title.textContent = product.title || "Untitled product";
  const price = document.createElement("p");
  price.className = "price";
  const sale = parseAmount(product.salePrice);
  if (sale !== null) {
    const was = document.createElement("s");
    was.textContent = displayPrice(product.price, product.currency);
    price.append(displayPrice(sale, product.currency), " ", was);
  } else {
    price.textContent = displayPrice(product.price, product.currency) || "No price";
  }
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [product.sku, product.colors.length && `${product.colors.length} colour${product.colors.length > 1 ? "s" : ""}`,
    product.sizes.length && `${product.sizes.length} size${product.sizes.length > 1 ? "s" : ""}`,
    product.availability !== "in stock" && AVAILABILITY.find(([v]) => v === product.availability)?.[1]].filter(Boolean).join(" · ");
  const state = document.createElement("p");
  state.className = errors.length ? "state todo" : "state ok";
  state.textContent = errors.length ? errors.map(i => i.text.replace(/^Add (a |an |at least one )?/, "")).join(", ") : "Ready";
  if (errors.length) state.prepend("Needs: ");
  body.append(title, price, meta, state);
  open.append(thumb, body);
  card.append(open);
  return card;
}

function renderChecklist() {
  const list = $("share-checklist");
  const products = shop.products;
  const ready = products.filter(p => isReady(p, shop));
  const localOnly = products.filter(p => p.photos.some(ph => ph.blob)).length;
  const items = [
    [ready.length === products.length, `${ready.length} of ${products.length} products are ready`,
      ready.length < products.length ? ["Show the others", () => { $("only-unready").checked = true; filter.unready = true; renderProducts(); $("products-section").scrollIntoView({ behavior: "smooth" }); }] : null],
    [!localOnly || Boolean(shop.imageBase), localOnly && !shop.imageBase
      ? `Photos of ${localOnly} product${localOnly === 1 ? "" : "s"} are only on this device: put them online and set the photo link address`
      : localOnly ? `Photo links point to ${shop.imageBase}` : "All photos are links",
      localOnly && !shop.imageBase ? ["How", () => $("photo-help-dialog").showModal()] : null],
    [Boolean(shop.whatsapp || shop.website), shop.whatsapp || shop.website
      ? `Buyers are sent to ${shop.website || "your WhatsApp chat"}`
      : "Add a WhatsApp number or website so buyers can contact you",
      shop.whatsapp || shop.website ? null : ["Settings", () => ctx.openSettings()]],
  ];
  list.replaceChildren(...items.map(([ok, text, action]) => {
    const row = document.createElement("p");
    row.className = ok ? "check ok" : "check todo";
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = ok ? "✓" : "!";
    row.append(mark, text);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link";
      button.textContent = action[0];
      button.addEventListener("click", action[1]);
      row.append(" ", button);
    }
    return row;
  }));
}

// ------------------------------------------------------------------ editor

function setupEditor() {
  const form = $("product-form");
  const fill = (name, choices) => form.elements[name].replaceChildren(...choices.map(([v, l]) => new Option(l, v)));
  fill("availability", AVAILABILITY);
  fill("condition", CONDITIONS);
  fill("gender", GENDERS);
  fill("ageGroup", AGE_GROUPS);

  for (const name of ["title", "description", "price", "salePrice", "currency", "availability", "condition", "quantity",
    "category", "brand", "material", "pattern", "gender", "ageGroup", "gtin", "sku", "link"]) {
    form.elements[name].addEventListener("input", () => {
      readForm();
      if (name === "sku") renderVariants();
      renderIssues();
      updateCounter();
    });
  }
  chipsInput("colors");
  chipsInput("sizes");
  form.querySelectorAll("[data-sizes]").forEach(button => button.addEventListener("click", () => {
    for (const size of button.dataset.sizes.split(",")) if (!editing.sizes.includes(size)) editing.sizes.push(size);
    renderChips("sizes");
    changedOptions();
  }));

  $("photo-add").addEventListener("change", async e => { await addPhotos([...e.target.files]); e.target.value = ""; });
  dropZone($("photo-add-drop"), files => addPhotos(files));
  $("photo-url-add").addEventListener("click", () => {
    const input = $("photo-url");
    const url = input.value.trim();
    if (!/^https?:\/\/\S+$/.test(url)) { input.setCustomValidity("Enter a full link starting with https://"); input.reportValidity(); return; }
    input.setCustomValidity("");
    editing.photos.push({ url });
    input.value = "";
    renderPhotos();
    renderIssues();
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    readForm();
    if (!editing.title.trim()) {
      form.elements.title.setCustomValidity("Add a title");
      form.elements.title.reportValidity();
      form.elements.title.setCustomValidity("");
      return;
    }
    saveEditing();
    $("product-dialog").close();
  });
  $("product-delete").addEventListener("click", async () => {
    if (editingIsNew) { await discardNewPhotos(); $("product-dialog").close(); return; }
    if (!confirm(`Delete “${editing.title || editing.sku}”?`)) return;
    const original = shop.products.find(p => p.id === editing.id);
    shop.products = shop.products.filter(p => p.id !== editing.id);
    await deleteUnusedPhotos([...(original?.photos || []), ...editing.photos]);
    persist();
    renderProducts();
    $("product-dialog").close();
    ctx.status("Product deleted.");
  });
  $("product-duplicate").addEventListener("click", () => {
    readForm();
    if (editing.title.trim()) saveEditing();
    const copy = structuredClone(editing);
    const fresh = newProduct(shop);
    copy.id = fresh.id;
    for (const v of copy.variants) v.sku = variantSku(fresh.sku, v.color, v.size);
    copy.sku = fresh.sku;
    copy.title = `${copy.title} (copy)`;
    copy.src = null;
    $("product-dialog").close();
    openEditor(copy, true);
    ctx.status("Copy created. Change what differs, then save.");
  });
  $("product-dialog").addEventListener("cancel", () => { if (editingIsNew) discardNewPhotos(); });
  $("product-dialog").querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => {
    if (editingIsNew) discardNewPhotos();
    $("product-dialog").close();
  }));
}

function openEditor(product, isNew) {
  editing = product;
  editingIsNew = isNew;
  editing.originalSku = product.sku;
  const form = $("product-form");
  for (const name of ["title", "description", "price", "salePrice", "currency", "availability", "condition", "quantity",
    "category", "brand", "material", "pattern", "gender", "ageGroup", "gtin", "sku", "link"]) {
    form.elements[name].value = product[name] ?? "";
  }
  form.elements.brand.placeholder = shop.brand || shop.name;
  $("product-title").textContent = isNew ? "New product" : "Edit product";
  $("product-sku").textContent = product.sku;
  $("product-delete").textContent = isNew ? "Discard" : "Delete";
  $("product-duplicate").hidden = isNew;
  form.querySelector(".more-details").open = Boolean(product.material || product.pattern || product.gender || product.ageGroup || product.gtin || product.link);
  renderChips("colors");
  renderChips("sizes");
  renderPhotos();
  renderVariants();
  renderIssues();
  updateCounter();
  $("product-dialog").showModal();
  if (isNew) form.elements.title.focus();
}

function readForm() {
  const form = $("product-form");
  for (const name of ["title", "description", "price", "salePrice", "currency", "availability", "condition", "quantity",
    "category", "brand", "material", "pattern", "gender", "ageGroup", "gtin", "link"]) {
    editing[name] = form.elements[name].value;
  }
  editing.currency = (editing.currency || shop.currency).trim().toUpperCase();
  const sku = form.elements.sku.value.trim().replace(/\s+/g, "-");
  if (sku && sku !== editing.sku) {
    for (const v of editing.variants) if (v.sku.startsWith(editing.sku)) v.sku = sku + v.sku.slice(editing.sku.length);
    editing.sku = sku;
    $("product-sku").textContent = sku;
  }
}

function saveEditing() {
  for (const key of ["price", "salePrice"]) {
    const amount = parseAmount(editing[key]);
    editing[key] = amount === null ? (key === "price" ? editing[key] : "") : amount;
  }
  editing.quantity = String(editing.quantity).replace(/\D/g, "");
  delete editing.originalSku;
  editing.edited = true;
  editing.updated = Date.now();
  syncVariants(editing);
  for (const photo of editing.photos) delete photo.added;
  const index = shop.products.findIndex(p => p.id === editing.id);
  const removed = index >= 0 ? shop.products[index].photos.filter(old => !editing.photos.some(ph => ph.blob && ph.blob === old.blob)) : [];
  if (index >= 0) shop.products[index] = editing;
  else shop.products.push(editing);
  deleteUnusedPhotos(removed);
  editingIsNew = false;
  persist();
  renderProducts();
  ctx.status(`Saved ${editing.title}.`);
}

function updateCounter() {
  const counter = $("product-form").querySelector('[data-for="title"]');
  const length = editing.title.length;
  counter.textContent = length > 65 ? `${length}/150 · shorter titles read better in shops` : "";
}

function renderIssues() {
  const list = $("product-issues");
  const issues = productIssues({ ...editing, variants: editing.variants }, shop);
  list.replaceChildren(...issues.map(issue => {
    const li = document.createElement("li");
    li.className = issue.level;
    li.textContent = issue.text;
    return li;
  }));
  if (!issues.length) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = "Ready for WhatsApp, Facebook, Instagram and Google";
    list.append(li);
  }
}

// Photos in the editor ---------------------------------------------------------------

async function addPhotos(files) {
  const room = MAX_PHOTOS - editing.photos.length;
  if (room <= 0) { ctx.status(`A product can have up to ${MAX_PHOTOS} photos.`, true); return; }
  try {
    for (const file of files.slice(0, room)) {
      const photo = await storePhoto(file);
      photo.added = true; // removed again if the editor is cancelled
      editing.photos.push(photo);
      renderPhotos();
    }
    if (files.length > room) ctx.status(`Only ${MAX_PHOTOS} photos fit; the rest were skipped.`, true);
  } catch (error) {
    ctx.status(error.message, true);
  }
  renderVariants();
  renderIssues();
}

function renderPhotos() {
  const list = $("photo-list");
  list.replaceChildren(...editing.photos.map((photo, index) => {
    const item = document.createElement("figure");
    item.className = "photo-item";
    const img = document.createElement("img");
    img.alt = `Photo ${index + 1}`;
    setImage(img, photo);
    const caption = document.createElement("figcaption");
    caption.textContent = index === 0 ? "Main" : String(index + 1);
    const tools = document.createElement("div");
    tools.className = "photo-tools";
    const tool = (text, label, handler, disabled = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = label;
      b.setAttribute("aria-label", `${label} (photo ${index + 1})`);
      b.disabled = disabled;
      b.addEventListener("click", handler);
      tools.append(b);
    };
    tool("←", "Move earlier", () => movePhoto(index, -1), index === 0);
    tool("→", "Move later", () => movePhoto(index, 1), index === editing.photos.length - 1);
    tool("✕", "Remove", () => {
      const [removed] = editing.photos.splice(index, 1);
      if (removed.added && removed.blob) store.deletePhoto(removed.blob);
      for (const v of editing.variants) if (v.photo >= editing.photos.length) v.photo = 0;
      renderPhotos();
      renderVariants();
      renderIssues();
    });
    item.append(img, caption, tools);
    return item;
  }));
  $("photo-add-drop").hidden = editing.photos.length >= MAX_PHOTOS;
}

function movePhoto(index, delta) {
  const target = index + delta;
  [editing.photos[index], editing.photos[target]] = [editing.photos[target], editing.photos[index]];
  for (const v of editing.variants) {
    if (v.photo === index) v.photo = target;
    else if (v.photo === target) v.photo = index;
  }
  renderPhotos();
  renderVariants();
}

async function discardNewPhotos() {
  for (const photo of editing?.photos || []) if (photo.added && photo.blob) await store.deletePhoto(photo.blob);
}

async function deleteUnusedPhotos(photos) {
  const inUse = new Set(shop.products.flatMap(p => p.photos.map(ph => ph.blob)));
  for (const photo of photos) if (photo.blob && !inUse.has(photo.blob)) await store.deletePhoto(photo.blob);
}

// Colours and sizes ---------------------------------------------------------------

function chipsInput(kind) {
  const input = $(`${kind}-input`);
  const add = () => {
    const values = input.value.split(/[,;\n]/).map(v => v.trim()).filter(Boolean);
    for (const value of values) {
      if (!editing[kind].some(v => v.toLowerCase() === value.toLowerCase())) editing[kind].push(value);
    }
    input.value = "";
    if (values.length) { renderChips(kind); changedOptions(); }
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !input.value && editing[kind].length) {
      editing[kind].pop();
      renderChips(kind);
      changedOptions();
    }
  });
  input.addEventListener("blur", add);
  input.addEventListener("paste", () => setTimeout(add));
}

function renderChips(kind) {
  const box = $(`${kind}-chips`);
  box.replaceChildren(...editing[kind].map((value, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = value;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Remove ${value}`);
    remove.addEventListener("click", () => {
      editing[kind].splice(index, 1);
      renderChips(kind);
      changedOptions();
    });
    chip.append(remove);
    return chip;
  }));
}

function changedOptions() {
  syncVariants(editing);
  renderVariants();
  renderIssues();
}

function renderVariants() {
  const wrap = $("variants-wrap");
  syncVariants(editing);
  wrap.hidden = editing.variants.length === 0;
  const body = $("variants-body");
  body.replaceChildren(...editing.variants.map(variant => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = [variant.color, variant.size].filter(Boolean).join(" / ");
    const input = (field, attrs = {}) => {
      const td = document.createElement("td");
      const el = document.createElement("input");
      el.value = variant[field] ?? "";
      Object.assign(el, attrs);
      el.setAttribute("aria-label", `${attrs.title || field} for ${name.textContent}`);
      el.addEventListener("input", () => {
        variant[field] = field === "quantity" ? el.value.replace(/\D/g, "") : el.value;
        renderIssues();
      });
      td.append(el);
      return td;
    };
    const photoCell = document.createElement("td");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Photo for ${name.textContent}`);
    editing.photos.forEach((_, i) => select.add(new Option(i === 0 ? "Main" : `Photo ${i + 1}`, i)));
    if (!editing.photos.length) select.add(new Option("—", 0));
    select.value = String(variant.photo || 0);
    select.disabled = editing.photos.length < 2;
    select.addEventListener("change", () => { variant.photo = Number(select.value); });
    photoCell.append(select);
    tr.append(name,
      input("sku", { title: "SKU", className: "w-sku" }),
      input("price", { title: "Price", inputMode: "decimal", placeholder: editing.price || "same", className: "w-price" }),
      input("quantity", { title: "Stock", inputMode: "numeric", placeholder: "—", className: "w-stock" }),
      photoCell);
    return tr;
  }));
}

// ------------------------------------------------------------------ exports

function setupExports() {
  $("export-meta").addEventListener("click", () => exportFeed("meta"));
  $("export-google").addEventListener("click", () => exportFeed("google"));
  $("export-photos").addEventListener("click", exportPhotos);
  $("export-xlsx").addEventListener("click", exportExcel);
  $("photo-help").addEventListener("click", () => $("photo-help-dialog").showModal());
  $("copy-whatsapp").addEventListener("click", async () => {
    const text = whatsappText(shop.products.filter(p => p.title && parseAmount(p.price) !== null), shop);
    try {
      await navigator.clipboard.writeText(text);
      ctx.status("Product list copied. Paste it into a WhatsApp chat or status.");
    } catch {
      ctx.download(new Blob([text], { type: "text/plain;charset=utf-8" }), `${fileStem()}-whatsapp.txt`);
      ctx.status("Copying was blocked, so the list was downloaded as a text file.");
    }
  });
}

const fileStem = () => (shop.code || "shop").toLowerCase() + "-catalog";

function exportable() {
  const ready = shop.products.filter(p => isReady(p, shop));
  const skipped = shop.products.length - ready.length;
  const noLinks = ready.filter(p => p.photos.some(ph => ph.blob) && !shop.imageBase).length;
  if (!ready.length) { ctx.status("No products are ready yet. Products need a title, price, description and photo.", true); return null; }
  const notes = [];
  if (skipped) notes.push(`${skipped} product${skipped === 1 ? " isn't" : "s aren't"} ready and will be left out.`);
  if (noLinks) notes.push(`${noLinks} product${noLinks === 1 ? " has" : "s have"} photos only on this device, so Meta and Google can't show them. Put the photos online and set the photo link address in Settings first.`);
  if (notes.length && !confirm(`${notes.join("\n\n")}\n\nDownload the file anyway?`)) return null;
  return ready;
}

function exportFeed(kind) {
  const products = exportable();
  if (!products) return;
  const rows = feedRows(products, shop);
  if (kind === "meta") {
    ctx.download(new Blob(["﻿" + toMetaFeed(rows)], { type: "text/csv;charset=utf-8" }), `${fileStem()}-meta.csv`);
    ctx.status(`Meta catalog downloaded: ${rows.length} rows from ${products.length} products.`);
  } else {
    ctx.download(new Blob([toGoogleFeed(rows)], { type: "text/tab-separated-values;charset=utf-8" }), `${fileStem()}-google.tsv`);
    ctx.status(`Google feed downloaded: ${rows.length} rows from ${products.length} products.`);
  }
}

function exportExcel() {
  const rows = feedRows(shop.products, shop);
  const sheet = XLSX.utils.json_to_sheet(rows.map(r => Object.fromEntries(META_COLUMNS.map(c => [c, r[c] ?? ""]))), { header: META_COLUMNS });
  sheet["!cols"] = META_COLUMNS.map(c => ({ wch: ["title", "description", "link", "image_link", "additional_image_link"].includes(c) ? 40 : 14 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Products");
  XLSX.writeFile(book, `${fileStem()}.xlsx`);
  ctx.status(`Excel file downloaded: ${rows.length} rows.`);
}

async function exportPhotos() {
  const local = shop.products.flatMap(p => p.photos.map((photo, i) => ({ photo, name: photoFileName(p.sku, i) }))).filter(x => x.photo.blob);
  if (!local.length) { ctx.status("No photos stored on this device. Photos added as links are already online.", true); return; }
  const button = $("export-photos");
  button.disabled = true;
  try {
    const zip = XLSX.CFB.utils.cfb_new();
    let done = 0;
    for (const { photo, name } of local) {
      const blob = await squareJpeg(photo);
      if (blob) XLSX.CFB.utils.cfb_add(zip, "/" + name, new Uint8Array(await blob.arrayBuffer()));
      ctx.status(`Preparing photos… ${++done} of ${local.length}`);
    }
    const data = XLSX.CFB.write(zip, { fileType: "zip", type: "array", compression: false });
    ctx.download(new Blob([data], { type: "application/zip" }), `${fileStem()}-photos.zip`);
    ctx.status(`${local.length} photos downloaded, named by SKU. Put them online and set the photo link address in Settings.`);
  } catch (error) {
    ctx.status(`Photos could not be packed: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ backup

export async function backupPhotos(catalog) {
  const photos = {};
  for (const id of store.photoIds(catalog)) {
    const blob = await store.getPhoto(id);
    if (blob) photos[id] = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  }
  return photos;
}

export async function restorePhotos(catalog, photos = {}) {
  const map = new Map();
  for (const [oldId, dataUrl] of Object.entries(photos)) {
    const blob = await (await fetch(dataUrl)).blob();
    map.set(oldId, await store.putPhoto(blob));
  }
  for (const p of catalog.products || []) {
    p.photos = p.photos.map(ph => (ph.blob ? (map.has(ph.blob) ? { ...ph, blob: map.get(ph.blob) } : null) : ph)).filter(Boolean);
  }
}
