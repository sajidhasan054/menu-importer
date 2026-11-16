// Shop catalog model, naming conventions and feed exports. Pure functions,
// shared by the browser and the Node tests.
//
// Naming conventions
//   Shop code        3–4 capital letters from the shop name: "Dhaka Fashion House" -> "DFH".
//   Product SKU      <shop code>-<4-digit number>: "DFH-0001". Used as item_group_id.
//   Variant SKU      <product SKU>-<COLOR>-<SIZE>: "DFH-0001-BLACK-M". Used as id.
//   Photo file       <product SKU, lowercase>-<n>.jpg: "dfh-0001-1.jpg", "dfh-0001-2.jpg".
//   Feed columns     Meta's and Google's official names: id, title, description,
//                    availability, condition, price, link, image_link, brand,
//                    additional_image_link, item_group_id, color, size, …

import { parseAmount } from "./parser.js";

export const AVAILABILITY = [
  ["in stock", "In stock"], ["out of stock", "Out of stock"], ["preorder", "Pre-order"],
  ["available for order", "Made to order"], ["discontinued", "Discontinued"],
];
export const CONDITIONS = [["new", "New"], ["refurbished", "Refurbished"], ["used", "Used"]];
export const GENDERS = [["", "Not set"], ["female", "Women"], ["male", "Men"], ["unisex", "Unisex"]];
export const AGE_GROUPS = [
  ["", "Not set"], ["adult", "Adults"], ["all ages", "All ages"], ["teen", "Teens"], ["kids", "Kids"],
  ["toddler", "Toddlers"], ["infant", "Infants"], ["newborn", "Newborns"],
];
export const MAX_PHOTOS = 10;
export const RECOMMENDED_PHOTOS = 3;
export const TITLE_LIMIT = 150; // Meta truncates long titles in shops; 65 or fewer reads best.

// ------------------------------------------------------------------ naming

/** ASCII slug: "Café Crème Brûlée!" -> "cafe-creme-brulee". Non-Latin text becomes "". */
export function slug(text) {
  return String(text ?? "")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/ß/g, "ss").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Short code for SKUs: "Navy Blue" -> "NAVYBLUE" (max 8), "XL" -> "XL", "লাল" -> "" . */
export function code(text, max = 8) {
  return slug(text).replace(/-/g, "").toUpperCase().slice(0, max);
}

/** Shop code from its name: initials of up to 4 words, or the first letters of one word. */
export function shopCode(name) {
  const words = slug(name).split("-").filter(Boolean);
  if (!words.length) return "SHOP";
  const initials = words.length > 1 ? words.slice(0, 4).map(w => w[0]).join("") : words[0].slice(0, 3);
  return (initials.length >= 2 ? initials : (initials + "shop").slice(0, 3)).toUpperCase();
}

export function productSku(shop, number) {
  return `${shop.code || shopCode(shop.name)}-${String(number).padStart(4, "0")}`;
}

/** Next free product number for a shop, so SKUs never repeat even after deletions. */
export function nextProductNumber(shop, products) {
  const prefix = `${shop.code || shopCode(shop.name)}-`;
  let max = shop.lastNumber || 0;
  for (const p of products) {
    if (p.sku?.startsWith(prefix)) {
      const n = Number(p.sku.slice(prefix.length).split("-")[0]);
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

export function variantSku(productSkuValue, color, size) {
  return [productSkuValue, code(color), code(size, 6)].filter(Boolean).join("-");
}

export function photoFileName(sku, index, extension = "jpg") {
  return `${slug(sku) || "product"}-${index + 1}.${extension}`;
}

export function whatsappLink(number, text = "") {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

// ------------------------------------------------------------------ products

export function newShop({ name = "", currency = "USD", whatsapp = "", website = "", brand = "" } = {}) {
  return {
    type: "shop", name: name.trim(), code: shopCode(name), currency, whatsapp, website, brand: brand.trim(),
    imageBase: "", lastNumber: 0, products: [],
  };
}

export function newProduct(shop, fields = {}) {
  const number = nextProductNumber(shop, shop.products || []);
  shop.lastNumber = number;
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    sku: productSku(shop, number),
    title: "", description: "", category: "", brand: "",
    price: "", salePrice: "", currency: shop.currency,
    availability: "in stock", condition: "new", quantity: "",
    link: "", photos: [], colors: [], sizes: [],
    material: "", pattern: "", gender: "", ageGroup: "", gtin: "",
    variants: [], updated: Date.now(),
    ...fields,
  };
}

/**
 * Variants for every colour × size combination. Existing variants keep their
 * SKU, price, stock and photo; combinations that no longer exist are dropped.
 */
export function syncVariants(product) {
  const colors = product.colors.length ? product.colors : [""];
  const sizes = product.sizes.length ? product.sizes : [""];
  if (!product.colors.length && !product.sizes.length) {
    product.variants = [];
    return product;
  }
  const old = new Map(product.variants.map(v => [`${v.color}\u0000${v.size}`, v]));
  product.variants = colors.flatMap(color => sizes.map(size => {
    const kept = old.get(`${color}\u0000${size}`);
    return kept ? { ...kept } : {
      color, size, sku: variantSku(product.sku, color, size), price: "", quantity: "",
      availability: "", photo: defaultPhoto(product, color),
    };
  }));
  // Keep SKUs unique when two names reduce to the same code (e.g. non-Latin colour names).
  const seen = new Map();
  for (const v of product.variants) {
    const base = v.sku;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count) v.sku = `${base}-${count + 1}`;
  }
  return product;
}

// Photo n often shows colour n, so the first colour gets photo 1, the second photo 2…
function defaultPhoto(product, color) {
  const index = product.colors.indexOf(color);
  return index >= 0 && index < product.photos.length ? index : 0;
}

export function formatPrice(amount, currency) {
  const value = parseAmount(amount);
  return value === null ? "" : `${Number(value).toFixed(2)} ${currency}`;
}

/**
 * What a product still needs before WhatsApp, Facebook and Instagram accept it.
 * Returns [{level: "error"|"warning", text}].
 */
export function productIssues(product, shop) {
  const issues = [];
  const add = (level, text) => issues.push({ level, text });
  if (!product.title.trim()) add("error", "Add a title");
  else if (product.title.length > TITLE_LIMIT) add("warning", `Shorten the title to ${TITLE_LIMIT} characters`);
  if (parseAmount(product.price) === null) add("error", "Add a price");
  if (product.salePrice && parseAmount(product.salePrice) !== null && parseAmount(product.price) !== null
      && Number(parseAmount(product.salePrice)) >= Number(parseAmount(product.price))) add("warning", "Sale price should be lower than the price");
  if (!product.photos.length) add("error", "Add at least one photo");
  else if (product.photos.length < 2) add("warning", "Add 2–3 photos so buyers see more angles");
  if (!product.description.trim()) add("error", "Add a description");
  if (!product.link && !shop.website && !shop.whatsapp) add("warning", "Add a WhatsApp number or website in shop settings, so buyers can reach you");
  for (const v of product.variants) {
    if (v.price && parseAmount(v.price) === null) add("error", `Fix the price of ${[v.color, v.size].filter(Boolean).join(" / ")}`);
  }
  return issues;
}

export const isReady = (product, shop) => !productIssues(product, shop).some(i => i.level === "error");

// ------------------------------------------------------------------ feeds

/** Public link of a photo: its own URL, or the shop's image folder + the conventional file name. */
export function photoUrl(photo, product, index, shop) {
  if (photo.url) return photo.url;
  if (!shop.imageBase) return "";
  const base = shop.imageBase.endsWith("/") ? shop.imageBase : shop.imageBase + "/";
  return base + photoFileName(product.sku, index);
}

function productLink(product, shop, variantSku) {
  if (product.link) return product.link;
  if (shop.website) return shop.website;
  return whatsappLink(shop.whatsapp, `Hi! I'm interested in ${product.title} (${variantSku}).`);
}

/**
 * One feed row per variant (or per product without variants), using Meta's
 * column names. Google's differ only in a few values; see toGoogleFeed.
 */
export function feedRows(products, shop) {
  const rows = [];
  for (const product of products) {
    const urls = product.photos.map((photo, i) => photoUrl(photo, product, i, shop));
    const base = {
      title: product.title.trim(),
      description: product.description.trim(),
      condition: product.condition || "new",
      brand: (product.brand || shop.brand || shop.name).trim(),
      product_type: product.category.trim(),
      material: product.material.trim(),
      pattern: product.pattern.trim(),
      gender: product.gender,
      age_group: product.ageGroup,
      gtin: product.gtin.trim(),
    };
    const variants = product.variants.length ? product.variants : [null];
    for (const variant of variants) {
      const id = variant ? variant.sku : product.sku;
      const photoIndex = variant && urls[variant.photo] ? variant.photo : 0;
      const ordered = urls.length ? [urls[photoIndex], ...urls.filter((_, i) => i !== photoIndex)] : [];
      const price = variant?.price ? variant.price : product.price;
      const quantity = variant ? variant.quantity : product.quantity;
      let availability = variant?.availability || product.availability || "in stock";
      if (quantity !== "" && quantity !== undefined && Number(quantity) === 0 && availability === "in stock") availability = "out of stock";
      rows.push({
        id,
        ...base,
        availability,
        price: formatPrice(price, product.currency || shop.currency),
        sale_price: product.salePrice ? formatPrice(product.salePrice, product.currency || shop.currency) : "",
        link: productLink(product, shop, id),
        image_link: ordered[0] || "",
        additional_image_link: ordered.slice(1).filter(Boolean).join(","),
        item_group_id: variant ? product.sku : "",
        color: variant?.color || "",
        size: variant?.size || "",
        quantity_to_sell_on_facebook: quantity === "" || quantity === undefined ? "" : String(Math.max(0, Math.floor(Number(quantity) || 0))),
      });
    }
  }
  return rows;
}

export const META_COLUMNS = [
  "id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link",
  "additional_image_link", "brand", "item_group_id", "color", "size", "material", "pattern", "gender", "age_group",
  "product_type", "gtin", "quantity_to_sell_on_facebook",
];
export const GOOGLE_COLUMNS = [
  "id", "title", "description", "link", "image_link", "additional_image_link", "availability", "price", "sale_price",
  "brand", "condition", "item_group_id", "color", "size", "material", "pattern", "gender", "age_group",
  "product_type", "gtin", "identifier_exists",
];

function csvCell(value) {
  const v = String(value ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Meta Commerce Manager data feed (also used by WhatsApp and Instagram shops). */
export function toMetaFeed(rows) {
  const columns = META_COLUMNS.filter(c => ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"].includes(c)
    || rows.some(r => r[c]));
  return [columns, ...rows.map(r => columns.map(c => r[c]))].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Google Merchant Center feed (tab-separated, Google's availability values). */
export function toGoogleFeed(rows) {
  const google = rows.map(r => ({
    ...r,
    availability: { "in stock": "in_stock", "out of stock": "out_of_stock", preorder: "preorder", "available for order": "backorder", discontinued: "out_of_stock" }[r.availability] || "in_stock",
    gender: r.gender, age_group: r.age_group === "all ages" ? "" : r.age_group,
    identifier_exists: r.gtin ? "yes" : "no",
  }));
  const columns = GOOGLE_COLUMNS.filter(c => ["id", "title", "description", "link", "image_link", "availability", "price", "brand", "condition"].includes(c)
    || google.some(r => r[c]));
  const clean = v => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  return [columns, ...google.map(r => columns.map(c => r[c]))].map(r => r.map(clean).join("\t")).join("\n") + "\n";
}

/** A plain-text product list for WhatsApp messages and status updates. */
export function whatsappText(products, shop) {
  const lines = [`*${shop.name}*`, ""];
  for (const p of products) {
    const price = parseAmount(p.salePrice) !== null
      ? `~${formatPrice(p.price, p.currency)}~ *${formatPrice(p.salePrice, p.currency)}*`
      : `*${formatPrice(p.price, p.currency)}*`;
    lines.push(`• ${p.title} — ${price}`);
    const options = [p.colors.length && `Colours: ${p.colors.join(", ")}`, p.sizes.length && `Sizes: ${p.sizes.join(", ")}`].filter(Boolean);
    if (options.length) lines.push(`  ${options.join(" · ")}`);
    if (p.availability !== "in stock") lines.push(`  (${AVAILABILITY.find(([v]) => v === p.availability)?.[1] || p.availability})`);
  }
  if (shop.whatsapp || shop.website) lines.push("", `Order: ${shop.website || whatsappLink(shop.whatsapp)}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ importing

/**
 * Turn imported rows (from a spreadsheet, a Meta/Google feed, or a price list
 * read from a photo) into products. Rows with the same item_group_id, or the
 * same title, become one product whose colours and sizes become variants.
 * Row fields: name/title, price, portion/size, color, sku/id, item_group_id,
 * description, section/category, quantity, image_link, additional_image_link,
 * brand, sale_price, availability, condition, material, gender, age_group.
 */
export function productsFromRows(rows, shop) {
  const groups = new Map();
  for (const row of rows) {
    const title = (row.title || row.name || "").trim();
    if (!title) continue;
    const key = (row.item_group_id || "").trim() || title.toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const products = [];
  for (const group of groups.values()) {
    const first = group[0];
    const sizeOf = r => (r.size || r.portion || "").trim();
    const colorOf = r => (r.color || "").trim();
    const multiple = group.length > 1;
    const product = newProduct(shop, {
      title: (first.title || first.name).trim(),
      description: (first.description || "").trim(),
      category: (first.product_type || first.category || first.section || "").trim(),
      brand: (first.brand || "").trim(),
      price: parseAmount(first.price) ?? "",
      salePrice: parseAmount(first.sale_price) ?? "",
      currency: (first.currency || shop.currency).toUpperCase(),
      availability: normalizeAvailability(first.availability),
      condition: ["new", "refurbished", "used"].includes((first.condition || "").toLowerCase()) ? first.condition.toLowerCase() : "new",
      quantity: multiple ? "" : (first.quantity ?? first.quantity_to_sell_on_facebook ?? ""),
      material: (first.material || "").trim(), gender: (first.gender || "").toLowerCase(), ageGroup: (first.age_group || "").toLowerCase(),
      link: /^https?:/.test(first.link || "") ? first.link : "",
      photos: [first.image_link, ...String(first.additional_image_link || "").split(",")]
        .map(u => (u || "").trim()).filter(u => /^https?:\/\//.test(u)).slice(0, MAX_PHOTOS).map(url => ({ url })),
    });
    if (first.item_group_id && first.item_group_id.trim()) product.sku = first.item_group_id.trim();
    else if (!multiple && (first.id || first.sku)) product.sku = String(first.id || first.sku).trim();
    if (multiple || colorOf(first) || sizeOf(first)) {
      product.colors = [...new Set(group.map(colorOf).filter(Boolean))];
      product.sizes = [...new Set(group.map(sizeOf).filter(Boolean))];
      syncVariants(product);
      for (const row of group) {
        const variant = product.variants.find(v => v.color === colorOf(row) && v.size === sizeOf(row));
        if (!variant) continue;
        if (row.id || row.sku) variant.sku = String(row.id || row.sku).trim();
        const price = parseAmount(row.price);
        if (price !== null && price !== product.price) variant.price = price;
        variant.quantity = row.quantity ?? row.quantity_to_sell_on_facebook ?? "";
      }
    }
    products.push(product);
  }
  return products;
}

function normalizeAvailability(value) {
  const v = String(value || "").toLowerCase().replace(/_/g, " ").trim();
  if (!v) return "in stock";
  if (["in stock", "out of stock", "preorder", "available for order", "discontinued"].includes(v)) return v;
  if (v === "backorder") return "available for order";
  return /out|sold/.test(v) ? "out of stock" : "in stock";
}

/** Group photo files into products by name: "shirt-1.jpg", "shirt (2).jpg" -> "Shirt". */
export function groupPhotoNames(names) {
  const groups = new Map();
  for (const name of names) {
    const base = name.replace(/\.[^.]+$/, "").trim();
    // Camera names ("IMG_2041", "PXL_2025…", "WhatsApp Image …") are separate products without a title.
    const camera = /^(img|dsc|dscn|pxl|photo|image|whatsapp image|screenshot)[\s_-]*\d/i.test(base);
    const stem = camera ? base : base.replace(/(?:[\s_-]+(?:\(?\d{1,2}\)?|front|back|side|detail|copy)|\s*\(\d{1,2}\))+$/i, "").trim() || base;
    const key = camera ? `camera:${base}` : slug(stem) || base.toLowerCase();
    if (!groups.has(key)) groups.set(key, { title: camera ? "" : titleFromFileName(stem), names: [] });
    groups.get(key).names.push(name);
  }
  return [...groups.values()];
}

function titleFromFileName(stem) {
  const words = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

/** Header names (lowercase) recognised in shop spreadsheets, mapped to row fields. */
export const SHOP_HEADER_ALIASES = {
  title: "title product product name item item name name nombre nom produkt nome naam নাম পণ্য 商品名 品名 名称 상품명 اسم المنتج",
  sku: "sku id product id item id code product code article article number barcode code style style number",
  item_group_id: "item_group_id item group id group id parent sku",
  price: "price mrp unit price regular price precio prix preis prezzo preço দাম মূল্য 价格 価格 가격 سعر",
  sale_price: "sale_price sale price offer price discount price special price",
  color: "color colour colors colours color name farbe couleur colore রং রঙ 颜色 色 색상 اللون",
  size: "size sizes größe taille talla tamanho সাইজ 尺码 サイズ 사이즈 المقاس",
  quantity: "quantity qty stock inventory quantity_to_sell_on_facebook stock quantity",
  description: "description desc details বিবরণ 描述 説明 설명 الوصف",
  category: "category product_type product type type collection department ক্যাটাগরি 分类 カテゴリ 카테고리 الفئة",
  brand: "brand marca marque marke ব্র্যান্ড 品牌",
  image_link: "image_link image image url image link photo photo url picture main image",
  additional_image_link: "additional_image_link additional image link additional images more images",
  availability: "availability status in stock",
  condition: "condition",
  material: "material fabric",
  gender: "gender",
  age_group: "age_group age group",
  link: "link url product url product link",
};

const SHOP_ALIAS_MAP = new Map();
for (const [field, aliases] of Object.entries(SHOP_HEADER_ALIASES)) {
  for (const alias of aliases.split(" ")) if (!SHOP_ALIAS_MAP.has(alias)) SHOP_ALIAS_MAP.set(alias, field);
}
for (const [phrase, field] of [["product name", "title"], ["item name", "title"], ["product id", "sku"], ["item id", "sku"],
  ["product code", "sku"], ["article number", "sku"], ["style number", "sku"], ["item group id", "item_group_id"], ["group id", "item_group_id"],
  ["parent sku", "item_group_id"], ["unit price", "price"], ["regular price", "price"], ["sale price", "sale_price"],
  ["offer price", "sale_price"], ["discount price", "sale_price"], ["special price", "sale_price"], ["color name", "color"],
  ["stock quantity", "quantity"], ["product type", "category"], ["image url", "image_link"], ["image link", "image_link"],
  ["photo url", "image_link"], ["main image", "image_link"], ["additional image link", "additional_image_link"],
  ["additional images", "additional_image_link"], ["more images", "additional_image_link"], ["in stock", "availability"],
  ["age group", "age_group"], ["product url", "link"], ["product link", "link"], ["product title", "title"]]) {
  SHOP_ALIAS_MAP.set(phrase, field);
}

export const SHOP_FIELDS = [
  ["ignore", "Ignore"], ["title", "Product title"], ["sku", "SKU / ID"], ["item_group_id", "Product group (parent SKU)"],
  ["price", "Price"], ["sale_price", "Sale price"], ["color", "Colour"], ["size", "Size"], ["quantity", "Stock quantity"],
  ["description", "Description"], ["category", "Category"], ["brand", "Brand"], ["image_link", "Photo link"],
  ["additional_image_link", "More photo links"], ["availability", "Availability"], ["condition", "Condition"],
  ["material", "Material"], ["gender", "Gender"], ["age_group", "Age group"], ["link", "Product page link"],
];

export function shopHeaderField(cell) {
  const key = String(cell ?? "").trim().toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s*\(.*\)\s*$/, "").replace(/\s+/g, " ");
  return SHOP_ALIAS_MAP.get(key) || SHOP_ALIAS_MAP.get(key.replace(/ /g, "_")) || null;
}

/** Guess the header row and what each column of a product spreadsheet holds. */
export function guessShopColumns(table) {
  let headerRow = -1;
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const fields = (table[i] || []).map(shopHeaderField).filter(Boolean);
    if (fields.includes("title") || fields.length >= 3) { headerRow = i; break; }
  }
  const width = Math.max(0, ...table.map(r => r.length));
  const body = table.slice(headerRow + 1).filter(r => r.some(c => String(c ?? "").trim()));
  const mapping = [];
  for (let col = 0; col < width; col++) {
    const field = headerRow >= 0 ? shopHeaderField(table[headerRow][col]) : null;
    if (field && !mapping.includes(field)) { mapping.push(field); continue; }
    const values = body.map(r => String(r[col] ?? "").trim()).filter(Boolean);
    const numeric = values.length && values.filter(v => parseAmount(v) !== null && !/\p{L}{2,}/u.test(v)).length / values.length >= 0.7;
    if (headerRow < 0 && numeric && !mapping.includes("price")) mapping.push("price");
    else if (headerRow < 0 && values.length && !numeric && !mapping.includes("title")) mapping.push("title");
    else mapping.push("ignore");
  }
  return { headerRow, mapping };
}

/** Rows of {field: value} from a product spreadsheet and its column mapping. */
export function shopTableRows(table, { headerRow, mapping }) {
  const rows = [];
  for (let r = headerRow + 1; r < table.length; r++) {
    const cells = table[r] || [];
    if (!cells.some(c => String(c ?? "").trim())) continue;
    const row = {};
    mapping.forEach((field, col) => {
      const value = String(cells[col] ?? "").trim();
      if (field !== "ignore" && value) row[field] = value;
    });
    if (row.title) rows.push(row);
  }
  return rows;
}
