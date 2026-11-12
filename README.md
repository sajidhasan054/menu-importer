# Menu Importer

Turn any restaurant menu into a clean CSV: phone photos, designed or scanned
menus, PDFs, Excel workbooks, CSV, Word and text files, in almost any language.
Review and edit the draft in a browser, download the CSV or JSON, or publish an
immutable snapshot to SQLite.

## How menus are read

| Input | With `ANTHROPIC_API_KEY` | Without it |
| --- | --- | --- |
| Photos (JPEG, PNG, WebP, HEIC, GIF, BMP, TIFF) and designed menus | Claude reads the image directly: multi-column layouts, size/price columns, icons, any script | Tesseract OCR and a line parser (simple layouts only) |
| PDF | Each page is read by Claude in parallel (text layer and page image) | Text layer, OCR fallback |
| Excel (`.xlsx`, `.xlsm`, `.xls`) and CSV/TSV | Clean tables are read directly; messy ones (title rows, Small/Large price columns, no header) are interpreted by Claude | Header-based table reader |
| Word (`.docx`), `.txt`, `.md` | Claude | Line parser |

The AI reader keeps names in the original language and script, adds English
translations (`name_en`, `description_en`), creates one row per size or price
column, detects the currency per price, and fills dietary and allergen tags only
when the menu shows them. Anything uncertain (illegible prices, service-charge
notes) is listed under **entries to check**.

The table reader finds the header row even below title rows and recognizes
column names in many languages (for example `Nom`/`Prix`, `Plato`/`Precio`,
`Gericht`/`Preis`, `নাম`/`দাম`, `品名`/`价格`).

## Run locally

Use Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app:app
```

To enable AI reading, export an [Anthropic API key](https://console.anthropic.com/)
before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn app:app
```

Optional settings: `MENU_AI_MODEL` (default `claude-opus-5-5`), `MENU_AI_EFFORT`
(`low`, `medium`, `high` (default), `xhigh`, `max`), `MENU_AI_PARALLEL` (pages
read at once, default 4) and `MENU_AI=off` to force the offline readers. Files
you upload are sent to the Anthropic API when AI reading is on.

Open http://127.0.0.1:8000 and try `examples/menu.csv`. Interactive API
documentation is at http://127.0.0.1:8000/docs and the JSON schema is at
`/api/schema`. Set `MENU_DB` to choose a different SQLite file.

To import photographs and scanned PDFs, install Tesseract and its language packs.
For example, on Debian or Ubuntu:

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-ben
OCR_LANG=eng+ben uvicorn app:app
```

English OCR is the default. CSV and text PDFs do not require Tesseract.

## Run in GitHub Codespaces

Open the repository in GitHub, then select **Code → Codespaces → Create
codespace on main**. The dev container installs the Python requirements and
English and Bengali OCR. Add `ANTHROPIC_API_KEY` as a Codespaces secret to
turn on AI reading. For a pre-existing Codespace, pull the latest changes
and use **Codespaces: Rebuild Container** from the command palette, or install
Tesseract manually using the commands above.

After setup finishes, start the app with:

```bash
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

Open the forwarded port in the browser and keep its visibility private.

## Command line

Convert one or more files straight to a CSV without the browser:

```bash
python extract_menu.py menu-photo.jpg drinks.pdf -o menu.csv --currency EUR
```

Use `--no-ai` for the offline readers and `--all-columns` to keep empty columns.

## Download results

After extracting and reviewing a menu, select **Download extracted CSV**.
It exports the current draft with one row per priced option or serving size,
starting with section, name, English name and description, then portion, price
and currency. Columns that are empty for every row are left out; add
`?all_columns=true` to `POST /api/export/csv` to keep them. The CSV uses UTF-8
with a BOM so spreadsheet apps show every script correctly. Use **Download draft JSON**
to retain the nested structure and source evidence. **Download example CSV**
provides a separate sample file to practice importing.

## Import formats

- **CSV:** UTF-8, with a header and one row per portion. Rows with the same
  section and item name are grouped. Start with the sample CSV. Column names
  follow the schema, with aliases like `item_name`, `category` and `price`.
  Use pipes inside tag cells, for example `Bangladeshi|Bengali`. Quote CSV
  values containing commas. Unrecognized columns are ignored.
- **Text PDF:** Reads each page's text layer while preserving spacing.
  Empty text layers fall back to OCR.
- **Without AI, scanned PDF or photo:** OCR reads the rendered page or image. Use straight,
  well-lit images. The line parser supports clear patterns such as
  `Chicken Momo — 6 pcs ৳180 / 12 pcs ৳320` and `Tea — 40`. Review unmatched
  lines and add any missing items. Dense multi-column layouts, unlabelled price
  columns, and descriptions on a separate line may need manual entry.

## Data model

The menu contains a restaurant, a branch, and items with one or more variants.
An item can have optional English and Bangla names and descriptions, section, cuisine,
item type, spice and sweetness on a 0–5 scale, dietary tags, and allergen tags.
Each variant can store a currency, fixed/starting/market/unknown price,
pieces, grams, millilitres, serving range, and availability. Optional unknowns
are null. Prices serialize as decimal strings to preserve precision.
Imported items carry the source filename, page or row, and original text.

Use `POST /api/import` with multipart fields `restaurant_name` and
`branch_name` (both optional; the restaurant name is read from the menu when
possible), `currency` (the fallback when the menu shows none) and one to ten
`files` fields of up to 25 MiB each. `GET /api/status` reports whether AI
reading is on. Use `POST /api/validate` to validate
the edited JSON, `POST /api/menus` to publish it, and `GET /api/menus/{id}` to
retrieve it. Each publish creates a distinct snapshot. Drafts and unmatched
lines are held in the browser during review.

This is a local, single-operator MVP. Merchant accounts, branch IDs, access
control, durable drafts, and re-upload comparisons would be needed for a shared
restaurant portal. Keep this instance bound to localhost.

## Open-source components

- [pypdf layout extraction](https://github.com/py-pdf/pypdf/blob/main/docs/user/extract-text.md)
- [pypdfium2 PDF rendering](https://github.com/pypdfium2-team/pypdfium2)
- [Claude API](https://docs.claude.com/) for vision and PDF reading
- [openpyxl](https://openpyxl.readthedocs.io/), [xlrd](https://github.com/python-excel/xlrd) and [pillow-heif](https://github.com/bigcat88/pillow_heif)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) and
  [Bengali language data](https://github.com/tesseract-ocr/tessdata/blob/main/ben.traineddata)
