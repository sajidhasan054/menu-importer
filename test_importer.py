from decimal import Decimal
import csv
import io
import unittest
from pathlib import Path
from unittest import mock
import zipfile

from openpyxl import Workbook
from PIL import Image

import ai_extract
from export import menu_csv
from importer import docx_text, parse_decimal_row, parse_line, read_csv, read_menu
from schema import Menu


class ImportTests(unittest.TestCase):
    def test_bangla_digits_and_portions(self):
        item = parse_line("Chicken Momo — ৬ পিস ৳১৮০ / ১২ পিস ৳৩২০", "page 1", "BDT")
        self.assertEqual([variant.pieces for variant in item.variants], [6, 12])
        self.assertEqual([variant.price_amount for variant in item.variants], [180, 320])
        self.assertIsNone(item.spice_level)

    def test_ambiguous_prices_stay_unmatched(self):
        self.assertIsNone(parse_line("Pizza   220   350", "page 1", "BDT"))

    def test_dollar_price_uses_dollar_currency_and_ignores_ocr_noise(self):
        line = "Vi. oS        :     Fruit Salad          $13        3    SY"
        item = parse_line(line, "photo", "BDT")
        self.assertEqual((item.name, item.variants[0].price_amount), ("Fruit Salad", 13))
        self.assertEqual(item.variants[0].currency, "USD")
        self.assertEqual(parse_line(line, "photo", "CAD").variants[0].currency, "CAD")
        self.assertIsNone(parse_line("Pizza   $12   $15", "photo", "USD"))
        self.assertIsNone(parse_line("Pizza   $12   15", "photo", "USD"))

    def test_merged_menu_rows_recover_items_without_guessing_missing_decimals(self):
        cases = [
            ("GREEK SALAD 5.00 LENGUADO 12.00", [("GREEK SALAD", 5), ("LENGUADO", 12)], False),
            ("TORTILLA ESPANOLA 480 BACALAO FRITO 7.00", [("TORTILLA ESPANOLA", None), ("BACALAO FRITO", 7)], True),
            ("OLIVAS RELLENAS 6.00 PAELLA MIXTA 8.60", [("OLIVAS RELLENAS", 6), ("PAELLA MIXTA", "8.60")], False),
            ("VERDURAS CON OLIVADA = 8.50 LOMO DE SALMON 1160", [("VERDURAS CON OLIVADA", "8.50"), ("LOMO DE SALMON", None)], True),
            ("LASAGNE 3.00 POLLO AL HORNO 8.00", [("LASAGNE", 3), ("POLLO AL HORNO", 8)], False),
            ("FRIES 2.00 4%", [("FRIES", 2)], False),
            ("‘ONION RINGS 4.00 ~ 3", [("ONION RINGS", 4)], False),
        ]
        for line, expected, needs_review in cases:
            with self.subTest(line=line):
                items, review = parse_decimal_row(line, "photo", "USD")
                self.assertEqual(review, needs_review)
                self.assertEqual(
                    [(item.name, item.variants[0].price_amount) for item in items],
                    [(name, None if price is None else Decimal(price)) for name, price in expected],
                )
        self.assertEqual(parse_decimal_row("Pizza 5.00 6.00", "photo", "USD"), ([], False))

    def test_csv_groups_variants(self):
        items, issues = read_csv(Path("examples/menu.csv").read_bytes(), "BDT")
        self.assertFalse(issues)
        self.assertEqual(len(items), 3)
        self.assertEqual(len(items[0].variants), 2)

    def test_invalid_csv_price_is_preserved_for_review(self):
        items, issues = read_csv(b"name,price\nTea,12abc\nCoffee,70\n", "BDT")
        self.assertEqual([item.name for item in items], ["Coffee"])
        self.assertIn("12abc", issues[0].raw_text)


def workbook(rows, title="Menu"):
    book = Workbook()
    sheet = book.active
    sheet.title = title
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def ai_result(items, **extra):
    return {"restaurant_name": None, "menu_language": "English", "currency": None,
            "items": items, "review_notes": [], **extra}


def ai_item(name, price, section=None, **extra):
    variant = {"label": None, "price": price, "price_type": "fixed" if price else "unknown",
               "currency": None, "pieces": None, "weight_g": None, "volume_ml": None,
               "serves_min": None, "serves_max": None}
    item = {"section": section, "name": name, "name_en": None, "description": None,
            "description_en": None, "item_type": None, "dietary_tags": [], "allergen_tags": [],
            "spice_level": None, "variants": [variant], "source_text": name}
    item.update(extra)
    return item


class TableTests(unittest.TestCase):
    def test_excel_header_below_title_rows_and_multilingual_aliases(self):
        data = workbook([
            ["Café Lumière — Carte"], [],
            ["Catégorie", "Nom", "Prix", "Description"],
            ["Entrées", "Soupe à l'oignon", 8.5, "Gratinée"],
            ["Entrées", "Escargots", 12, None],
        ])
        items, issues, info = read_menu(data, "carte.xlsx", "EUR", use_ai=False)
        self.assertEqual(info["method"], "table")
        self.assertFalse(issues)
        self.assertEqual([(i.section, i.name, i.variants[0].price_amount) for i in items],
                         [("Entrées", "Soupe à l'oignon", Decimal("8.5")), ("Entrées", "Escargots", 12)])

    def test_price_columns_are_sent_to_ai(self):
        data = workbook([["Item", "Small", "Large"], ["Latte", 3.5, 4.5], ["Mocha", 4, 5]])
        result = ai_result([{**ai_item("Latte", "3.50"), "variants": [
            {**ai_item("x", "3.50")["variants"][0], "label": "Small"},
            {**ai_item("x", "4.50")["variants"][0], "label": "Large"},
        ]}])
        with mock.patch.object(ai_extract, "call_model", return_value=result) as call:
            items, _, info = read_menu(data, "drinks.xlsx", "USD", use_ai=True)
        self.assertEqual(info["method"], "ai")
        self.assertIn("Latte,3.5,4.5", call.call_args[0][0][0]["text"])
        self.assertEqual([v.label for v in items[0].variants], ["Small", "Large"])

    def test_messy_table_without_ai_keeps_what_it_can(self):
        data = workbook([["Item", "Small", "Large"], ["Latte", 3.5, 4.5]])
        items, _, info = read_menu(data, "drinks.xlsx", "USD", use_ai=False)
        self.assertEqual((info["method"], items[0].name), ("table", "Latte"))

    def test_semicolon_csv_in_windows_encoding(self):
        items, issues = read_csv("Plat;Preis\nGulasch;12\n".encode("cp1252"), "EUR")
        self.assertEqual((items[0].name, items[0].variants[0].price_amount), ("Gulasch", 12))

    def test_docx_tables_become_text(self):
        body = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                '<w:p><w:r><w:t>Desserts</w:t></w:r></w:p>'
                '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Flan</w:t></w:r></w:p></w:tc>'
                '<w:tc><w:p><w:r><w:t>5.00</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", body)
        self.assertEqual(docx_text(buffer.getvalue()), "Desserts\nFlan | 5.00")


class AITests(unittest.TestCase):
    def test_model_output_is_cleaned(self):
        result = ai_result([
            ai_item("Pâtes", "12,50", "Plats", name_en="Pasta", spice_level=9, dietary_tags=["vegetarian"]),
            ai_item("Steak", "1,250", "Plats"),
            ai_item("Fish", "MP", "Plats", variants=[{**ai_item("x", None)["variants"][0], "price_type": "market"}]),
            ai_item("Bad", "abc"),
        ], currency="EUR", review_notes=["Service compris"])
        items, issues, _ = ai_extract.to_items(result, "page 1", "BDT")
        self.assertEqual([i.variants[0].price_amount for i in items], [Decimal("12.5"), 1250, None, None])
        self.assertEqual([i.variants[0].price_type for i in items], ["fixed", "fixed", "market", "unknown"])
        self.assertEqual({i.variants[0].currency for i in items}, {"EUR"})
        self.assertEqual((items[0].name_en, items[0].spice_level, items[0].dietary_tags), ("Pasta", None, ["vegetarian"]))
        self.assertEqual([i.raw_text for i in issues], ["Service compris", "Check the price of Bad: abc"])

    def test_sections_continue_across_pages(self):
        pages = {"p1": ai_result([ai_item("Soup", "5", "Starters")]),
                 "p2": ai_result([ai_item("Salad", "6"), ai_item("Cake", "4", "Desserts")])}
        with mock.patch.object(ai_extract, "call_model", side_effect=lambda content, hint: pages[content[0]]):
            items, _, _ = ai_extract.extract_parts([("1", ["p1"], ""), ("2", ["p2"], "")], "USD")
        self.assertEqual([i.section for i in items], ["Starters", "Starters", "Desserts"])

    def test_image_goes_to_ai_and_failures_become_review_issues(self):
        buffer = io.BytesIO()
        Image.new("RGBA", (5000, 300), "white").save(buffer, format="PNG")
        with mock.patch.object(ai_extract, "call_model", side_effect=ValueError("declined")) as call:
            items, issues, info = read_menu(buffer.getvalue(), "menu.png", "USD", use_ai=True)
        block = call.call_args[0][0][0]
        self.assertEqual((block["type"], block["source"]["media_type"]), ("image", "image/jpeg"))
        self.assertEqual((items, info["method"], issues[0].raw_text), ([], "ai", "declined"))

    def test_unavailable_ai_falls_back_to_basic_reader(self):
        with mock.patch.object(ai_extract, "call_model", side_effect=ai_extract.AIUnavailable("No key.")):
            items, issues, info = read_menu(b"Tea - 40\n", "menu.txt", "BDT", use_ai=True)
        self.assertEqual((info["method"], items[0].name), ("text", "Tea"))
        self.assertIn("No key.", issues[0].raw_text)


class ExportTests(unittest.TestCase):
    def test_csv_drops_empty_columns(self):
        items, _ = read_csv(Path("examples/menu.csv").read_bytes(), "BDT")
        menu = Menu(restaurant_name="R", branch_name="B", items=items)
        rows = list(csv.reader(io.StringIO(menu_csv(menu).decode("utf-8-sig"))))
        self.assertEqual(rows[0][:5], ["restaurant_name", "branch_name", "section", "name", "description"])
        self.assertNotIn("name_en", rows[0])
        self.assertEqual(len(rows), 5)


if __name__ == "__main__":
    unittest.main()
