import test from "node:test";
import assert from "node:assert/strict";
import {
  feedRows, groupPhotoNames, guessShopColumns, isReady, newProduct, newShop, photoFileName, productIssues,
  productsFromRows, shopCode, shopTableRows, slug, syncVariants, toGoogleFeed, toMetaFeed, variantSku, whatsappLink, whatsappText,
} from "../catalog.js";

const csvRows = text => text.trim().split("\r\n").map(line => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map(c => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')));

test("naming conventions", () => {
  assert.equal(slug("Café Crème — Brûlée!"), "cafe-creme-brulee");
  assert.equal(shopCode("Dhaka Fashion House"), "DFH");
  assert.equal(shopCode("Zara"), "ZAR");
  assert.equal(shopCode("আড়ং"), "SHOP");
  assert.equal(variantSku("DFH-0001", "Navy Blue", "XL"), "DFH-0001-NAVYBLUE-XL");
  assert.equal(variantSku("DFH-0001", "", "42"), "DFH-0001-42");
  assert.equal(photoFileName("DFH-0001", 1), "dfh-0001-2.jpg");
  assert.equal(whatsappLink("+880 1711-000000", "Hi there"), "https://wa.me/8801711000000?text=Hi%20there");
});

test("product SKUs count up and never repeat", () => {
  const shop = newShop({ name: "Dhaka Fashion House", currency: "BDT" });
  const a = newProduct(shop); shop.products.push(a);
  const b = newProduct(shop); shop.products.push(b);
  shop.products = shop.products.filter(p => p !== b); // deleted
  const c = newProduct(shop);
  assert.deepEqual([a.sku, b.sku, c.sku], ["DFH-0001", "DFH-0002", "DFH-0003"]);
});

test("colours × sizes become variants and keep edits", () => {
  const shop = newShop({ name: "Test Shop", currency: "USD" });
  const p = newProduct(shop, { title: "Tee", colors: ["Black", "White"], sizes: ["M", "L"], photos: [{ url: "a" }, { url: "b" }] });
  syncVariants(p);
  assert.deepEqual(p.variants.map(v => [v.sku, v.photo]), [
    ["TS-0001-BLACK-M", 0], ["TS-0001-BLACK-L", 0], ["TS-0001-WHITE-M", 1], ["TS-0001-WHITE-L", 1],
  ]);
  p.variants[0].price = "12";
  p.sizes.push("XL");
  syncVariants(p);
  assert.equal(p.variants.length, 6);
  assert.equal(p.variants.find(v => v.color === "Black" && v.size === "M").price, "12");
  p.colors = ["লাল", "নীল"]; // non-Latin colour names reduce to the same code
  syncVariants(p);
  assert.equal(new Set(p.variants.map(v => v.sku)).size, p.variants.length);
});

test("readiness checks follow Meta's required fields", () => {
  const shop = newShop({ name: "Test Shop", currency: "USD" });
  const p = newProduct(shop, { title: "Tee" });
  assert.deepEqual(productIssues(p, shop).filter(i => i.level === "error").map(i => i.text), ["Add a price", "Add at least one photo", "Add a description"]);
  Object.assign(p, { price: "10", description: "Soft cotton", photos: [{ url: "https://x/a.jpg" }] });
  assert.ok(isReady(p, shop));
  assert.ok(productIssues(p, shop).some(i => i.text.startsWith("Add 2–3 photos")));
});

test("Meta feed: one row per variant, grouped, with image links and WhatsApp links", () => {
  const shop = newShop({ name: "Dhaka Fashion House", currency: "BDT", whatsapp: "8801711000000" });
  shop.imageBase = "https://dfh.github.io/photos";
  const p = newProduct(shop, {
    title: "Cotton Panjabi", description: "Soft, breathable cotton", price: "2500", salePrice: "2200",
    category: "Men > Panjabi", photos: [{ blob: 1 }, { blob: 2 }, { url: "https://cdn.example.com/x.jpg" }],
    colors: ["White", "Navy"], sizes: ["M"],
  });
  syncVariants(p);
  p.variants[1].quantity = "0";
  const rows = feedRows([p], shop);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.id, r.item_group_id, r.color, r.size, r.availability]), [
    ["DFH-0001-WHITE-M", "DFH-0001", "White", "M", "in stock"], ["DFH-0001-NAVY-M", "DFH-0001", "Navy", "M", "out of stock"],
  ]);
  assert.equal(rows[0].price, "2500.00 BDT");
  assert.equal(rows[0].sale_price, "2200.00 BDT");
  assert.equal(rows[0].brand, "Dhaka Fashion House");
  assert.equal(rows[0].image_link, "https://dfh.github.io/photos/dfh-0001-1.jpg");
  assert.equal(rows[0].additional_image_link, "https://dfh.github.io/photos/dfh-0001-2.jpg,https://cdn.example.com/x.jpg");
  assert.equal(rows[1].image_link, "https://dfh.github.io/photos/dfh-0001-2.jpg"); // Navy shows photo 2
  assert.match(rows[0].link, /^https:\/\/wa\.me\/8801711000000\?text=/);

  const meta = csvRows(toMetaFeed(rows));
  assert.deepEqual(meta[0].slice(0, 9), ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link"]);
  assert.equal(meta.length, 3);
  const google = toGoogleFeed(rows).split("\n")[1].split("\t");
  assert.ok(google.includes("in_stock"));
});

test("importing spreadsheet rows and feeds groups variants", () => {
  const shop = newShop({ name: "Test Shop", currency: "USD" });
  const table = [
    ["Product Name", "Colour", "Size", "Price", "Stock", "Image URL"],
    ["Linen Shirt", "Blue", "M", "30", "4", "https://x/blue.jpg"],
    ["Linen Shirt", "Blue", "L", "32", "0", ""],
    ["Linen Shirt", "Sand", "M", "30", "2", ""],
    ["Canvas Tote", "", "", "15", "9", "https://x/tote.jpg"],
  ];
  const guess = guessShopColumns(table);
  assert.deepEqual(guess.mapping, ["title", "color", "size", "price", "quantity", "image_link"]);
  const products = productsFromRows(shopTableRows(table, guess), shop);
  assert.equal(products.length, 2);
  const [shirt, tote] = products;
  assert.deepEqual([shirt.colors, shirt.sizes], [["Blue", "Sand"], ["M", "L"]]);
  assert.equal(shirt.variants.find(v => v.color === "Blue" && v.size === "L").price, "32");
  assert.equal(shirt.variants.find(v => v.color === "Sand" && v.size === "M").quantity, "2");
  assert.deepEqual(tote.photos, [{ url: "https://x/tote.jpg" }]);
  assert.equal(tote.quantity, "9");

  // A Meta feed exported by this tool imports back with the same SKUs.
  shop.imageBase = "https://x/photos";
  syncVariants(shirt);
  const feed = feedRows([shirt], shop);
  const again = productsFromRows(feed, newShop({ name: "Other", currency: "USD" }));
  assert.equal(again.length, 1);
  assert.equal(again[0].sku, shirt.sku);
  assert.deepEqual(again[0].variants.map(v => v.sku).sort(), feed.map(r => r.id).sort());
});

test("photo files are grouped into products by name", () => {
  const groups = groupPhotoNames(["red-dress-1.jpg", "red-dress-2.jpg", "Red Dress (3).jpg", "tote_bag.png", "IMG_2041.jpg"]);
  assert.deepEqual(groups.map(g => [g.title, g.names.length]), [["Red dress", 3], ["Tote bag", 1], ["", 1]]);
});

test("WhatsApp text list", () => {
  const shop = newShop({ name: "Test Shop", currency: "USD", whatsapp: "15550100" });
  const p = newProduct(shop, { title: "Tee", price: "10", salePrice: "8", colors: ["Black"], sizes: ["M", "L"] });
  const text = whatsappText([p], shop);
  assert.match(text, /^\*Test Shop\*/);
  assert.match(text, /• Tee — ~10\.00 USD~ \*8\.00 USD\*/);
  assert.match(text, /Colours: Black · Sizes: M, L/);
  assert.match(text, /wa\.me\/15550100/);
});
