/**
 * Local test harness for api/buy.js.
 *
 * Usage:
 *   node test_local.js [msisdn] [pool]
 *
 * If no msisdn is given, it first fetches a real currently-available number
 * from True's API (same endpoint/headers as buy_worker.py) and buys that one.
 *
 * Requires a local Chromium. First time:
 *   npm install
 *   npx playwright install chromium
 *
 * The harness auto-detects the locally installed Playwright Chromium and passes
 * it to the function via CHROMIUM_PATH (which api/buy.js already supports).
 */
const { chromium } = require("playwright");

// Point the function at the locally installed Playwright Chromium BEFORE
// anything runs (api/buy.js reads CHROMIUM_PATH at launch time).
if (!process.env.CHROMIUM_PATH) {
  try {
    process.env.CHROMIUM_PATH = chromium.executablePath();
    console.log("CHROMIUM_PATH =", process.env.CHROMIUM_PATH);
  } catch (e) {
    console.error("No local Chromium found. Run: npx playwright install chromium");
    process.exit(2);
  }
}

const handler = require("./api/buy.js");

function mockRes() {
  const res = {
    _status: null,
    _json: null,
    _headers: {},
    setHeader(k, v) {
      this._headers[k] = v;
    },
    status(c) {
      this._status = c;
      return this;
    },
    json(o) {
      this._json = o;
    },
    end() {},
  };
  return res;
}

async function fetchRealNumber(pool) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Origin: "https://store.true.th",
    Referer: "https://store.true.th/",
    correlationid: new Date().toISOString().replace(/\D/g, "").slice(0, 18),
    "x-correlator-id": new Date().toISOString().replace(/\D/g, "").slice(0, 18),
    sessionid: "VECOM-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") +
      "-" + require("crypto").randomUUID(),
  };
  const r = await fetch("https://store.true.th/api/lucky-number/product-list", {
    method: "POST",
    headers,
    body: JSON.stringify({ type: pool, pagination: { page: 1, size: 1 } }),
  });
  const resp = await r.json();
  const items = (resp && resp.data && resp.data.numbering) || [];
  if (!items.length) {
    console.error("True API returned no numbers for pool", pool, JSON.stringify(resp).slice(0, 300));
    process.exit(3);
  }
  console.log("API picked:", JSON.stringify(items[0], null, 2));
  return items[0].msisdn;
}

async function main() {
  let msisdn = process.argv[2];
  const pool = (process.argv[3] || "universal").toLowerCase();
  if (!/^\d{10}$/.test(msisdn || "")) {
    msisdn = await fetchRealNumber(pool);
    console.log("Using live number:", msisdn, "pool:", pool);
  }

  const req = { method: "POST", headers: { "content-type": "application/json" }, body: { msisdn, pool } };
  const res = mockRes();
  const t0 = Date.now();
  try {
    await handler(req, res);
  } catch (e) {
    console.error("handler threw:", e);
    process.exit(4);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nHTTP ${res._status} in ${elapsed}s`);
  console.log(JSON.stringify(res._json, null, 2));
  process.exit(res._json && res._json.ok ? 0 : 1);
}

main();
