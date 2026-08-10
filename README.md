# Mobile Phone Lucky searching Number Toolkit (Thai)

Search, watch, and track Thai lucky numbers from True-dtac's online store
(`store.true.th`), right from your terminal.

## What it does

One tool (`lucky.py`) provides:

- **Find numbers** — repeats (tong/quad/rare structures), easy-to-remember patterns
  (54321, 1234, ABAB pairs), patterns (ends/contains/starts), digit templates
  (`0658XXXXXX`), must/must-not digits, best value (numerology stars per baht),
  random pick, and exact-number lookup
- **Watch & check availability (live)** — check specific numbers against
  True's API, scan for memorable numbers currently in stock, and a watch loop
  that beeps when it finds something interesting
- **Update dataset** — refresh the local pool from True's API (quick or full)
- **My numbers** — track your own numbers alongside the store pool
- **Stats & tips** — dataset overview and buying guidance

## Quick start

```bash
python lucky.py
```

That's it, everything is under one menu.

## Data

The tool reads these files (all optional; it auto-detects what's present):

| File | Purpose |
|---|---|
| `all_numbers.csv` | Master pool — `msisdn, grade, price_baht_month, sum, luckyTypes, pool(s)` |
| `numbers_*.csv` | Per-pool dumps (rahu, universal, khanthep, naga, ajchang, emperor) |
| `numbers_prices.csv` | Minimal number + price only |
| `my_numbers.csv` | Your own numbers |
| `watchlist.txt` | Numbers to keep checking |

The full dataset is a **snapshot** of True's live inventory (~93k numbers).
Numbers sell out fast, so always verify availability live (Watch → Check)
before buying.

## How it works

True's store is a JavaScript app that loads numbers from a JSON API
(`POST /api/lucky-number/product-list`). The API returns **random samples**
per request, so the tool draws many samples and dedupes to build a near-complete
pool locally, then filters/ranks it instantly.

## Requirements

- Python 3.9+
- No external packages (stdlib only)

## Disclaimer

For personal research use. Lucky numbers are a cultural/entertainment product;
rarity and pattern scores are descriptive, not a guarantee of luck or value.
Buying is done through True's official website.
