"""Spreadsheet-friendly CSV export of a menu."""
import csv
import io

from schema import Item, Menu, Variant


def spreadsheet_cell(value):
    if isinstance(value, list):
        value = "|".join(value)
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


CSV_ITEM_COLUMNS = [
    "section", "name", "name_en", "description", "description_en", "item_type",
    "dietary_tags", "allergen_tags", "spice_level", "sweetness_level", "cuisine_tags",
    "name_bn", "description_bn",
]
CSV_VARIANT_COLUMNS = [
    "label", "price_amount", "currency", "price_type", "pieces", "weight_g", "volume_ml",
    "serves_min", "serves_max", "availability",
]
assert set(CSV_ITEM_COLUMNS) == Item.model_fields.keys() - {"variants", "sources"}
assert set(CSV_VARIANT_COLUMNS) == Variant.model_fields.keys()


def menu_csv(menu: Menu, include_empty=False):
    """One row per item portion, with columns that are empty for every row dropped."""
    rows = []
    for item in menu.items:
        for variant in item.variants:
            values = {"restaurant_name": menu.restaurant_name, "branch_name": menu.branch_name}
            values.update({field: getattr(item, field) for field in CSV_ITEM_COLUMNS})
            values.update({field: getattr(variant, field) for field in CSV_VARIANT_COLUMNS})
            if variant.price_amount is not None:
                values["price_amount"] = format(variant.price_amount, "f")
            rows.append(values)
    columns = ["restaurant_name", "branch_name", *CSV_ITEM_COLUMNS, *CSV_VARIANT_COLUMNS]
    always = {"section", "name", "price_amount", "currency"}
    if not include_empty:
        columns = [c for c in columns if c in always or any(row[c] not in (None, [], "") for row in rows)]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        writer.writerow([spreadsheet_cell(row[column]) for column in columns])
    return output.getvalue().encode("utf-8-sig")
