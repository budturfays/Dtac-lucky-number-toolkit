import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSnapshot, mergeCatalog, parseFavorites, validRow, rawToRow, rowKey } from "../src/catalog.js";
const row = { msisdn: "0803655552", price_baht_month: 399, stars: 12, pools: "universal", provider: "true" };
const meta = { count: 1, lastmod: "2026-09-06T00:00:00Z", providerCounts: { true: 1, ais: 0 } };
test("missing price never becomes a free number", () => {
  assert.throws(() => rawToRow({ msisdn: row.msisdn }, "universal"));
  assert.throws(() => rawToRow({ msisdn: row.msisdn, detail: [{ rc: null }] }, "universal"));
  assert.equal(rawToRow({ msisdn: row.msisdn, detail: [{ rc: 399 }] }, "rahu").pools, "rahu");
});
test("raw True categories are retained for score filters", () => {
  const converted = rawToRow({
    msisdn: row.msisdn,
    detail: [{ rc: 399 }],
    luckyType: [
      { name: "การงาน", star: 5 },
      { name: "การเงิน", star: 4 },
      { name: "ความรัก", star: 3 },
    ],
  }, "universal");
  assert.deepEqual(converted.scores, { work: 5, finance: 4, love: 3 });
  assert.equal(converted.stars, 12);
  assert.equal(converted.provider, "true");
});
test("AIS rows use unknown monthly pricing and a provider-specific identity", () => {
  const ais = { ...row, provider: "ais", pools: "ais", price_baht_month: null };
  assert.equal(validRow(ais), true);
  assert.equal(rowKey(ais), `ais:${row.msisdn}`);
  assert.equal(validRow({ ...ais, provider: "true" }), false);
  assert.doesNotThrow(() => validateSnapshot([row, ais], { ...meta, count: 2, providerCounts: { true: 1, ais: 1 } }));
});
test("snapshot requires valid, nonempty, unique rows matching metadata", () => {
  assert.equal(validateSnapshot([row], meta)[0], row);
  for (const [rows, metadata] of [[[], { ...meta, count: 0 }], [[row], {}],
    [[row], { ...meta, count: 2 }], [[row, row], { ...meta, count: 2 }],
    [[{ ...row, price_baht_month: NaN }], meta], [[row], { ...meta, lastmod: "bad" }]]) {
    assert.throws(() => validateSnapshot(rows, metadata));
  }
  assert.equal(validRow({ ...row, price_baht_month: -1 }), false);
});
test("manual samples supplement snapshots but never freeze later updates", () => {
  const updated = { ...row, price_baht_month: 499 };
  const samples = new Map([[row.msisdn, { row: updated, fetchedAt: 200 }]]);
  assert.deepEqual(mergeCatalog([row], samples, 100), [{ ...updated, sampledAt: 200 }]);
  assert.deepEqual(mergeCatalog([row], samples, 300), [row]);
  assert.deepEqual(mergeCatalog([], samples, 300), []);
  assert.deepEqual(mergeCatalog([row], samples, 200), [row]);
});
test("favorites preserve legacy entries and safely reject corrupt storage", () => {
  const legacy = { msisdn: row.msisdn, price: 399 };
  assert.deepEqual(parseFavorites(JSON.stringify({ [row.msisdn]: legacy })), { [row.msisdn]: legacy });
  for (const saved of ["{", "null", "[]", "1", '{"bad":true}']) assert.deepEqual(parseFavorites(saved), {});
  assert.deepEqual(parseFavorites(JSON.stringify({ [row.msisdn]: row })), { [row.msisdn]: row });
});
