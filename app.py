from contextlib import closing
import csv
import io
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pypdf.errors import PyPdfError
from pypdfium2 import PdfiumError

from importer import read_menu
from schema import Currency, Item, Menu, Source, Variant

ROOT = Path(__file__).resolve().parent
app = FastAPI(title="Menu Importer", version="1.0")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def database():
    db = sqlite3.connect(os.getenv("MENU_DB", ROOT / "menus.sqlite3"))
    db.execute(
        "CREATE TABLE IF NOT EXISTS menus "
        "(id TEXT PRIMARY KEY, published_at TEXT DEFAULT CURRENT_TIMESTAMP, payload TEXT NOT NULL)"
    )
    return db


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/sample.csv", include_in_schema=False)
def sample():
    return FileResponse(ROOT / "examples" / "menu.csv", filename="sample-menu.csv", media_type="text/csv")


@app.get("/api/schema")
def schema():
    return Menu.model_json_schema()


@app.post("/api/import")
def import_menu(
    restaurant_name: str = Form(min_length=1, max_length=200),
    branch_name: str = Form(min_length=1, max_length=200),
    currency: Currency = Form("BDT"),
    files: list[UploadFile] = File(),
):
    if not 1 <= len(files) <= 5:
        raise HTTPException(422, "Select between one and five menu files.")
    items, issues = [], []
    for file in files:
        name = Path(file.filename or "untitled").name
        data = file.file.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            issues.append(Source(locator=name, raw_text="File exceeds 10 MiB."))
            continue
        try:
            extracted, unmatched = read_menu(data, name, currency)
        except (ValueError, OSError, PyPdfError, PdfiumError, Image.DecompressionBombError) as error:
            issues.append(Source(locator=name, raw_text=str(error)))
            continue
        for source in [*unmatched, *(source for item in extracted for source in item.sources)]:
            if not source.locator.startswith(name):
                source.locator = f"{name} · {source.locator}"
        items.extend(extracted)
        issues.extend(unmatched)
    try:
        draft = Menu(restaurant_name=restaurant_name, branch_name=branch_name, default_currency=currency, items=items)
    except ValueError as error:
        raise HTTPException(422, "Enter a restaurant name and a branch name.") from error
    return {"draft": draft, "review_issues": issues}


@app.post("/api/validate")
def validate(menu: Menu):
    return menu


def spreadsheet_cell(value):
    if isinstance(value, list):
        value = "|".join(value)
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


@app.post("/api/export/csv", response_class=Response)
def export_csv(menu: Menu):
    if not menu.items:
        raise HTTPException(422, "Add at least one menu item before exporting.")
    item_columns = [field for field in Item.model_fields if field not in {"variants", "sources"}]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["restaurant_name", "branch_name", *item_columns, *Variant.model_fields])
    for item in menu.items:
        item_values = [spreadsheet_cell(getattr(item, field)) for field in item_columns]
        for variant in item.variants:
            variant_values = variant.model_dump()
            if variant.price_amount is not None:
                variant_values["price_amount"] = format(variant.price_amount, "f")
            writer.writerow([
                spreadsheet_cell(menu.restaurant_name), spreadsheet_cell(menu.branch_name),
                *item_values, *(spreadsheet_cell(value) for value in variant_values.values()),
            ])
    return Response(
        output.getvalue().encode("utf-8-sig"), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="extracted-menu.csv"'},
    )


@app.post("/api/menus", status_code=201)
def publish(menu: Menu):
    if not menu.items:
        raise HTTPException(422, "Add at least one menu item before publishing.")
    menu_id = str(uuid4())
    with closing(database()) as db, db:
        db.execute("INSERT INTO menus(id, payload) VALUES (?, ?)", (menu_id, menu.model_dump_json()))
    return {"id": menu_id, "menu": menu}


@app.get("/api/menus/{menu_id}")
def published_menu(menu_id: str):
    with closing(database()) as db:
        row = db.execute("SELECT payload, published_at FROM menus WHERE id = ?", (menu_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Menu not found.")
    return {"id": menu_id, "published_at": row[1], "menu": Menu.model_validate_json(row[0])}
