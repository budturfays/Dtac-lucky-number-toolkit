# lucky-number-buy — Vercel serverless buy function

A single Vercel serverless function that reserves a Thai lucky number on True's
store (`store.true.th`) with a **direct API call** — no headless Chromium, ~1s
total. This replaced the old playwright-core + @sparticuz/chromium browser flow
(15-20s).

```
POST /api/buy
Content-Type: application/json
{ "msisdn": "0954321133", "pool": "universal" }   // pool optional (default universal)

200 -> { "ok": true, "offerUrl": "https://store.true.th/lucky-number-offer",
         "msisdn": "...", "pool": "...", "onOfferPage": true,
         "offer": { ... } }                        // offer = optional best-effort sim data
404 -> { "ok": false, "error": "unavailable", ... } // number already reserved/sold
```

The direct flow (no browser):

1. **Lookup** — `POST /api/lucky-number/product-list` with an exact-position
   `number_index` query (the 9 digits of the msisdn) to fetch the number's own
   catalog record and check availability. Not found = already reserved →
   `error: "unavailable"`.
2. **Reserve** — `POST /api/lucky-number/select-number` with the payload the
   site's storefront sends: `{ msisdn, companyCode (=item.oper), groupHora,
   bermongkolInfo }`. `bermongkolInfo` is built from `detail[0]`:
   `subGroupHora` (falls back to the pool name for rahu/naga, which the API
   requires non-empty), `grade`, `nasCode`, `pricePlan (=rc)`, `priority`
   (default 1 when absent), `newSpecialType`. HTTP 200 + `statusCode:200`
   means the number is reserved server-side and drops out of the pool.
3. **Best-effort offer data** (optional) — `GET /api/sim/select-number` with a
   bearer token from `POST /api/auth/anonymous` and the SAME session headers.
   Bounded by a time budget so it never slows the core response; skipped when
   the lookup+reserve already took too long.

Headers are generated per-request exactly like the site's JS: `correlationid` /
`x-correlator-id` = `YYYYMMDDHHmmss` + 6 random digits, `sessionid` =
`VECOM-YYYYMMDD-<uuid>`, browser User-Agent. No authorization header is needed
for the reserve call.

## Stack

- Zero runtime dependencies — plain Node.js with global `fetch`.
- Node.js runtime, 1024 MB memory, region `sin1` (Singapore — closest Vercel
  region to True's servers in Thailand).
- Response target ~1s; `vercel.json` still keeps `maxDuration: 60` as a ceiling
  (harmless now that the function is fast).

## Deploy

```bash
cd vercel-fn
vercel link                  # project: lucky-number-buy (org budturfays-projects)
vercel deploy --prod --yes
```

That produces `https://lucky-number-buy.vercel.app`. The function is
`https://<project>.vercel.app/api/buy`.

Smoke-test after deploy:

```bash
curl -s https://<project>.vercel.app/api/buy
curl -s -X POST https://<project>.vercel.app/api/buy \
  -H "Content-Type: application/json" \
  -d '{"msisdn":"0955525521","pool":"universal"}'
```

## Web app wiring

In the Vercel-hosted web app (`webapp/`), the "ซื้อ" button calls this URL.
It is configurable at build time:

```
# webapp/.env.production (or set in your CI / Vercel / anywhere the Vite build runs)
VITE_BUY_API=https://lucky-number-buy.vercel.app/api/buy
```

If the env var is unset, `webapp/src/main.jsx` falls back to the default URL
`https://lucky-number-buy.vercel.app/api/buy`; if the local bridge is reachable
it still takes priority (existing local workflow), otherwise it opens the
listing tab.

## Local testing (no browser needed)

```bash
cd vercel-fn
node test_local.js                  # fetches a live number from True's API, then buys it
node test_local.js 0954321133 rahu  # or pass an explicit number + pool
```

`test_local.js` calls the same handler as the deployed function, then re-queries
the exact number to confirm the reservation dropped it from the pool.

## Known caveats

- **Reservation session:** the number is reserved in the *function's* API
  session (its generated `correlationid`/`sessionid`). Navigating a user's
  browser to the returned `offerUrl` opens a fresh storefront session, so the
  offer page may not show the reserved number directly — same limitation as the
  old browser flow, but now the number is genuinely held server-side and removed
  from the pool (verified).
- **Optional label fields:** the site also sends display-only label fields
  (`subGroupHoraLabelTh/En`, `itemListName`, `groupHoraTitle`) in
  `bermongkolInfo`. The API accepts the payload without them (verified live),
  so they are omitted for robustness against sparse catalog data.
- **Cloud-IP risk:** True may throttle/block datacenter IPs. Verified working
  from Vercel's `sin1` region at time of writing; if blocked later, the web
  app's buy button falls back to opening the listing tab.
