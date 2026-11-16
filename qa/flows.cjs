// End-to-end check of the main flows in a real browser:
//   shop: create, products from photos, product by hand with colours and sizes,
//         spreadsheet import, Meta feed, Google feed, photo ZIP, backup/restore;
//   restaurant: create, paste a menu, download CSV.
//
//   npm run build && node qa/flows.cjs
// Needs Playwright with Chromium. Screenshots go to qa/output/flows/.
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const SITE = path.resolve(__dirname, "..", "_site");
const OUT = path.join(__dirname, "output", "flows");

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

// Simple product photos drawn in the browser: a garment shape in a colour.
async function makePhotos(page, dir) {
  const specs = [["linen-shirt-1.jpg", "#283c6e"], ["linen-shirt-2.jpg", "#c8b48c"], ["linen-shirt-3.jpg", "#1d2d55"],
    ["red-dress-1.jpg", "#aa1e28"], ["red-dress-2.jpg", "#961923"], ["IMG_2041.jpg", "#1e1e1e"]];
  for (const [name, color] of specs) {
    const data = await page.evaluate(color => {
      const c = document.createElement("canvas"); c.width = 900; c.height = 1100;
      const g = c.getContext("2d"); g.fillStyle = "#eeece6"; g.fillRect(0, 0, 900, 1100); g.fillStyle = color;
      g.beginPath(); [[250, 150], [650, 150], [820, 320], [720, 420], [650, 350], [650, 950], [250, 950], [250, 350], [180, 420], [80, 320]]
        .forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.fill();
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }, color);
    fs.writeFileSync(path.join(dir, name), Buffer.from(data, "base64"));
  }
  return specs.map(([name]) => path.join(dir, name));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // Photo links in the test spreadsheet point at example.com, which may be unreachable.
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("dialog", d => d.accept());
  const step = name => console.log(`✓ ${name}`);
  const shot = name => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  const download = async (selector, name) => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
    const target = path.join(OUT, name || file.suggestedFilename());
    await file.saveAs(target);
    return target;
  };

  await page.goto(url);
  await page.waitForSelector("#catalog-empty:not([hidden])");
  await shot("1-home-empty");
  step("home page");

  // ---- create a shop
  await page.click("#create-button");
  await page.check('input[name="type"][value="shop"]');
  await page.fill('#create-form input[name="name"]', "Dhaka Fashion House");
  await page.fill('#create-form input[name="currency"]', "BDT");
  await page.fill('#create-form input[name="whatsapp"]', "+880 1711-000000");
  await page.screenshot({ path: path.join(OUT, "2-create-dialog.png") });
  await page.click('#create-form button[type="submit"]');
  await page.waitForSelector("#products-empty:not([hidden])");
  assert.equal(await page.textContent("#ws-name"), "Dhaka Fashion House");
  assert.match(await page.textContent("#ws-meta"), /SKU prefix DFH/);
  step("create shop");

  // ---- products from photos
  const photos = await makePhotos(page, OUT);
  await page.setInputFiles("#product-photos", photos);
  await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 3);
  const titles = await page.$$eval(".product-card h3", hs => hs.map(h => h.textContent));
  assert.deepEqual(titles, ["Linen shirt", "Red dress", "Untitled product"]);
  assert.match(await page.textContent(".product-card .photo-count"), /3 photos/);
  step("products from photos (grouped by file name)");

  // ---- complete the first product by hand: price, description, colours, sizes
  await page.click(".product-card .card-open");
  await page.waitForSelector("#product-dialog[open]");
  await page.fill('#product-form input[name="title"]', "Linen Shirt");
  await page.fill('#product-form textarea[name="description"]', "Breathable linen, relaxed fit. Machine wash cold.");
  await page.fill('#product-form input[name="price"]', "1,850");
  await page.fill('#product-form input[name="salePrice"]', "1650");
  await page.fill('#product-form input[name="category"]', "Men > Shirts");
  await page.fill("#colors-input", "Navy, Sand");
  await page.press("#colors-input", "Enter");
  await page.click('[data-sizes="S,M,L,XL"]');
  await page.waitForFunction(() => document.querySelectorAll("#variants-body tr").length === 8);
  const skus = await page.$$eval("#variants-body .w-sku", inputs => inputs.map(i => i.value));
  assert.equal(skus[0], "DFH-0001-NAVY-S");
  await page.fill("#variants-body tr:nth-child(2) .w-stock", "0");
  await page.fill("#variants-body tr:nth-child(4) .w-price", "1950");
  await page.screenshot({ path: path.join(OUT, "3-product-editor.png") });
  assert.match(await page.textContent("#product-issues"), /Ready for WhatsApp/);
  await page.click("#product-save");
  await page.waitForFunction(() => !document.getElementById("product-dialog").open);
  assert.match(await page.textContent(".product-card:first-child .state"), /Ready/);
  step("edit product with colours, sizes, sale price");

  // ---- import a spreadsheet with variants
  const book = await page.evaluate(() => {
    const rows = [["Product Name", "SKU", "Colour", "Size", "Price", "Stock", "Category", "Description", "Image URL"],
      ["Cotton Panjabi", "", "White", "M", 2500, 5, "Men > Panjabi", "Soft breathable cotton", "https://example.com/p1.jpg"],
      ["Cotton Panjabi", "", "White", "L", 2500, 3, "Men > Panjabi", "Soft breathable cotton", ""],
      ["Cotton Panjabi", "", "Navy", "M", 2600, 0, "Men > Panjabi", "Soft breathable cotton", ""],
      ["Leather Belt", "BELT-01", "", "", 900, 12, "Accessories", "Genuine leather, brass buckle", "https://example.com/belt.jpg"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Products");
    return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  });
  const xlsx = path.join(OUT, "products.xlsx");
  fs.writeFileSync(xlsx, Buffer.from(book, "base64"));
  await page.click("#show-import");
  await page.setInputFiles("#files", xlsx);
  await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 5);
  const panjabi = await page.$$eval(".product-card", cards => cards.map(c => c.textContent).find(t => t.includes("Cotton Panjabi")));
  assert.match(panjabi, /2 colours · 2 sizes/);
  step("spreadsheet import with variants");

  // ---- a pasted price list (the same reader used for photos and PDFs of price lists)
  await page.click(".paste summary");
  await page.fill("#paste", "SCARVES\nCotton Scarf   450\nSilk Scarf   S 900  L 1200");
  await page.click("#add-paste");
  await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 7);
  const silk = await page.$$eval(".product-card", cards => cards.map(c => c.textContent).find(t => t.includes("Silk Scarf")));
  assert.match(silk, /2 sizes/);
  step("price list text becomes products");

  // ---- settings: photo link address
  await page.click("#ws-settings");
  await page.fill('#settings-form input[name="imageBase"]', "https://dfh.github.io/shop-photos/");
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById("settings-dialog").open);
  await shot("4-shop-workspace");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.click(".product-card .card-open");
  await page.waitForSelector("#product-dialog[open]");
  await page.screenshot({ path: path.join(OUT, "4b-dark-editor.png") });
  await page.click("#product-dialog [data-close]");
  await page.locator("#products-section").screenshot({ path: path.join(OUT, "4c-dark-products.png") });
  await page.emulateMedia({ colorScheme: "light" });
  step("shop settings");

  // ---- exports
  const meta = fs.readFileSync(await download("#export-meta", "meta.csv"), "utf8").replace(/^﻿/, "");
  const lines = meta.trim().split("\r\n");
  assert.ok(lines[0].startsWith("id,title,description,availability,condition,price"));
  assert.ok(lines.some(l => l.startsWith("DFH-0001-NAVY-S,Linen Shirt,")), "variant rows");
  assert.ok(meta.includes("https://dfh.github.io/shop-photos/dfh-0001-1.jpg"), "photo links from the photo address");
  assert.ok(meta.includes("1650.00 BDT"), "sale price");
  assert.ok(meta.includes("https://wa.me/8801711000000"), "WhatsApp links");
  assert.ok(!meta.includes("Red dress"), "unready products left out");
  const google = fs.readFileSync(await download("#export-google", "google.tsv"), "utf8");
  assert.ok(google.split("\n")[0].startsWith("id\ttitle\tdescription\tlink"));
  const zip = await download("#export-photos", "photos.zip");
  assert.ok(fs.statSync(zip).size > 10000);
  await download("#export-xlsx", "catalog.xlsx");
  step(`exports (Meta ${lines.length - 1} rows, Google, photos ZIP, Excel)`);

  // ---- backup and restore
  await page.click("#ws-settings");
  const backup = await download("#download-backup", "backup.json");
  await page.click("#settings-dialog [data-close]");
  await page.goto(url + "#/");
  await page.setInputFiles("#restore-file", backup);
  await page.waitForFunction(() => document.querySelector("#ws-name")?.textContent.includes("(restored)"));
  await page.waitForFunction(() => document.querySelectorAll(".product-card").length === 7);
  assert.equal(await page.$$eval(".product-card .thumb img", imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length) >= 3, true);
  step("backup and restore with photos");

  // ---- restaurant menu
  await page.goto(url + "#/");
  await page.click("#create-button");
  await page.check('input[name="type"][value="restaurant"]');
  await page.fill('#create-form input[name="name"]', "The Copper Pot");
  await page.fill('#create-form input[name="currency"]', "USD");
  await page.click('#create-form button[type="submit"]');
  await page.waitForSelector("#add-section:not([hidden])");
  await page.click(".paste summary");
  await page.fill("#paste", "STARTERS\nGarlic Bread   4.50\nTomato Soup   6.00\nMAINS\nBeef Burger   12.00");
  await page.click("#add-paste");
  await page.waitForFunction(() => document.querySelectorAll("#grid-body tr").length === 3);
  const csv = fs.readFileSync(await download("#download-csv", "menu.csv"), "utf8");
  assert.match(csv, /STARTERS,Garlic Bread,,,,4\.50,USD/);
  await shot("5-restaurant");
  step("restaurant menu");

  // ---- home lists all three, and a menu survives leaving and a reload
  await page.click(".brand");
  await page.waitForSelector("#home-view:not([hidden])");
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".catalog-card").length === 3);
  assert.match(await page.textContent(".catalog-card.restaurant"), /3 menu rows/, "menu rows saved");
  await shot("6-home");
  step("home lists catalogs after reload");

  // ---- phone layout
  const phone = await browser.newContext({ ...require("playwright").devices["iPhone 13"] });
  const p2 = await phone.newPage();
  p2.on("pageerror", e => errors.push(e.message));
  await p2.goto(url);
  await p2.click("#create-button");
  await p2.check('input[name="type"][value="shop"]');
  await p2.fill('#create-form input[name="name"]', "Phone Shop");
  await p2.click('#create-form button[type="submit"]');
  await p2.waitForSelector("#products-empty:not([hidden])");
  await p2.setInputFiles("#product-photos", photos.slice(0, 2));
  await p2.waitForFunction(() => document.querySelectorAll(".product-card").length === 1);
  await p2.click(".product-card .card-open");
  await p2.waitForSelector("#product-dialog[open]");
  await p2.screenshot({ path: path.join(OUT, "7-phone-editor.png") });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.equal(overflow, 0, "no sideways scrolling on phones");
  await p2.click("#product-dialog [data-close]");
  await p2.screenshot({ path: path.join(OUT, "8-phone-shop.png"), fullPage: true });
  step("phone layout");

  await browser.close();
  server.close();
  if (errors.length) {
    console.error("Page errors:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("All flows passed.");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
