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

## Click-to-buy from the web app (auto background purchase)

The web app (`webapp/`, live at `https://lucky-number-th.web.app`) lets you
click **ซื้อ** on a number. Because True's store has no deep link for a
specific number (it passes the number through the page's app state), the only
way to auto-select one is browser automation. The web app is a static site, so
the actual automation runs **on your PC** through two small local scripts:

| Script | What it does |
|---|---|
| `buy_bridge.py` | Tiny local HTTP server (`http://localhost:8765`). The web app POSTs the number to it; it appends to `buy_queue.txt`. |
| `buy_worker.py` | Reads `buy_queue.txt` and drives a real (headed) Chromium window to auto-fill the search on True's site, click เลือก, and land on the offer page where the number is reserved — left open so you finish the checkout. |

### How to use

1. Start the worker (Terminal 1) and the bridge (Terminal 2) in the repo root:

   ```bash
   python buy_worker.py --watch
   python buy_bridge.py
   ```

   Or run just the bridge and let it start the worker for you:

   ```bash
   python buy_bridge.py --auto-worker
   ```

2. Open the web app (deployed, or `cd webapp && npm run dev`) — the header
   shows **⚡ ซื้ออัตโนมัติ: พร้อม** when the bridge is reachable.
3. Click **ซื้อ** on a number. The bridge queues it, the worker opens a
   Chromium window, fills the search, and clicks **เลือก** — leaving the
   number reserved on the offer page for you to complete checkout.
4. If the bridge is **not** running, the button falls back to opening the
   listing page in a new tab (the old behavior), and the header shows
   **ซื้ออัตโนมัติ: ปิด**.

### Worker options

```bash
python buy_worker.py                # process everything queued once
python buy_worker.py --watch        # poll the queue every 5s, forever
python buy_worker.py --max 2        # up to 2 browser windows at once
python buy_worker.py --close-after 20  # auto-close browser 20s after selecting
python buy_worker.py --headless     # no visible window (testing only)
```

Queue/state files (all local, gitignored): `buy_queue.txt` (pending numbers),
`buy_processed.log` (history), `buy_worker.log` (run log).

### Limitations

- The automation only works **while your PC is on with `buy_bridge.py`
  running** — the deployed web app reaches `http://localhost:8765` on your
  machine, so it can't work from a phone or another computer.
- One browser window per number opens (headed) so you can see and complete the
  purchase; close it when you're done so the worker moves on.

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
- Stdlib only for `lucky.py` (search/watch/update)
- `playwright` (+ `playwright install chromium`) for the browser-automation
  buy worker: `pip install playwright && playwright install chromium`

## Disclaimer

For personal research use. Lucky numbers are a cultural/entertainment product;
rarity and pattern scores are descriptive, not a guarantee of luck or value.
Buying is done through True's official website.
