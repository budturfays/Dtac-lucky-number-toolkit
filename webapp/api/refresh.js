/**
 * Same-origin refresh endpoint for the web app.
 *
 * The browser cannot call True's API directly because it does not send CORS
 * headers. Keeping this call server-side avoids depending on public CORS
 * proxies, which are rate-limited and can disappear without notice.
 */
import crypto from "node:crypto";

const TRUE_API = "https://store.true.th/api/lucky-number/product-list";
const POOLS = new Set(["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"]);
const MAX_SIZE = 200;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function makeHeaders() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cid = ts + crypto.randomBytes(3).toString("hex");
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

function sendJson(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 200, { ok: true, service: "lucky-number-refresh", usage: "POST /api/refresh" });
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
  const pool = String(body.pool || "").trim().toLowerCase();
  const size = Number(body.size || 200);
  if (!POOLS.has(pool)) {
    sendJson(res, 400, { ok: false, error: "invalid pool", pools: [...POOLS] });
    return;
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
    sendJson(res, 400, { ok: false, error: `size must be an integer from 1 to ${MAX_SIZE}` });
    return;
  }

  try {
    const upstream = await fetch(TRUE_API, {
      method: "POST",
      headers: makeHeaders(),
      body: JSON.stringify({ type: pool, pagination: { page: 1, size } }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await upstream.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    const numbering = data && data.data && data.data.numbering;
    if (!upstream.ok || !data || data.statusCode !== 200 || !Array.isArray(numbering)) {
      sendJson(res, 502, { ok: false, error: "True API returned an unexpected response" });
      return;
    }
    sendJson(res, 200, { ok: true, pool, numbering });
  } catch (e) {
    sendJson(res, 502, { ok: false, error: e && e.message ? e.message : String(e) });
  }
};

