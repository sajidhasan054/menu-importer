# Menu Importer

Convert restaurant menu files into one versioned JSON format. Review and edit
the draft in a browser, download it, or publish an immutable snapshot to SQLite.

## Run locally

Use Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app:app
```

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
English and Bengali OCR. For a pre-existing Codespace, pull the latest changes
and use **Codespaces: Rebuild Container** from the command palette, or install
Tesseract manually using the commands above.

After setup finishes, start the app with:

```bash
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

Open the forwarded port in the browser and keep its visibility private.

## Download results

After extracting and reviewing a menu, select **Download extracted CSV**.
It exports the current draft with one row per priced option or serving size.
The CSV uses UTF-8 with a BOM for spreadsheet apps. Use **Download draft JSON**
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
- **Scanned PDF or photo:** OCR reads the rendered page or image. Use straight,
  well-lit images. The line parser supports clear patterns such as
  `Chicken Momo — 6 pcs ৳180 / 12 pcs ৳320` and `Tea — 40`. Review unmatched
  lines and add any missing items. Dense multi-column layouts, unlabelled price
  columns, and descriptions on a separate line may need manual entry.

## Data model

The menu contains a restaurant, a branch, and items with one or more variants.
An item can have optional names and descriptions in Bangla, section, cuisine,
item type, spice and sweetness on a 0–5 scale, dietary tags, and allergen tags.
Each variant can store a currency, fixed/starting/market/unknown price,
pieces, grams, millilitres, serving range, and availability. Optional unknowns
are null. Prices serialize as decimal strings to preserve precision.
Imported items carry the source filename, page or row, and original text.

Use `POST /api/import` with multipart fields `restaurant_name`, `branch_name`,
`currency` and one to five `files` fields. Use `POST /api/validate` to validate
the edited JSON, `POST /api/menus` to publish it, and `GET /api/menus/{id}` to
retrieve it. Each publish creates a distinct snapshot. Drafts and unmatched
lines are held in the browser during review.

This is a local, single-operator MVP. Merchant accounts, branch IDs, access
control, durable drafts, and re-upload comparisons would be needed for a shared
restaurant portal. Keep this instance bound to localhost.

## Open-source components

- [pypdf layout extraction](https://github.com/py-pdf/pypdf/blob/main/docs/user/extract-text.md)
- [pypdfium2 PDF rendering](https://github.com/pypdfium2-team/pypdfium2)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) and
  [Bengali language data](https://github.com/tesseract-ocr/tessdata/blob/main/ben.traineddata)
