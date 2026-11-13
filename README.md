# Menu Importer

Turn restaurant menus into a clean CSV: phone photos, designed or scanned
menus, PDFs, Excel workbooks, CSV, Word and text files, in dozens of languages.

**It is free.** Everything runs in your web browser: text recognition, PDF
reading and spreadsheet reading. Nothing is uploaded and there are no paid
services or API keys.

## Use the web tool

The tool lives in [`web/`](web/) and is published to GitHub Pages
automatically. Once Pages is turned on (see below), open:

```
https://<your-github-username>.github.io/menu-importer/
```

1. **Add your menu.** Choose files or drop them in: photos, PDF, Excel, CSV,
   Word or text. You can also paste text, or rows copied from a spreadsheet.
   Pick the languages printed on the menu (English, Bangla, Hindi, Arabic,
   Chinese, Japanese, Korean, Thai, French, Spanish and 30 more). Each language
   downloads once and is then cached by the browser.
2. **Check what was read.** Each photo or page shows the image next to the
   recognized text. The text is editable: fix mistakes and select
   **Update items**. A line starting with `#` becomes a section heading. Use
   **Rotate**, **Invert colors** (light text on a dark menu) or **Read again**
   if a photo comes out badly. For spreadsheets, choose what each column holds;
   columns marked *Price for size* become one row per size.
3. **Edit the items** in the table. Rows missing a name or price are
   highlighted. Add, duplicate (for another size) or delete rows.
4. **Download** a CSV or Excel file, or copy the table into Google Sheets.

Your table is kept in the browser between visits until you select
**Start over**.

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

Run the parser tests with `npm test`.

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
