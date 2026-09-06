// Safe to run against production: reads catalog / product-list only.
import assert from "node:assert/strict";
import { validateSnapshot } from "../src/catalog.js";
const base = "https://lucky-number-web-lac.vercel.app";
async function request(path, body) {
  return fetch(base + path, { cache: "no-store", signal: AbortSignal.timeout(30000),
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) }) });
}
for (const route of ["/api/check", "/api/refresh"]) {
  const response = await request(route);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal((await request(route, { pool: "invalid" })).status, 400);
}
const [dataRes, metaRes] = await Promise.all([request("/data/numbers.json"), request("/data/meta.json")]);
assert.equal(dataRes.status, 200);
assert.equal(metaRes.status, 200);
const rows = validateSnapshot(await dataRes.json(), await metaRes.json());
const sample = await request("/api/refresh", { pool: "universal", size: 1 });
assert.equal(sample.status, 200);
const fresh = await sample.json();
assert.equal(fresh.ok, true);
const msisdn = fresh.numbering[0]?.msisdn || rows[0].msisdn;
const checked = await request("/api/check", { pool: "universal", msisdn });
assert.equal(checked.status, 200);
const result = await checked.json();
assert.equal(result.ok, true);
assert.equal(result.msisdn, msisdn);
assert.equal(typeof result.available, "boolean");
console.log(JSON.stringify({ catalogCount: rows.length, checked: msisdn, available: result.available }));
