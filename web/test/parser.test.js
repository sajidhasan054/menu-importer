import test from "node:test";
import assert from "node:assert/strict";
import {
  guessColumns, guessLatinLanguage, isRightToLeft, layoutText, mergeWordSets, looksLikeTable, normalizeDigits, parseAmount, parseLine, parseMenuText, tableToRows, toCSV,
} from "../parser.js";

const simple = rows => rows.map(r => [r.section, r.name, r.portion, r.price, r.currency]);

test("digits from many scripts", () => {
  assert.equal(normalizeDigits("৳১৮০ ٤٥ ४२ ๕๐ １２"), "৳180 45 42 50 12");
});

test("amounts with different separators", () => {
  assert.deepEqual(["1,250", "12,50", "1.250.000", "1,250.75", "8.5", "abc"].map(parseAmount),
    ["1250", "12.50", "1250000", "1250.75", "8.50", null]);
});

test("line prices, portions and currencies", () => {
  const cases = [
    ["Chicken Momo — ৬ পিস ৳১৮০ / ১২ পিস ৳৩২০", "BDT", "Chicken Momo", [["180", "BDT", "6 পিস"], ["320", "BDT", "12 পিস"]]],
    ["Soupe à l'oignon ........ 8,50 €", "USD", "Soupe à l'oignon", [["8.50", "EUR", null]]],
    ["বিফ তেহারি ২৮০/-", "BDT", "বিফ তেহারি", [["280", "BDT", null]]],
    ["Chicken 65   250", "INR", "Chicken 65", [["250", "INR", null]]],
    ["Fruit Salad $13", "CAD", "Fruit Salad", [["13", "CAD", null]]],
    ["Latte   S 3.5   L 4.5", "USD", "Latte", [["3.50", "USD", "S"], ["4.50", "USD", "L"]]],
    ["Cappuccino   3:50 €", "USD", "Cappuccino", [["3.50", "EUR", null]]],
  ];
  for (const [line, currency, name, prices] of cases) {
    const parsed = parseLine(line, currency);
    assert.equal(parsed.name, name, line);
    assert.deepEqual(parsed.prices.map(p => [p.amount, p.currency, p.portion]), prices, line);
  }
  assert.equal(parseLine("Combo 1"), null);
  assert.equal(parseLine("Opening hours 10am"), null);
});

test("menu text: headings, descriptions, prices on their own line, size columns", () => {
  const text = [
    "STARTERS",
    "Garlic Bread ........ 4.50",
    "toasted with herbs, butter",
    "Soup of the Day",
    "6.00",
    "# Pizza",
    "Small   Large",
    "Margherita   8.00   12.00",
    "Pepperoni   9.00   13.50",
    "Desserts:",
    "Tiramisu",
    "mascarpone, espresso, cocoa",
    "5.50",
    "Call us: 555 0100 1234",
  ].join("\n");
  const { rows, unmatched } = parseMenuText(text, { defaultCurrency: "USD" });
  assert.deepEqual(simple(rows), [
    ["STARTERS", "Garlic Bread", "", "4.50", "USD"],
    ["STARTERS", "Soup of the Day", "", "6.00", "USD"],
    ["Pizza", "Margherita", "Small", "8.00", "USD"],
    ["Pizza", "Margherita", "Large", "12.00", "USD"],
    ["Pizza", "Pepperoni", "Small", "9.00", "USD"],
    ["Pizza", "Pepperoni", "Large", "13.50", "USD"],
    ["Desserts", "Tiramisu", "", "5.50", "USD"],
  ]);
  assert.equal(rows[0].description, "toasted with herbs, butter");
  assert.equal(rows.at(-1).description, "mascarpone, espresso, cocoa");
  assert.equal(unmatched.length, 1);
});

test("Bengali menu without capital letters", () => {
  const text = "নাস্তা\nপরোটা ২০\nডিম ভাজি ৩০\nপানীয়\nচা ১৫\n";
  const { rows } = parseMenuText(text, { defaultCurrency: "BDT" });
  assert.deepEqual(simple(rows), [
    ["নাস্তা", "পরোটা", "", "20", "BDT"], ["নাস্তা", "ডিম ভাজি", "", "30", "BDT"], ["পানীয়", "চা", "", "15", "BDT"],
  ]);
});

test("OCR layout splits two menu columns and keeps right-aligned prices", () => {
  const word = (text, x0, y0, w = text.length * 10, h = 20) => ({ text, x0, y0, x1: x0 + w, y1: y0 + h });
  const words = [
    word("The", 300, 0, 60, 60), word("Copper", 380, 0, 200, 60), word("Pot", 600, 0, 60, 60),
    word("Soup", 50, 100), word("4.00", 330, 100),
    word("Salad", 50, 140), word("5.00", 330, 140),
    word("Steak", 500, 100), word("Frites", 560, 100), word("21.00", 800, 100),
    word("Fish", 500, 140), word("18.00", 800, 140),
  ];
  const text = layoutText(words);
  const { rows } = parseMenuText(text, { defaultCurrency: "EUR" });
  assert.deepEqual(rows.map(r => [r.name, r.price]), [["Soup", "4.00"], ["Salad", "5.00"], ["Steak Frites", "21.00"], ["Fish", "18.00"]]);
  assert.match(text, /^# The Copper Pot\n/);
});

test("spreadsheet with title rows, multilingual header and size columns", () => {
  const table = [
    ["Café Lumière"], [],
    ["Catégorie", "Nom", "Petit", "Grand", "Notes"],
    ["Boissons", "Café crème", "2,50", "3,80", ""],
    ["", "Chocolat chaud", "3", "4,20", "maison"],
  ];
  const guess = guessColumns(table);
  assert.equal(guess.headerRow, 2);
  assert.deepEqual(guess.mapping, ["section", "name", "price_option", "price_option", "ignore"]);
  const { rows } = tableToRows(table, guess, { defaultCurrency: "EUR" });
  assert.deepEqual(rows.map(r => [r.name, r.portion, r.price]), [
    ["Café crème", "Petit", "2.50"], ["Café crème", "Grand", "3.80"], ["Chocolat chaud", "Petit", "3"], ["Chocolat chaud", "Grand", "4.20"],
  ]);
});

test("spreadsheet without header uses text and number columns, section rows carry over", () => {
  const table = [["Drinks"], ["Tea", "40"], ["Coffee", "৳৮০"], ["Snacks"], ["Samosa", "15"]];
  const guess = guessColumns(table);
  assert.deepEqual(guess.mapping, ["name", "price"]);
  const { rows } = tableToRows(table, guess, { defaultCurrency: "BDT" });
  assert.deepEqual(rows.map(r => [r.section, r.name, r.price]), [["Drinks", "Tea", "40"], ["Drinks", "Coffee", "80"], ["Snacks", "Samosa", "15"]]);
});

test("pasted CSV detection and CSV export escaping", () => {
  assert.equal(looksLikeTable("name,price\nTea,40\nCoffee,80"), ",");
  assert.equal(looksLikeTable("Tea 40\nCoffee 80"), false);
  const csv = toCSV([{ name: "=HYPERLINK()", price: "4", description: 'a "b", c' }], ["name", "price", "description"]);
  assert.equal(csv, '﻿name,price,description\r\n\'=HYPERLINK(),4,"a ""b"", c"\r\n');
});

test("Arabic menu photo is read right to left, with prices on the left", () => {
  const word = (text, x0, y0, w = 60, h = 24) => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, conf: 90 });
  const words = [
    word("مقبلات", 600, 40, 120, 34),
    word("حمص", 640, 100, 80), word("بالطحينة", 520, 100, 100), word("١٥", 60, 100, 30),
    word("فتوش", 640, 140, 80), word("٢٠", 60, 140, 30),
    word("مشروبات", 600, 200, 120, 34),
    word("شاي", 640, 260, 80), word("٥", 60, 260, 20),
    word("قهوة", 640, 300, 80), word("٨", 60, 300, 20),
  ];
  const text = layoutText(words);
  assert.match(text, /^# مقبلات\nحمص بالطحينة   ١٥/);
  const { rows } = parseMenuText(text, { defaultCurrency: "SAR" });
  assert.deepEqual(rows.map(r => [r.section, r.name, r.price]), [
    ["مقبلات", "حمص بالطحينة", "15"], ["مقبلات", "فتوش", "20"], ["مشروبات", "شاي", "5"], ["مشروبات", "قهوة", "8"],
  ]);
  assert.ok(isRightToLeft("حمص بالطحينة 15"));
  assert.ok(!isRightToLeft("Hummus 15"));
});

test("OCR noise from pictures and ornaments is dropped", () => {
  const word = (text, x0, y0, conf = 92, w = text.length * 12, h = 22) => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, conf });
  const words = [
    word("Burger", 40, 40), word("9.50", 400, 40),
    word("|||", 40, 80, 30), word("~~", 90, 80, 25), word("é1", 130, 80, 20),   // photo texture
    word("wd", 40, 120, 30), word("Ka", 90, 120, 35),                        // low-confidence fragments
    word("@", 300, 160, 20, 300, 200),                                        // big picture blob
    word("Fries", 40, 400), word("3.00", 400, 400),
  ];
  const text = layoutText(words);
  assert.equal(text, "Burger   9.50\nFries   3.00");
});

test("guess the language of Latin-script menus", () => {
  assert.equal(guessLatinLanguage("Soupe à l'oignon gratinée. Poulet rôti, frites maison. Crème brûlée")?.code, "fra");
  assert.equal(guessLatinLanguage("Tortilla española con jamón. Pollo al ajillo. Ensalada de la casa")?.code, "spa");
  assert.equal(guessLatinLanguage("Schnitzel mit Kartoffelsalat und Gurken. Käse Spätzle")?.code, "deu");
  assert.equal(guessLatinLanguage("Grilled chicken with fresh salad and fries. Soup of the day"), null);
});

test("words from two OCR passes are merged without duplicates", () => {
  const w = (text, x0, conf) => ({ text, x0, y0: 10, x1: x0 + 60, y1: 40, conf });
  const sparse = [w("Burger", 0, 95), w("9.50", 400, 96), w("Sal", 0 + 1000, 40), w("ad", 1050, 42)];
  const page = [w("Burger", 2, 93), { ...w("Salad", 1000, 90), x1: 1110 }, { ...w("Fries", 0, 91), y0: 60, y1: 90 }];
  const merged = mergeWordSets(sparse, page).map(x => x.text).sort();
  assert.deepEqual(merged, ["9.50", "Burger", "Fries", "Salad"]);
});
