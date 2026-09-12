import { HttpError, MSISDN_RE } from "./true-api.js";

export const AIS_FIND_URL = "https://www.ais.th/consumers/package/exclusive-plan/lucky-number/find-number";
const AIS_API = "https://croissant.ais.th/external/app/lucky/products";

export function parseAisProducts(json) {
  if (!json || typeof json !== "object" || !Number.isInteger(json.total_count) ||
      json.total_count < 0 || !Array.isArray(json.mobile) ||
      json.mobile.some(item => !item || !MSISDN_RE.test(String(item.mobile_no)))) {
    throw new HttpError(502, "unexpected response from AIS");
  }
  if (!json.mobile.length && json.total_count !== 0) {
    throw new HttpError(502, "inconsistent response from AIS");
  }
  return json.mobile;
}

export async function aisProductList(msisdn) {
  const body = { variables: { filter: {
    type_of_product: { eq: "mobile" }, mobile_no: { like: msisdn },
    prefered_number: { in: [] }, unwanted_number: { in: [] },
    fortune_teller: { eq: null }, birthday: { eq: "" },
    prediction_type: { in: [] }, letter_grade: null, aggregate_score: null,
  }, pageSize: 5, currentPage: 1 } };
  try {
    const response = await fetch(AIS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json",
        "User-Agent": "Mozilla/5.0", Origin: "https://www.ais.th", Referer: AIS_FIND_URL },
      body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new HttpError(502, "AIS is temporarily unavailable");
    return parseAisProducts(await response.json());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(error.name === "TimeoutError" ? 504 : 502, "could not contact AIS; try again");
  }
}
