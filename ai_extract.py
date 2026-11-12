"""Menu extraction with Claude's vision and document understanding.

Used for photos, designed or scanned menus, PDFs and spreadsheets whose layout
the deterministic parsers cannot read. Enabled when Anthropic credentials are
configured (ANTHROPIC_API_KEY) and MENU_AI is not "off".
"""
import base64
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation

from PIL import Image, ImageOps

from schema import Item, Source, Variant

MODEL = os.getenv("MENU_AI_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("MENU_AI_EFFORT", "high")
MAX_IMAGE_EDGE = 3000
MAX_IMAGE_BYTES = 4_500_000  # API limit is 5 MB per base64 image
PARALLEL_REQUESTS = int(os.getenv("MENU_AI_PARALLEL", "4"))

NULLABLE_STRING = {"anyOf": [{"type": "string"}, {"type": "null"}]}
NULLABLE_INT = {"anyOf": [{"type": "integer"}, {"type": "null"}]}
VARIANT_SCHEMA = {
    "type": "object",
    "properties": {
        "label": NULLABLE_STRING,
        "price": NULLABLE_STRING,
        "price_type": {"type": "string", "enum": ["fixed", "from", "market", "unknown"]},
        "currency": NULLABLE_STRING,
        "pieces": NULLABLE_INT,
        "weight_g": NULLABLE_INT,
        "volume_ml": NULLABLE_INT,
        "serves_min": NULLABLE_INT,
        "serves_max": NULLABLE_INT,
    },
    "required": ["label", "price", "price_type", "currency", "pieces", "weight_g",
                 "volume_ml", "serves_min", "serves_max"],
    "additionalProperties": False,
}
ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "section": NULLABLE_STRING,
        "name": {"type": "string"},
        "name_en": NULLABLE_STRING,
        "description": NULLABLE_STRING,
        "description_en": NULLABLE_STRING,
        "item_type": NULLABLE_STRING,
        "dietary_tags": {"type": "array", "items": {"type": "string"}},
        "allergen_tags": {"type": "array", "items": {"type": "string"}},
        "spice_level": NULLABLE_INT,
        "variants": {"type": "array", "items": VARIANT_SCHEMA},
        "source_text": {"type": "string"},
    },
    "required": ["section", "name", "name_en", "description", "description_en", "item_type",
                 "dietary_tags", "allergen_tags", "spice_level", "variants", "source_text"],
    "additionalProperties": False,
}
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "restaurant_name": NULLABLE_STRING,
        "menu_language": NULLABLE_STRING,
        "currency": NULLABLE_STRING,
        "items": {"type": "array", "items": ITEM_SCHEMA},
        "review_notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["restaurant_name", "menu_language", "currency", "items", "review_notes"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You extract restaurant menus into structured data for a spreadsheet import.

The input is one part of a menu: a photo, a scanned or designed page, a PDF page, or rows from a spreadsheet. Menus can be in any language and script, with any layout: multiple columns, price columns with size headers, decorative fonts, icons, rotated photos, or bilingual text.

Extract every orderable item, in reading order. Rules:
- name: the item name exactly as printed, in its original language and script. Fix only obvious OCR-style breaks, never translate it here. If the menu prints the name in two languages, put the primary (larger or first) one here and the other in name_en if it is English.
- name_en / description_en: an English translation when the original is not English; null when the original is already English.
- section: the heading the item appears under, as printed (e.g. "Starters", "Boissons", "ডেজার্ট"). Null if the item has no visible heading on this part of the menu.
- description: the printed description or ingredient list, verbatim. Null if none.
- variants: one entry per price. When a menu has price columns (Small / Medium / Large, Half / Full, Glass / Bottle, 6 pcs / 12 pcs, Regular / Spicy), create one variant per column and use the column header as the label. A single price gets one variant with label null unless a portion is printed.
- price: digits only as a plain decimal string using "." as the decimal separator and no thousands separators or currency symbols ("1,250" -> "1250", "12,50 €" -> "12.50", "৳১৮০" -> "180", "¥1,200" -> "1200"). Convert non-Latin digits to 0-9. Use null when no price is shown or it is illegible.
- price_type: "fixed" for a normal price, "from" for "from/starting at/ab/à partir de", "market" for market price / MP / seasonal price, "unknown" when no price is shown.
- currency: ISO 4217 code inferred from symbols, words, or the country/language context (৳/Tk/টাকা -> BDT, € -> EUR, £ -> GBP, ₹/Rs -> INR, ¥ on a Japanese menu -> JPY, ¥/元 on a Chinese menu -> CNY, ₩ -> KRW, ฿ -> THB, $ in the US -> USD). Null when you cannot tell.
- pieces, weight_g, volume_ml, serves_min, serves_max: fill only from printed quantities (convert kg to g, cl/l/oz to ml). Otherwise null.
- item_type: a short lowercase English kind when clear, such as "dish", "drink", "dessert", "side", "add-on", "combo", "set menu". Put extras like "add cheese +1.50" in their own item with item_type "add-on".
- dietary_tags / allergen_tags: only from printed words, icons, or a legend on the menu (e.g. "vegetarian", "vegan", "halal", "gluten-free"; "nuts", "dairy", "shellfish"). Use lowercase English. Empty when none.
- spice_level: 0-5 only when chili icons or a printed spice scale show it; otherwise null.
- source_text: the printed text the item came from, as a short excerpt.

Do not invent items, prices, or translations of things that are not on the menu. Skip addresses, phone numbers, opening hours, slogans, taxes and service-charge notices, and decorative text, but mention tax or service-charge notices in review_notes.

restaurant_name: the restaurant's name if printed, else null. menu_language: the main language as an English name. currency: the menu's main currency code, or null.
review_notes: short notes for a human reviewer about anything uncertain: illegible or cut-off prices, items you were unsure belonged to a section, prices that might apply to a group of items. Empty when everything is clear."""


class AIUnavailable(Exception):
    pass


def enabled():
    if os.getenv("MENU_AI", "auto").lower() in ("0", "off", "false", "no"):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


_client = None


def client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic(max_retries=3, timeout=600)
    return _client


def image_block(image):
    """Encode a PIL image within the API's size limits."""
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "L"):
        background = Image.new("RGB", image.size, "white")
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
    quality = 90
    while True:
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
        if buffer.tell() <= MAX_IMAGE_BYTES * 3 // 4 or quality <= 50:
            break
        quality -= 10
        if quality <= 60:
            image.thumbnail((image.width * 4 // 5, image.height * 4 // 5))
    data = base64.standard_b64encode(buffer.getvalue()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}}


def pdf_block(pdf_bytes):
    data = base64.standard_b64encode(pdf_bytes).decode()
    return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}


def text_block(text):
    return {"type": "text", "text": text}


def call_model(content, hint):
    """Send one menu part to Claude and return the parsed JSON result."""
    import anthropic

    instruction = "Extract the menu items from this " + hint + ". Follow the rules in the system prompt."
    request = dict(
        model=MODEL,
        max_tokens=64000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": [*content, text_block(instruction)]}],
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    )
    if MODEL.startswith(("claude-opus-5", "claude-fable-5", "claude-sonnet-5-5")):
        request.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    try:
        with client().beta.messages.stream(**request) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError as error:
        raise AIUnavailable("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.") from error
    except anthropic.RateLimitError as error:
        raise ValueError("The AI service is rate limited. Try again in a minute.") from error
    except anthropic.APIStatusError as error:
        raise ValueError(f"AI extraction failed ({error.status_code}): {error.message}") from error
    except anthropic.APIConnectionError as error:
        raise AIUnavailable("Could not reach the Anthropic API.") from error

    if message.stop_reason == "refusal":
        raise ValueError("The AI model declined to read this file.")
    text = "".join(block.text for block in message.content if block.type == "text")
    try:
        result = json.loads(text)
    except json.JSONDecodeError as error:
        if message.stop_reason == "max_tokens":
            raise ValueError("The menu part was too long to extract at once. Split the file into smaller parts.") from error
        raise ValueError("The AI response could not be read. Try again.") from error
    return result


def clean_text(value, limit=None):
    if not isinstance(value, str):
        return None
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return None
    return value[:limit] if limit else value


def clean_int(value, low=1, high=None):
    if isinstance(value, bool) or not isinstance(value, int) or value < low:
        return None
    return value if high is None or value <= high else None


def clean_currency(value, fallback):
    value = (value or "").strip().upper()
    return value if re.fullmatch(r"[A-Z]{3}", value) else fallback


def clean_price(value):
    if value is None:
        return None
    text = str(value).strip().replace(" ", "")
    text = re.sub(r"[^\d.,]", "", text)
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", text):
        text = text.replace(",", "")
    elif re.fullmatch(r"\d+,\d{1,2}", text):
        text = text.replace(",", ".")
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None
    if amount < 0 or amount >= Decimal("1e10"):
        return None
    return amount.quantize(Decimal("0.01")).normalize() if amount != amount.to_integral() else amount.quantize(Decimal(1))


def to_items(result, locator, default_currency):
    """Convert the model's JSON into validated menu items and review notes."""
    currency = clean_currency(result.get("currency"), default_currency)
    items, issues = [], []
    for note in result.get("review_notes") or []:
        if clean_text(note):
            issues.append(Source(locator=locator, raw_text=clean_text(note)))
    for raw in result.get("items") or []:
        name = clean_text(raw.get("name"), 200)
        if not name:
            continue
        variants = []
        for entry in raw.get("variants") or [{}]:
            amount = clean_price(entry.get("price"))
            price_type = entry.get("price_type") or "unknown"
            if amount is None and price_type in ("fixed", "from"):
                if entry.get("price"):
                    issues.append(Source(locator=locator, raw_text=f"Check the price of {name}: {entry.get('price')}"))
                price_type = "unknown"
            if amount is not None and price_type in ("market", "unknown"):
                price_type = "fixed"
            serves_min, serves_max = clean_int(entry.get("serves_min")), clean_int(entry.get("serves_max"))
            if serves_min and serves_max and serves_min > serves_max:
                serves_min, serves_max = serves_max, serves_min
            variants.append(Variant(
                label=clean_text(entry.get("label"), 100),
                price_amount=amount,
                price_type=price_type,
                currency=clean_currency(entry.get("currency"), currency),
                pieces=clean_int(entry.get("pieces")),
                weight_g=clean_int(entry.get("weight_g")),
                volume_ml=clean_int(entry.get("volume_ml")),
                serves_min=serves_min,
                serves_max=serves_max,
            ))
        tags = lambda key: [t for t in (clean_text(tag, 50) for tag in raw.get(key) or []) if t] or None
        items.append(Item(
            name=name,
            name_en=clean_text(raw.get("name_en"), 200),
            section=clean_text(raw.get("section"), 200),
            description=clean_text(raw.get("description")),
            description_en=clean_text(raw.get("description_en")),
            item_type=clean_text(raw.get("item_type"), 50),
            dietary_tags=tags("dietary_tags"),
            allergen_tags=tags("allergen_tags"),
            spice_level=clean_int(raw.get("spice_level"), low=0, high=5),
            variants=variants,
            sources=[Source(locator=locator, raw_text=clean_text(raw.get("source_text")) or name)],
        ))
    return items, issues, clean_text(result.get("restaurant_name"), 200)


def extract_parts(parts, default_currency):
    """Extract several menu parts concurrently.

    parts: list of (locator, content_blocks, hint). Sections carry over from
    one part to the next when a page continues the previous page's section.
    Returns (items, issues, restaurant_name).
    """
    def run(part):
        locator, content, hint = part
        try:
            return to_items(call_model(content, hint), locator, default_currency), None
        except AIUnavailable:
            raise
        except ValueError as error:
            return None, Source(locator=locator, raw_text=str(error))

    with ThreadPoolExecutor(max_workers=max(1, min(PARALLEL_REQUESTS, len(parts)))) as pool:
        results = list(pool.map(run, parts))

    items, issues, restaurant = [], [], None
    section = None
    for extracted, error in results:
        if error:
            issues.append(error)
            continue
        part_items, part_issues, name = extracted
        restaurant = restaurant or name
        # Items at the top of a page with no heading continue the previous page's section.
        for item in part_items:
            if item.section:
                break
            item.section = section
        section = next((item.section for item in reversed(part_items) if item.section), section)
        items.extend(part_items)
        issues.extend(part_issues)
    return items, issues, restaurant
