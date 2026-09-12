// Read-only: fetches the current public AIS catalog; it never reserves a number.
import { methodAllowed, sendJson, sendError } from "../lib/true-api.js";
import { aisCatalog } from "../lib/ais-api.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, "ais-catalog-refresh")) return;
  try {
    const mobile = await aisCatalog();
    sendJson(res, 200, {
      ok: true, provider: "ais", total: mobile.length, mobile,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) { sendError(res, error); }
}
