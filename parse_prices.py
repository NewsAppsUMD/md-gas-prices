#!/usr/bin/env python3
"""Parse Maryland "AGGREGATED Fuel Price Table" PDFs into JSON.

Usage: python3 parse_prices.py [--force] [pdf_dir] [out_dir]
pdf_dir defaults to pdfs/ and out_dir to data/, both next to this script.
Only PDFs without an existing data/json/YYYY-MM-DD.json are parsed;
--force re-parses everything. Requires `pdftotext` (poppler) on PATH.
"""
import json
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

REGIONS = ["A", "B", "C", "D-1", "D-2", "E"]

# Static county -> region map from the "STATEWIDE REGIONS" footer.
REGION_COUNTIES = {
    "A": ["Allegany", "Garrett", "Washington"],
    "B": ["Frederick", "Montgomery", "Prince Georges"],
    "C": ["Anne Arundel", "Baltimore", "Baltimore City", "Carroll", "Harford", "Howard"],
    "D-1": ["Kent", "Queen Anne", "Talbot", "Caroline", "Cecil"],
    "D-2": ["Dorchester", "Wicomico", "Worcester", "Somerset"],
    "E": ["St. Mary's", "Calvert", "Charles"],
}

PRODUCT_CODES = {
    "Unleaded Reg. 87/E10 and Unleaded Conv 87": "unl87",
    "#2 Ultra Low Sulfur Heating Oil": "ulsho2",
    "ULS Diesel Clear": "ulsd_clear",
    "ULS Diesel Dyed": "ulsd_dyed",
    "ULSD B5": "ulsd_b5",
    "Soy Bio-Diesel/B5": "b5_soy",
    "E85": "e85",
}

EXPECTED_ROWS = 14
PRICE_LINE = re.compile(r"^\s*(\d+\.\d{4}\s+){5}\d+\.\d{4}\s*$")
HEADER_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")
FILENAME = re.compile(r"^(\d{2})_(\d{2})_(\d{4})\.pdf$")


class ParseError(Exception):
    pass


def pdf_text(path):
    return subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True, capture_output=True, text=True,
    ).stdout


def parse_header_date(line):
    m = HEADER_DATE.search(line)
    if not m:
        return None
    month, day, year = (int(g) for g in m.groups())
    if year < 100:
        year += 2000
    return date(year, month, day)


def parse_price(token):
    value = float(token)
    return None if value == 0 else value


def parse_text(text, source_file):
    lines = text.splitlines()
    header_date = parse_header_date(lines[0]) if lines else None
    if header_date is None:
        raise ParseError(f"{source_file}: could not find header date")

    sections = {}
    section = None
    delivery_type = product = None
    for raw in lines[1:]:
        line = raw.strip()
        if not line or line.startswith("Region "):
            continue
        if line == "STATEWIDE REGIONS":
            break
        if line == "BULK FUEL DELIVERY":
            section = "bulk"
            sections[section] = {"pricing_basis": None, "products": []}
        elif line == "CONSIGNED FUEL":
            section = "consigned"
            sections[section] = {"pricing_basis": None, "products": []}
        elif section is None:
            raise ParseError(f"{source_file}: unexpected line before section: {line!r}")
        elif line.startswith("ALL PRICING BASED"):
            sections[section]["pricing_basis"] = line
        elif PRICE_LINE.match(raw):
            if product is None:
                raise ParseError(f"{source_file}: price row without product: {line!r}")
            values = line.split()
            sections[section]["products"].append({
                "delivery_type": delivery_type,
                "product": product,
                "product_code": PRODUCT_CODES[product],
                "prices": {r: parse_price(v) for r, v in zip(REGIONS, values)},
            })
            delivery_type = product = None
        else:
            m = re.match(r"^(TANKWAGON|TRANSPORT) - (.+)$", line)
            if m:
                delivery_type, product = m.group(1).lower(), m.group(2)
            elif section == "consigned":
                delivery_type, product = "consigned", line
            else:
                raise ParseError(f"{source_file}: unrecognized line: {line!r}")
            if product not in PRODUCT_CODES:
                raise ParseError(f"{source_file}: unknown product: {product!r}")

    rows = sum(len(s["products"]) for s in sections.values())
    if rows != EXPECTED_ROWS:
        raise ParseError(f"{source_file}: expected {EXPECTED_ROWS} price rows, got {rows}")
    return header_date, sections


def parse_file(path):
    m = FILENAME.match(path.name)
    if not m:
        raise ParseError(f"{path.name}: filename is not MM_DD_YYYY.pdf")
    month, day, year = (int(g) for g in m.groups())
    file_date = date(year, month, day)
    header_date, sections = parse_text(pdf_text(path), path.name)
    record = {
        "date": file_date.isoformat(),
        "source_file": path.name,
        "header_date": header_date.isoformat(),
        "sections": sections,
    }
    if header_date != file_date:
        record["warnings"] = ["header_date_mismatch"]
    return record


def to_long(record):
    for section, data in record["sections"].items():
        for p in data["products"]:
            for region, price in p["prices"].items():
                yield {
                    "date": record["date"],
                    "section": section,
                    "delivery_type": p["delivery_type"],
                    "product_code": p["product_code"],
                    "product": p["product"],
                    "region": region,
                    "price": price,
                }


def series_key(section, p):
    return f"{section}/{p['delivery_type']}/{p['product_code']}"


def products(record):
    """Ordered product list, in the order the PDF prints them."""
    return [
        {"key": series_key(section, p), "section": section,
         "delivery_type": p["delivery_type"], "product_code": p["product_code"],
         "product": p["product"]}
        for section, data in record["sections"].items() for p in data["products"]
    ]


def latest(records):
    """Latest price per product and region with 1-day and 1-week changes.

    "Previous day" is the previous published date; "previous week" is the
    latest published date at least 7 days before the latest date.
    """
    def prices_by_key(record):
        return {series_key(s, p): p["prices"]
                for s, d in record["sections"].items() for p in d["products"]}

    def delta(now, then):
        return None if now is None or then is None else round(now - then, 4)

    last = records[-1]
    prev_day = records[-2] if len(records) > 1 else None
    week_cutoff = date.fromisoformat(last["date"]).toordinal() - 7
    prev_week = next((r for r in reversed(records)
                      if date.fromisoformat(r["date"]).toordinal() <= week_cutoff), None)
    now = prices_by_key(last)
    day = prices_by_key(prev_day) if prev_day else {}
    week = prices_by_key(prev_week) if prev_week else {}
    return {
        "date": last["date"],
        "prev_day_date": prev_day and prev_day["date"],
        "prev_week_date": prev_week and prev_week["date"],
        "prices": {
            key: {region: {
                "price": price,
                "day_change": delta(price, day.get(key, {}).get(region)),
                "week_change": delta(price, week.get(key, {}).get(region)),
            } for region, price in regions.items()}
            for key, regions in now.items()
        },
    }


def main():
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    root = Path(__file__).parent
    pdf_dir = Path(args[0]) if args else root / "pdfs"
    out_dir = Path(args[1]) if len(args) > 1 else root / "data"
    json_dir = out_dir / "json"
    json_dir.mkdir(parents=True, exist_ok=True)

    new, skipped, errors = [], 0, []
    for path in sorted(pdf_dir.glob("*.pdf")):
        m = FILENAME.match(path.name)
        if m and not force:
            month, day, year = m.groups()
            if (json_dir / f"{year}-{month}-{day}.json").exists():
                skipped += 1
                continue
        try:
            new.append(parse_file(path))
        except (ParseError, subprocess.CalledProcessError) as e:
            errors.append(str(e))

    for r in new:
        (json_dir / f"{r['date']}.json").write_text(json.dumps(r, indent=2) + "\n")

    # Rebuild combined output from every per-day file, old and new.
    records = [json.loads(p.read_text()) for p in sorted(json_dir.glob("*.json"))]
    long_rows = [row for r in records for row in to_long(r)]
    (out_dir / "prices.json").write_text(json.dumps(long_rows, indent=1) + "\n")
    (out_dir / "regions.json").write_text(json.dumps(
        {c: region for region, cs in REGION_COUNTIES.items() for c in cs}, indent=2) + "\n")
    if records:
        (out_dir / "products.json").write_text(json.dumps(products(records[-1]), indent=2) + "\n")
        (out_dir / "latest.json").write_text(json.dumps(latest(records), indent=2) + "\n")

    warned = [r for r in new if r.get("warnings")]
    print(f"Parsed {len(new)} new files, skipped {skipped} already parsed, {len(errors)} errors")
    print(f"Wrote {len(records)} days, {len(long_rows)} price records to {out_dir / 'prices.json'}")
    for r in warned:
        print(f"  warning: {r['source_file']} header date {r['header_date']} != {r['date']}")
    for e in errors:
        print(f"  error: {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
