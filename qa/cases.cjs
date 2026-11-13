// QA menus: each case renders a menu in HTML, turns it into a photo-like image,
// and lists the items and prices the tool should find.

const toDigits = (text, zero) => String(text).replace(/[0-9]/g, d => String.fromCharCode(zero + Number(d)));
const arabic = n => toDigits(n, 0x0660);
const bangla = n => toDigits(n, 0x09e6);

const FONT = name => `<link rel="stylesheet" href="../node_modules/@fontsource/${name}/400.css">`;

// A fake food photo: soft colour blobs with grain, like a picture on a menu.
const photo = (w, h, hue) => `<div style="width:${w}px;height:${h}px;border-radius:10px;margin:14px 0;
  background:radial-gradient(circle at 30% 40%, hsl(${hue} 70% 55%) 0 22%, transparent 23%),
  radial-gradient(circle at 65% 60%, hsl(${hue + 40} 60% 40%) 0 28%, transparent 29%),
  radial-gradient(circle at 50% 50%, hsl(${hue + 20} 30% 85%) 0 45%, hsl(${hue} 25% 25%) 46%);
  filter:url(#grain)"></div>`;

const GRAIN = `<svg width="0" height="0" style="position:absolute"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2"/><feColorMatrix type="saturate" values="0"/><feBlend in="SourceGraphic" mode="multiply"/></filter></svg>`;

function page({ fonts = [], dir = "ltr", lang = "en", style = "", body }) {
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">${fonts.map(FONT).join("")}
<style>body{margin:0}.menu{${style}}.row{display:flex;justify-content:space-between;gap:16px;align-items:baseline;margin:6px 0}
.lead{flex:1;border-bottom:2px dotted currentColor;opacity:.5;transform:translateY(-6px)}.desc{font-size:.72em;opacity:.8;margin:-2px 0 8px}
h1{text-align:center;margin:0 0 18px}h2{margin:18px 0 8px}.cols{display:flex;gap:70px}.cols>div{flex:1}</style></head>
<body>${GRAIN}<div class="menu">${body}</div></body></html>`;
}

const row = (name, price, { lead = false, desc = "" } = {}) =>
  `<div class="row"><span>${name}</span>${lead ? '<span class="lead"></span>' : ""}<span>${price}</span></div>${desc ? `<div class="desc">${desc}</div>` : ""}`;

module.exports = [
  {
    id: "en-two-columns-photos",
    title: "English, dark two-column menu with food pictures",
    expected: [["Garlic Bread", "4.50"], ["Tomato Soup", "6.00"], ["Chicken Wings", "8.25"], ["Beef Burger", "12.00"],
      ["Grilled Salmon", "16.50"], ["Mushroom Risotto", "13.00"], ["Chocolate Cake", "5.50"], ["Lemonade", "3.00"]],
    effects: { tilt: 1.5, blur: 0.6, shadow: 0.25, noise: 0.08 },
    html: page({
      fonts: ["noto-serif"],
      style: "width:1000px;padding:44px;background:#2b1d14;color:#f3e6cf;font:26px 'Noto Serif',serif",
      body: `<h1 style="font-size:60px">The Copper Pot</h1><div class="cols"><div>
        <h2>STARTERS</h2>${row("Garlic Bread", "4.50", { desc: "toasted with herbs and butter" })}${row("Tomato Soup", "6.00")}${row("Chicken Wings", "8.25")}
        ${photo(400, 170, 20)}<h2>DESSERTS</h2>${row("Chocolate Cake", "5.50")}</div><div>
        <h2>MAINS</h2>${row("Beef Burger", "12.00")}${row("Grilled Salmon", "16.50")}${row("Mushroom Risotto", "13.00")}
        ${photo(400, 170, 100)}<h2>DRINKS</h2>${row("Lemonade", "3.00")}</div></div>`,
    }),
  },
  {
    id: "fr-bistro",
    title: "French bistro, accents, decimal commas, dot leaders, patterned paper",
    expected: [["Soupe à l'oignon", "8.50"], ["Escargots de Bourgogne", "12.00"], ["Pâté de campagne", "9.00"],
      ["Bœuf bourguignon", "21.00"], ["Poulet rôti", "17.50"], ["Crème brûlée", "7.50"], ["Tarte Tatin", "8.00"]],
    effects: { tilt: -1, blur: 0.4, shadow: 0.2, noise: 0.06 },
    html: page({
      lang: "fr", fonts: ["playfair-display"],
      style: "width:900px;padding:50px;color:#3a2a1a;font:28px 'Playfair Display',serif;background:#f4ead6 repeating-linear-gradient(45deg,#0000 0 14px,#e8dcc2 14px 16px)",
      body: `<h1 style="font-size:58px">Chez Margot</h1><h2>Entrées</h2>
        ${row("Soupe à l'oignon", "8,50 €", { lead: true, desc: "gratinée au comté" })}${row("Escargots de Bourgogne", "12,00 €", { lead: true })}${row("Pâté de campagne", "9,00 €", { lead: true })}
        <h2>Plats</h2>${row("Bœuf bourguignon", "21,00 €", { lead: true })}${row("Poulet rôti", "17,50 €", { lead: true, desc: "frites maison, salade verte" })}
        <h2>Desserts</h2>${row("Crème brûlée", "7,50 €", { lead: true })}${row("Tarte Tatin", "8,00 €", { lead: true })}`,
    }),
  },
  {
    id: "ar-grill",
    title: "Arabic, right to left, Arabic-Indic digits, riyal prices",
    expected: [["حمص", "15"], ["متبل", "15"], ["فتوش", "20"], ["شيش طاووق", "45"], ["كباب لحم", "55"], ["شاي", "5"], ["قهوة عربية", "10"]],
    effects: { tilt: 1, blur: 0.4, shadow: 0.15, noise: 0.05 },
    html: page({
      lang: "ar", dir: "rtl", fonts: ["noto-naskh-arabic"],
      style: "width:820px;padding:50px;background:#fffaf0;color:#222;font:34px 'Noto Naskh Arabic',serif",
      body: `<h1 style="font-size:60px">مطعم الشام</h1><h2>مقبلات</h2>${row("حمص", `${arabic(15)} ر.س`)}${row("متبل", `${arabic(15)} ر.س`)}${row("فتوش", `${arabic(20)} ر.س`)}
        <h2>مشويات</h2>${row("شيش طاووق", `${arabic(45)} ر.س`)}${row("كباب لحم", `${arabic(55)} ر.س`)}
        <h2>مشروبات</h2>${row("شاي", `${arabic(5)} ر.س`)}${row("قهوة عربية", `${arabic(10)} ر.س`)}`,
    }),
  },
  {
    id: "ar-western-digits",
    title: "Arabic menu with Western digits (common in the Gulf)",
    expected: [["شوربة عدس", "12"], ["سلطة خضراء", "18"], ["مندي دجاج", "35"], ["كبسة لحم", "48"], ["عصير برتقال", "10"], ["ماء", "3"]],
    effects: { tilt: -0.8, blur: 0.4, shadow: 0.15, noise: 0.05 },
    html: page({
      lang: "ar", dir: "rtl", fonts: ["noto-naskh-arabic"],
      style: "width:820px;padding:50px;background:#fff;color:#222;font:34px 'Noto Naskh Arabic',serif",
      body: `<h1 style="font-size:60px">مطعم البيت</h1><h2>المقبلات</h2>${row("شوربة عدس", "12 SAR")}${row("سلطة خضراء", "18 SAR")}
        <h2>الأطباق الرئيسية</h2>${row("مندي دجاج", "35 SAR")}${row("كبسة لحم", "48 SAR")}<h2>المشروبات</h2>${row("عصير برتقال", "10 SAR")}${row("ماء", "3 SAR")}`,
    }),
  },
  {
    id: "es-tapas-sizes",
    title: "Spanish tapas with Tapa / Ración price columns",
    expected: [["Patatas bravas", "4.50"], ["Patatas bravas", "8.00"], ["Croquetas de jamón", "5.00"], ["Croquetas de jamón", "9.50"],
      ["Pulpo a la gallega", "9.00"], ["Pulpo a la gallega", "16.00"], ["Tortilla española", "4.00"], ["Tortilla española", "7.50"]],
    effects: { tilt: 0.8, blur: 0.3, shadow: 0.1, noise: 0.04 },
    html: page({
      lang: "es", fonts: ["noto-serif"],
      style: "width:900px;padding:50px;background:#fff;color:#7a1f12;font:28px 'Noto Serif',serif",
      body: `<h1 style="font-size:56px">Bar La Plaza</h1><div class="row" style="justify-content:flex-end;gap:60px;font-weight:700"><span>Tapa</span><span>Ración</span></div>
        ${["Patatas bravas|4,50|8,00", "Croquetas de jamón|5,00|9,50", "Pulpo a la gallega|9,00|16,00", "Tortilla española|4,00|7,50"].map(line => {
          const [n, a, b] = line.split("|");
          return `<div class="row"><span style="flex:1">${n}</span><span style="width:90px;text-align:right">${a}</span><span style="width:110px;text-align:right">${b}</span></div>`;
        }).join("")}`,
    }),
  },
  {
    id: "de-cafe",
    title: "German café with umlauts",
    expected: [["Kaffee", "2.80"], ["Cappuccino", "3.50"], ["Heiße Schokolade", "3.90"], ["Apfelstrudel mit Sahne", "5.20"], ["Käsekuchen", "4.60"], ["Brötchen mit Käse", "3.20"]],
    effects: { tilt: -0.7, blur: 0.4, shadow: 0.15, noise: 0.05 },
    html: page({
      lang: "de", fonts: ["noto-serif"],
      style: "width:860px;padding:50px;background:#f7f3ec;color:#1d2b36;font:28px 'Noto Serif',serif",
      body: `<h1 style="font-size:56px">Café Müller</h1><h2>Getränke</h2>${row("Kaffee", "2,80 €")}${row("Cappuccino", "3,50 €")}${row("Heiße Schokolade", "3,90 €")}
        <h2>Kuchen</h2>${row("Apfelstrudel mit Sahne", "5,20 €")}${row("Käsekuchen", "4,60 €")}<h2>Frühstück</h2>${row("Brötchen mit Käse", "3,20 €")}`,
    }),
  },
  {
    id: "bn-cafe",
    title: "Bangla menu with Bangla digits and taka sign",
    expected: [["পরোটা", "20"], ["ডিম ভাজি", "30"], ["চিকেন বিরিয়ানি", "220"], ["বিফ তেহারি", "250"], ["চা", "15"], ["লাচ্ছি", "60"]],
    effects: { tilt: 1, blur: 0.4, shadow: 0.15, noise: 0.05 },
    html: page({
      lang: "bn", fonts: ["noto-sans-bengali"],
      style: "width:820px;padding:50px;background:#fff;color:#111;font:32px 'Noto Sans Bengali',sans-serif",
      body: `<h1 style="font-size:56px">ঢাকা ক্যাফে</h1><h2>নাস্তা</h2>${row("পরোটা", `৳${bangla(20)}`)}${row("ডিম ভাজি", `৳${bangla(30)}`)}
        <h2>ভাত</h2>${row("চিকেন বিরিয়ানি", `৳${bangla(220)}`)}${row("বিফ তেহারি", `৳${bangla(250)}`)}<h2>পানীয়</h2>${row("চা", `৳${bangla(15)}`)}${row("লাচ্ছি", `৳${bangla(60)}`)}`,
    }),
  },
  {
    id: "zh-noodles",
    title: "Chinese noodle shop with yuan prices",
    expected: [["牛肉面", "28"], ["炸酱面", "22"], ["酸辣粉", "18"], ["小笼包", "25"], ["饺子", "20"], ["豆浆", "6"]],
    effects: { tilt: 0.6, blur: 0.3, shadow: 0.12, noise: 0.04 },
    html: page({
      lang: "zh", fonts: ["noto-sans-sc"],
      style: "width:760px;padding:50px;background:#fff8f0;color:#7a0f0f;font:34px 'Noto Sans SC',sans-serif",
      body: `<h1 style="font-size:58px">老北京面馆</h1><h2>面食</h2>${row("牛肉面", "¥28")}${row("炸酱面", "¥22")}${row("酸辣粉", "¥18")}
        <h2>点心</h2>${row("小笼包", "¥25")}${row("饺子", "¥20")}<h2>饮料</h2>${row("豆浆", "¥6")}`,
    }),
  },
  {
    id: "en-sideways-photo",
    title: "English menu photographed sideways, tilted, with a shadow",
    expected: [["Pancakes", "7.50"], ["Eggs Benedict", "11.00"], ["Avocado Toast", "9.50"], ["Fresh Orange Juice", "4.00"], ["Flat White", "3.80"]],
    effects: { rotate: 90, tilt: 2.5, blur: 0.7, shadow: 0.45, noise: 0.08 },
    html: page({
      fonts: ["noto-serif"],
      style: "width:820px;padding:50px;background:#fff;color:#222;font:30px 'Noto Serif',serif",
      body: `<h1 style="font-size:56px">Sunrise Diner</h1><h2>BREAKFAST</h2>${row("Pancakes", "$7.50")}${row("Eggs Benedict", "$11.00")}${row("Avocado Toast", "$9.50")}
        <h2>DRINKS</h2>${row("Fresh Orange Juice", "$4.00")}${row("Flat White", "$3.80")}`,
    }),
  },
  {
    id: "en-busy-pictures",
    title: "Busy menu: script headings, ornaments and many pictures",
    expected: [["Margherita Pizza", "11.00"], ["Pepperoni Pizza", "13.00"], ["Caesar Salad", "9.00"], ["Spaghetti Carbonara", "14.00"],
      ["Tiramisu", "6.50"], ["Espresso", "2.50"]],
    effects: { tilt: -1.2, blur: 0.5, shadow: 0.2, noise: 0.07 },
    html: page({
      fonts: ["dancing-script", "noto-serif"],
      style: "width:1000px;padding:44px;background:#fdf6e3;color:#2d1b0e;font:28px 'Noto Serif',serif;border:14px double #8b5a2b",
      body: `<h1 style="font:72px 'Dancing Script',cursive">Luigi's Trattoria</h1><div style="text-align:center;font-size:30px">❦ ✦ ❧ ✦ ❦</div>
        <div class="cols"><div>${photo(420, 200, 10)}<h2 style="font:44px 'Dancing Script',cursive">Pizza</h2>${row("Margherita Pizza", "11.00")}${row("Pepperoni Pizza", "13.00")}
        ${photo(420, 150, 80)}<h2 style="font:44px 'Dancing Script',cursive">Salads</h2>${row("Caesar Salad", "9.00")}</div>
        <div><h2 style="font:44px 'Dancing Script',cursive">Pasta</h2>${row("Spaghetti Carbonara", "14.00")}${photo(420, 230, 40)}
        <h2 style="font:44px 'Dancing Script',cursive">Dolci &amp; Caffè</h2>${row("Tiramisu", "6.50")}${row("Espresso", "2.50")}${photo(420, 140, 200)}</div></div>
        <div style="text-align:center;font-size:30px">✦ ❦ ✦</div>`,
    }),
  },
];
