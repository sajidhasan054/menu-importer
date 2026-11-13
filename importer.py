import csv
import io
import os
from pathlib import Path
import re
import subprocess
from datetime import date, datetime
from decimal import Decimal
from threading import Lock
from xml.etree import ElementTree
import zipfile

import pypdfium2 as pdfium
from PIL import Image, ImageOps
from pypdf import PdfReader

from schema import Item, Source, Variant

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
NUMBER = r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,2})?"
PORTION = r"(?P<quantity>[0-9]+)\s*(?P<unit>pcs?\b|pieces?\b|পিস|g\b|grams?\b|গ্রাম|ml\b|মিলি)"
PRICE = re.compile(
    rf"(?:(?P<portion>{PORTION})\s*[:–—-]?\s*)?"
    rf"(?P<from>from\s+)?(?P<prefix>৳|BDT\s*)?\s*"
    rf"(?P<amount>{NUMBER})(?P<suffix>\s*(?:৳|BDT\b|টাকা))?",
    re.I,
)
SEGMENTS = re.compile(r"\s*/\s*")
DOLLAR_PRICE = re.compile(rf"(?P<name>.+?)\s+\$\s*(?P<amount>{NUMBER})(?=\s{{2,}}|$)")
SECTIONS = re.compile(
    r"main courses?|appeti[sz]ers?|beverages?|drinks?|starters?|desserts?|salads?|soups?|sides?",
    re.I,
)
DOLLAR_CURRENCIES = {"USD", "CAD", "AUD", "NZD", "SGD", "HKD"}
PDFIUM_LOCK = Lock()
ALIASES = {
    alias: field
    for field, aliases in {
        "name": "item item_name dish dish_name product product_name menu_item food title "
                "nombre plato nom plat gericht nome piatto produto prato isim ürün naam "
                "নাম 名前 品名 菜名 料理名 名称 메뉴 메뉴명 이름 اسم नाम ชื่อ món tên_món",
        "section": "category categories group menu_section course categoria categoría catégorie "
                   "kategorie kategori ক্যাটাগরি বিভাগ 分类 類別 カテゴリ 카테고리 فئة श्रेणी",
        "price_amount": "price cost amount rate mrp unit_price precio prix preis prezzo preço "
                        "fiyat prijs цена মূল্য দাম 価格 价格 價格 가격 سعر कीमत ราคา giá",
        "description": "desc details ingredients descripcion descripción beschreibung descrizione "
                       "descrição açıklama বিবরণ 説明 描述 설명 وصف विवरण",
        "label": "portion size variant serving",
        "cuisine_tags": "cuisine",
        "sweetness_level": "sweet_level",
    }.items()
    for alias in aliases.split()
}


def normalize(text):
    return text.translate(DIGITS).strip()


def number(text):
    value = re.sub(r"৳|BDT|টাকা", "", normalize(text), flags=re.I).strip()
    if not re.fullmatch(NUMBER, value):
        raise ValueError("Enter a price such as 180 or 1,250.50.")
    return Decimal(value.replace(",", ""))


def decode_text(data):
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def csv_rows(data):
    text = decode_text(data)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        dialect = "excel"
    return list(csv.reader(io.StringIO(text, newline=""), dialect))


def cell_text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).strip()


def excel_sheets(data, suffix):
    """Return [(sheet_name, rows)] for .xlsx/.xlsm or legacy .xls workbooks."""
    if suffix == ".xls":
        import xlrd
        book = xlrd.open_workbook(file_contents=data)
        return [
            (sheet.name, [[cell_text(value) for value in sheet.row_values(index)] for index in range(sheet.nrows)])
            for sheet in book.sheets()
        ]
    from openpyxl import load_workbook
    book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        return [
            (sheet.title, [[cell_text(value) for value in row] for row in sheet.iter_rows(values_only=True)])
            for sheet in book.worksheets
        ]
    finally:
        book.close()


def header_key(cell):
    key = re.sub(r"[\s\-/]+", "_", cell.strip().casefold()).strip("_")
    key = re.sub(r"_?\(.*\)$", "", key)
    return ALIASES.get(key, key)


def find_header(rows):
    """Locate the header row: the first of the opening rows that names an item column."""
    for index, row in enumerate(rows[:15]):
        headers = [header_key(cell) for cell in row]
        if "name" in headers:
            return index, headers
    return None, None


def table_items(rows, currency, origin="CSV"):
    """Parse rows that have a recognizable header. Returns (items, issues, complete).

    complete is False when the table has no name column, or when it has
    unrecognized numeric columns (for example Small/Large price columns).
    """
    header_index, headers = find_header(rows)
    if header_index is None:
        return [], [], False
    known = set(Item.model_fields) | set(Variant.model_fields) | {"name"}
    named = [header for header in headers if header]
    if len(set(named)) != len(named):
        return [], [], False
    body = rows[header_index + 1:]
    unknown_numeric = [
        column for column, header in enumerate(headers)
        if header and header not in known
        and sum(bool(re.fullmatch(rf"\D{{0,4}}{NUMBER}\D{{0,4}}", normalize(row[column])))
                for row in body if column < len(row) and row[column].strip()) >= max(1, len(body) // 3)
    ]

    items = {}
    issues = []
    for offset, values in enumerate(body, header_index + 2):
        locator = f"{origin} row {offset}"
        if not any(value.strip() for value in values):
            continue
        try:
            row = {key: value.strip() for key, value in zip(headers, values) if key and value.strip()}
            if "name" not in row:
                raise ValueError("Missing item name.")
            item_fields = {key: value for key, value in row.items() if key in Item.model_fields}
            for key in ("cuisine_tags", "dietary_tags", "allergen_tags"):
                if key in item_fields:
                    item_fields[key] = [tag.strip() for tag in re.split(r"[|;]", row[key]) if tag.strip()]
            for key in ("spice_level", "sweetness_level"):
                if key in item_fields:
                    item_fields[key] = normalize(row[key])

            variant_fields = {key: value for key, value in row.items() if key in Variant.model_fields}
            for key in ("pieces", "weight_g", "volume_ml", "serves_min", "serves_max"):
                if key in variant_fields:
                    variant_fields[key] = normalize(row[key])
            if "price_amount" in row:
                variant_fields["price_amount"] = number(row["price_amount"])
                variant_fields.setdefault("price_type", "fixed")
            variant_fields["currency"] = variant_fields.get("currency", currency).upper()
            item_fields["variants"] = [Variant(**variant_fields)]
            item_fields["sources"] = [Source(locator=locator, raw_text=" | ".join(values))]
            item = Item(**item_fields)
        except ValueError as error:
            issues.append(Source(locator=locator, raw_text=f"{' | '.join(values)}\n{error}"))
            continue
        key = (item.section, item.name)
        if key in items:
            existing = items[key]
            for field in Item.model_fields.keys() - {"variants", "sources", "section", "name"}:
                previous, incoming = getattr(existing, field), getattr(item, field)
                if previous is None:
                    setattr(existing, field, incoming)
                elif incoming is not None and previous != incoming:
                    issues.append(Source(locator=locator, raw_text=f"Conflicting {field}: {incoming}"))
            if item.variants[0] not in existing.variants:
                existing.variants.extend(item.variants)
            existing.sources.extend(item.sources)
        else:
            items[key] = item
    items = list(items.values())
    complete = bool(items) and not unknown_numeric and len(issues) <= max(2, len(items) // 5)
    return items, issues, complete


def read_csv(data, currency):
    items, issues, _ = table_items(csv_rows(data), currency)
    if not items and not issues:
        raise ValueError("CSV needs a unique name column. Use the sample CSV for supported columns.")
    return items, issues


def parse_line(raw, locator, currency):
    line = normalize(raw)
    dollar = DOLLAR_PRICE.match(line)
    if dollar and line.count("$") == 1 and not re.fullmatch(NUMBER, line[dollar.end():].strip()):
        name = re.split(r"\s{2,}", dollar["name"])[-1].strip()
        if name and name[0].isalpha() and not re.search(PORTION, name, flags=re.I):
            return Item(
                name=name,
                variants=[Variant(
                    price_amount=number(dollar["amount"]),
                    price_type="fixed",
                    currency=currency if currency in DOLLAR_CURRENCIES else "USD",
                )],
                sources=[Source(locator=locator, raw_text=raw)],
            )
    # Require a visible separator or currency for an unlabelled trailing price.
    split = re.split(r"\s{2,}|\s+[-–—:]\s+|\s+(?=৳|BDT\s|from\s|[0-9]+\s*(?:pcs?\b|pieces?\b|পিস|g\b|grams?\b|গ্রাম|ml\b|মিলি))", line, maxsplit=1, flags=re.I)
    if len(split) != 2:
        split = re.split(rf"\s+(?={NUMBER}\s*(?:৳|BDT|টাকা)$)", line, maxsplit=1, flags=re.I)
    if len(split) != 2:
        return None
    name, price_text = split
    segments = SEGMENTS.split(price_text)
    variants = []
    for segment in segments:
        match = PRICE.fullmatch(segment)
        if not match or (len(segments) > 1 and not match["portion"]):
            return None
        measure = {}
        if match["portion"]:
            unit = match["unit"].casefold()
            field = "volume_ml" if unit in ("ml", "মিলি") else "weight_g" if unit in ("g", "gram", "grams", "গ্রাম") else "pieces"
            measure[field] = int(match["quantity"])
        variants.append(Variant(
            label=match["portion"], price_amount=number(match["amount"]),
            price_type="from" if match["from"] else "fixed",
            currency="BDT" if match["prefix"] or match["suffix"] else currency,
            **measure,
        ))
    return Item(name=name, variants=variants, sources=[Source(locator=locator, raw_text=raw)])


def parse_decimal_row(raw, locator, currency):
    """Recover item/price pairs from OCR that merged adjacent columns."""
    line = re.sub(r"\s+(?:[0-9]+%|[~≈]\s*[0-9]+)$", "", normalize(raw))
    if re.search(r"[$৳/]|\b(?:USD|BDT|EUR|GBP|from)\b", line, re.I):
        return [], False
    tokens = list(re.finditer(rf"(?<!\S){NUMBER}(?!\S)", line))
    if not tokens or tokens[-1].end() != len(line):
        return [], False
    if not any("." in token[0] for token in tokens):
        return [], False

    items = []
    start = 0
    for token in tokens:
        name = line[start:token.start()].strip(" \t=–—:‘’'")
        if not re.fullmatch(r"[^\W\d_](?:[^\W\d_]|[ &’'(),.-])*", name):
            return [], False
        amount = number(token[0]) if "." in token[0] else None
        items.append(Item(
            name=name,
            variants=[Variant(
                currency=currency, price_amount=amount,
                price_type="fixed" if amount is not None else "unknown",
            )],
            sources=[Source(locator=locator, raw_text=raw)],
        ))
        start = token.end()
    return items, any(item.variants[0].price_amount is None for item in items)


def ocr(image):
    image = ImageOps.exif_transpose(image)
    image.thumbnail((3200, 3200))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", os.getenv("OCR_LANG", "eng"),
             "--psm", "6", "-c", "preserve_interword_spaces=1"],
            input=buffer.getvalue(), capture_output=True, check=True, timeout=25,
        )
    except FileNotFoundError as error:
        raise ValueError("Install Tesseract to read scans and images.") from error
    except subprocess.TimeoutExpired as error:
        raise ValueError("OCR timed out. Try a smaller image or fewer pages.") from error
    except subprocess.CalledProcessError as error:
        raise ValueError("OCR failed. Check the installed Tesseract language packs and OCR_LANG.") from error
    return result.stdout.decode("utf-8")


def pdf_image(data, index):
    with PDFIUM_LOCK, pdfium.PdfDocument(data) as document:
        page = document[index]
        scale = min(3, 3200 / max(page.get_size()))
        return page.render(scale=scale).to_pil().copy()


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
SPREADSHEET_SUFFIXES = {".xlsx", ".xlsm", ".xls"}
TEXT_SUFFIXES = {".txt", ".md"}
SUPPORTED = sorted({".csv", ".tsv", ".pdf", ".docx", *IMAGE_SUFFIXES, *SPREADSHEET_SUFFIXES, *TEXT_SUFFIXES})
MAX_PDF_PAGES = 15
WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_text(data):
    """Text of a Word document, with table cells separated by ' | '."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    lines = []

    def paragraph(element):
        return "".join(node.text or "" for node in element.iter(WORD + "t"))

    for block in root.find(WORD + "body"):
        if block.tag == WORD + "p":
            lines.append(paragraph(block))
        elif block.tag == WORD + "tbl":
            for row in block.iter(WORD + "tr"):
                cells = [" ".join(paragraph(p) for p in cell.iter(WORD + "p")).strip() for cell in row.iter(WORD + "tc")]
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def open_image(data):
    image = Image.open(io.BytesIO(data))
    if image.width * image.height > 60_000_000:
        raise ValueError("Image exceeds 60 megapixels.")
    image.seek(0)
    return image


def read_menu(data, filename, currency):
    """Extract menu items from one file. Returns (items, review_issues, info)."""
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED:
        raise ValueError("Upload a menu as a photo, PDF, Excel, CSV, Word or text file.")

    if suffix in (".csv", ".tsv", *SPREADSHEET_SUFFIXES):
        sheets = excel_sheets(data, suffix) if suffix in SPREADSHEET_SUFFIXES else [("", csv_rows(data))]
        origin = lambda sheet: f"Sheet {sheet!r}" if sheet else suffix.lstrip(".").upper()
        items, issues = [], []
        for sheet, rows in sheets:
            sheet_items, sheet_issues, _ = table_items(rows, currency, origin(sheet))
            items += sheet_items
            issues += sheet_issues
        if items or issues:
            return items, issues, {"method": "table"}
        raise ValueError("No item name column was found. Add a header such as name, section, price.")

    if suffix == ".pdf":
        pdf = PdfReader(io.BytesIO(data))
        if len(pdf.pages) > MAX_PDF_PAGES:
            raise ValueError(f"Upload up to {MAX_PDF_PAGES} PDF pages at a time.")
        pages = (
            (f"PDF page {index + 1}", page.extract_text(extraction_mode="layout").strip()
             or ocr(pdf_image(data, index)))
            for index, page in enumerate(pdf.pages)
        )
    elif suffix in IMAGE_SUFFIXES:
        with open_image(data) as image:
            pages = [(filename, ocr(image))]
    else:
        pages = [(filename, docx_text(data) if suffix == ".docx" else decode_text(data))]
    items, issues = parse_pages(pages, currency)
    return items, issues, {"method": "ocr" if suffix in IMAGE_SUFFIXES else "text"}


def parse_pages(pages, currency):
    items, issues = [], []
    for page, content in pages:
        if not content.strip():
            issues.append(Source(locator=page, raw_text="No text extracted."))
        section = None
        warned_dollar_currency = False
        for index, raw in enumerate(content.splitlines(), 1):
            if not raw.strip():
                continue
            heading = next(
                (part for part in re.split(r"\s{2,}", raw.strip()) if SECTIONS.fullmatch(part)),
                None,
            )
            if heading and not re.search(r"[$৳]", raw):
                section = heading.title()
                continue
            locator = f"{page}, extracted line {index}"
            try:
                item = parse_line(raw, locator, currency)
                extracted, needs_price_check = ([item], False) if item else parse_decimal_row(raw, locator, currency)
            except ValueError:
                extracted, needs_price_check = [], False
            if not extracted:
                issues.append(Source(locator=locator, raw_text=raw))
                continue
            if needs_price_check:
                issues.append(Source(locator=locator, raw_text=f"Confirm the blank price against the menu: {raw}"))
            if "$" in raw and currency not in DOLLAR_CURRENCIES and not warned_dollar_currency:
                issues.append(Source(locator=locator, raw_text="Dollar prices were entered as USD. Check the currency before publishing."))
                warned_dollar_currency = True
            for item in extracted:
                item.section = section
            items.extend(extracted)
    return items, issues
