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
  let line = normalizeDigits(rawLine).replace(LEADERS, WIDE_GAP).replace(/\s+$/, "")
    // OCR sometimes reads a decimal comma as a colon: "3:50 €"
    .replace(new RegExp(String.raw`(\d):(\d{2})(?=\s?(?:${CURRENCY_RE}))`, "gu"), "$1.$2");
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

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;
const LETTER = /[\p{L}]/u;

export function isRightToLeft(text) {
  const letters = [...text].filter(ch => LETTER.test(ch));
  return letters.length > 0 && letters.filter(ch => RTL_CHARS.test(ch)).length / letters.length > 0.5;
}

/** True for OCR "words" that are picture noise rather than text: "|", "~~", "®©", "|l1|". */
function isJunkWord(word) {
  const text = word.text.trim();
  if (!text) return true;
  if (new RegExp(`^(${CURRENCY_RE})$`, "u").test(text)) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return !/^[&+/\-–—:()*#]$/.test(text); // keep lone separators that matter
  // Mostly symbols, or a short mix of letters and pipes typical of OCR on photos.
  const good = [...text].filter(ch => /[\p{L}\p{N}\p{M}.,'’%-]/u.test(ch)).length;
  return good / [...text].length < 0.5 || /^[|!lI1]{2,}$/.test(text);
}

/**
 * Turn positioned words (from OCR or a PDF text layer) into reading-order text.
 * Detects menu columns, keeps price columns attached to their item column,
 * marks large text as "# " headings, and puts a wide gap before prices.
 * Lines that span several columns (titles, centred headings) split the page
 * into bands that are read one after another. Arabic, Persian, Urdu and
 * Hebrew lines are read right to left.
 *
 * words: [{text, x0, y0, x1, y1, conf?}]
 * options.minConfidence: drop OCR words below this confidence (0-100). Words
 *   with digits are kept a little longer since prices matter most.
 */
export function layoutText(words, { splitColumns = true, minConfidence = 40, rtl = "auto" } = {}) {
  words = words.filter(w => w.text && w.text.trim() && !isJunkWord(w));
  if (!words.length) return "";
  const h0 = Math.max(1, median(words.map(w => w.y1 - w.y0)));
  words = words.filter(w => {
    if (w.conf === undefined) return true;
    const limit = /\d/.test(w.text) ? minConfidence - 15 : minConfidence;
    if (w.conf < limit) return false;
    // Huge low-confidence "words" are usually pictures or ornaments.
    return !(w.y1 - w.y0 > h0 * 4 && w.conf < 85);
  });
  if (!words.length) return "";
  const pageRtl = rtl === "auto" ? isRightToLeft(words.map(w => w.text).join(" ")) : Boolean(rtl);
  const h = Math.max(1, median(words.map(w => w.y1 - w.y0)));
  const lines = [];
  const clusters = clusterWords(words, h);
  const cuts = splitColumns ? findCuts(clusters, h, pageRtl) : [];
  const ordered = columns => (pageRtl ? [...columns].reverse() : columns);
  if (!cuts.length) {
    lines.push(...groupLines(words, h, pageRtl));
  } else {
    // A phrase crossing a gutter makes its whole line a spanning line (title, centred heading).
    const crossing = clusters.filter(c => cuts.some(cut => c.x0 < cut && c.x1 > cut));
    const spanning = words.filter(w => crossing.some(c => {
      const center = (w.y0 + w.y1) / 2;
      return center > c.y0 && center < c.y1;
    }));
    const spanLines = groupLines(spanning, h, pageRtl);
    const others = words.filter(w => !spanning.includes(w));
    const bounds = [-Infinity, ...spanLines.map(l => l.center), Infinity];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (i > 0) lines.push(spanLines[i - 1], { text: "" });
      const band = others.filter(w => {
        const c = (w.y0 + w.y1) / 2;
        return c > bounds[i] && c <= bounds[i + 1];
      });
      if (!band.length) continue;
      const bandCuts = findCuts(clusterWords(band, h), h, pageRtl);
      for (const column of ordered(splitIntoColumns(band, bandCuts))) {
        lines.push(...groupLines(column, h, pageRtl), { text: "" });
      }
    }
  }
  return lines
    .filter(line => line.text === "" || !line.weak)
    .map(line => line.text)
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const isPriceWord = text => isPriceText(text) || new RegExp(`^(${CURRENCY_RE})$`, "u").test(text.trim());

/** Group words into rows: a word joins a row it overlaps vertically by at least half its height. */
function rowsOf(words) {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows = [];
  for (const word of sorted) {
    const height = word.y1 - word.y0;
    let best = null, bestOverlap = 0;
    for (const row of rows) {
      const overlap = Math.min(row.y1, word.y1) - Math.max(row.y0, word.y0);
      const ratio = overlap / Math.max(1, Math.min(height, row.y1 - row.y0));
      if (ratio > bestOverlap) { best = row; bestOverlap = ratio; }
    }
    if (best && bestOverlap >= 0.5) {
      best.words.push(word);
      best.y0 = median(best.words.map(w => w.y0));
      best.y1 = median(best.words.map(w => w.y1));
    } else {
      rows.push({ y0: word.y0, y1: word.y1, words: [word] });
    }
  }
  return rows;
}

/** Merge words that sit close together on a row into phrases (boxes). */
function clusterWords(words, h) {
  const clusters = [];
  for (const row of rowsOf(words)) {
    const ws = [...row.words].sort((a, b) => a.x0 - b.x0);
    let current = null;
    for (const w of ws) {
      if (current && w.x0 - current.x1 <= h * 0.9) {
        current.x1 = Math.max(current.x1, w.x1);
        current.y0 = Math.min(current.y0, w.y0);
        current.y1 = Math.max(current.y1, w.y1);
        current.text += " " + w.text;
      } else {
        current = { x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, text: w.text };
        clusters.push(current);
      }
    }
  }
  return clusters;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF]/u;

function groupLines(words, h, pageRtl = false) {
  const rows = rowsOf(words);
  for (const row of rows) row.center = (row.y0 + row.y1) / 2;
  rows.sort((a, b) => a.center - b.center);

  // A row of only prices that sits a little above or below a row of only
  // text (common when prices are printed in a different font or the photo is
  // tilted) belongs to that text row.
  const textOnly = row => row.words.some(w => /\p{L}/u.test(w.text)) && !row.words.some(w => isPriceWord(w.text));
  for (const row of rows) {
    if (!row.words.length || !row.words.every(w => isPriceWord(w.text))) continue;
    const left = Math.min(...row.words.map(w => w.x0)), right = Math.max(...row.words.map(w => w.x1));
    let target = null, distance = Infinity;
    for (const other of rows) {
      if (other === row || !other.words.length || !textOnly(other)) continue;
      const d = Math.abs(other.center - row.center);
      const otherLeft = Math.min(...other.words.map(w => w.x0)), otherRight = Math.max(...other.words.map(w => w.x1));
      const beside = pageRtl ? right < otherLeft : left > otherRight;
      if (beside && d < distance && d <= h * 1.1) { target = other; distance = d; }
    }
    if (target) {
      // Only when no other price row is closer to that text row.
      const rival = rows.some(r => r !== row && r.words.length && r.words.every(w => isPriceWord(w.text)) && Math.abs(r.center - target.center) < distance);
      if (!rival) { target.words.push(...row.words); row.words = []; }
    }
  }

  return rows.filter(row => row.words.length).map(row => {
    // On an Arabic page, a line whose leftmost word is a price is also read
    // right to left, even when OCR got its words wrong.
    const leftmost = [...row.words].sort((a, b) => a.x0 - b.x0)[0];
    const lineRtl = row.words.some(w => RTL_CHARS.test(w.text))
      ? isRightToLeft(row.words.map(w => w.text).join(" ")) || pageRtl
      : pageRtl && row.words.length > 1 && isPriceWord(leftmost.text);
    const ws = row.words.sort((a, b) => (lineRtl ? b.x1 - a.x1 : a.x0 - b.x0));
    const rowH = median(ws.map(w => w.y1 - w.y0));
    let text = "";
    ws.forEach((w, i) => {
      if (i) {
        const gap = lineRtl ? ws[i - 1].x0 - w.x1 : w.x0 - ws[i - 1].x1;
        const glued = gap < Math.max(h, rowH) * 0.8 && CJK.test(ws[i - 1].text.trim().slice(-1)) && CJK.test(w.text.trim()[0]);
        text += gap > Math.max(h, rowH) * 1.6 ? WIDE_GAP : glued ? "" : " ";
      }
      text += w.text.trim();
    });
    const heading = rowH > h * 1.35 && parseLine(text) === null && text.length < 50;
    // A line made only of short, unsure fragments is noise from a picture.
    const confs = ws.map(w => w.conf).filter(c => c !== undefined);
    const weak = confs.length > 0 && median(confs) < 60 && !/\d/.test(text) && ws.every(w => w.text.length <= 3);
    return { center: row.center, text: heading ? `# ${text}` : text, weak };
  });
}

function findCuts(boxes, h, rtl = false) {
  const minX = Math.min(...boxes.map(w => w.x0));
  const maxX = Math.max(...boxes.map(w => w.x1));
  const width = maxX - minX;
  if (width <= 0 || boxes.length < 4) return [];
  const bucket = Math.max(1, h / 4);
  const n = Math.ceil(width / bucket) + 1;
  const cover = new Array(n).fill(0);
  for (const w of boxes) {
    for (let b = Math.floor((w.x0 - minX) / bucket); b <= Math.floor((w.x1 - minX) / bucket); b++) cover[b]++;
  }
  // A gutter is a run of x positions that almost no phrase crosses (titles may span it).
  const allowance = Math.max(1, Math.floor(boxes.length * 0.04));
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
  // to the item names before it (on the left, or on the right in Arabic).
  const inside = boxes.filter(b => !cuts.some(cut => b.x0 < cut && b.x1 > cut));
  const segments = splitIntoColumns(inside, cuts, true);
  return cuts.filter((cut, i) => {
    const priceSide = rtl ? segments[i] : segments[i + 1];
    return segments[i].length && segments[i + 1].length && !isPriceColumn(priceSide);
  });
}

const CURRENCY_GLOBAL = new RegExp(CURRENCY_RE, "gu");

/** "12.50", "8,50 €", "৳১৮০", "١٥ ر.س", "$7" — a price with no other words. */
function isPriceText(text) {
  const t = normalizeDigits(text).replace(CURRENCY_GLOBAL, " ").replace(/\/[-=]/g, "").trim();
  return /^[^\p{L}]*\d[\d.,\s]*[^\p{L}]*$/u.test(t) && /\d/.test(t);
}

function isPriceColumn(boxes) {
  if (!boxes.length) return false;
  return boxes.filter(w => isPriceText(w.text)).length / boxes.length >= 0.6;
}

function splitIntoColumns(words, cuts, keepEmpty = false) {
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

/**
 * Combine words from two OCR passes over the same image. Each mode misses
 * different words (sparse mode skips some names, page mode skips prices), so
 * words from the second pass are added where the first pass found nothing.
 */
export function mergeWordSets(primary, secondary) {
  let out = [...primary];
  const area = w => Math.max(1, (w.x1 - w.x0) * (w.y1 - w.y0));
  const clashes = (a, b) => {
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return ix > 0 && iy > 0 && (ix * iy) / Math.min(area(a), area(b)) > 0.4;
  };
  for (const word of secondary) {
    const group = out.filter(o => clashes(o, word));
    if (!group.length) { out.push(word); continue; }
    // Replace the overlapping words when this one is clearly more certain, or
    // when they were weak (often a word split into misread pieces).
    const conf = word.conf ?? 0;
    const weakest = Math.min(...group.map(o => o.conf ?? 0));
    const average = group.reduce((n, o) => n + (o.conf ?? 0), 0) / group.length;
    if (conf >= weakest + 15 && conf >= average || (weakest < 75 && conf >= average + 5 && conf >= 60)) {
      out = out.filter(o => !group.includes(o));
      out.push(word);
    }
  }
  return out;
}

// ---------------------------------------------------------------- languages

/** OCR languages to use for a script reported by Tesseract's script detection. */
export const SCRIPT_LANGUAGES = {
  Arabic: ["ara"], Bengali: ["ben"], Devanagari: ["hin"], Han: ["chi_sim", "chi_tra"], HanS: ["chi_sim"],
  HanT: ["chi_tra"], Japanese: ["jpn"], Hangul: ["kor"], Korean: ["kor"], Thai: ["tha"], Cyrillic: ["rus"],
  Greek: ["ell"], Hebrew: ["heb"], Tamil: ["tam"], Telugu: ["tel"], Kannada: ["kan"], Malayalam: ["mal"],
  Gujarati: ["guj"], Gurmukhi: ["pan"], Sinhala: ["sin"], Katakana: ["jpn"], Hiragana: ["jpn"],
};

// Common menu words and letters per Latin-script language.
const LATIN_HINTS = {
  fra: { words: "le la les de des du et aux au avec sauce poulet boeuf bœuf poisson fromage frites crème glace plat plats entrée entrées dessert desserts boissons vin maison jour salade soupe légumes pommes canard tarte chocolat café thé", chars: "éèêàâçùûôîœë" },
  spa: { words: "el la los las de del con y al a pollo carne cerdo pescado queso patatas papas salsa ensalada sopa postres bebidas vino casa tortilla jamón arroz huevos tapas ración media", chars: "ñáíóúé¿¡" },
  ita: { words: "il lo la le di del della con e al alla pollo manzo pesce formaggio pomodoro insalata zuppa dolci bevande vino casa pasta pizza antipasti primi secondi contorni funghi", chars: "àèéìòù" },
  deu: { words: "der die das mit und vom von auf aus hähnchen rind schwein fisch käse kartoffeln salat suppe nachspeisen getränke wein haus tag vorspeisen hauptgerichte beilagen kaffee kuchen schokolade frühstück brötchen sahne strudel wurst bier brot heiße", chars: "äöüß" },
  por: { words: "o a os as de do da com e ao frango carne porco peixe queijo batatas salada sopa sobremesas bebidas vinho casa arroz feijão", chars: "ãõçáéíóúâêô" },
  nld: { words: "de het een met en van op kip rund varken vis kaas friet salade soep nagerechten dranken wijn huis", chars: "ëï" },
  tur: { words: "ve ile tavuk et balık peynir patates salata çorba tatlılar içecekler ev kebap pilav", chars: "ıışğçöü" },
  ind: { words: "dan dengan ayam sapi ikan nasi goreng mie sayur sambal minuman es teh kopi", chars: "" },
  vie: { words: "và với gà bò heo cá cơm phở bún nước trà cà phê", chars: "ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ" },
  pol: { words: "z i w ze kurczak wołowina ryba ser ziemniaki sałatka zupa desery napoje wino", chars: "ąćęłńóśźż" },
  ces: { words: "s a se kuře hovězí ryba sýr brambory salát polévka dezerty nápoje víno", chars: "ěščřžýáíéůú" },
  swe: { words: "och med kyckling nötkött fisk ost potatis sallad soppa efterrätter drycker vin", chars: "åäö" },
  ron: { words: "și cu pui vită pește brânză cartofi salată supă desert băuturi vin", chars: "ăâîșț" },
  hun: { words: "és csirke marha hal sajt burgonya saláta leves desszert italok bor", chars: "őűáéíóöüú" },
};

/**
 * Guess the language of Latin-script menu text so the matching OCR language
 * can be added. Returns {code, score} or null when it looks like English or
 * there is too little evidence.
 */
const stripAccents = text => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/œ/g, "oe");

export function guessLatinLanguage(text) {
  const lower = text.toLocaleLowerCase();
  // OCR without the right language often drops accents ("Kasekuchen"), so words are compared without them.
  const tokens = stripAccents(lower).split(/[^\p{L}]+/u).filter(Boolean);
  if (tokens.length < 4) return null;
  const english = new Set("the and with of in on our fresh served chicken beef fish cheese fries salad soup desserts drinks wine house day starters mains sides".split(" "));
  const englishHits = tokens.filter(t => english.has(t)).length;
  let best = null;
  for (const [code, hint] of Object.entries(LATIN_HINTS)) {
    const words = new Set(stripAccents(hint.words).split(" "));
    const wordHits = tokens.filter(t => words.has(t)).length;
    const charHits = [...lower].filter(ch => hint.chars.includes(ch)).length;
    const score = wordHits + Math.min(charHits, tokens.length) * 0.5;
    if (!best || score > best.score) best = { code, score };
  }
  if (!best || best.score < Math.max(2, englishHits * 1.2)) return null;
  return best;
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
