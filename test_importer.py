from decimal import Decimal
import unittest
from pathlib import Path

from importer import parse_decimal_row, parse_line, read_csv


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


if __name__ == "__main__":
    unittest.main()
