// End-to-end QA: renders each test menu as a photo-like image, runs it through
// the built web tool in a real browser, and scores the items it finds.
//
//   npm run build && node qa/run.cjs [--manual] [case-id …]
//
// Default mode is what a new user gets: languages left at English with
// automatic detection on. --manual ticks the right languages instead.
// Needs Playwright with Chromium (npx playwright install chromium).
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cases = require("./cases.cjs");

const ROOT = path.resolve(__dirname, "..");
const SITE = path.resolve(process.env.SITE || path.join(ROOT, "_site"));
const OUT = path.join(__dirname, "output", process.env.QA_LABEL || "");
const args = process.argv.slice(2);
const manual = args.includes("--manual");
const only = args.filter(a => !a.startsWith("--"));
const MANUAL_LANGS = {
  "fr-bistro": ["eng", "fra"], "ar-grill": ["ara", "eng"], "es-tapas-sizes": ["eng", "spa"], "de-cafe": ["eng", "deu"],
  "bn-cafe": ["ben", "eng"], "zh-noodles": ["chi_sim", "eng"], "ar-western-digits": ["ara", "eng"],
};

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".gz": "application/gzip", ".wasm": "application/wasm" };
  const server = http.createServer((req, res) => {
    const file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

// Similarity of two names, 0..1 (Levenshtein on normalised text).
function similarity(a, b) {
  const norm = s => s.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
  a = [...norm(a)]; b = [...norm(b)];
  if (!a.length || !b.length) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

function score(expected, rows) {
  const used = new Set();
  let found = 0, exact = 0;
  for (const [name, price] of expected) {
    let best = -1, bestSim = 0;
    rows.forEach((row, i) => {
      if (used.has(i) || Number(row.price) !== Number(price)) return;
      const sim = similarity(name, row.name);
      if (sim > bestSim) { best = i; bestSim = sim; }
    });
    if (best >= 0 && bestSim >= 0.75) {
      used.add(best);
      found++;
      if (bestSim === 1) exact++;
    }
  }
  return { found, exact, total: expected.length, extra: rows.length - used.size };
}

async function photograph(browser, test) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 });
  const file = path.join(__dirname, "output", `${test.id}.html`);
  fs.writeFileSync(file, test.html);
  await page.goto("file://" + file);
  await page.evaluate(() => document.fonts.ready);
  const clean = await page.locator(".menu").screenshot();
  // Turn the clean render into a "phone photo": rotation, tilt, blur, shadow, grain.
  const { rotate = 0, tilt = 0, blur = 0, shadow = 0, noise = 0 } = test.effects || {};
  const dataUrl = await page.evaluate(async ({ src, rotate, tilt, blur, shadow, noise }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const angle = ((rotate + tilt) * Math.PI) / 180;
    const w = Math.abs(img.width * Math.cos(angle)) + Math.abs(img.height * Math.sin(angle));
    const h = Math.abs(img.width * Math.sin(angle)) + Math.abs(img.height * Math.cos(angle));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w + 80); canvas.height = Math.round(h + 80);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#7d7368"; ctx.fillRect(0, 0, canvas.width, canvas.height); // table under the menu
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, `rgba(0,0,0,${shadow})`); g.addColorStop(0.6, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(255,240,200,${shadow / 3})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let seed = 12345; // same grain on every run, so results are comparable
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < data.data.length; i += 4) {
      const n = (random() - 0.5) * 255 * noise;
      data.data[i] += n; data.data[i + 1] += n; data.data[i + 2] += n;
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, { src: "data:image/png;base64," + clean.toString("base64"), rotate, tilt, blur, shadow, noise });
  await page.close();
  const out = path.join(OUT, `${test.id}.jpg`);
  fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const results = [];
  for (const test of cases.filter(c => !only.length || only.includes(c.id))) {
    const image = await photograph(browser, test);
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const langs = manual ? MANUAL_LANGS[test.id] || ["eng"] : ["eng"];
    await context.addInitScript(settings => localStorage.setItem("menu-to-csv:v1", JSON.stringify({ settings })),
      { langs, autoLang: !manual, autoRotate: true, cleanup: "auto", minConfidence: 40, layout: "auto", currency: "USD", upscale: "auto" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(url);
    const started = Date.now();
    await page.setInputFiles("#files", image);
    await page.waitForFunction(() => /done|error/i.test(document.getElementById("status").textContent)
      || document.getElementById("status").classList.contains("error"), null, { timeout: 240000 });
    const seconds = (Date.now() - started) / 1000;
    const rows = await page.$$eval("#grid-body tr", trs => trs.map(tr => {
      const [section, name, nameEn, description, portion, price, currency] = [...tr.querySelectorAll("input")].map(i => i.value);
      return { section, name, portion, price, currency };
    }));
    const info = (await page.$(".read-info")) ? await page.textContent(".read-info") : "";
    const text = await page.inputValue(".source textarea");
    fs.writeFileSync(path.join(OUT, `${test.id}-words.json`), JSON.stringify(await page.evaluate(() => window.lastOcrWords || []), null, 0));
    const result = { id: test.id, title: test.title, seconds, info, errors, ...score(test.expected, rows), rows, text };
    results.push(result);
    console.log(`${test.id.padEnd(24)} ${result.found}/${result.total} found, ${result.exact} exact names, ${result.extra} extra rows, ${seconds.toFixed(1)}s · ${info}`);
    if (errors.length) console.log("  page errors:", errors.join(" | "));
    await page.screenshot({ path: path.join(OUT, `${test.id}-tool.png`), fullPage: true });
    await context.close();
  }
  await browser.close();
  server.close();
  const total = results.reduce((t, r) => ({ found: t.found + r.found, exact: t.exact + r.exact, total: t.total + r.total, extra: t.extra + r.extra }), { found: 0, exact: 0, total: 0, extra: 0 });
  console.log(`\nTOTAL ${total.found}/${total.total} items found (${Math.round((100 * total.found) / total.total)}%), ${total.exact} exact names, ${total.extra} extra rows`);
  fs.writeFileSync(path.join(OUT, `results${manual ? "-manual" : ""}.json`), JSON.stringify({ total, results }, null, 2));
})();
