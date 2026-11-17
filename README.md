# Menu & Catalog Maker

Build **restaurant menus** and **shop catalogs** from phone photos, designed
or scanned menus, price lists, PDFs, Excel, CSV, Word and text files, in
dozens of languages. Shop catalogs export straight to **WhatsApp, Facebook,
Instagram** (Meta catalog) and **Google Merchant Center**.

**It is free.** Everything runs in your web browser: text recognition, PDF
and spreadsheet reading, photo processing and storage. Nothing is uploaded
and there are no paid services or API keys.

## Use the web tool

The tool lives in [`web/`](web/) and is published to GitHub Pages
automatically. Once Pages is turned on (see below), open:

```
https://<your-github-username>.github.io/menu-importer/
```

The home page lists your menus and catalogs. Select **Create new** and
choose a **Restaurant menu** or a **Shop catalog**. Each one is saved in your
browser; **Settings › Download backup** moves it to another device
(**Restore a backup** on the home page).

## Shop catalogs

1. **Add products** three ways:
   - **From product photos**: drop photos and each item becomes a product.
     Photos named `red-dress-1.jpg`, `red-dress-2.jpg` are grouped into one
     product called "Red dress".
   - **One product by hand.**
   - **Import a product list**: Excel or CSV (column names in many languages
     are recognised), a Meta or Google product feed, or a photo, PDF or pasted
     text of a price list.
2. **Edit each product**: up to 10 photos (2–3 recommended, the first is the
   main one), title, description, price and sale price, availability,
   condition, stock, category, brand, and **colours and sizes**. Every
   colour × size combination becomes a variant with its own SKU, price, stock
   and photo. Under *More details*: material, pattern, gender, age group,
   barcode (GTIN) and product page link. Each product shows what it still
   needs before Meta and Google accept it.
3. **Share and export**:
   - **Meta catalog (CSV)** for WhatsApp Business, Facebook and Instagram
     shops. In [Meta Commerce Manager](https://business.facebook.com/commerce)
     open your catalog, then *Data sources › Data feed › Upload once*. Connect
     the catalog to WhatsApp Business (*WhatsApp Manager › Catalog*), your
     Facebook Page and Instagram.
   - **Google feed (TSV)** for Google Merchant Center (*Products › Add
     products › Add from file*).
   - **Photos (ZIP)**: square JPEGs named by SKU. Meta and Google read photos
     from public links, so put this folder online once (for example a free
     public GitHub repository with Pages turned on; the tool shows the steps)
     and enter its address under **Settings › Photo link address**. Photos
     you added as links are used as they are.
   - **Excel**, and a **WhatsApp product list** to paste into chats and status.

Products without their own page link to a WhatsApp chat with your number
(`https://wa.me/…`, with a message naming the product), or to your website.

### Orders and delivery

The **Orders** tab is for shops that sell through WhatsApp, Messenger or
calls and deliver anywhere in Bangladesh through a courier.

- **New order**: customer name, mobile, district (all 64), area and address;
  products and options from the catalog; delivery charge (inside or outside
  Dhaka, set in **Settings**, editable per order); discount; payment (cash on
  delivery, bKash, Nagad, Rocket, bank, card) with any advance and its
  transaction ID. It shows what the courier must collect, and warns when an
  option is out of stock.
- **Status**: New → Confirmed → Packed → With courier (courier and tracking
  number) → Delivered, or Cancelled / Returned. Confirming takes the stock;
  cancelling or a return puts it back.
- **Customer updates**: at each step, open a WhatsApp chat with the customer
  with the message already written, in Bangla or English (set in
  **Settings**). It's sent from the owner's own WhatsApp, so it costs nothing.
- **Courier sheet**: packed orders as Excel (invoice, name, phone, address,
  district, area, cash to collect, items) for bulk upload in the courier's
  merchant panel. **Invoice** prints an invoice and packing slip.
- The summary shows orders to confirm, to ship, with the courier, and the cash
  the couriers still have to hand over.

Order numbers follow the shop prefix: `DFH-ORD-1001`.

### Naming conventions

| What | Pattern | Example |
| --- | --- | --- |
| SKU prefix | Initials of the shop name (editable in Settings) | `DFH` for Dhaka Fashion House |
| Product SKU (`item_group_id`) | `<prefix>-<4 digits>`, never reused | `DFH-0001` |
| Variant SKU (`id`) | `<product SKU>-<COLOUR>-<SIZE>` | `DFH-0001-NAVY-XL` |
| Photo files | `<product SKU in lowercase>-<n>.jpg` | `dfh-0001-1.jpg`, `dfh-0001-2.jpg` |
| Order number | `<prefix>-ORD-<number from 1001>` | `DFH-ORD-1001` |
| Feed columns | Meta's and Google's official field names | `id, title, description, availability, condition, price, sale_price, link, image_link, additional_image_link, brand, item_group_id, color, size, material, pattern, gender, age_group, product_type, gtin, quantity_to_sell_on_facebook` |
| Prices in feeds | amount with 2 decimals, space, ISO currency | `1650.00 BDT` |

A feed exported by the tool can be imported again with the same SKUs.

## Restaurant menus

1. **Add your menu.** Choose files or drop them in: photos, PDF, Excel, CSV,
   Word or text. You can also paste text, or rows copied from a spreadsheet.
   Pick the languages printed on the menu (English, Bangla, Hindi, Arabic,
   Chinese, Japanese, Korean, Thai, French, Spanish and 30 more). Each language
   downloads once and is then cached by the browser.
2. **Check what was read.** Each photo or page shows the image next to the
   recognized text, the languages used and how certain the reader was. The
   text is editable: fix mistakes and select **Update items**. A line starting
   with `#` becomes a section heading. For a menu full of pictures, use
   **Select areas** and drag boxes around the text to read; everything else is
   ignored. **Rotate**, **Invert colors** (light text on a dark menu) and
   **Read again** are there too. For spreadsheets, choose what each column
   holds; columns marked *Price for size* become one row per size.
3. **Edit the items** in the table. Rows missing a name or price are
   highlighted. Add, duplicate (for another size) or delete rows.
4. **Download** a CSV or Excel file, or copy the table into Google Sheets.

Your table is kept in the browser between visits until you select
**Start over**.

### How photos are read

1. **Language and orientation.** The page's script (Latin, Arabic, Bangla,
   Chinese, Devanagari, Thai…) and orientation are detected, so sideways
   photos are turned upright and the right language is loaded. For
   Latin-script menus a quick first read spots French, Spanish, German,
   Italian, Portuguese, Turkish, Dutch and others, and adds that language so
   accents (é, ñ, ü, ç) come out right. Ticking the languages yourself under
   **Menu languages** is faster and the most reliable.
2. **Image cleanup.** The photo is straightened, converted to grayscale with
   stretched contrast, and inverted for light text on a dark background.
   **Strong** cleanup also evens out shadows and flattens patterned paper and
   pictures.
3. **Text size.** The size of the letters is measured and the image is scaled
   to the size the text reader handles best.
4. **Two reading passes.** One pass finds text scattered across the page
   (prices far from their names); the other reads whole lines. Their words are
   merged, so each catches what the other misses.
5. **Noise removal and layout.** Words from pictures and ornaments, and words
   below the **Skip unclear text** level, are dropped. Columns are detected,
   prices are kept with their items, Arabic, Persian, Urdu and Hebrew are read
   right to left, and large text becomes section headings.

**More reading settings** lets you change the image cleanup, the unclear-text
level, text enlarging, the layout mode and automatic straightening.

### What the reader understands

- Item names with prices at the end of the line, with or without dot leaders
  (`Soup ........ 4.50`), currency symbols (`৳ € £ ₹ ¥ ₩ ฿ $ Tk Rs` and ISO
  codes) and South Asian `280/-` prices.
- Digits in Bangla, Devanagari, Arabic, Thai and other scripts, and decimal
  commas (`12,50 €`).
- Several prices per item: `6 pcs 180 / 12 pcs 320`, `S 3.5  L 4.5`, or a
  `Small  Medium  Large` header above price columns. Each price becomes its
  own row with the size in the *portion* column.
- Section headings (capitals, a trailing colon, larger text in photos, or
  common words such as *Starters*, *Desserts*, *পানীয়*, *Boissons*),
  descriptions under items, and names with the price on the next line.
- Two- and three-column menu layouts in photos and PDFs.

Free text recognition is not perfect on very decorative menus. Clear, straight,
well-lit photos work best; take one photo per page. For a menu it cannot read,
the **Tips** section has a prompt you can paste into any free AI chat app along
with the photo, then paste the reply back into the tool.

### CSV columns

`section, name, name_en, description, portion, price, currency`, one row per
price. The file is UTF-8 so every script opens correctly in Excel and Google
Sheets.

## Publish on GitHub Pages (free)

1. In the repository on GitHub, go to **Settings → Pages** and set
   **Source** to **GitHub Actions**.
2. Merge to `main`. The **Publish web tool** workflow builds the site and
   publishes it; the address appears in the workflow run and under
   **Settings → Pages**.

GitHub Pages is free for **public** repositories. For a private repository it
needs a paid GitHub plan; alternatively make the repository public (the tool
contains no secrets), or upload the built `_site` folder to another free static
host such as Cloudflare Pages or Netlify.

## Run it on your computer

Use Node.js 20 or newer:

```bash
npm install
npm run build
npm run serve
```

Then open http://localhost:8080. (Opening `index.html` directly from disk does
not work, because browsers block the text recognition worker on `file://`.)

Run the unit tests with `npm test`, and the end-to-end check of the main
flows (shop and restaurant, exports, backup, phone layout) with
`node qa/flows.cjs` after `npm run build`.

### Quality checks

`qa/` holds a set of test menus in English, French, Spanish, German, Arabic,
Bangla and Chinese, rendered as photo-like images (tilted, blurred, shadowed,
grainy, with pictures and ornaments, one sideways). `node qa/run.cjs` runs them
through the built tool in a real browser and reports how many items and prices
were found. It needs Playwright with Chromium (`npx playwright install
chromium`). Add `--manual` to test with the right languages ticked instead of
automatic detection.

## Optional: Python server and command line

The repository also has the original Python app (`app.py`), which reads files
on a server with Tesseract and can publish menu snapshots to SQLite, and a
command-line converter:

```bash
python -m pip install -r requirements.txt
sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-ben
python extract_menu.py menu.pdf prices.xlsx -o menu.csv --currency BDT
uvicorn app:app   # browser version at http://127.0.0.1:8000
```

Set `OCR_LANG` (for example `eng+ben`) to choose Tesseract languages. Run its
tests with `python -m unittest test_importer`. The GitHub Codespaces dev
container installs everything needed for it.

## Open-source components

- [Tesseract.js](https://github.com/naptha/tesseract.js) and
  [tessdata](https://github.com/tesseract-ocr/tessdata) for text recognition
- [PDF.js](https://mozilla.github.io/pdf.js/) for PDFs
- [SheetJS](https://sheetjs.com/) for Excel files and
  [Papa Parse](https://www.papaparse.com/) for CSV
- Python app: FastAPI, pypdf, pypdfium2, openpyxl, xlrd, Pillow and Tesseract
