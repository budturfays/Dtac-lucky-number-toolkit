import { randomUUID } from "node:crypto";

export const POOLS = new Set(["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"]);
export const MSISDN_RE = /^0\d{9}$/;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sendJson(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(payload);
}

export function methodAllowed(req, res, service) {
  if (req.method === "POST") return true;
  if (req.method === "GET") sendJson(res, 200, { ok: true, service });
  else {
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { ok: false, error: "method not allowed" });
  }
  return false;
}

export function readBody(req) {
  let body = req.body;
  try {
    if (Buffer.isBuffer(body)) body = body.toString("utf8");
    if (typeof body === "string") {
      if (Buffer.byteLength(body) > 1024) throw new Error();
      body = JSON.parse(body);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "expected a JSON object");
  }
}

export function readPool(body) {
  if (typeof body.pool !== "string" || !POOLS.has(body.pool)) {
    throw new HttpError(400, "invalid pool");
  }
  return body.pool;
}

export function parseNumbering(json) {
  const data = json?.data;
  if (json?.statusCode !== 200 || !data || typeof data !== "object") {
    throw new HttpError(502, "unexpected response from True");
  }
  // True explicitly uses null for an empty search. Missing/malformed data is
  // an upstream failure, not proof that the number is unavailable.
  if (data.numbering === null && data.pagination?.totalItem === 0) return [];
  if (!Array.isArray(data.numbering) ||
      data.numbering.some(item => !item || !MSISDN_RE.test(String(item.msisdn)))) {
    throw new HttpError(502, "unexpected response from True");
  }
  if (!data.numbering.length && data.pagination?.totalItem !== 0) {
    throw new HttpError(502, "inconsistent response from True");
  }
  return data.numbering;
}

export async function productList(body) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const correlation = stamp + randomUUID().replaceAll("-", "").slice(0, 6);
  try {
    const res = await fetch("https://store.true.th/api/lucky-number/product-list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        Origin: "https://store.true.th", Referer: "https://store.true.th/",
        correlationid: correlation, "x-correlator-id": correlation,
        sessionid: `VECOM-${stamp.slice(0, 8)}-${randomUUID()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new HttpError(502, "True is temporarily unavailable");
    return parseNumbering(await res.json());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(error.name === "TimeoutError" ? 504 : 502, "could not contact True; try again");
  }
}

export function sendError(res, error) {
  return sendJson(res, error instanceof HttpError ? error.status : 500,
    { ok: false, error: error instanceof HttpError ? error.message : "request failed" });
}
