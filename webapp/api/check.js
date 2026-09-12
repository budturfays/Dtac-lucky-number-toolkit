// Read-only: never reserves a number or changes a provider shopping session.
import { MSISDN_RE, HttpError, methodAllowed, readBody, readPool, productList, sendJson, sendError } from "../lib/true-api.js";
import { aisProductList } from "../lib/ais-api.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, "lucky-number-check")) return;
  try {
    const body = readBody(req);
    if (typeof body.msisdn !== "string" || !MSISDN_RE.test(body.msisdn)) {
      throw new HttpError(400, "msisdn must be 10 digits starting with 0");
    }
    const msisdn = body.msisdn;
    const provider = body.provider === undefined ? "true" : body.provider;
    if (provider !== "true" && provider !== "ais") {
      throw new HttpError(400, "invalid provider");
    }
    let pool = null;
    let numbering;
    if (provider === "ais") {
      numbering = await aisProductList(msisdn);
    } else {
      pool = readPool(body);
      numbering = await productList({
        type: pool,
        number_index: msisdn.slice(1).split("").map((n, index) => ({ index, number: Number(n) })),
        pagination: { page: 1, size: 5 },
      });
    }
    sendJson(res, 200, {
      ok: true, available: numbering.some(item => String(item.msisdn ?? item.mobile_no) === msisdn),
      msisdn, provider, pool, checkedAt: new Date().toISOString(),
    });
  } catch (error) { sendError(res, error); }
}

