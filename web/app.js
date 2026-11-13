import {
  COLUMNS, COLUMN_LABELS, guessColumns, layoutText, looksLikeTable, parseAmount, parseMenuText,
  tableToRows, toCSV,
} from "./parser.js";

const $ = id => document.getElementById(id);
const STORE_KEY = "menu-to-csv:v1";
const MAPPING_CHOICES = [
  ["ignore", "Ignore"], ["name", "Item name"], ["section", "Section"], ["description", "Description"],
  ["price", "Price"], ["price_option", "Price for size (use header)"], ["portion", "Portion / size"],
  ["currency", "Currency"], ["name_en", "English name"],
];
const CURRENCIES = "BDT USD EUR GBP INR PKR LKR NPR AED SAR QAR KWD OMR BHD EGP TRY JPY CNY KRW THB VND IDR MYR SGD PHP AUD NZD CAD CHF SEK NOK DKK PLN CZK HUF RON RUB UAH ILS BRL MXN ZAR NGN KES".split(" ");

const state = {
  sources: [],   // {id, kind: "image"|"text"|"table", title, ...}
  rows: [],      // {id, src, section, name, name_en, description, portion, price, currency, source, edited}
  onlyIssues: false,
};
let nextId = 1;
const newId = () => nextId++;

// ------------------------------------------------------------------ settings

let languages = [];
const settings = loadSettings();

function loadSettings() {
  const stored = readStore();
  const region = (navigator.language || "en-US").split("-")[1] || "";
  const byRegion = { BD: "BDT", US: "USD", GB: "GBP", IN: "INR", PK: "PKR", AE: "AED", SA: "SAR", JP: "JPY", CN: "CNY", KR: "KRW", TH: "THB", VN: "VND", ID: "IDR", MY: "MYR", SG: "SGD", AU: "AUD", CA: "CAD", TR: "TRY", NP: "NPR", LK: "LKR" };
  const euro = ["DE", "FR", "ES", "IT", "NL", "PT", "IE", "AT", "BE", "FI", "GR"];
  return {
    langs: stored.settings?.langs || ["eng"],
    currency: stored.settings?.currency || byRegion[region] || (euro.includes(region) ? "EUR" : "USD"),
    layout: stored.settings?.layout || "auto",
  };
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings,
        rows: state.rows.map(({ id, src, ...row }) => row),
      }));
    } catch { /* storage full or blocked: the page still works */ }
  }, 300);
}

async function setupOptions() {
  try {
    languages = await (await fetch("languages.json")).json();
  } catch {
    languages = [["eng", "English"]];
  }
  const list = $("language-list");
  for (const [code, name] of languages) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = code;
    box.checked = settings.langs.includes(code);
    box.addEventListener("change", () => {
      settings.langs = [...list.querySelectorAll("input:checked")].map(i => i.value);
      if (!settings.langs.length) { settings.langs = ["eng"]; list.querySelector('input[value="eng"]').checked = true; }
      updateLanguageSummary();
      save();
    });
    label.append(box, name);
    list.append(label);
  }
  updateLanguageSummary();

  for (const code of CURRENCIES) $("currency-list").append(new Option(code, code));
  $("currency").value = settings.currency;
  $("currency").addEventListener("change", () => {
    const value = $("currency").value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(value)) { settings.currency = value; save(); }
    $("currency").value = settings.currency;
  });
  $("layout").value = settings.layout;
  $("layout").addEventListener("change", () => { settings.layout = $("layout").value; save(); });
}

function updateLanguageSummary() {
  const names = Object.fromEntries(languages);
  $("language-summary").textContent = settings.langs.map(code => names[code] || code).join(", ");
}

// ------------------------------------------------------------------ status

function status(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

// ------------------------------------------------------------------ files

$("files").addEventListener("change", event => {
  addFiles([...event.target.files]);
  event.target.value = "";
});
const drop = $("drop");
drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", event => {
  event.preventDefault();
  drop.classList.remove("over");
  addFiles([...event.dataTransfer.files]);
});
document.addEventListener("paste", event => {
  if (event.target.closest("input, textarea")) return;
  const files = [...event.clipboardData.files].filter(f => f.type.startsWith("image/"));
  if (files.length) addFiles(files);
});

let queue = Promise.resolve();
function addFiles(files) {
  for (const file of files) {
    queue = queue
      .then(() => addFile(file))
      .then(() => { if ($("status").textContent.startsWith("Opening")) status(`${file.name || "Image"} added. Check the items below.`); })
      .catch(error => status(`${file.name}: ${error.message}`, true));
  }
}

async function addFile(file) {
  const name = file.name || "pasted image";
  const ext = (name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
  status(`Opening ${name}…`);
  if (ext === ".pdf" || file.type === "application/pdf") return addPdf(file);
  if ([".xlsx", ".xlsm", ".xls", ".ods"].includes(ext)) return addWorkbook(file);
  if ([".csv", ".tsv"].includes(ext) || file.type === "text/csv") return addDelimited(name, await readText(file));
  if (ext === ".docx") return addTextSource(name, await docxText(file));
  if (ext === ".txt" || file.type === "text/plain") {
    const text = await readText(file);
    return looksLikeTable(text) ? addDelimited(name, text) : addTextSource(name, text);
  }
  if (file.type.startsWith("image/") || [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"].includes(ext)) {
    let image;
    try {
      image = await createImageBitmap(file);
    } catch {
      throw new Error(ext === ".heic" || ext === ".heif"
        ? "This browser cannot open HEIC photos. On iPhone, set Camera › Formats › Most Compatible, or share the photo as JPEG."
        : "This image could not be opened.");
    }
    return addImageSource(name, image);
  }
  throw new Error("This file type is not supported. Use a photo, PDF, Excel, CSV, Word or text file.");
}

async function readText(file) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

async function docxText(file) {
  const zip = XLSX.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const entry = XLSX.CFB.find(zip, "word/document.xml") || XLSX.CFB.find(zip, "/word/document.xml");
  if (!entry) throw new Error("This Word file could not be read. Save it as PDF and try again.");
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(entry.content), "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const text = node => [...node.getElementsByTagNameNS(W, "t")].map(t => t.textContent).join("");
  const body = xml.getElementsByTagNameNS(W, "body")[0];
  const lines = [];
  for (const block of body.children) {
    if (block.localName === "p") lines.push(text(block));
    if (block.localName === "tbl") {
      for (const row of block.getElementsByTagNameNS(W, "tr")) {
        lines.push([...row.getElementsByTagNameNS(W, "tc")].map(cell => text(cell).trim()).join("   "));
      }
    }
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ PDF

let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

async function addPdf(file) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
  }).promise;
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const title = doc.numPages > 1 ? `${file.name} · page ${number}` : file.name;
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words = [];
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = lib.Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(tx[2], tx[3]) || item.height;
      words.push({ text: item.str, x0: tx[4], y0: tx[5] - height, x1: tx[4] + item.width * viewport.scale, y1: tx[5] });
    }
    const scale = Math.min(3, 3000 / Math.max(viewport.width, viewport.height));
    const render = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(render.width);
    canvas.height = Math.round(render.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: render }).promise;
    const chars = words.reduce((n, w) => n + w.text.trim().length, 0);
    if (chars >= 20) {
      const source = addTextSource(title, layoutText(words, { splitColumns: settings.layout === "auto" }), canvas);
      source.note = "Text read from the PDF. Select Read with OCR if it looks wrong.";
      renderSource(source);
    } else {
      await addImageSource(title, canvas);
    }
  }
}

// ------------------------------------------------------------------ spreadsheets

async function addWorkbook(file) {
  const book = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: true });
  for (const sheetName of book.SheetNames) {
    const table = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false })
      .map(row => row.map(cell => String(cell ?? "").trim()));
    if (!table.some(row => row.some(Boolean))) continue;
    addTableSource(book.SheetNames.length > 1 ? `${file.name} · ${sheetName}` : file.name, table);
  }
}

function addDelimited(title, text) {
  const delimiter = looksLikeTable(text) || "";
  const result = Papa.parse(text.trim(), { delimiter, skipEmptyLines: "greedy" });
  addTableSource(title, result.data.map(row => row.map(cell => String(cell ?? "").trim())));
}

function addTableSource(title, table) {
  const source = { id: newId(), kind: "table", title, table, ...guessColumns(table) };
  state.sources.push(source);
  renderSource(source);
  applySource(source);
}

// ------------------------------------------------------------------ text and images

function addTextSource(title, text, preview = null) {
  const source = { id: newId(), kind: "text", title, text, preview };
  state.sources.push(source);
  renderSource(source);
  applySource(source);
  return source;
}

async function addImageSource(title, image) {
  const source = { id: newId(), kind: "image", title, image, rotation: 0, invert: null, text: "" };
  state.sources.push(source);
  renderSource(source);
  await recognize(source);
}

let worker = null;
let workerKey = "";
let progressTarget = null;

async function getWorker() {
  const key = settings.langs.join("+");
  if (worker && workerKey === key) return worker;
  if (worker) await worker.terminate();
  const base = new URL(".", location.href).href;
  status(`Loading text recognition for ${$("language-summary").textContent}… The first time takes a moment.`);
  worker = await Tesseract.createWorker(settings.langs, 1, {
    workerPath: base + "vendor/tesseract/worker.min.js",
    corePath: base + "vendor/tesseract-core",
    langPath: base + "lang",
    logger: message => {
      if (progressTarget && message.status === "recognizing text") progressTarget.style.width = `${Math.round(message.progress * 100)}%`;
    },
  });
  workerKey = key;
  return worker;
}

/** Draw the image upright, large enough for OCR, in grayscale with stretched contrast. */
function prepareImage(source) {
  const { image, rotation } = source;
  const w = image.width, h = image.height;
  const long = Math.max(w, h), short = Math.min(w, h);
  let scale = Math.min(1, 3200 / long);
  if (short * scale < 1400) scale = Math.min(3200 / long, 1400 / short, 3);
  const sideways = rotation % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((sideways ? h : w) * scale);
  canvas.height = Math.round((sideways ? w : h) * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = y;
    histogram[y]++;
    sum += y;
  }
  const count = px.length / 4;
  const invert = source.invert ?? sum / count < 110; // light text on a dark menu
  let low = 0, high = 255, seen = 0;
  for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen > count * 0.01) { low = v; break; } }
  seen = 0;
  for (let v = 255; v >= 0; v--) { seen += histogram[v]; if (seen > count * 0.01) { high = v; break; } }
  const range = Math.max(1, high - low);
  for (let i = 0; i < px.length; i += 4) {
    let y = Math.min(255, Math.max(0, ((px[i] - low) * 255) / range));
    if (invert) y = 255 - y;
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  ctx.putImageData(data, 0, 0);
  source.autoInverted = invert;
  return canvas;
}

async function recognize(source) {
  const view = source.view;
  const bar = view.querySelector(".progress div");
  view.querySelector(".progress").hidden = false;
  view.querySelectorAll("button").forEach(b => { b.disabled = true; });
  bar.style.width = "0%";
  try {
    const canvas = prepareImage(source);
    view.querySelector(".preview").replaceChildren(previewElement(canvas));
    const ocr = await getWorker();
    status(`Reading ${source.title}…`);
    progressTarget = bar;
    await ocr.setParameters({ tessedit_pageseg_mode: settings.layout === "single" ? "6" : "3", preserve_interword_spaces: "1" });
    const { data } = await ocr.recognize(canvas, {}, { blocks: true, text: true });
    const words = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words) {
            words.push({ text: word.text, conf: word.confidence, ...word.bbox });
          }
        }
      }
    }
    source.text = words.length ? layoutText(words, { splitColumns: settings.layout === "auto" }) : data.text;
    view.querySelector("textarea").value = source.text;
    applySource(source);
    status(`${source.title}: done. Check the text and the items below.`);
  } catch (error) {
    status(`${source.title}: ${error.message || error}`, true);
  } finally {
    progressTarget = null;
    view.querySelector(".progress").hidden = true;
    view.querySelectorAll("button").forEach(b => { b.disabled = false; });
  }
}

function previewElement(canvasOrBitmap) {
  let canvas = canvasOrBitmap;
  if (!(canvas instanceof HTMLCanvasElement)) {
    canvas = document.createElement("canvas");
    canvas.width = canvasOrBitmap.width;
    canvas.height = canvasOrBitmap.height;
    canvas.getContext("2d").drawImage(canvasOrBitmap, 0, 0);
  }
  const link = document.createElement("a");
  link.className = "zoom";
  link.title = "Open full size";
  link.target = "_blank";
  canvas.toBlob(blob => { if (blob) link.href = URL.createObjectURL(blob); }, "image/jpeg", 0.85);
  const img = document.createElement("img");
  img.alt = "Menu page";
  img.src = canvas.toDataURL("image/jpeg", 0.6);
  link.append(img);
  return link;
}

// ------------------------------------------------------------------ source cards

function renderSource(source) {
  $("sources-section").hidden = false;
  const card = source.view || document.createElement("article");
  card.className = "source" + (source.kind === "table" ? " table-source" : "");
  card.replaceChildren();
  source.view = card;

  if (source.kind === "table") {
    const title = document.createElement("h3");
    title.textContent = source.title;
    const help = document.createElement("p");
    help.className = "help";
    help.textContent = "Choose what each column holds. Bold is the header row. Columns marked “Price for size” become one row per size, labelled with the column header.";
    const wrap = document.createElement("div");
    wrap.className = "mapping-wrap";
    wrap.append(mappingTable(source));
    const headerLabel = document.createElement("label");
    headerLabel.className = "toggle";
    const headerInput = document.createElement("input");
    headerInput.type = "number";
    headerInput.min = 0;
    headerInput.style.width = "5em";
    headerInput.value = source.headerRow + 1;
    headerInput.addEventListener("change", () => {
      source.headerRow = Math.max(-1, Math.min(source.table.length - 1, Number(headerInput.value) - 1));
      renderSource(source);
    });
    headerLabel.append("Header row (0 for none):", headerInput);
    card.append(title, help, headerLabel, wrap, sourceActions(source));
  } else {
    const preview = document.createElement("div");
    preview.className = "preview";
    if (source.kind === "image") preview.append(previewElement(source.image));
    else if (source.preview) preview.append(previewElement(source.preview));
    else preview.hidden = true;
    const body = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = source.title;
    const progress = document.createElement("div");
    progress.className = "progress";
    progress.hidden = true;
    progress.append(document.createElement("div"));
    const textarea = document.createElement("textarea");
    textarea.value = source.text;
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", `Recognized text of ${source.title}`);
    textarea.addEventListener("input", () => { source.text = textarea.value; });
    body.append(title);
    if (source.note) {
      const note = document.createElement("p");
      note.className = "help";
      note.textContent = source.note;
      body.append(note);
    }
    body.append(progress, textarea, sourceActions(source), unmatchedList(source));
    card.append(preview, body);
    if (preview.hidden) card.style.gridTemplateColumns = "minmax(0, 1fr)";
  }
  if (!card.isConnected) $("sources").append(card);
}

function sourceActions(source) {
  const actions = document.createElement("div");
  actions.className = "actions";
  const add = (label, handler, kind = "secondary") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = kind;
    button.textContent = label;
    button.addEventListener("click", handler);
    actions.append(button);
  };
  add("Update items", () => applySource(source, true), "");
  if (source.kind === "image") {
    add("Rotate", () => { source.rotation = (source.rotation + 90) % 360; recognize(source); });
    add("Invert colors", () => { source.invert = !source.autoInverted; recognize(source); });
    add("Read again", () => recognize(source));
  }
  if (source.kind === "text" && source.preview) {
    add("Read with OCR", () => {
      Object.assign(source, { kind: "image", image: source.preview, rotation: 0, invert: null, note: "" });
      renderSource(source);
      recognize(source);
    });
  }
  add("Remove", () => {
    if (!confirmReplace(source, "Remove this file and its items?")) return;
    state.sources = state.sources.filter(s => s !== source);
    state.rows = state.rows.filter(r => r.src !== source.id);
    source.view.remove();
    $("sources-section").hidden = !state.sources.length;
    renderGrid();
  }, "danger");
  return actions;
}

function unmatchedList(source) {
  const box = document.createElement("details");
  box.className = "unmatched";
  box.hidden = true;
  source.unmatchedView = box;
  return box;
}

function showUnmatched(source, unmatched) {
  const box = source.unmatchedView;
  if (!box) return;
  box.hidden = !unmatched.length;
  const summary = document.createElement("summary");
  summary.textContent = `${unmatched.length} line${unmatched.length === 1 ? "" : "s"} not used as items`;
  const list = document.createElement("ul");
  for (const entry of unmatched) {
    const li = document.createElement("li");
    li.textContent = entry.text;
    list.append(li);
  }
  box.replaceChildren(summary, list);
}

function mappingTable(source) {
  const table = document.createElement("table");
  const width = Math.max(...source.table.map(r => r.length));
  const head = document.createElement("tr");
  for (let col = 0; col < width; col++) {
    const th = document.createElement("th");
    const select = document.createElement("select");
    for (const [value, label] of MAPPING_CHOICES) select.add(new Option(label, value));
    select.value = source.mapping[col] || "ignore";
    select.setAttribute("aria-label", `Column ${col + 1}`);
    select.addEventListener("change", () => {
      const unique = ["name", "section", "description", "portion", "currency", "name_en"];
      if (unique.includes(select.value)) {
        source.mapping = source.mapping.map((m, i) => (m === select.value && i !== col ? "ignore" : m));
      }
      source.mapping[col] = select.value;
      renderSource(source);
      applySource(source, true);
    });
    th.append(select);
    head.append(th);
  }
  const thead = document.createElement("thead");
  thead.append(head);
  const tbody = document.createElement("tbody");
  const start = Math.max(0, source.headerRow);
  source.table.slice(0, start + 8).forEach((row, index) => {
    if (index < start - 2) return;
    const tr = document.createElement("tr");
    if (index === source.headerRow) tr.className = "header-row";
    for (let col = 0; col < width; col++) {
      const td = document.createElement("td");
      td.textContent = row[col] ?? "";
      tr.append(td);
    }
    tbody.append(tr);
  });
  if (source.table.length > start + 8) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = width;
    td.textContent = `… ${source.table.length - start - 8} more rows`;
    tr.append(td);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return table;
}

function confirmReplace(source, message) {
  const edited = state.rows.some(r => r.src === source.id && r.edited);
  return !edited || confirm(`${message}\nYou edited some of its items in the table; those edits will be lost.`);
}

/** (Re)build the rows that come from one source, keeping their place in the table. */
function applySource(source, userAction = false) {
  if (userAction && !confirmReplace(source, "Update the items from this file?")) return;
  const options = { defaultCurrency: settings.currency, source: source.title };
  let result;
  if (source.kind === "table") {
    result = tableToRows(source.table, source, options);
    result.unmatched = result.issues;
  } else {
    result = parseMenuText(source.text || "", options);
  }
  showUnmatched(source, result.unmatched || []);
  const fresh = result.rows.map(row => ({ ...row, id: newId(), src: source.id, edited: false }));
  const first = state.rows.findIndex(r => r.src === source.id);
  const kept = state.rows.filter(r => r.src !== source.id);
  const at = first < 0 ? kept.length : state.rows.slice(0, first).filter(r => r.src !== source.id).length;
  kept.splice(at, 0, ...fresh);
  state.rows = kept;
  renderGrid();
  if (userAction) status(`${source.title}: ${fresh.length} item rows.`);
}

// ------------------------------------------------------------------ grid

function rowIssue(row) {
  if (!row.name.trim()) return "Missing item name";
  if (!String(row.price).trim()) return "Missing price";
  if (parseAmount(row.price) === null) return "Price is not a number";
  return "";
}

function renderGrid() {
  const has = state.rows.length > 0;
  $("items-section").hidden = !has && !state.sources.length;
  $("download-section").hidden = !has;
  const head = $("grid-head");
  if (!head.children.length) {
    head.append(cell("th", "#"));
    for (const column of COLUMNS) head.append(cell("th", COLUMN_LABELS[column]));
    head.append(cell("th", ""));
  }
  const body = $("grid-body");
  body.replaceChildren();
  let issues = 0;
  state.rows.forEach((row, index) => {
    const issue = rowIssue(row);
    if (issue) issues++;
    if (state.onlyIssues && !issue) return;
    const tr = document.createElement("tr");
    tr.className = issue ? "issue" : "";
    const num = cell("td", String(index + 1));
    num.className = "num";
    num.title = [issue, row.source].filter(Boolean).join(" · ");
    tr.append(num);
    for (const column of COLUMNS) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.className = `w-${column}`;
      input.value = row[column] ?? "";
      input.setAttribute("aria-label", `${COLUMN_LABELS[column]}, row ${index + 1}`);
      if (column === "price") input.inputMode = "decimal";
      input.addEventListener("input", () => {
        row[column] = input.value;
        row.edited = true;
        const nowIssue = rowIssue(row);
        tr.className = nowIssue ? "issue" : "";
        num.title = [nowIssue, row.source].filter(Boolean).join(" · ");
        save();
      });
      input.addEventListener("change", () => {
        if (column === "price" && input.value.trim()) {
          const amount = parseAmount(input.value);
          if (amount !== null) row.price = input.value = amount;
        }
        if (column === "currency") row.currency = input.value = input.value.trim().toUpperCase();
        updateSummary();
        save();
      });
      td.append(input);
      tr.append(td);
    }
    const actions = document.createElement("td");
    actions.className = "row-actions";
    actions.append(
      iconButton("＋", "Insert a row below", () => {
        state.rows.splice(index + 1, 0, blankRow(row));
        renderGrid();
        focusRow(index + 1);
      }),
      iconButton("⧉", "Duplicate (for another size)", () => {
        state.rows.splice(index + 1, 0, { ...row, id: newId(), portion: "", price: "", edited: true });
        renderGrid();
        focusRow(index + 1, "portion");
      }),
      iconButton("✕", "Delete row", () => { state.rows.splice(index, 1); renderGrid(); }),
    );
    tr.append(actions);
    body.append(tr);
  });
  updateSummary(issues);
  save();
}

function updateSummary(issues = state.rows.filter(rowIssue).length) {
  const items = new Set(state.rows.map(r => `${r.section}\u0000${r.name}`)).size;
  $("items-summary").textContent = state.rows.length
    ? `${items} items, ${state.rows.length} rows (one per price).` + (issues ? ` ${issues} highlighted rows need a name or price.` : " Everything has a name and a price.")
    : "No items yet.";
}

function blankRow(like = {}) {
  return {
    id: newId(), src: null, section: like.section || "", name: "", name_en: "", description: "", portion: "",
    price: "", currency: like.currency || settings.currency, source: "added by hand", edited: true,
  };
}

function focusRow(index, column = "name") {
  const inputs = $("grid-body").querySelectorAll(`input.w-${column}`);
  inputs[Math.min(index, inputs.length - 1)]?.focus();
}

function cell(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function iconButton(text, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

$("only-issues").addEventListener("change", event => { state.onlyIssues = event.target.checked; renderGrid(); });
$("add-row").addEventListener("click", () => {
  state.rows.push(blankRow(state.rows.at(-1)));
  state.onlyIssues = false;
  $("only-issues").checked = false;
  renderGrid();
  focusRow(state.rows.length - 1);
});
$("clear").addEventListener("click", () => {
  if (!confirm("Remove all files and items?")) return;
  state.rows = [];
  state.sources = [];
  $("sources").replaceChildren();
  $("sources-section").hidden = true;
  renderGrid();
  status("");
});

// ------------------------------------------------------------------ paste

$("add-paste").addEventListener("click", () => {
  const text = $("paste").value;
  if (!text.trim()) return;
  if (looksLikeTable(text)) addDelimited("Pasted table", text);
  else addTextSource("Pasted text", text);
  $("paste").value = "";
  status("Pasted text added.");
});

// ------------------------------------------------------------------ download

const exportRows = () => state.rows.filter(r => r.name.trim() || String(r.price).trim());

function download(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

$("download-csv").addEventListener("click", () => {
  download(new Blob([toCSV(exportRows())], { type: "text/csv;charset=utf-8" }), "menu.csv");
  status("CSV downloaded.");
});
$("download-xlsx").addEventListener("click", () => {
  const rows = exportRows().map(r => COLUMNS.map(c => (c === "price" && r.price !== "" ? Number(r.price) : r[c] ?? "")));
  const sheet = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Menu");
  XLSX.writeFile(book, "menu.xlsx");
  status("Excel file downloaded.");
});
$("copy-tsv").addEventListener("click", async () => {
  const clean = v => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  const tsv = [COLUMNS, ...exportRows().map(r => COLUMNS.map(c => r[c]))].map(r => r.map(clean).join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(tsv);
    status("Copied. Paste into the first cell of a Google Sheet.");
  } catch {
    status("The browser blocked copying. Use Download CSV instead.", true);
  }
});

const AI_PROMPT = `Read the attached restaurant menu and reply with only a CSV table (no other text) with these columns:
section,name,name_en,description,portion,price,currency
Rules: one row per price (an item with Small/Large prices gets two rows, with the size in "portion"). Keep names as printed in the original language; put an English translation in name_en if the menu is not in English. price is a plain number with a dot for decimals. currency is a 3-letter code such as BDT, USD, EUR. Leave cells empty when not shown. Do not invent anything.`;
$("copy-prompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(AI_PROMPT);
    status("Prompt copied. Paste it into the chat together with the menu photo.");
  } catch {
    $("paste").value = AI_PROMPT;
    $("paste").closest("details").open = true;
    status("Copy the prompt from the paste box.");
  }
});

// ------------------------------------------------------------------ start

await setupOptions();
const stored = readStore();
if (stored.rows?.length) {
  state.rows = stored.rows.map(row => ({ ...row, id: newId(), src: null }));
  renderGrid();
  status(`Restored ${stored.rows.length} rows from your last visit. Select Start over to clear them.`);
}
