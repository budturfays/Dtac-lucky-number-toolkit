// Catalog-relative rarity helpers. These describe how uncommon a pattern is
// in the current snapshot; they are not claims about luck or market value.

function repeatedRuns(msisdn) {
  const runs = [];
  let start = 0;
  while (start < msisdn.length) {
    let end = start + 1;
    while (end < msisdn.length && msisdn[end] === msisdn[start]) end += 1;
    if (end - start >= 2) runs.push({ digit: msisdn[start], start, length: end - start });
    start = end;
  }
  return runs;
}

function sequenceRuns(msisdn) {
  const runs = [];
  for (let start = 0; start < msisdn.length - 2; start += 1) {
    const step = Number(msisdn[start + 1]) - Number(msisdn[start]);
    if (Math.abs(step) !== 1) continue;
    let end = start + 2;
    while (end < msisdn.length && Number(msisdn[end]) - Number(msisdn[end - 1]) === step) end += 1;
    if (end - start >= 3) {
      runs.push({ start, length: end - start, direction: step > 0 ? "up" : "down", value: msisdn.slice(start, end) });
      start = end - 2;
    }
  }
  return runs;
}

export function rarityFeatures(msisdn) {
  const features = new Set();
  for (const run of repeatedRuns(msisdn)) {
    // Exact digit + position makes this more precise than the old length-only
    // signature, while the shape key keeps useful groups from becoming noisy.
    features.add(`run:${run.digit}:${run.start}:${run.length}`);
    features.add(`run-shape:${run.start}:${run.length}`);
  }
  for (const sequence of sequenceRuns(msisdn)) {
    features.add(`sequence:${sequence.start}:${sequence.direction}:${sequence.value}`);
    features.add(`sequence-shape:${sequence.start}:${sequence.direction}:${sequence.length}`);
  }
  for (let start = 0; start < msisdn.length - 3; start += 1) {
    const four = msisdn.slice(start, start + 4);
    if (four[0] === four[2] && four[1] === four[3] && four[0] !== four[1]) {
      features.add(`abab:${start}:${four}`);
    }
    if (four[0] === four[3] && four[1] === four[2] && four[0] !== four[1]) {
      features.add(`abba:${start}:${four}`);
    }
  }
  if (msisdn.slice(0, 5) === msisdn.slice(5).split("").reverse().join("")) {
    features.add(`mirror:${msisdn}`);
  }
  return [...features];
}

export function buildRarityIndex(list) {
  const counts = new Map();
  for (const row of list) {
    for (const feature of new Set(rarityFeatures(row.msisdn))) {
      counts.set(feature, (counts.get(feature) || 0) + 1);
    }
  }
  return { total: list.length, counts };
}

export function rarityFor(msisdn, index) {
  const total = index?.total || 0;
  const features = rarityFeatures(msisdn);
  if (!total || !features.length) return { count: total, total, score: 0, features: [] };
  const count = Math.min(...features.map(feature => index.counts.get(feature) || total));
  return { count, total, score: Math.max(0, Math.round((1 - count / total) * 100)), features };
}

export function rarityLabel(info) {
  if (!info?.total || !info.features?.length) return "ทั่วไป";
  if (info.count <= 1) return "หายากมาก";
  if (info.count <= 3) return "หายาก";
  if (info.count <= Math.max(10, Math.ceil(info.total * 0.01))) return "ค่อนข้างหายาก";
  return "ทั่วไป";
}

