# lucky-number-buy — Vercel serverless browser-buy function

A single Vercel serverless function that runs headless Chromium to auto-select a
Thai lucky number on True's store (`store.true.th`), mirroring the flow that
`buy_worker.py` does locally — so the web app's "ซื้อ" button works from any
device with no local PC / bridge.

```
POST /api/buy
Content-Type: application/json
{ "msisdn": "0954321133", "pool": "universal" }   // pool optional (default universal)

200 -> { "ok": true,  "offerUrl": "https://store.true.th/lucky-number-offer", "msisdn": "...", "pool": "...", "onOfferPage": true }
4xx/5xx -> { "ok": false, "error": "..." }
```

The browser flow (identical steps to `buy_worker.py`):

1. Open the pool's listing page (`POOL_PAGES` mapping).
2. Inject the 9 position digits into `input.numberPosition` boxes via the
   **native value setter + `input`/`change` events in one `page.evaluate`**.
3. Click **"ค้นหาเบอร์"** (exact text match).
4. Wait for `.number-card`, compare digits-only text against the msisdn, click
   the card's **"เลือก"** button.
5. Land on `/lucky-number-offer` (number reserved) and return the URL.

## Stack

- `playwright-core` — drives the browser.
- `@sparticuz/chromium` — pre-stripped headless Chromium binary that fits under
  Vercel's ~50 MB function limit. **Linux-only**, which is exactly what Vercel's
  Node.js runtime runs on.
- Node.js 20 runtime, 1024 MB memory, region `sin1` (Singapore — closest Vercel
  region to True's servers in Thailand).

## Deploy

Prerequisite: a Vercel account and the Vercel CLI.

```bash
npm i -g vercel
cd vercel-fn
vercel login                 # opens browser auth (or: vercel login --github)
vercel link                  # create a new project (e.g. name: lucky-number-buy)
vercel deploy --prod
```

That produces a URL like `https://lucky-number-buy.vercel.app`. The function is
`https://<project>.vercel.app/api/buy`.

Smoke-test after deploy:

```bash
curl -s https://<project>.vercel.app/api/buy
curl -s -X POST https://<project>.vercel.app/api/buy \
  -H "Content-Type: application/json" \
  -d '{"msisdn":"0955525521","pool":"universal"}'
```

## Web app wiring

In the Firebase-hosted web app (`webapp/`), the "ซื้อ" button calls this URL.
It is configurable at build time:

```
# webapp/.env.production (or set in your CI / Vercel / anywhere the Vite build runs)
VITE_BUY_API=https://lucky-number-buy.vercel.app/api/buy
```

If the env var is unset, `webapp/src/main.jsx` falls back to the default URL
`https://lucky-number-buy.vercel.app/api/buy`; if the local bridge is reachable
it still takes priority (existing local workflow), otherwise it opens the
listing tab.

## Local testing (Windows/macOS)

`@sparticuz/chromium`'s binary is Linux-only, so run locally with a normal
Chromium installed by Playwright:

```bash
cd vercel-fn
npm install
npx playwright install chromium
node test_local.js                  # fetches a live number from True's API, then buys it
node test_local.js 0954321133 rahu  # or pass an explicit number + pool
```

`test_local.js` auto-detects the local Chromium and passes it via
`CHROMIUM_PATH` (already supported by `api/buy.js`).

## Limits & known caveats

- **Vercel Hobby: 60 s wall time.** The happy path is ~20-25 s, cold start adds
  a few seconds; the function self-limits to 55 s and returns a timeout error
  past that.
- **Cloud-IP risk:** True may throttle/block datacenter IPs. This must be
  verified against the live deploy — see the repo report. If blocked, the web
  app's buy button falls back to opening the listing tab.
- **Reservation lifetime:** the number is reserved in the headless browser's
  session when it lands on `/lucky-number-offer`. Whether that reservation
  follows a user who opens the returned `offerUrl` in their own browser depends
  on True's session handling — the function reports `onOfferPage` so the caller
  can decide.
- `@sparticuz/chromium` and `playwright-core` versions should be bumped
  together (the package follows Chromium's release cycle, not semver).
