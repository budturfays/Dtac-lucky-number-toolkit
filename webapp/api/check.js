/**
 * Same-origin availability check for one number.
 * This only queries True's catalog; it never reserves or purchases anything.
 */
import crypto from "node:crypto";

const TRUE_API = "https://store.true.th/api/lucky-number/product-list";
const POOLS = new Set(["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"]);
const MSISDN_RE = /^\d{10}$/;
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
    sendJson(res, 200, { ok: true, service: "lucky-number-check", usage: "POST /api/check" });
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
  const pool = String(body.pool || "").trim().toLowerCase();
  if (!MSISDN_RE.test(msisdn)) {
    sendJson(res, 400, { ok: false, error: "msisdn must be exactly 10 digits" });
    return;
  }
  if (!POOLS.has(pool)) {
    sendJson(res, 400, { ok: false, error: "invalid pool", pools: [...POOLS] });
    return;
  }

  const number_index = msisdn.slice(1).split("").map((digit, index) => ({
    index,
    number: Number(digit),
  }));

  try {
    const upstream = await fetch(TRUE_API, {
      method: "POST",
      headers: makeHeaders(),
      body: JSON.stringify({ type: pool, number_index, pagination: { page: 1, size: 5 } }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await upstream.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!upstream.ok || !data || data.statusCode !== 200) {
      sendJson(res, 502, { ok: false, error: "True API returned an unexpected response" });
      return;
    }
    const numbering = Array.isArray(data.data?.numbering) ? data.data.numbering : [];
    const available = numbering.some((item) => String(item.msisdn) === msisdn);
    sendJson(res, 200, { ok: true, available, msisdn, pool });
  } catch (e) {
    sendJson(res, 502, { ok: false, error: e && e.message ? e.message : String(e) });
  }
};

