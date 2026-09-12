# Mobile Phone Lucky Number searching Toolkit (Thai)

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

## Web app: AIS, True and dtac

[Open the web app](https://lucky-number-web-lac.vercel.app/).

Click **เช็กเบอร์** to perform a read-only, exact-number availability
check. If the provider reports the number available, continue to the matching
AIS or True search page in the same tab. Use the browser's Back action to return.
Select and complete checkout yourself in that browser
session. The web app does not reserve numbers or call the legacy buy service.
A check shows a stale warning after one minute, without blocking the link; even a successful check cannot guarantee
availability by the time you reach True.

The catalog combines AIS's complete public lucky-number listing with a
random-sampled True-dtac snapshot and is rebuilt on a six-hour schedule.
Open pages check for a newer snapshot every five minutes. Manual refresh adds
a small fresh sample, not a full inventory replacement. The displayed snapshot
timestamp and sample timestamp are intentionally separate. Failed or malformed
responses preserve the current catalog; they are not treated as sold-out results.
Snapshots older than eight hours show a warning.

No local bridge or PC is required for the deployed web app. The legacy
`buy_bridge.py` and `buy_worker.py` are separate, opt-in tools; they are no longer
called by the web UI and can reserve numbers if run manually.

The deployed app has no database. GitHub Actions builds `numbers.json` and
`meta.json`, then Vercel serves those static snapshot files alongside read-only
serverless availability endpoints. Favorites stay only in each visitor's browser.

## Deployment checks

GitHub Actions runs Node API/catalog regression tests, Python exporter safety
tests, the production build, and a dependency audit on pull requests. The
production workflow also runs regression tests, rejects unhealthy catalog
fetches, serializes deployments, verifies the Vercel project ID, and runs
read-only production API/catalog checks after deployment. Tests do not purchase
or reserve numbers.

## Data

The tool reads these files (all optional; it auto-detects what's present):

| File | Purpose |
|---|---|
| `all_numbers.csv` | Master pool — `msisdn, grade, price_baht_month, sum, luckyTypes, pool(s)` |
| `numbers_*.csv` | Per-pool dumps (rahu, universal, khanthep, naga, ajchang, emperor) |
| `numbers_prices.csv` | Minimal number + price only |
| `my_numbers.csv` | Your own numbers |
| `watchlist.txt` | Numbers to keep checking |

The dataset is a **sampled snapshot** of True's inventory, not a complete list.
Numbers sell out fast, so always verify availability live (Watch → Check)
before buying.

## How it works

True's store is a JavaScript app that loads numbers from a JSON API
(`POST /api/lucky-number/product-list`). The API returns **random samples**
per request, so the tool draws many samples and dedupes to build a near-complete
pool locally, then filters/ranks it instantly.

## Requirements

- Python 3.9+
- Stdlib only for `lucky.py` (search/watch/update)
- `playwright` (+ `playwright install chromium`) for the browser-automation
  buy worker: `pip install playwright && playwright install chromium`

## Disclaimer

For personal research use. Lucky numbers are a cultural/entertainment product;
rarity and pattern scores are descriptive, not a guarantee of luck or value.
Buying is done through True's official website.
