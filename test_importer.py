import unittest
from pathlib import Path

from importer import parse_line, read_csv


class ImportTests(unittest.TestCase):
    def test_bangla_digits_and_portions(self):
        item = parse_line("Chicken Momo — ৬ পিস ৳১৮০ / ১২ পিস ৳৩২০", "page 1", "BDT")
        self.assertEqual([variant.pieces for variant in item.variants], [6, 12])
        self.assertEqual([variant.price_amount for variant in item.variants], [180, 320])
        self.assertIsNone(item.spice_level)

    def test_ambiguous_prices_stay_unmatched(self):
        self.assertIsNone(parse_line("Pizza   220   350", "page 1", "BDT"))

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
