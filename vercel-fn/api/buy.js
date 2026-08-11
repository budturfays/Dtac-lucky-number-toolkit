/**
 * Vercel serverless function — POST /api/buy {"msisdn": "0954321133", "pool": "universal"}
 *
 * Reserves a Thai lucky number on True's store with a DIRECT API call — no
 * headless Chromium, ~0.3-1s total:
 *
 *   1. Lookup: POST /api/lucky-number/product-list with an exact-position
 *      number_index query → find the item by msisdn → build bermongkolInfo
 *      from detail[0] + item.oper. If the number is no longer in the pool
 *      (already reserved/sold), return {ok:false, error:"unavailable"}.
 *   2. Reserve: POST /api/lucky-number/select-number with the exact payload
 *      shape the site's storefront sends. HTTP 200 + statusCode 200 means the
 *      number is reserved server-side and drops out of the pool.
 *   3. Best-effort: GET /api/sim/select-number (Bearer token from
 *      /api/auth/anonymous, same session headers) returns extra offer data.
 *      Bounded by a deadline — never blocks or fails the core result.
 *
 * Returns {"ok": true, "offerUrl", "msisdn", "onOfferPage": true} in ~1s
 * or {"ok": false, "error"}. CORS is wide open so the web app can call it
 * cross-origin.
 *
 * Runtime: Node 20+ (Vercel Functions). Uses global fetch — zero deps.
 */
const crypto = require("crypto");

const BASE = "https://store.true.th/api";
const OFFER_URL = "https://store.true.th/lucky-number-offer";
const MSISDN_RE = /^\d{10}$/;
const DEFAULT_POOL = "universal";
const POOLS = ["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"];
// Soft wall-clock budget for a request and the cap for the best-effort
// sim/select-number follow-up (see handleBuy).
const TOTAL_BUDGET_MS = 1100;
const SIM_DEADLINE_MS = 600;
const UPSTREAM_TIMEOUT_MS = 10000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Per-instance counter so repeated calls on a warm instance still vary.
let _seq = 0;

/**
 * Build the request headers the site's storefront sends. The correlation id
 * format matches the site's JS: YYYYMMDDHHmmss + 6 random digits; session id
 * is VECOM-YYYYMMDD-<uuid>. No authorization header is needed for the core
 * reserve call (only for the optional sim/select-number follow-up).
 */
function makeHeaders() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cid = ts + String(100000 + ((_seq++ * 7919) % 900000));
  const sid = `VECOM-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${crypto.randomUUID()}`;
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": UA,
    Origin: "https://store.true.th",
    Referer: "https://store.true.th/",
    correlationid: cid,
    "x-correlator-id": cid,
    sessionid: sid,
  };
}

async function apiPost(path, body, headers) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}

async function apiGet(path, headers) {
  const r = await fetch(BASE + path, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}

/** Resolve the deadline once the promise settles; value.extra = true on win. */
async function withinDeadline(promise, ms) {
  let timer;
  return Promise.race([
    promise.then((v) => ({ won: true, value: v })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ won: false, value: null }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Exact-position catalog lookup (mirror of lucky.py check_exact): query with
 * the 9 position digits, find the item whose msisdn matches exactly.
 */
async function findItem(headers, pool, msisdn) {
  const digits = msisdn.slice(1); // position 0 is the fixed leading 0
  const number_index = digits.split("").map((d, i) => ({ index: i, number: Number(d) }));
  const res = await apiPost(
    "/lucky-number/product-list",
    { type: pool, number_index, pagination: { page: 1, size: 5 } },
    headers
  );
  const numbering = (res.json && res.json.data && res.json.data.numbering) || [];
  return numbering.find((it) => String(it.msisdn) === msisdn) || null;
}

/**
 * bermongkolInfo mirrors the site's own builder (captured live for universal
 * and rahu): detail[0] provides subGroupHora/grade/nasCode/rc(pricePlan)/
 * priority/newSpecialType. Two catalog gaps are covered by the site's defaults:
 *   - subGroupHora is empty for some pools (rahu/naga) -> the site sends the
 *     pool name itself (e.g. "rahu") and the API rejects an empty value.
 *   - priority is absent for those pools -> the site defaults it to 1.
 * The optional label/title fields the site also sends are display-only and NOT
 * required for the reservation (verified live), so they are omitted to stay
 * resilient to sparse catalog data.
 */
function buildBermongkolInfo(d0, pool) {
  return {
    subGroupHora: d0.subGroupHora || pool,
    grade: d0.grade ?? "",
    nasCode: d0.nasCode ?? "",
    pricePlan: d0.rc ?? 0,
    priority: d0.priority ?? 1,
    newSpecialType: d0.newSpecialType ?? "",
  };
}

function parseReserveError(res) {
  const msg = res.json && res.json.statusMessage;
  if (msg && String(msg) !== "Success") return String(msg);
  if (res.json && res.json.message) return String(res.json.message);
  return `select-number HTTP ${res.status}`;
}

/**
 * One buy run: lookup detail -> reserve -> (best-effort) extra offer data.
 */
async function handleBuy(msisdn, pool) {
  const start = Date.now();
  const headers = makeHeaders();

  // The auth token is independent of the reservation — fetch it in parallel
  // so the best-effort sim/select-number call adds almost no latency.
  const authPromise = apiPost("/auth/anonymous", {}, headers);

  const item = await findItem(headers, pool, msisdn);
  if (!item) {
    return { ok: false, error: "unavailable", msisdn, pool };
  }

  const d0 = (item.detail && item.detail[0]) || {};
  const payload = {
    msisdn,
    companyCode: item.oper || "RF",
    groupHora: item.groupHora || pool,
    bermongkolInfo: buildBermongkolInfo(d0, item.groupHora || pool),
  };

  const sel = await apiPost("/lucky-number/select-number", payload, headers);
  if (!(sel.status === 200 && sel.json && sel.json.statusCode === 200)) {
    return { ok: false, error: parseReserveError(sel), msisdn, pool };
  }

  const result = { ok: true, offerUrl: OFFER_URL, msisdn, pool, onOfferPage: true };

  // Best-effort extra offer data (same session + bearer token). Only run when
  // the core steps left time in the budget — the reservation already happened,
  // so this must never push the response past the ~1s target.
  const remainingBudget = TOTAL_BUDGET_MS - (Date.now() - start);
  if (remainingBudget > 100) {
    const auth = await authPromise;
    const token = auth && auth.json && auth.json.data && auth.json.data.access_token;
    if (token) {
      const sim = await withinDeadline(
        apiGet("/sim/select-number", { ...headers, Authorization: `Bearer ${token}` }),
        Math.min(SIM_DEADLINE_MS, remainingBudget)
      );
      if (sim.won && sim.value.json && sim.value.json.status === 200 && sim.value.json.data) {
        result.offer = sim.value.json.data;
      }
    }
  }
  return result;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  cors(res);
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    // GET is handy for a quick health check after deploy.
    sendJson(res, 200, {
      ok: true,
      service: "lucky-number-buy",
      usage: "POST /api/buy with JSON body { msisdn: '0954321133', pool?: 'universal' }",
      pools: POOLS,
    });
    return;
  }

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
    else if (Buffer.isBuffer(body)) body = JSON.parse(body.toString("utf-8") || "{}");
  } catch (_) {
    sendJson(res, 400, { ok: false, error: "invalid JSON body" });
    return;
  }
  body = body || {};

  const msisdn = String(body.msisdn || "").trim();
  if (!MSISDN_RE.test(msisdn)) {
    sendJson(res, 400, { ok: false, error: "msisdn must be exactly 10 digits" });
    return;
  }
  const pool = String(body.pool || "").trim().toLowerCase() || DEFAULT_POOL;

  try {
    const result = await handleBuy(msisdn, pool);
    if (result.ok) {
      sendJson(res, 200, result);
    } else if (result.error === "unavailable") {
      sendJson(res, 404, result);
    } else {
      sendJson(res, 502, result);
    }
  } catch (e) {
    sendJson(res, 502, {
      ok: false,
      error: e && e.message ? e.message : String(e),
      msisdn,
      pool,
    });
  }
};
