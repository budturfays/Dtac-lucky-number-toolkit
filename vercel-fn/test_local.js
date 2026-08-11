/**
 * Local test harness for api/buy.js (no Chromium — direct API).
 *
 * Usage:
 *   node test_local.js [msisdn] [pool]
 *
 * If no msisdn is given, it first fetches a real currently-available number
 * from True's API (same endpoint/headers as the function) and buys that one.
 * After the handler returns it re-queries the exact number to confirm the
 * reservation dropped it from the pool.
 */
const crypto = require("crypto");
const BASE = "https://store.true.th/api";

function makeHeaders() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cid = ts + Math.floor(1e5 + Math.random() * 9e5);
  const sid = `VECOM-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${crypto.randomUUID()}`;
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Origin: "https://store.true.th",
    Referer: "https://store.true.th/",
    correlationid: cid,
    "x-correlator-id": cid,
    sessionid: sid,
  };
}

const handler = require("./api/buy.js");

function mockRes() {
  const res = {
    _status: null,
    _json: null,
    setHeader() {},
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
  const r = await fetch(BASE + "/lucky-number/product-list", {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify({ type: pool, pagination: { page: 1, size: 5 } }),
  });
  const resp = await r.json();
  const items = (resp && resp.data && resp.data.numbering) || [];
  if (!items.length) {
    console.error("True API returned no numbers for pool", pool);
    process.exit(3);
  }
  console.log("API picked:", items[0].msisdn);
  return String(items[0].msisdn);
}

async function exactCount(pool, msisdn) {
  const digits = msisdn.slice(1);
  const number_index = digits.split("").map((d, i) => ({ index: i, number: Number(d) }));
  const r = await fetch(BASE + "/lucky-number/product-list", {
    method: "POST",
    headers: makeHeaders(),
    body: JSON.stringify({ type: pool, number_index, pagination: { page: 1, size: 5 } }),
  });
  const resp = await r.json();
  return ((resp && resp.data && resp.data.numbering) || []).filter(
    (it) => String(it.msisdn) === msisdn
  ).length;
}

async function main() {
  let msisdn = process.argv[2];
  const pool = (process.argv[3] || "universal").toLowerCase();
  if (!/^\d{10}$/.test(msisdn || "")) {
    msisdn = await fetchRealNumber(pool);
    console.log("Using live number:", msisdn, "pool:", pool);
  }

  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { msisdn, pool },
  };
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

  const remaining = await exactCount(pool, msisdn);
  console.log(
    `\nre-check exact query for ${msisdn}: ${remaining} result(s) ` +
      (remaining === 0 ? "-> RESERVED" : "-> still listed")
  );
  process.exit(res._json && res._json.ok && remaining === 0 ? 0 : 1);
}

main();
