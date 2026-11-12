import csv
import io
import os
from pathlib import Path
import re
import subprocess
from decimal import Decimal
from threading import Lock

import pypdfium2 as pdfium
from PIL import Image, ImageOps
from pypdf import PdfReader

from schema import Item, Source, Variant

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
    "item": "name", "item_name": "name", "dish": "name", "নাম": "name",
    "category": "section", "price": "price_amount", "মূল্য": "price_amount",
    "portion": "label", "cuisine": "cuisine_tags", "sweet_level": "sweetness_level",
}


def normalize(text):
    return text.translate(DIGITS).strip()


def number(text):
    value = re.sub(r"৳|BDT|টাকা", "", normalize(text), flags=re.I).strip()
    if not re.fullmatch(NUMBER, value):
        raise ValueError("Enter a price such as 180 or 1,250.50.")
    return Decimal(value.replace(",", ""))


def read_csv(data, currency):
    stream = io.StringIO(data.decode("utf-8-sig"), newline="")
    sample = stream.read(4096)
    stream.seek(0)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = "excel"
    reader = csv.reader(stream, dialect)
    headers = [re.sub(r"[ -]+", "_", header.strip().casefold()) for header in next(reader, [])]
    headers = [ALIASES.get(header, header) for header in headers]
    if "name" not in headers or len(set(headers)) != len(headers):
        raise ValueError("CSV needs a unique name column. Use the sample CSV for supported columns.")

    items = {}
    issues = []
    for values in reader:
        locator = f"CSV row ending at line {reader.line_num}"
        if not any(value.strip() for value in values):
            continue
        try:
            row = {key: value.strip() for key, value in zip(headers, values, strict=True) if value.strip()}
            item_fields = {key: value for key, value in row.items() if key in Item.model_fields}
            for key in ("cuisine_tags", "dietary_tags", "allergen_tags"):
                if key in item_fields:
                    item_fields[key] = [tag.strip() for tag in row[key].split("|") if tag.strip()]
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
            item_fields["sources"] = [Source(locator=locator, raw_text=str(values))]
            item = Item(**item_fields)
        except ValueError as error:
            issues.append(Source(locator=locator, raw_text=f"{values}\n{error}"))
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
    return list(items.values()), issues


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


def read_menu(data, filename, currency):
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        return read_csv(data, currency)

    if suffix == ".pdf":
        pdf = PdfReader(io.BytesIO(data))
        if len(pdf.pages) > 15:
            raise ValueError("Upload up to 15 PDF pages at a time.")
        pages = (
            (f"PDF page {index + 1}", page.extract_text(extraction_mode="layout").strip()
             or ocr(pdf_image(data, index)))
            for index, page in enumerate(pdf.pages)
        )
    elif suffix in (".png", ".jpg", ".jpeg", ".webp"):
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 25_000_000:
                raise ValueError("Image exceeds 25 megapixels.")
            pages = [(filename, ocr(image))]
    else:
        raise ValueError("Upload a CSV, PDF, PNG, JPEG, or WebP file.")

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
