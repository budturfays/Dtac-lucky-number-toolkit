/**
 * getLive — lightweight live pulse from True's API.
 *
 * True's /api/lucky-number/product-list returns RANDOM samples, so a full
 * catalog can't be rebuilt per request cheaply. Instead this function:
 *   - reports current pool sizes (one cheap call per pool)
 *   - scans a few random draws for memorable numbers currently in stock
 *
 * The web app polls this endpoint every N minutes to show fresh inventory
 * status without rebuilding the whole 93k catalog.
 */
const functions = require("firebase-functions");
const https = require("https");

const BASE = "https://store.true.th/api";
const POOLS = ["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"];
const POOL_NAMES = {
  universal: "พลังดาว", rahu: "ฟันธงพระราหู", khanthep: "ฟันธงขั้นเทพ",
  naga: "ฟันธงนาคราช", ajchang: "เฉพาะคุณ/ตอง", emperor: "จักรพรรดิ",
};

function makeHeaders() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const cid = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${Math.floor(Math.random()*9000+1000)}`;
  const sid = `VECOM-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${require("crypto").randomUUID()}`;
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://store.true.th",
    "Referer": "https://store.true.th/",
    "correlationid": cid,
    "x-correlator-id": cid,
    "sessionid": sid,
  };
}

function postJson(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...body, pagination: { page: 1, size: 200 } });
    const req = https.request(BASE + "/lucky-number/product-list", {
      method: "POST",
      headers: { ...makeHeaders(), "Content-Length": Buffer.byteLength(data) },
      timeout: 20000,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error("bad json: " + raw.slice(0, 80))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

function maxrun(m) {
  let best = 1, cur = 1;
  for (let i = 1; i < m.length; i++) {
    cur = m[i] === m[i-1] ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

function memorableScore(m) {
  let s = 0;
  const mr = maxrun(m);
  if (mr >= 4) s += 10; else if (mr >= 3) s += 6; else if (mr >= 2) s += 3;
  let a = 1, d = 1;
  for (let i = 1; i < m.length; i++) {
    a = m[i] === String(+m[i-1]+1) ? a + 1 : 1;
    d = m[i] === String(+m[i-1]-1) ? d + 1 : 1;
    if (a >= 4 || d >= 4) { s += 8; break; }
  }
  if (m.endsWith("0000")) s += 6; else if (m.endsWith("000")) s += 3;
  return s;
}

async function getLive() {
  const pools = {};
  for (const pool of POOLS) {
    try {
      const resp = await postJson({ type: pool, pagination: { page: 1, size: 1 } });
      pools[pool] = {
        name: POOL_NAMES[pool],
        total: (resp.data && resp.data.pagination && resp.data.pagination.totalItem) || null,
      };
    } catch (e) {
      pools[pool] = { name: POOL_NAMES[pool], total: null, error: String(e.message || e) };
    }
  }

  // memorable scan: a few draws, keep unique
  const found = {};
  for (let i = 0; i < 3; i++) {
    try {
      const resp = await postJson({ type: "universal" });
      for (const item of (resp.data && resp.data.numbering) || []) {
        const m = item.msisdn;
        const sc = memorableScore(m);
        if (sc >= 10 && !found[m]) {
          found[m] = { msisdn: m, score: sc, price: (item.detail && item.detail[0] && item.detail[0].rc) || null };
        }
      }
    } catch (e) { /* skip */ }
  }
  const memorable = Object.values(found).sort((a, b) => b.score - a.score).slice(0, 10);

  return {
    updatedAt: new Date().toISOString(),
    pools,
    memorable,
  };
}

exports.getLive = functions
  .runWith({ memory: "256MB", timeoutSeconds: 60 })
  .region("asia-southeast1")
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    }
    try {
      const data = await getLive();
      res.set("Cache-Control", "no-store");
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
