export function validRow(row) {
  return row && typeof row.msisdn === "string" && /^0\d{9}$/.test(row.msisdn) &&
    (row.provider === "true" || row.provider === "ais") &&
    (row.price_baht_month === null || (typeof row.price_baht_month === "number" &&
    Number.isFinite(row.price_baht_month) && row.price_baht_month >= 0)) &&
    (row.provider !== "true" || typeof row.price_baht_month === "number") &&
    typeof row.pools === "string" &&
    typeof row.stars === "number" && Number.isFinite(row.stars);
}

export function providerOf(row) { return row?.provider === "ais" ? "ais" : "true"; }
export function rowKey(row) { return `${providerOf(row)}:${row.msisdn}`; }

export function rawToRow(item, pool) {
  const price = item?.detail?.[0]?.rc;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 ||
      (item.luckyType != null && !Array.isArray(item.luckyType))) {
    throw new Error("invalid pricing data");
  }
  const scores = {};
  for (const entry of item.luckyType || []) {
    const name = String(entry?.name || "");
    const value = Number(entry?.star) || 0;
    if (name.includes("การงาน")) scores.work = value;
    if (name.includes("การเงิน")) scores.finance = value;
    if (name.includes("ความรัก")) scores.love = value;
  }
  const row = { msisdn: item.msisdn, price_baht_month: price, pools: pool, provider: "true",
    stars: (item.luckyType || []).reduce((sum, entry) => sum + (Number(entry?.star) || 0), 0), scores };
  if (!validRow(row)) throw new Error("invalid number");
  return row;
}

export function validateSnapshot(rows, meta) {
  const providerCounts = Array.isArray(rows) ? rows.reduce((counts, row) => {
    counts[providerOf(row)] += 1;
    return counts;
  }, { true: 0, ais: 0 }) : null;
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !validRow(row)) ||
      new Set(rows.map(rowKey)).size !== rows.length ||
      meta?.count !== rows.length || !Number.isFinite(Date.parse(meta?.lastmod)) ||
      meta?.providerCounts?.true !== providerCounts?.true ||
      meta?.providerCounts?.ais !== providerCounts?.ais) {
    throw new Error("invalid or mismatched snapshot");
  }
  return rows;
}

// Keep samples fetched after this snapshot, then discard them when a newer
// snapshot supersedes them. A manual refresh must never freeze future updates.
export function mergeCatalog(snapshot, samples, snapshotAt) {
  const merged = new Map(snapshot.map(row => [rowKey(row), row]));
  for (const { row, fetchedAt } of samples.values()) {
    if (fetchedAt > snapshotAt) merged.set(rowKey(row), { ...row, sampledAt: fetchedAt });
  }
  return [...merged.values()];
}

export function parseFavorites(saved) {
  try {
    const parsed = JSON.parse(saved || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, row]) =>
      /^0\d{9}$/.test(key) && row && row.msisdn === key));
  } catch { return {}; }
}

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
