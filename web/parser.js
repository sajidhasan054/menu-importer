// Menu parsing that runs in the browser and in Node tests. No network, no AI.
//
// Rows are flat, one per price: {section, name, name_en, description, portion,
// price, currency, source}. Several prices for one item become several rows
// with the same name and a different portion label.

export const COLUMNS = ["section", "name", "name_en", "description", "portion", "price", "currency"];
export const COLUMN_LABELS = {
  section: "Section", name: "Item name", name_en: "English name", description: "Description",
  portion: "Portion / size", price: "Price", currency: "Currency",
};

// ---------------------------------------------------------------- digits

const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6,
  0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810, 0xff10,
];
const DIGITS = new Map();
for (const zero of DIGIT_ZEROS) {
  for (let i = 0; i < 10; i++) DIGITS.set(String.fromCharCode(zero + i), String(i));
}

/** Convert digits of any script (Bengali, Devanagari, Arabic, Thai, full-width…) to 0-9. */
export function normalizeDigits(text) {
  let out = "";
  for (const ch of text) out += DIGITS.get(ch) ?? ch;
  return out.replace(/٫/g, ".").replace(/[٬،]/g, ",");
}

// ---------------------------------------------------------------- currency

// Symbol or word -> possible ISO codes. The first code is used unless the
// default currency is one of the others.
const CURRENCY_TOKENS = [
  ["US$", "USD"], ["CA$", "CAD"], ["A$", "AUD"], ["NZ$", "NZD"], ["S$", "SGD"], ["HK$", "HKD"], ["R$", "BRL"],
  ["$", "USD CAD AUD NZD SGD HKD MXN"], ["৳", "BDT"], ["টাকা", "BDT"], ["Tk.", "BDT"], ["Tk", "BDT"], ["TK", "BDT"],
  ["€", "EUR"], ["£", "GBP"], ["₹", "INR"], ["Rs.", "INR PKR LKR NPR"], ["Rs", "INR PKR LKR NPR"], ["रु", "NPR INR"],
  ["₨", "PKR INR LKR NPR"], ["¥", "JPY CNY"], ["円", "JPY"], ["元", "CNY"], ["RMB", "CNY"], ["₩", "KRW"], ["원", "KRW"],
  ["฿", "THB"], ["บาท", "THB"], ["₫", "VND"], ["₺", "TRY"], ["TL", "TRY"], ["₽", "RUB"], ["руб.", "RUB"], ["руб", "RUB"],
  ["₴", "UAH"], ["грн", "UAH"], ["₱", "PHP"], ["RM", "MYR"], ["Rp", "IDR"], ["zł", "PLN"], ["Kč", "CZK"], ["Ft", "HUF"],
  ["kr", "SEK NOK DKK ISK"], ["₪", "ILS"], ["د.إ", "AED"], ["ر.س", "SAR"], ["ريال", "SAR QAR OMR YER"], ["د.ك", "KWD"],
  ["ج.م", "EGP"], ["﷼", "IRR SAR"], ["₦", "NGN"], ["KSh", "KES"], ["CHF", "CHF"], ["Fr.", "CHF"], ["лв", "BGN"], ["lei", "RON"],
];
const ISO_CODES = "AED ARS AUD BDT BGN BHD BRL CAD CHF CLP CNY COP CZK DKK EGP EUR GBP HKD HUF IDR ILS INR IQD IRR ISK JOD JPY KES KRW KWD LBP LKR MAD MXN MYR NGN NOK NPR NZD OMR PEN PHP PKR PLN QAR RON RUB SAR SEK SGD THB TND TRY TWD UAH USD VND ZAR".split(" ");
for (const code of ISO_CODES) CURRENCY_TOKENS.push([code, code]);
CURRENCY_TOKENS.sort((a, b) => b[0].length - a[0].length);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CURRENCY_RE = CURRENCY_TOKENS.map(([token]) =>
  /^[A-Za-z]/.test(token) ? `${escapeRe(token)}(?![A-Za-z])` : escapeRe(token)).join("|");

export function currencyFor(token, defaultCurrency) {
  if (!token) return defaultCurrency;
  const entry = CURRENCY_TOKENS.find(([t]) => t === token.trim());
  if (!entry) return defaultCurrency;
  const codes = entry[1].split(" ");
  return codes.includes(defaultCurrency) ? defaultCurrency : codes[0];
}

// ---------------------------------------------------------------- prices

const NUMBER_RE = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const PRICE_RE = new RegExp(
  String.raw`(?:(?<pre>${CURRENCY_RE})\s?)?(?<num>${NUMBER_RE})(?:\s?(?<post>${CURRENCY_RE}))?(?<dash>\s?/-|\s?/=|,-|\.-)?`,
  "u",
);
const PORTION_UNITS = String.raw`pcs?\.?|pieces?|piece|pc|nos?\.?|ps|পিস|টি|পিচ|g|gm|gms|grams?|gr|গ্রাম|kg|কেজি|ml|মিলি|cl|l|ltr|litres?|liters?|লিটার|oz|inch(?:es)?|in|"|cm|persons?|pax|people|serves?|জন|個|本|枚|杯|人前|份|개|인분`;
const PORTION_RE = new RegExp(String.raw`(?<!\S)(\d+(?:[.,]\d+)?)\s?(${PORTION_UNITS})(?![\p{L}])`, "iu");

/** Parse "1,250.50", "12,50", "1.250" into a plain decimal string, or null. */
export function parseAmount(text) {
  let t = normalizeDigits(String(text ?? "")).trim().replace(/\s/g, "");
  t = t.replace(/[^\d.,]/g, "");
  if (!t || !/\d/.test(t)) return null;
  const lastSep = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  if (lastSep >= 0) {
    const decimals = t.length - lastSep - 1;
    const seps = t.match(/[.,]/g);
    if (decimals === 3 && (seps.length > 1 ? new Set(seps).size === 1 : true)) {
      t = t.replace(/[.,]/g, ""); // 1,250 or 1.250.000 -> thousands
    } else if (decimals >= 1 && decimals <= 2) {
      t = t.slice(0, lastSep).replace(/[.,]/g, "") + "." + t.slice(lastSep + 1);
    } else {
      t = t.replace(/[.,]/g, "");
    }
  }
  const value = Number(t);
  if (!Number.isFinite(value) || value < 0) return null;
  return t.includes(".") ? value.toFixed(2) : String(value);
}

const LEADERS = /(?:\s*[.…·•_~=]{2,}\s*|\s+-{2,}\s+|\s*\t+\s*)/g;
const WIDE_GAP = "   ";

/**
 * Split a line into an item name and trailing prices.
 * Returns {name, prices: [{amount, currency, portion}], wide} or null when no price.
 */
export function parseLine(rawLine, defaultCurrency = "USD") {
  let line = normalizeDigits(rawLine).replace(LEADERS, WIDE_GAP).replace(/\s+$/, "");
  // Price segments split by "/" or "|" each carrying a portion: "6 pcs 180 / 12 pcs 320"
  const prices = [];
  let rest = line;
  for (let guard = 0; guard < 8; guard++) {
    const match = trailingPrice(rest);
    // Earlier prices on the line need a clear separator, so "Chicken 65  250"
    // keeps "Chicken 65" as the name.
    if (!match || (prices.length && !match.price.strong)) break;
    prices.unshift(match.price);
    rest = match.rest;
  }
  if (!prices.length) return null;
  // A bare number after a single space needs at least two digits, so names
  // like "Combo 1" or "Pepsi 7" are not read as prices.
  if (prices.length === 1 && prices[0].weak) return null;
  rest = rest.replace(/[\s:–—\-|/,]+$/u, "");
  const name = rest.replace(/^[\s•·*\-–—#]+/u, "").trim();
  if (!/\p{L}/u.test(name)) return name ? null : { name: "", prices: finish(prices, defaultCurrency) };
  return { name, prices: finish(prices, defaultCurrency) };
}

function finish(prices, defaultCurrency) {
  return prices.map(p => ({
    amount: p.amount,
    currency: currencyFor(p.currencyToken, defaultCurrency),
    portion: p.portion || null,
  }));
}

function trailingPrice(text) {
  // Find the last price-looking token that ends the text.
  const re = new RegExp(PRICE_RE.source + String.raw`\s*$`, "u");
  const m = text.match(re);
  if (!m) return null;
  const before = text.slice(0, m.index);
  if (/[\p{L}\d]$/u.test(before) && !m.groups.pre) return null; // glued to a word: "A4", "B12"
  const amount = parseAmount(m.groups.num);
  if (amount === null) return null;
  const currencyToken = m.groups.pre || m.groups.post || null;
  const gap = before.match(/(\s*)$/)[1];
  const decimals = /[.,]\d{1,2}$/.test(m.groups.num);
  const strong = Boolean(currencyToken || m.groups.dash || decimals || gap.length >= 2 || /[:–—\-|/]\s*$/.test(before));
  const weak = !strong && m.groups.num.replace(/\D/g, "").length < 2;
  let rest = before;
  let portion = null;
  const portionMatch = rest.match(new RegExp(String.raw`(?:^|\s)(${PORTION_RE.source})\s*[:–—\-]?\s*$`, "iu"));
  if (portionMatch) {
    portion = portionMatch[1].trim();
    rest = rest.slice(0, portionMatch.index);
  } else {
    // Size word right before the price: "Latte   S 3.5   L 4.5", "Tea   Large 40"
    const sizeMatch = rest.match(/(\s{2,}|\s)(\p{L}{1,8}\.?)\s?$/u);
    if (sizeMatch && SIZE_WORD.test(sizeMatch[2]) && /\p{L}/u.test(rest.slice(0, sizeMatch.index))
        && (sizeMatch[1].length >= 2 || /^\p{Lu}{1,2}$/u.test(sizeMatch[2]))) {
      portion = sizeMatch[2];
      rest = rest.slice(0, sizeMatch.index);
    }
  }
  rest = rest.replace(/\s*[/|]\s*$/, WIDE_GAP);
  return { price: { amount, currencyToken, portion, strong, weak }, rest };
}

// ---------------------------------------------------------------- headings

const SECTION_WORDS = `
starters starter appetizers appetisers appetizer entrees entrée entrées mains main mains main course main courses
soups soup salads salad sides side dishes desserts dessert sweets drinks beverages beverage juices juice shakes
smoothies coffee coffees tea teas hot drinks cold drinks breakfast brunch lunch dinner specials special pizza pizzas
burgers burger pasta rice noodles kids combos combo set menu set menus sandwiches wraps seafood fish grill grills
bbq curries curry biryani kebabs kebab bread breads naan tandoor tandoori snacks platters platter vegetarian vegan
chicken beef mutton lamb sushi ramen dim sum mocktails cocktails wine wines beer beers spirits extras add ons add-ons
plats boissons vins bières bieres fromages vorspeisen hauptgerichte nachspeisen getränke suppen salate beilagen
entrantes primeros segundos postres bebidas tapas raciones antipasti primi secondi contorni dolci bevande
sobremesas bebidas pratos principais entradas çorbalar tatlılar içecekler ana yemekler
নাস্তা স্টার্টার স্যুপ সালাদ ভাত বিরিয়ানি ডেজার্ট মিষ্টি পানীয় কাবাব চা কফি জুস মেইন কোর্স সেট মেনু
स्टार्टर मिठाई पेय सूप मुख्य भोजन नाश्ता
مقبلات سلطات مشروبات حلويات شوربات أطباق رئيسية مشويات
前菜 主食 汤 湯 饮料 飲料 甜点 甜點 小吃 主菜 飲み物 ドリンク デザート 음료 디저트 식사 메인
`.trim().split(/\s+/);
const SECTION_SET = new Set(SECTION_WORDS.map(w => w.normalize("NFC").toLocaleLowerCase()));

export function looksLikeHeading(text) {
  const t = text.trim();
  if (/^#{1,3}\s/.test(t)) return true;
  if (!t || t.length > 45 || /\d{2,}/.test(t)) return false;
  const words = t.replace(/[:：]$/, "").split(/\s+/);
  if (words.length > 5) return false;
  const plain = t.normalize("NFC").replace(/[^\p{L}\p{M}\s&-]/gu, " ").toLocaleLowerCase().trim();
  if (SECTION_SET.has(plain) || plain.split(/\s+/).some(w => SECTION_SET.has(w)) && words.length <= 3) return true;
  if (/[:：]$/.test(t)) return true;
  const cased = t.replace(/[^\p{L}]/gu, "");
  return cased.length >= 3 && cased === cased.toLocaleUpperCase() && cased !== cased.toLocaleLowerCase();
}

function headingText(text) {
  return text.trim().replace(/^#{1,3}\s*/, "").replace(/[:：]$/, "").trim();
}

function looksLikeDescription(text) {
  const t = text.trim();
  return /^[(\[+*]/.test(t) || /^\p{Ll}/u.test(t) || t.includes(",") || t.split(/\s+/).length >= 6;
}

const SIZE_WORD = /^(s|m|l|xl|xxl|sm|md|lg|small|medium|large|regular|reg|lrg|half|full|single|double|glass|bottle|carafe|cup|pot|mug|hot|iced|cold|petit|grand|klein|groß|pequeño|grande|mini|family|personal|হাফ|ফুল|ছোট|বড়|মাঝারি)\.?$/iu;

// Lines like "Small  Medium  Large" or "Half Full" above a block of multi-price items.
function sizeHeader(text) {
  const words = text.trim().split(/\s{2,}|\t|\s*\|\s*/).flatMap(part => part.split(/\s+(?=\S)/).length <= 2 ? [part] : part.split(/\s+/));
  if (words.length < 2 || words.length > 5) return null;
  if (words.some(w => w.length > 14 || /[.,]\d/.test(w))) return null;
  return words.every(w => SIZE_WORD.test(w.trim()) || /^\d+\s?(?:pcs?|"|inch|in|cm|ml|cl|oz|g)$|^\d+"$/iu.test(w.trim()))
    ? words.map(w => w.trim()) : null;
}

// ---------------------------------------------------------------- text -> rows

/**
 * Parse menu text (from OCR, a PDF text layer, or pasted) into rows.
 * Returns {rows, unmatched: [{line, text}]}.
 */
export function parseMenuText(text, { defaultCurrency = "USD", source = "" } = {}) {
  const lines = text.split(/\r?\n/).map((raw, index) => ({ raw, index: index + 1 })).filter(l => l.raw.trim());
  const parsed = lines.map(l => ({ ...l, p: parseLine(l.raw, defaultCurrency) }));
  const rows = [];
  const unmatched = [];
  let section = "";
  let labels = null;
  let lastItemRows = null; // rows of the most recent item
  let sinceItem = 99;

  const priceOnly = entry => entry?.p && !entry.p.name;
  const emit = (name, prices, entry, description = "") => {
    const itemRows = prices.map((price, i) => ({
      section, name: cleanName(name), name_en: "", description: description,
      portion: price.portion || (labels && labels.length === prices.length ? labels[i] : prices.length > 1 ? `Option ${i + 1}` : ""),
      price: price.amount, currency: price.currency, source: `${source}${source ? ", " : ""}line ${entry.index}`,
    }));
    rows.push(...itemRows);
    lastItemRows = itemRows;
    sinceItem = 0;
  };

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    const next = parsed[i + 1];
    const afterNext = parsed[i + 2];
    sinceItem++;

    if (NOISE.test(entry.raw)) {
      unmatched.push({ line: entry.index, text: entry.raw });
      continue;
    }

    if (entry.p && entry.p.name) {
      emit(entry.p.name, entry.p.prices, entry);
      continue;
    }
    if (priceOnly(entry)) {
      if (lastItemRows && sinceItem <= 2 && lastItemRows.every(r => r.price === "")) {
        const [first] = lastItemRows;
        rows.splice(rows.indexOf(first), lastItemRows.length);
        emit(first.name, entry.p.prices, entry, first.description);
      } else {
        unmatched.push({ line: entry.index, text: entry.raw });
      }
      continue;
    }
    const textLine = entry.raw.trim();
    const sizes = sizeHeader(textLine);
    if (sizes) { labels = sizes; continue; }

    const forcedHeading = /^#{1,3}\s/.test(textLine);
    // "Name" on one line and its price on the next (optionally with a description between).
    if (!forcedHeading && priceOnly(next)) {
      emit(textLine, next.p.prices, next);
      i++;
      continue;
    }
    if (!forcedHeading && next && !next.p && priceOnly(afterNext) && !looksLikeHeading(textLine) && looksLikeDescription(next.raw)) {
      emit(textLine, afterNext.p.prices, afterNext, next.raw.trim());
      i += 2;
      continue;
    }
    if (looksLikeHeading(textLine) && !(lastItemRows && sinceItem === 1 && looksLikeDescription(textLine))) {
      section = headingText(textLine);
      const inlineSizes = sizeHeader(textLine.replace(/^.*?(?=\s{2,})/, "").trim());
      labels = inlineSizes;
      continue;
    }
    // Scripts without capital letters (Bengali, Arabic, Chinese…): a short line
    // between priced items is a heading rather than a description.
    const uncased = !/[\p{Lu}\p{Ll}]/u.test(textLine);
    if (uncased && next?.p?.name && textLine.split(/\s+/).length <= 3 && textLine.length <= 30 && !looksLikeDescription(textLine)) {
      section = headingText(textLine);
      labels = null;
      continue;
    }
    if (lastItemRows && sinceItem <= 3) {
      for (const row of lastItemRows) row.description = row.description ? `${row.description} ${textLine}` : textLine;
      sinceItem = 1;
      continue;
    }
    // A short line followed by priced items is most likely a heading in scripts without capitals.
    if (next?.p?.name && textLine.split(/\s+/).length <= 4 && textLine.length <= 40) {
      section = headingText(textLine);
      labels = null;
      continue;
    }
    unmatched.push({ line: entry.index, text: entry.raw });
  }
  return { rows, unmatched };
}

const NOISE = /https?:|www\.|\S@\S|\.com\b|\btel\b|phone|call us|whatsapp|hotline|☎|📞|\d{3,}[\s-]\d{3,}[\s-]\d{2,}|\+\d{2,3}[\s-]?\d{3,}/iu;

function cleanName(name) {
  return name.replace(/\s{2,}/g, " ").replace(/^[\d]{1,3}[.)]\s+(?=\p{L})/u, "").trim();
}

// ---------------------------------------------------------------- OCR layout

/**
 * Turn positioned words (from OCR or a PDF text layer) into reading-order text.
 * Detects menu columns, keeps price columns attached to their item column,
 * marks large text as "# " headings, and puts a wide gap before prices.
 * Lines that span several columns (titles, centred headings) split the page
 * into bands that are read one after another.
 * words: [{text, x0, y0, x1, y1, conf?}]
 */
export function layoutText(words, { splitColumns = true } = {}) {
  words = words.filter(w => w.text && w.text.trim() && (w.conf === undefined || w.conf >= 35 || /\d/.test(w.text) || w.text.length > 2));
  if (!words.length) return "";
  const h = Math.max(1, median(words.map(w => w.y1 - w.y0)));
  const lines = [];
  const cuts = splitColumns ? findCuts(words, h) : [];
  if (!cuts.length) {
    lines.push(...groupLines(words, h).map(l => l.text));
  } else {
    // A word crossing a gutter makes its whole line a spanning line (title, centred heading).
    const crossing = words.filter(w => cuts.some(c => w.x0 < c && w.x1 > c));
    const spanning = words.filter(w => crossing.some(c => {
      const center = (w.y0 + w.y1) / 2;
      return center > c.y0 && center < c.y1;
    }));
    const spanLines = groupLines(spanning, h);
    const others = words.filter(w => !spanning.includes(w));
    const bounds = [-Infinity, ...spanLines.map(l => l.center), Infinity];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (i > 0) lines.push(spanLines[i - 1].text, "");
      const band = others.filter(w => {
        const c = (w.y0 + w.y1) / 2;
        return c > bounds[i] && c <= bounds[i + 1];
      });
      if (!band.length) continue;
      for (const column of splitIntoColumns(band, h, findCuts(band, h))) {
        lines.push(...groupLines(column, h).map(l => l.text), "");
      }
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function groupLines(words, h) {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows = [];
  for (const word of sorted) {
    const center = (word.y0 + word.y1) / 2;
    const row = rows.find(r => Math.abs(r.center - center) <= Math.max(h, word.y1 - word.y0) * 0.55);
    if (row) {
      row.words.push(word);
      row.center = (row.center * (row.words.length - 1) + center) / row.words.length;
    } else {
      rows.push({ center, words: [word] });
    }
  }
  rows.sort((a, b) => a.center - b.center);
  return rows.map(row => {
    const ws = row.words.sort((a, b) => a.x0 - b.x0);
    const rowH = median(ws.map(w => w.y1 - w.y0));
    let text = "";
    ws.forEach((w, i) => {
      if (i) text += w.x0 - ws[i - 1].x1 > Math.max(h, rowH) * 1.6 ? WIDE_GAP : " ";
      text += w.text.trim();
    });
    const heading = rowH > h * 1.35 && parseLine(text) === null && text.length < 50;
    return { center: row.center, text: heading ? `# ${text}` : text };
  });
}

function findCuts(words, h) {
  const minX = Math.min(...words.map(w => w.x0));
  const maxX = Math.max(...words.map(w => w.x1));
  const width = maxX - minX;
  if (width <= 0 || words.length < 4) return [];
  const bucket = Math.max(1, h / 4);
  const n = Math.ceil(width / bucket) + 1;
  const cover = new Array(n).fill(0);
  for (const w of words) {
    for (let b = Math.floor((w.x0 - minX) / bucket); b <= Math.floor((w.x1 - minX) / bucket); b++) cover[b]++;
  }
  // A gutter is a run of x positions that almost no word crosses (titles may span it).
  const allowance = Math.max(1, Math.floor(words.length * 0.03));
  const minGap = Math.ceil((h * 2.5) / bucket);
  const cuts = [];
  let start = -1;
  for (let b = 0; b <= n; b++) {
    const empty = b < n && cover[b] <= allowance;
    if (empty && start < 0) start = b;
    if (!empty && start >= 0) {
      if (b - start >= minGap && start > 0 && b < n) cuts.push(minX + ((start + b) / 2) * bucket);
      start = -1;
    }
  }
  // Keep only gutters that separate text columns: a column of prices belongs
  // to the item names on its left.
  const segments = splitIntoColumns(words, h, cuts, true);
  return cuts.filter((cut, i) => segments[i + 1]?.length && !isPriceColumn(segments[i + 1]));
}

function isPriceColumn(words) {
  if (!words.length) return false;
  const priceLike = words.filter(w => /^[^\p{L}]*\d[\d.,]*[^\p{L}]*$/u.test(normalizeDigits(w.text))
    || new RegExp(`^(${CURRENCY_RE})$`, "u").test(w.text)).length;
  return priceLike / words.length >= 0.6;
}

function splitIntoColumns(words, h, cuts, keepEmpty = false) {
  if (!cuts.length) return [words];
  const bounds = [-Infinity, ...cuts, Infinity];
  const columns = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const column = words.filter(w => {
      const c = (w.x0 + w.x1) / 2;
      return c >= bounds[i] && c < bounds[i + 1];
    });
    if (column.length || keepEmpty) columns.push(column);
  }
  return columns;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// ---------------------------------------------------------------- spreadsheets

const HEADER_ALIASES = {
  name: `name item item_name item name dish dish name product product name menu item food title nombre plato nom plat
         gericht nome piatto produto prato isim ürün naam নাম আইটেম 名前 品名 菜名 料理名 名称 商品名 메뉴 메뉴명 이름 اسم الصنف नाम ชื่อ món`,
  section: `section category categories group menu section course type categoria categoría catégorie kategorie kategori
            ক্যাটাগরি বিভাগ 分类 分類 類別 カテゴリ 카테고리 فئة القسم श्रेणी`,
  description: `description desc details ingredients descripcion descripción beschreibung descrizione descrição açıklama
                বিবরণ 説明 描述 설명 وصف विवरण`,
  price: `price prices cost amount rate mrp unit price selling price precio prix preis prezzo preço fiyat prijs цена
          মূল্য দাম 価格 价格 價格 가격 سعر السعر कीमत मूल्य ราคา giá`,
  portion: "portion size variant serving quantity qty unit পরিমাণ সাইজ",
  currency: "currency curr মুদ্রা",
  name_en: "english name name en name_en english",
};
const ALIAS_MAP = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases.split(/\s{2,}|\n/).flatMap(part => [part.trim(), ...part.trim().split(/\s+/)])) {
    if (alias && !ALIAS_MAP.has(alias.toLocaleLowerCase())) ALIAS_MAP.set(alias.toLocaleLowerCase(), field);
  }
}
for (const phrase of ["item name", "dish name", "product name", "menu item", "unit price", "selling price", "menu section", "english name", "name en"]) {
  const field = Object.entries(HEADER_ALIASES).find(([, a]) => a.includes(phrase))[0];
  ALIAS_MAP.set(phrase, field);
}

export function headerField(cell) {
  const key = String(cell ?? "").trim().toLocaleLowerCase().replace(/[_\-/]+/g, " ").replace(/\s*\(.*\)\s*$/, "").replace(/\s+/g, " ");
  return ALIAS_MAP.get(key) || null;
}

const isNumberCell = v => parseAmount(v) !== null && /^[^\p{L}]*\d[\d.,\s]*[^\p{L}]*$/u.test(normalizeDigits(String(v).trim()))
  || new RegExp(`^(${CURRENCY_RE})?\\s?(${NUMBER_RE})\\s?(${CURRENCY_RE})?$`, "u").test(normalizeDigits(String(v).trim()));

/**
 * Guess what each spreadsheet column holds.
 * Returns {headerRow: index or -1, mapping: [field|"price_option"|"ignore"]}.
 */
export function guessColumns(table) {
  const rows = table.filter(r => r.some(c => String(c ?? "").trim()));
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].some(c => headerField(c) === "name")) { headerRow = table.indexOf(rows[i]); break; }
  }
  const width = Math.max(0, ...table.map(r => r.length));
  const body = table.slice(headerRow + 1).filter(r => r.some(c => String(c ?? "").trim()));
  const mapping = [];
  for (let col = 0; col < width; col++) {
    const header = headerRow >= 0 ? table[headerRow][col] : "";
    const field = headerField(header);
    const values = body.map(r => String(r[col] ?? "").trim()).filter(Boolean);
    const numeric = values.length && values.filter(isNumberCell).length / values.length >= 0.6;
    if (field && !mapping.includes(field)) mapping.push(field);
    else if (!values.length) mapping.push("ignore");
    else if (numeric && headerRow >= 0 && String(header).trim()) mapping.push("price_option");
    else if (numeric) mapping.push(mapping.includes("price") ? "price_option" : "price");
    else mapping.push("ignore");
  }
  if (!mapping.includes("name")) {
    // No header: the column with the most text is the item name.
    let best = -1, bestScore = 0;
    for (let col = 0; col < width; col++) {
      if (mapping[col] !== "ignore") continue;
      const score = body.reduce((n, r) => n + (/\p{L}/u.test(String(r[col] ?? "")) ? String(r[col]).length : 0), 0);
      if (score > bestScore) { best = col; bestScore = score; }
    }
    if (best >= 0) mapping[best] = "name";
  }
  if (mapping.filter(m => m === "price_option").length === 1 && !mapping.includes("price")) {
    mapping[mapping.indexOf("price_option")] = "price";
  }
  return { headerRow, mapping };
}

/** Build rows from a table and a column mapping chosen by guessColumns or the user. */
export function tableToRows(table, { headerRow, mapping }, { defaultCurrency = "USD", source = "" } = {}) {
  const rows = [];
  const issues = [];
  let section = "";
  for (let r = headerRow + 1; r < table.length; r++) {
    const cells = table[r] || [];
    if (!cells.some(c => String(c ?? "").trim())) continue;
    const get = field => {
      const col = mapping.indexOf(field);
      return col >= 0 ? String(cells[col] ?? "").trim() : "";
    };
    const name = get("name");
    const filled = cells.filter(c => String(c ?? "").trim());
    const hasPriceColumn = mapping.some(m => m === "price" || m === "price_option");
    if (!name || (hasPriceColumn && filled.length === 1 && !get("price"))) {
      // A row with a single text cell between items is a section heading.
      if (filled.length === 1 && /\p{L}/u.test(String(filled[0]))) section = String(filled[0]).trim();
      else issues.push({ line: r + 1, text: filled.join(" | ") });
      continue;
    }
    const base = {
      section: get("section") || section, name, name_en: get("name_en"), description: get("description"),
      source: `${source}${source ? ", " : ""}row ${r + 1}`,
    };
    const prices = [];
    mapping.forEach((field, col) => {
      if (field !== "price" && field !== "price_option") return;
      const raw = String(cells[col] ?? "").trim();
      if (!raw) return;
      const label = field === "price_option" ? String(table[headerRow]?.[col] ?? "").trim() : get("portion");
      const parsed = parseLine(`x  ${raw}`, defaultCurrency);
      const amount = parseAmount(raw);
      if (amount === null) { issues.push({ line: r + 1, text: `${name}: price "${raw}" not understood` }); return; }
      prices.push({ amount, currency: get("currency").toUpperCase() || parsed?.prices[0]?.currency || defaultCurrency, portion: label });
    });
    if (!prices.length) prices.push({ amount: "", currency: get("currency").toUpperCase() || defaultCurrency, portion: get("portion") });
    for (const price of prices) rows.push({ ...base, portion: price.portion, price: price.amount, currency: price.currency });
  }
  return { rows, issues };
}

/** Detect whether pasted text is a delimited table (CSV/TSV) rather than menu text. */
export function looksLikeTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean).slice(0, 10);
  if (lines.length < 2) return false;
  for (const delim of ["\t", ",", ";", "|"]) {
    const counts = lines.map(l => l.split(delim).length - 1);
    if (counts[0] >= 1 && counts.every(c => c === counts[0]) && lines[0].split(delim).some(c => headerField(c.replace(/"/g, "")))) return delim;
  }
  return false;
}

// ---------------------------------------------------------------- export

export function toCSV(rows, columns = COLUMNS) {
  const escape = value => {
    let v = String(value ?? "");
    if (/^[=+\-@]/.test(v) && !/^-?\d/.test(v)) v = "'" + v; // spreadsheet formula injection
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [columns, ...rows.map(row => columns.map(c => row[c]))].map(r => r.map(escape).join(",")).join("\r\n") + "\r\n";
}
