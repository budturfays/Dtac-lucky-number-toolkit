"""Export the lucky-number CSV to a compact JSON for the web app.
Run:  python scripts/export_numbers_json.py  (from webapp/ or repo root)
Output: webapp/public/data/numbers.json  (used by the React app)
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CSV_PATHS = [
    os.path.join(ROOT, "..", "all_numbers.csv"),
    os.path.join(ROOT, "..", "..", "all_numbers.csv"),
    os.path.join(ROOT, "all_numbers.csv"),
]


def find_csv():
    for p in CSV_PATHS:
        if os.path.exists(p):
            return p
    # fall back to any numbers_*.csv
    candidates = []
    for base in (ROOT, os.path.dirname(ROOT)):
        for name in os.listdir(base):
            if name.startswith("numbers_") and name.endswith(".csv"):
                candidates.append(os.path.join(base, name))
    return candidates[0] if candidates else None


def star_sum(lt_str):
    """Sum the star ratings in a luckyTypes JSON like [{"name":"..","star":3},...]"""
    try:
        arr = json.loads(lt_str)
        return sum(t.get("star", 0) for t in arr) if arr else 0
    except Exception:
        return 0


def main():
    src = find_csv()
    if not src:
        sys.exit("No CSV found. Put all_numbers.csv next to the repo.")
    print(f"Reading {src}")
    rows = []
    with open(src, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append({
                "msisdn": r["msisdn"],
                "price_baht_month": int(r["price_baht_month"]) if (r.get("price_baht_month") or "").isdigit() else 0,
                "pools": r.get("pools") or r.get("pool") or "",
                "stars": star_sum(r.get("luckyTypes") or ""),
            })
    out_dir = os.path.join(ROOT, "public", "data")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "numbers.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    size_mb = os.path.getsize(out) / 1e6
    print(f"Wrote {len(rows)} numbers -> {out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
