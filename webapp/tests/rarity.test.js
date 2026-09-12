import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRarityIndex, rarityFeatures, rarityFor, rarityLabel } from "../src/rarity.js";

test("rarity features include exact runs and sequences", () => {
  const features = rarityFeatures("0123456789");
  assert.ok(features.includes("sequence:0:up:0123456789"));
  assert.ok(features.includes("sequence-shape:0:up:10"));
  assert.ok(rarityFeatures("0803655552").includes("run:5:5:4"));
});

test("rarity is counted against the current catalog and labels uncommon patterns", () => {
  const list = [
    { msisdn: "0123456789" },
    { msisdn: "0803655552" },
    { msisdn: "0803655552" },
  ];
  const index = buildRarityIndex(list);
  const unique = rarityFor("0123456789", index);
  const repeated = rarityFor("0803655552", index);
  assert.equal(unique.total, 3);
  assert.equal(unique.count, 1);
  assert.equal(rarityLabel(unique), "หายากมาก");
  assert.equal(repeated.count, 2);
  assert.equal(rarityLabel(repeated), "หายาก");
});

test("numbers without a recognized pattern remain common", () => {
  const index = buildRarityIndex([{ msisdn: "0135792468" }]);
  const info = rarityFor("0135792468", index);
  assert.deepEqual(info.features, []);
  assert.equal(rarityLabel(info), "ทั่วไป");
});
