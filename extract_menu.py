"""Command line: convert menu files into one CSV.

    python extract_menu.py menu.jpg page2.pdf -o menu.csv --currency EUR
"""
import argparse
from pathlib import Path
import sys

from export import menu_csv
from importer import read_menu
from schema import Menu


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extract a restaurant menu into a CSV file.")
    parser.add_argument("files", nargs="+", type=Path, help="Photos, PDFs, Excel, CSV, Word or text files")
    parser.add_argument("-o", "--output", type=Path, default=Path("extracted-menu.csv"))
    parser.add_argument("--currency", default="BDT", help="Fallback ISO currency when the menu shows none")
    parser.add_argument("--restaurant", default="")
    parser.add_argument("--branch", default="Main")
    parser.add_argument("--no-ai", action="store_true", help="Use only the offline parsers")
    parser.add_argument("--all-columns", action="store_true", help="Keep columns that are empty for every row")
    args = parser.parse_args(argv)

    items, restaurant = [], args.restaurant
    for path in args.files:
        try:
            extracted, issues, info = read_menu(path.read_bytes(), path.name, args.currency.upper(),
                                                use_ai=False if args.no_ai else None)
        except (ValueError, OSError) as error:
            print(f"{path.name}: {error}", file=sys.stderr)
            continue
        restaurant = restaurant or info.get("restaurant_name") or ""
        items.extend(extracted)
        print(f"{path.name}: {len(extracted)} items ({info['method']})", file=sys.stderr)
        for issue in issues:
            print(f"  check · {issue.locator} · {issue.raw_text}", file=sys.stderr)
    if not items:
        print("No menu items were extracted.", file=sys.stderr)
        return 1
    menu = Menu(restaurant_name=restaurant or "Restaurant", branch_name=args.branch,
                default_currency=args.currency.upper(), items=items)
    args.output.write_bytes(menu_csv(menu, include_empty=args.all_columns))
    print(f"Wrote {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
