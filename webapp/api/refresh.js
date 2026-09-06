import { HttpError, methodAllowed, readBody, readPool, productList, sendJson, sendError } from "../lib/true-api.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, "lucky-number-refresh")) return;
  try {
    const body = readBody(req);
    const pool = readPool(body);
    const size = body.size === undefined ? 200 : body.size;
    if (!Number.isInteger(size) || size < 1 || size > 200) {
      throw new HttpError(400, "size must be an integer from 1 to 200");
    }
    const numbering = await productList({ type: pool, pagination: { page: 1, size } });
    sendJson(res, 200, { ok: true, pool, numbering, fetchedAt: new Date().toISOString() });
  } catch (error) { sendError(res, error); }
}

