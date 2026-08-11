import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// ── SEO (runtime metadata; static tags live in index.html) ────────────────
const SEO_TITLE = "หาเบอร์มงคล – ค้นหาเบอร์สวยและเบอร์มงคล";
const SEO_DESCRIPTION =
  "ค้นหาเบอร์มงคลและเบอร์สวยจากทรูและดีแทค ดูดวงเบอร์โทรศัพท์ วิเคราะห์เลขมงคล เบอร์ตอง เบอร์ 4 ตัวท้าย ราคาถูก อัปเดตสดทุกวัน";

function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaProperty(property, content) {
  let el = document.head.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function applySeo() {
  document.title = SEO_TITLE;
  setMeta("description", SEO_DESCRIPTION);
  setMetaProperty("og:title", SEO_TITLE);
  setMetaProperty("og:description", SEO_DESCRIPTION);
  document.documentElement.lang = "th";
}

// ── number utilities (mirror of lucky.py) ──────────────────────────────────
function fmtNum(m) {
  return m.length === 10 ? `${m.slice(0,3)} ${m.slice(3,6)} ${m.slice(6)}` : m;
}

// format the numbers.json file timestamp (from meta.json) for the live bar,
// e.g. "2026-08-11 12:00:20" in the viewer's local time
function fmtFileTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "...";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function runsOf(m) {
  const out = [];
  let i = 0;
  while (i < m.length) {
    let j = i;
    while (j < m.length && m[j] === m[i]) j++;
    if (j - i >= 2) out.push(m[i].repeat(j - i));
    i = j;
  }
  return out.join(" ");
}

function maxrun(m) {
  let best = 1, cur = 1;
  for (let i = 1; i < m.length; i++) {
    cur = m[i] === m[i-1] ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

function rawStruct(m) {
  const out = [];
  let i = 0;
  while (i < m.length) {
    let j = i;
    while (j < m.length && m[j] === m[i]) j++;
    if (j - i >= 2) out.push(j - i);
    i = j;
  }
  return out.sort((a, b) => b - a);
}

function memorableScore(m) {
  let s = 0;
  const mr = maxrun(m);
  if (mr >= 4) s += 10;
  else if (mr >= 3) s += 6;
  else if (mr >= 2) s += 3;
  let a = 1, d = 1, seq3 = false;
  for (let i = 1; i < m.length; i++) {
    a = m[i] === String(+m[i-1]+1) ? a + 1 : 1;
    d = m[i] === String(+m[i-1]-1) ? d + 1 : 1;
    if (a >= 4 || d >= 4) { s += 8; break; }
    if (a === 3 || d === 3) seq3 = true;
    if (i === m.length - 1 && seq3) s += 4;
  }
  for (let i = 0; i < m.length - 3; i++) {
    if (m[i] === m[i+2] && m[i+1] === m[i+3] && m[i] !== m[i+1]) { s += 3; break; }
  }
  if (m.endsWith("0000")) s += 6;
  else if (m.endsWith("000")) s += 3;
  return s;
}

function seqLen(m) {
  let a = 1, d = 1, best = 1;
  for (let i = 1; i < m.length; i++) {
    a = m[i] === String(+m[i-1]+1) ? a + 1 : 1;
    d = m[i] === String(+m[i-1]-1) ? d + 1 : 1;
    best = Math.max(best, a, d);
  }
  return best;
}

function hasABAB(m) {
  for (let i = 0; i < m.length - 3; i++) {
    if (m[i] === m[i+2] && m[i+1] === m[i+3] && m[i] !== m[i+1]) return true;
  }
  return false;
}

function starSum(n) {
  return n.stars || 0;
}

function matches(n, f) {
  const m = n.msisdn;
  if (f.ends && !m.endsWith(f.ends)) return false;
  if (f.seq && !m.includes(f.seq)) return false;
  if (f.abab && !hasABAB(m)) return false;
  if (f.mask) {
    const mask = f.mask.replace(/[\s-]/g, "");
    for (let i = 0; i < mask.length; i++) {
      const ch = mask[i];
      if (!"Xx?*_".includes(ch) && m[i] !== ch) return false;
    }
  }
  if (f.include && !f.include.split(",").filter(Boolean).every(d => m.includes(d))) return false;
  if (f.exclude) {
    const ex = f.exclude.split(",").filter(Boolean);
    if (ex.some(d => m.includes(d))) return false;
  }
  if (f.minrun && maxrun(m) < f.minrun) return false;
  if (f.price) {
    const pr = parseInt(n.price_baht_month, 10);
    if (f.price === "under500" && pr >= 500) return false;
    if (f.price === "under1000" && pr >= 1000) return false;
    if (f.price === "under1500" && pr >= 1500) return false;
  }
  return true;
}

// rarity of a structure: count how many numbers share it
const STRUCT_RARITY = {}; // filled after data loads

// ── POOL -> listing page (for the "buy" link) ──────────────────────────────
const POOL_PAGES = {
  rahu: "https://store.true.th/lucky-number/postpaid/funtong-phrarahu",
  universal: "https://store.true.th/lucky-number/postpaid/somjade?type=all&priceplan=all",
  khanthep: "https://store.true.th/lucky-number/postpaid/funtong-khanthep?type=all&priceplan=all",
  naga: "https://store.true.th/lucky-number/postpaid/funtong-bernaga?priceplan=all",
  ajchang: "https://store.true.th/lucky-number/postpaid/morchang-personalize?type=all&priceplan=all",
  emperor: "https://store.true.th/lucky-number/postpaid/morchang-emperor?type=all&priceplan=all",
};

function poolOf(n) {
  const pools = (n.pools || n.pool || "universal").split(",");
  const hit = pools.find(p => POOL_PAGES[p] || POOL_PAGES[p.split("-")[0]]);
  if (!hit) return "universal";
  return POOL_PAGES[hit] ? hit : hit.split("-")[0];
}

function buyUrl(n) {
  return POOL_PAGES[poolOf(n)] || POOL_PAGES.universal;
}

// ── cloud buy API (Vercel serverless function) ─────────────────────────────
// Primary buy path: POST /api/buy on a Vercel function that reserves the
// number directly with True's API (product-list exact lookup + select-number),
// no browser needed — takes ~1s. Override the URL at build time with:
//   VITE_BUY_API=https://<project>.vercel.app/api/buy
const DEFAULT_BUY_API = "https://lucky-number-buy.vercel.app/api/buy";
const BUY_API = (import.meta.env.VITE_BUY_API || DEFAULT_BUY_API).replace(/\/+$/, "");
const BUY_API_EXPLICIT = Boolean((import.meta.env.VITE_BUY_API || "").trim());

function cloudBuy(msisdn, pool) {
  const ctrl = new AbortController();
  // the API flow takes ~1s — generous 15s cap
  const timer = setTimeout(() => ctrl.abort(), 15000);
  return fetch(BUY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msisdn, pool }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
}

// ── local buy bridge (auto-buy in the background on this PC) ───────────────
// Kept as a fallback: if VITE_BUY_API is unset AND the local bridge is up, the
// buy button uses the bridge as before. The web app is a static site; the
// actual buying is done by buy_bridge.py + buy_worker.py running on this machine.
const BRIDGE_URL = "http://localhost:8765";

function bridgeFetch(path, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  return fetch(`${BRIDGE_URL}${path}`, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── in-browser refresh from True (via a public CORS proxy, no backend) ─────
// The static numbers.json is the cold-start catalog. Visitors can trigger a
// refresh that pulls fresh random samples straight from True's API through a
// public CORS proxy — True's API sends no CORS headers, so the browser can't
// call it directly. Fresh rows are upserted by msisdn on top of the snapshot.
// Note: the proxy fetches from its own IP, not the visitor's — the win is
// "no local PC / no cloud backend", not literally "the user's IP".
const TRUE_API = "https://store.true.th/api/lucky-number/product-list";
const CORS_PROXIES = [
  u => `https://cors.eu.org/${u}`,
  u => `https://proxy.cors.sh/${u}`,
];

function trueHeaders() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
             `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cid = ts + Math.random().toString(16).slice(2, 6);
  const sid = `VECOM-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2) + Date.now().toString(16)
  }`;
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    correlationid: cid,
    "x-correlator-id": cid,
    sessionid: sid,
  };
}

async function proxyDraw(pool, size = 200) {
  const body = JSON.stringify({ type: pool, pagination: { page: 1, size } });
  const headers = trueHeaders();
  let lastErr = null;
  for (const build of CORS_PROXIES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(build(TRUE_API), {
        method: "POST",
        headers,
        body,
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`proxy HTTP ${r.status}`);
      const data = await r.json();
      if (!data || data.statusCode !== 200 || !Array.isArray(data.data?.numbering))
        throw new Error("proxy returned unexpected payload");
      return data.data.numbering;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("all CORS proxies unavailable");
}

// map a raw True API item to the app's row shape (mirror fetch_and_export.py)
function rawToRow(it) {
  const d0 = (it.detail || [])[0] || {};
  let stars = 0;
  for (const t of it.luckyType || []) stars += Number(t.star) || 0;
  return {
    msisdn: String(it.msisdn),
    price_baht_month: Number(d0.rc) || 0,
    pools: it.groupHora || "universal",
    stars,
  };
}

function recomputeRarity(list) {
  const rarity = {};
  for (const n of list) {
    const key = rawStruct(n.msisdn).join(",");
    rarity[key] = (rarity[key] || 0) + 1;
  }
  for (const k of Object.keys(rarity)) STRUCT_RARITY[k] = rarity[k];
}

// ── components ──────────────────────────────────────────────────────────────
function App() {
  const [numbers, setNumbers] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataFetchedAt, setDataFetchedAt] = useState(null);
  const [favorites, setFavorites] = useState({});
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState("repeat");
  const [showFavs, setShowFavs] = useState(false);
  const [limit, setLimit] = useState(30);
  const [notice, setNotice] = useState(null);
  const [randomPick, setRandomPick] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const proxyRefreshed = useRef(false);
  const [lastmod, setLastmod] = useState(null);

  // apply runtime SEO metadata once the app mounts
  useEffect(() => { applySeo(); }, []);

  // buy click: try, in order — the Vercel cloud function (works from any
  // device), the local bridge (fast on this PC when env unset), then opening
  // the listing page as today.
  const handleBuy = useCallback((e, row) => {
    const msisdn = row?.msisdn;
    if (!msisdn) return;
    if (e) e.preventDefault();
    const pool = poolOf(row);

    // Open a tab IMMEDIATELY (user gesture) so the popup blocker can't kill it.
    // Start on the listing page; if the cloud function reserves the number, the
    // same tab is navigated to the offer URL. This gives instant feedback.
    const tab = window.open(buyUrl(row), "_blank", "noopener");

    // cloud path: direct True API call reserves the number in ~1s
    const cloud = () => {
      setNotice(`⏳ กำลังเลือกเบอร์ ${fmtNum(msisdn)}... ใช้เวลาไม่กี่วินาที`);
      return cloudBuy(msisdn, pool)
        .then(async r => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok || !data.ok) {
            const err = new Error(data.error || `cloud ${r.status}`);
            err.unavailable = data.error === "unavailable";
            throw err;
          }
          setNotice(`✅ เลือกเบอร์ ${fmtNum(msisdn)} สำเร็จ — หน้าออฟเฟอร์เปิดแล้ว ทำรายการต่อได้เลย`);
          // navigate the already-open tab to the offer page (number reserved)
          if (data.offerUrl && tab && !tab.closed) {
            try { tab.location.href = data.offerUrl; } catch (_) { window.open(data.offerUrl, "_blank", "noopener"); }
          } else if (data.offerUrl) {
            window.open(data.offerUrl, "_blank", "noopener");
          }
        });
    };

    // local bridge path: buy_worker.py drives a browser on this PC
    const bridge = () =>
      bridgeFetch("/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msisdn }),
      }).then(async r => {
        if (!r.ok) throw new Error(`bridge ${r.status}`);
        setNotice(`⏳ กำลังกรอกเบอร์ ${fmtNum(msisdn)} ... หน้าต่างจะเปิดขึ้นเพื่อให้คุณเลือกซิม/โปรโมชันเอง`);
      });

    if (BUY_API_EXPLICIT) {
      // explicit cloud URL → cloud only, listing page already open as fallback
      cloud().catch(e => {
        setNotice(e && e.unavailable
          ? "⚠️ เบอร์นี้ถูกจอง/ขายไปแล้ว — เปิดหน้าเบอร์แทน (แท็บที่เปิดอยู่)"
          : "❌ เซิร์ฟเวอร์ล้มเหลว — เปิดหน้าเบอร์แทน (แท็บที่เปิดอยู่)");
      });
    } else {
      // env unset: prefer the local bridge (fast on this PC), then the default
      // cloud function, then the listing page.
      bridge()
        .catch(() => cloud())
        .catch(() => {
          setNotice("บริดจ์และคลาวด์ไม่พร้อมใช้งาน — เปิดหน้าเบอร์แทน (แท็บที่เปิดอยู่)");
        });
    }
  }, []);

  // buy-me-a-coffee: Thai modal with a PromptPay QR code
  const [coffeeOpen, setCoffeeOpen] = useState(false);

  // load favorites from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("lucky_favorites");
      if (saved) setFavorites(JSON.parse(saved));
    } catch (e) { /* ignore corrupt storage */ }
  }, []);

  // persist favorites to localStorage
  useEffect(() => {
    try { localStorage.setItem("lucky_favorites", JSON.stringify(favorites)); }
    catch (e) { /* storage full/blocked */ }
  }, [favorites]);

  // load numbers dataset + compute structure rarity
  // refetch on a timer so a newly deployed numbers.json is picked up
  // without a full page reload (cache-busting query param)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const ts = Date.now();
        const r = await fetch(`${import.meta.env.BASE_URL}data/numbers.json?v=${ts}`);
        const data = await r.json();
        if (cancelled) return;
        if (proxyRefreshed.current) return; // keep the proxy-freshened catalog in memory
        setNumbers(data);
        setLoadingData(false);
        setDataFetchedAt(new Date());
        // fetch the file-level meta so the live bar shows the real data timestamp
        fetch(`${import.meta.env.BASE_URL}data/meta.json?v=${ts}`)
          .then(res => (res.ok ? res.json() : null))
          .then(m => { if (m && m.lastmod && !cancelled) setLastmod(m.lastmod); })
          .catch(() => { /* meta is optional; keep the previous lastmod */ });
        recomputeRarity(data);
      } catch (e) {
        if (!cancelled) { setNotice("Failed to load dataset"); setLoadingData(false); }
      }
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000); // refetch every 5 min
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // in-browser refresh: pull fresh samples from True via a CORS proxy and
  // upsert them into the in-memory catalog (snapshot stays as cold start)
  const refreshData = useCallback(async (silent) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    if (!silent) setNotice("⏳ กำลังอัปเดตข้อมูลจากทรูผ่านตัวกลาง...");
    const plan = [];
    for (const [pool, draws] of [["universal", 3], ["rahu", 2], ["khanthep", 2], ["naga", 1], ["ajchang", 1], ["emperor", 1]])
      for (let i = 0; i < draws; i++) plan.push(pool);
    const fresh = new Map();
    let failed = 0;
    for (let i = 0; i < plan.length; i += 3) {
      const batch = plan.slice(i, i + 3);
      const results = await Promise.allSettled(batch.map(p => proxyDraw(p)));
      for (const res of results) {
        if (res.status === "fulfilled") {
          for (const r of res.value.map(rawToRow)) fresh.set(r.msisdn, r);
        } else {
          failed++;
        }
      }
    }
    refreshInFlight.current = false;
    setRefreshing(false);
    if (fresh.size === 0) {
      setNotice("❌ อัปเดตล้มเหลว — ไม่สามารถดึงข้อมูลจากทรูผ่านตัวกลางได้ ลองอีกครั้ง");
      return;
    }
    proxyRefreshed.current = true;
    setNumbers(prev => {
      const byId = new Map(fresh);
      const next = prev.map(n => byId.get(n.msisdn) || n);
      const seen = new Set(next.map(n => n.msisdn));
      for (const r of fresh.values()) if (!seen.has(r.msisdn)) next.push(r);
      recomputeRarity(next);
      return next;
    });
    setDataFetchedAt(new Date());
    if (!silent) setNotice(`✅ อัปเดตแล้ว! ได้เบอร์จากทรู ${fresh.size.toLocaleString()} เบอร์ (ล้มเหลว ${failed}/${plan.length})`);
  }, []);

  // silent auto-refresh every 60 min (proxy refresh layered on the snapshot)
  useEffect(() => {
    const t = setInterval(() => refreshData(true), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshData]);

  const toggleFav = useCallback((msisdn, row) => {
    setFavorites(prev => {
      const next = { ...prev };
      if (next[msisdn]) delete next[msisdn];
      else next[msisdn] = { msisdn, price: row.price_baht_month, addedAt: Date.now() };
      return next;
    });
  }, []);

  const setQuick = useCallback((q) => {
    setFilters(q);
    setShowFavs(false);
    setSort("repeat");
    setLimit(30);
  }, []);

  const randomPickClick = useCallback(() => {
    const pool = numbers.filter(n => matches(n, filters));
    if (!pool.length) { setRandomPick(null); setNotice("ไม่มีเบอร์ที่ตรงเงื่อนไข"); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setRandomPick(pick);
  }, [numbers, filters]);

  const results = useMemo(() => {
    let rows = showFavs
      ? numbers.filter(n => favorites[n.msisdn])
      : numbers.filter(n => matches(n, filters));
    if (sort === "memorable") rows = [...rows].sort((a, b) => memorableScore(b.msisdn) - memorableScore(a.msisdn));
    else if (sort === "price") rows = [...rows].sort((a, b) => (parseInt(a.price_baht_month)||0) - (parseInt(b.price_baht_month)||0));
    else if (sort === "repeat") rows = [...rows].sort((a, b) => maxrun(b.msisdn) - maxrun(a.msisdn));
    else if (sort === "rarity") rows = [...rows].sort((a, b) => {
      const ka = rawStruct(a.msisdn).join(","), kb = rawStruct(b.msisdn).join(",");
      const ra = ka ? STRUCT_RARITY[ka] || 1e9 : 1e9, rb = kb ? STRUCT_RARITY[kb] || 1e9 : 1e9;
      return ra - rb;
    });
    else if (sort === "rare_mem") rows = [...rows].filter(n => memorableScore(n.msisdn) > 0).sort((a, b) => {
      const ma = memorableScore(a.msisdn), mb = memorableScore(b.msisdn);
      const ra = STRUCT_RARITY[rawStruct(a.msisdn).join(",")] || 1e9;
      const rb = STRUCT_RARITY[rawStruct(b.msisdn).join(",")] || 1e9;
      return (mb / rb) - (ma / ra);
    });
    else if (sort === "value") rows = [...rows].sort((a, b) => {
      const va = starSum(a) / Math.max(parseInt(a.price_baht_month)||1, 1);
      const vb = starSum(b) / Math.max(parseInt(b.price_baht_month)||1, 1);
      return vb - va;
    });
    return rows;
  }, [numbers, filters, sort, showFavs, favorites]);

  const shown = results.slice(0, limit);

  const quickButtons = [
    { label: "จบ 888", q: { ends: "888" } },
    { label: "ตอง/คู่ (ซ้ำ 3+)", q: { minrun: "3" } },
    { label: "สี่ตัว (8888)", q: { minrun: "4" } },
    { label: "ลำดับ 54321/1234", q: {} }, // special: handled via sort? no - use seq quick
    { label: "ราคา < 500", q: { price: "under500" } },
    { label: "สุ่ม", q: null },
  ];

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>หาเบอร์มงคล</h1>
          <span className="sub">ค้นหาเบอร์มงคลฟรี ไม่ต้องผ่านนายหน้า อัพเดทตลอด • บันทึกเบอร์โปรดได้ในเบราว์เซอร์</span>
        </div>
        <button className="coffee" onClick={() => setCoffeeOpen(true)} title="เลี้ยงกาแฟ">☕ เลี้ยงกาแฟ</button>
      </header>

      {coffeeOpen && (
        <div className="coffee-modal" onClick={() => setCoffeeOpen(false)}>
          <div className="card" onClick={e => e.stopPropagation()}>
            <h3>☕ เลี้ยงกาแฟ</h3>
            <img
              className="qr-img"
              src="https://promptpay.io/0869532969"
              alt="PromptPay QR code"
              width={220}
              height={220}
            />
            <p>
              สแกน QR พร้อมเพย์ เพื่อส่งกำลังใจให้ผู้พัฒนา<br />
              ขอบคุณที่ใช้หาเบอร์มงคล! 🙏
            </p>
            <button onClick={() => setCoffeeOpen(false)}>ปิด</button>
          </div>
        </div>
      )}

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      {lastmod && (
        <section className="livebar card">
          <div className="live-title">
            <span className="live-dot" /> สด อัปเดต {fmtFileTime(lastmod)}
          </div>
        </section>
      )}

      {loadingData ? (
        <div className="center">กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          <section className="filters card">
            <div className="searchbar">
              <div className="search-row">
                <input
                  className="search-input"
                  placeholder="จบด้วย... (เช่น 888)"
                  value={filters.ends || ""}
                  onChange={e => setFilters({ ...filters, ends: e.target.value })}
                />
                <input
                  className="search-input"
                  placeholder="มีตัวเลข... (เช่น 8,9)"
                  value={filters.include || ""}
                  onChange={e => setFilters({ ...filters, include: e.target.value })}
                />
                <input
                  className="search-input"
                  placeholder="ไม่มีเลข... (เช่น 4)"
                  value={filters.exclude || ""}
                  onChange={e => setFilters({ ...filters, exclude: e.target.value })}
                />
                <input
                  className="search-input"
                  placeholder="รูปแบบ... (0658XXXXXX)"
                  value={filters.mask || ""}
                  onChange={e => setFilters({ ...filters, mask: e.target.value })}
                />
                <input
                  className="search-input"
                  placeholder="มีลำดับ... (54321)"
                  value={filters.seq || ""}
                  onChange={e => setFilters({ ...filters, seq: e.target.value })}
                />
              </div>
              <div className="search-actions">
                <select className="filter-select" value={filters.minrun || ""} onChange={e => setFilters({ ...filters, minrun: e.target.value })}>
                  <option value="">ซ้ำเลขทุกระดับ</option>
                  <option value="2">มีเลขคู่ (88)</option>
                  <option value="3">มีเลขตอง (888)</option>
                  <option value="4">มีเลขสี่ตัว (8888)</option>
                </select>
                <select className="filter-select" value={filters.price || ""} onChange={e => setFilters({ ...filters, price: e.target.value })}>
                  <option value="">ราคาทั้งหมด</option>
                  <option value="under500">ต่ำกว่า 500</option>
                  <option value="under1000">ต่ำกว่า 1,000</option>
                  <option value="under1500">ต่ำกว่า 1,500</option>
                </select>
                <button className="btn" onClick={() => { setFilters({}); }}>ล้างค่า</button>
                <button className={showFavs ? "btn active" : "btn"} onClick={() => setShowFavs(!showFavs)}>
                  {showFavs ? "แสดงทั้งหมด" : "★ เบอร์โปรด"}
                </button>
              </div>
            </div>

            <div className="quick-row">
              <span className="quick-label">โหมด:</span>
              <button className={!filters.ends && !filters.minrun && !filters.seq && !filters.mask && !filters.include && !filters.exclude && !filters.abab && !filters.price && !showFavs && sort === "repeat" ? "chip on" : "chip"} onClick={() => setQuick({})}>ทั้งหมด</button>
              <button className="chip" onClick={() => setQuick({ ends: "888" })}>จบ 888</button>
              <button className="chip" onClick={() => setQuick({ ends: "000" })}>จบ 000</button>
              <button className="chip" onClick={() => setQuick({ ends: "0000" })}>จบ 0000</button>
              <button className="chip" onClick={() => setQuick({ minrun: "3" })}>ตอง (ซ้ำ 3)</button>
              <button className="chip" onClick={() => setQuick({ minrun: "4" })}>สี่ตัว (ซ้ำ 4)</button>
              <button className="chip" onClick={() => setQuick({ seq: "54321" })}>54321</button>
              <button className="chip" onClick={() => setQuick({ seq: "1234" })}>1234</button>
              <button className="chip" onClick={() => setQuick({ abab: true })}>1212 (ABAB)</button>
              <button className="chip" onClick={() => setQuick({ price: "under500" })}>ราคาต่ำ 500</button>
            </div>

            <div className="quick-row">
              <span className="quick-label">เรียง:</span>
              <button className={sort === "repeat" ? "chip on" : "chip"} onClick={() => setSort("repeat")}>ซ้ำมากสุด</button>
              <button className={sort === "memorable" ? "chip on" : "chip"} onClick={() => setSort("memorable")}>🧠 จำง่าย</button>
              <button className={sort === "rarity" ? "chip on" : "chip"} onClick={() => setSort("rarity")}>💎 หายาก</button>
              <button className={sort === "rare_mem" ? "chip on" : "chip"} onClick={() => setSort("rare_mem")}>💎+🧠 หายาก&จำง่าย</button>
              <button className={sort === "value" ? "chip on" : "chip"} onClick={() => setSort("value")}>คุ้มสุด</button>
              <button className={sort === "price" ? "chip on" : "chip"} onClick={() => setSort("price")}>ราคาต่ำสุด</button>
              <button className="chip random" onClick={randomPickClick}>🎲 สุ่ม</button>
            </div>
          </section>

          {randomPick && (
            <section className="card random-card">
              🎲 <span className="num big">{fmtNum(randomPick.msisdn)}</span> — {randomPick.price_baht_month}฿/เดือน
              <button onClick={e => handleBuy(e, randomPick)}>ซื้อ</button>
            </section>
          )}

          <section className="results">
            <div className="count">
              {results.length.toLocaleString()} เบอร์
              {dataFetchedAt && (
                <span className="updated">
                  อัปเดต {dataFetchedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                  {proxyRefreshed.current ? " (สดจากทรู)" : "(รีเฟรชอัตโนมัติทุก 5 นาที)"}
                </span>
              )}
              <button
                className="refresh-btn"
                onClick={() => refreshData(false)}
                disabled={refreshing}
                title="ดึงข้อมูลสดจาก True ผ่านตัวกลาง CORS จากเบราว์เซอร์ของคุณ"
              >
                {refreshing ? "⏳ กำลังอัปเดต..." : "🔄 อัปเดตข้อมูล"}
              </button>
            </div>
            <table>
              <thead>
                <tr><th>เบอร์</th><th>ราคา/เดือน</th><th>แพทเทิร์น</th><th>จำง่าย</th><th></th><th></th></tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.msisdn}>
                    <td className="num">{fmtNum(r.msisdn)}</td>
                    <td>{r.price_baht_month}฿</td>
                    <td className="runs">{runsOf(r.msisdn) || "-"}</td>
                    <td>{memorableScore(r.msisdn) > 0 ? "⭐".repeat(Math.min(3, Math.ceil(memorableScore(r.msisdn)/5))) : ""}</td>
                    <td>
                      <a
                        className="buy"
                        href={buyUrl(r)}
                        target="_blank"
                        rel="noreferrer"
                        title="ซื้อเบอร์นี้ (ลองซื้ออัตโนมัติก่อน แล้วค่อยเปิดหน้าเบอร์)"
                        onClick={e => handleBuy(e, r)}
                      >
                        ซื้อ
                      </a>
                    </td>
                    <td>
                      <button
                        className={favorites[r.msisdn] ? "fav on" : "fav"}
                        onClick={() => toggleFav(r.msisdn, r)}
                        title={favorites[r.msisdn] ? "ลบออกจากเบอร์โปรด" : "บันทึกเบอร์โปรด"}
                      >
                        {favorites[r.msisdn] ? "★" : "☆"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.length > limit && (
              <button className="more" onClick={() => setLimit(limit + 50)}>แสดงเพิ่ม (อีก {results.length - limit} เบอร์)</button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
