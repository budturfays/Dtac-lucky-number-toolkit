import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import check from "../api/check.js";
import refresh from "../api/refresh.js";
import { parseNumbering } from "../lib/true-api.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const msisdn = "0803655552";
const body = { msisdn, pool: "universal" };
function response() {
  return {
    headers: {}, statusCode: null, payload: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}
async function invoke(handler, payload, method = "POST") {
  const res = response();
  await handler({ method, body: payload }, res);
  return res;
}
function upstream(numbering, totalItem = numbering?.length ?? 0) {
  return { statusCode: 200, data: { numbering, pagination: { totalItem } } };
}
test("health and unsupported methods never contact True", async () => {
  globalThis.fetch = () => { throw new Error("must not call upstream"); };
  for (const handler of [check, refresh]) {
    assert.equal((await invoke(handler, null, "GET")).statusCode, 200);
    const res = await invoke(handler, null, "DELETE");
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, "GET, POST");
  }
});
test("invalid input is rejected before upstream", async () => {
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error("unexpected call"); };
  for (const invalid of [null, [], "{", "null", { ...body, msisdn: 803655552 },
    { ...body, msisdn: "08036555520" }, { ...body, pool: "invalid" }]) {
    assert.equal((await invoke(check, invalid)).statusCode, 400);
  }
  for (const size of [0, -1, 201, 1.5, "5", null, true]) {
    assert.equal((await invoke(refresh, { pool: "universal", size })).statusCode, 400);
  }
  assert.equal(calls, 0);
});
test("exact lookup uses all nine positions and only product-list, never reserve", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://store.true.th/api/lucky-number/product-list");
    assert.equal(options.method, "POST");
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.number_index, [...msisdn.slice(1)].map((n, index) => ({ index, number: +n })));
    assert.equal(sent.type, "universal");
    assert.ok(options.signal);
    return { ok: true, json: async () => upstream([{ msisdn }]) };
  };
  const res = await invoke(check, JSON.stringify(body));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.available, true);
  assert.equal(res.payload.msisdn, msisdn);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
test("explicit empty is unavailable; a different number is not an exact match", async () => {
  for (const rows of [null, [], [{ msisdn: "0803655553" }]]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => upstream(rows) });
    const res = await invoke(check, body);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.available, false);
  }
});
test("upstream malformed responses stay unknown, never unavailable", async () => {
  for (const data of [{}, { statusCode: 500 }, { statusCode: 200, data: {} },
    upstream([], 1), upstream([{ msisdn: "invalid" }])]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => data });
    const res = await invoke(check, body);
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.available, undefined);
  }
});
test("network errors, invalid JSON and timeout return safe errors", async () => {
  for (const [fetcher, status] of [
    [async () => ({ ok: false }), 502],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError("secret"); } }), 502],
    [async () => { throw new Error("secret"); }, 502],
    [async () => { throw new DOMException("secret", "TimeoutError"); }, 504],
  ]) {
    globalThis.fetch = fetcher;
    const res = await invoke(check, body);
    assert.equal(res.statusCode, status);
    assert.equal(JSON.stringify(res.payload).includes("secret"), false);
  }
});
test("refresh uses bounded default and explicit size with fresh sessions", async () => {
  const sessions = [];
  for (const size of [undefined, 1, 200]) {
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).pagination.size, size ?? 200);
      sessions.push(options.headers.sessionid);
      return { ok: true, json: async () => upstream([]) };
    };
    const res = await invoke(refresh, { pool: "universal", size });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.numbering, []);
    assert.ok(Number.isFinite(Date.parse(res.payload.fetchedAt)));
  }
  assert.equal(new Set(sessions).size, 3);
});
test("missing numbering with zero total is still malformed", () => {
  assert.throws(() => parseNumbering({ statusCode: 200, data: { pagination: { totalItem: 0 } } }));
});
