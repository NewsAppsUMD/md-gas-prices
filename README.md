# Maryland fuel prices

Daily Maryland state contract fuel prices ("AGGREGATED Fuel Price Table" PDFs), parsed into JSON and shown on a small static website.

Source: [Maryland Department of General Services, Daily Fuel Prices](https://dgs.maryland.gov/pages/fuelprices.aspx). DGS keeps only the last 90 days online.

## Update the data

Drop new `MM_DD_YYYY.pdf` files in `pdfs/`, then run:

```bash
python3 parse_prices.py
```

Only PDFs without a matching `data/json/YYYY-MM-DD.json` are parsed. Use `--force` to re-parse everything. This needs `pdftotext` (from poppler: `brew install poppler`).

Outputs in `data/`:

- `json/YYYY-MM-DD.json`: one file per day, as published
- `prices.json`: one record per date, section, delivery type, product and region
- `latest.json`: latest prices with 1-day and 1-week changes
- `products.json`: product list in the order the PDFs print them
- `regions.json`: county → region lookup
- `csv/daily.csv`: every price as published, one row per date, fuel and region
- `csv/weekly.csv`, `csv/monthly.csv`: average price per week (Monday to Sunday) or month, fuel and region. Each average uses only the published days that have a price, and the `days` column gives that count. `avg_price` is blank when the fuel wasn't offered.

A price of `null` (blank in the CSVs) means the fuel isn't offered in that region (`0.0000` in the PDF).

## View the site

The page loads `../data/*.json`, so it has to be served over HTTP. From this folder:

```bash
python3 -m http.server
```

Then open <http://localhost:8000/site/>. On GitHub Pages, publish the repository root (with `data/` committed) and the site will be at `/site/`.

## License

The code is released under the [MIT License](LICENSE). The fuel price data comes from the Maryland Department of General Services and is not covered by this license.
