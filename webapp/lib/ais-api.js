import { HttpError, MSISDN_RE } from "./true-api.js";

export const AIS_FIND_URL = "https://www.ais.th/consumers/package/exclusive-plan/lucky-number/find-number";
const AIS_API = "https://croissant.ais.th/external/app/lucky/products";

function requestBody(like, pageSize) {
  return { variables: { filter: {
    type_of_product: { eq: "mobile" }, mobile_no: { like },
    prefered_number: { in: [] }, unwanted_number: { in: [] },
    fortune_teller: { eq: null }, birthday: { eq: "" },
    prediction_type: { in: [] }, letter_grade: null, aggregate_score: null,
  }, pageSize, currentPage: 1 } };
}

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
  return (await requestCatalog(requestBody(msisdn, 5))).products;
}

export async function aisCatalog() {
  const { products, total } = await requestCatalog(requestBody("0%%%%%%%%%", 10000));
  if (!products.length || products.length !== total) {
    throw new HttpError(502, "AIS returned an incomplete catalog");
  }
  return products;
}

async function requestCatalog(body) {
  try {
    const response = await fetch(AIS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json",
        "User-Agent": "Mozilla/5.0", Origin: "https://www.ais.th", Referer: AIS_FIND_URL },
      body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new HttpError(502, "AIS is temporarily unavailable");
    const json = await response.json();
    return { products: parseAisProducts(json), total: json.total_count };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(error.name === "TimeoutError" ? 504 : 502, "could not contact AIS; try again");
  }
}
