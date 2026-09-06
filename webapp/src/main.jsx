import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { validRow, validateSnapshot, mergeCatalog, parseFavorites, fetchJson, rawToRow } from "./catalog.js";
import { TrueHandoff } from "./TrueHandoff.js";

// ── SEO (runtime metadata; static tags live in index.html) ────────────────
const SEO_TITLE = "หาเบอร์มงคล – ค้นหาเบอร์สวยและเบอร์มงคล";
const SEO_DESCRIPTION =
  "ค้นหาเบอร์มงคลและเบอร์สวยจากทรูและดีแทค ดูดวงเบอร์โทรศัพท์ วิเคราะห์เลขมงคล เบอร์ตอง เบอร์ 4 ตัวท้าย ราคาถูก อัปเดตเป็นรอบ";

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
  if (f.include && !f.include.split(/[\s,]+/).filter(Boolean).every(d => m.includes(d))) return false;
  if (f.exclude) {
    const ex = f.exclude.split(/[\s,]+/).filter(Boolean);
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

// Listing URL with the number's digits pre-filled into the search boxes via
// ?specify=<9 digits> (True's site reads this and fills the position boxes).
function buyUrlSpecify(n) {
  const base = buyUrl(n);
  const sep = base.includes("?") ? "&" : "?";
  const digits = n.msisdn.slice(1); // drop leading 0 (box 0 is fixed)
  return `${base}${sep}specify=${digits}`;
}

// All browser requests are read-only. Selection happens in the visitor's
// True session; reserving on a server first makes the search link go stale.
async function refreshDraw(pool) {
  const data = await fetchJson(`${import.meta.env.BASE_URL}api/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pool, size: 200 }),
  });
  if (!data?.ok || !Array.isArray(data.numbering)) throw new Error("refresh failed");
  return data.numbering.map(item => rawToRow(item, pool));
}

async function checkAvailability(msisdn, pool) {
  const data = await fetchJson(`${import.meta.env.BASE_URL}api/check`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msisdn, pool }),
  });
  if (!data?.ok || typeof data.available !== "boolean" ||
      data.msisdn !== msisdn || data.pool !== pool) throw new Error("check failed");
  return data;
}

function computeRarity(list) {
  const rarity = {};
  for (const n of list) {
    const key = rawStruct(n.msisdn).join(",");
    rarity[key] = (rarity[key] || 0) + 1;
  }
  return rarity;
}

// ── components ──────────────────────────────────────────────────────────────
function App() {
  const [numbers, setNumbers] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [sampleFetchedAt, setSampleFetchedAt] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try { return parseFavorites(localStorage.getItem("lucky_favorites")); }
    catch { return {}; }
  });
  const [filters, setFilters] = useState(() => {
    const query = new URLSearchParams(window.location.search).get("s")?.trim();
    return query && /^\d{1,10}$/.test(query) ? { seq: query } : {};
  });
  const [sort, setSort] = useState("repeat");
  const [showFavs, setShowFavs] = useState(false);
  const [limit, setLimit] = useState(30);
  const [notice, setNotice] = useState(null);
  const [randomPick, setRandomPick] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const catalogRef = useRef({ rows: [], timestamp: 0, samples: new Map() });
  const checkInFlight = useRef(false);
  const purchaseRef = useRef(null);
  const [purchase, setPurchase] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  const [lastmod, setLastmod] = useState(null);

  // apply runtime SEO metadata once the app mounts
  useEffect(() => { applySeo(); }, []);

  const handleBuy = useCallback(async (row) => {
    if (checkInFlight.current || !row?.msisdn) return;
    checkInFlight.current = true;
    setPurchase({ row, status: "checking" });
    try {
      const data = await checkAvailability(row.msisdn, poolOf(row));
      setPurchase({
        row, status: data.available ? "available" : "unavailable",
        checkedAt: Date.now(), url: buyUrlSpecify(row),
      });
    } catch {
      setPurchase({ row, status: "error" });
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (purchase?.status === "checking") {
      purchaseRef.current?.focus();
      purchaseRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [purchase?.status, purchase?.row.msisdn]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const purchaseExpired = purchase?.checkedAt && clockNow - purchase.checkedAt >= 60000;
  const snapshotStale = lastmod && clockNow - Date.parse(lastmod) > 8 * 60 * 60 * 1000;

  // buy-me-a-coffee: Thai modal with a PromptPay QR code
  const [coffeeOpen, setCoffeeOpen] = useState(false);
  const coffeeDialog = useRef(null);
  useEffect(() => {
    if (coffeeOpen) coffeeDialog.current?.showModal();
  }, [coffeeOpen]);

  // persist favorites to localStorage
  useEffect(() => {
    try { localStorage.setItem("lucky_favorites", JSON.stringify(favorites)); }
    catch (e) { /* storage full/blocked */ }
  }, [favorites]);

  // A snapshot and its metadata must agree before replacing the current list.
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const ts = Date.now();
        const [data, meta] = await Promise.all([
          fetchJson(`${import.meta.env.BASE_URL}data/numbers.json?v=${ts}`),
          fetchJson(`${import.meta.env.BASE_URL}data/meta.json?v=${ts}`),
        ]);
        validateSnapshot(data, meta);
        if (cancelled) return;
        const state = catalogRef.current;
        const timestamp = Date.parse(meta.lastmod);
        if (timestamp < state.timestamp) return;
        state.rows = data;
        state.timestamp = timestamp;
        for (const [key, sample] of state.samples) {
          if (sample.fetchedAt <= timestamp) state.samples.delete(key);
        }
        setNumbers(mergeCatalog(data, state.samples, timestamp));
        setLastmod(meta.lastmod);
        setLoadError(false);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        loading = false;
        if (!cancelled) setLoadingData(false);
      }
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [reloadKey]);

  const refreshData = useCallback(async (silent) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    if (!silent) setNotice("กำลังดึงเบอร์ล่าสุดจากทรู…");
    try {
      const plan = ["universal", "universal", "universal", "rahu", "rahu",
        "khanthep", "khanthep", "naga", "ajchang", "emperor"];
      const fresh = new Map();
      let failed = 0;
      for (let i = 0; i < plan.length; i += 3) {
        const results = await Promise.allSettled(plan.slice(i, i + 3).map(refreshDraw));
        for (const result of results) {
          if (result.status === "fulfilled" && result.value.every(validRow)) {
            for (const row of result.value) fresh.set(row.msisdn, row);
          } else failed++;
        }
      }
      if (!fresh.size) throw new Error("no fresh numbers");
      const state = catalogRef.current;
      const fetchedAt = Date.now();
      for (const row of fresh.values()) state.samples.set(row.msisdn, { row, fetchedAt });
      setNumbers(mergeCatalog(state.rows, state.samples, state.timestamp));
      setSampleFetchedAt(new Date(fetchedAt));
      if (!silent) setNotice(`ดึงตัวอย่างล่าสุด ${fresh.size.toLocaleString()} เบอร์${failed ? ` (บางส่วนไม่สำเร็จ ${failed}/${plan.length})` : ""} — ตรวจสอบเบอร์ก่อนซื้ออีกครั้ง`);
    } catch {
      if (!silent) setNotice("ดึงข้อมูลไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาลองอีกครั้ง");
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => refreshData(true), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshData]);

  const structureRarity = useMemo(() => computeRarity(numbers), [numbers]);

  const toggleFav = useCallback((msisdn, row) => {
    setFavorites(prev => {
      const next = { ...prev };
      if (next[msisdn]) delete next[msisdn];
      else next[msisdn] = { ...row, addedAt: Date.now() };
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
    const pool = numbers.filter(n => matches(n, filters) && (!showFavs || favorites[n.msisdn]));
    if (!pool.length) { setRandomPick(null); setNotice("ไม่มีเบอร์ที่ตรงเงื่อนไข"); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setRandomPick(pick);
  }, [numbers, filters, showFavs, favorites]);

  useEffect(() => { setLimit(30); setRandomPick(null); }, [filters, showFavs, sort]);

  const results = useMemo(() => {
    let rows = numbers.filter(n => matches(n, filters) && (!showFavs || favorites[n.msisdn]));
    if (sort === "memorable") rows = [...rows].sort((a, b) => memorableScore(b.msisdn) - memorableScore(a.msisdn));
    else if (sort === "price") rows = [...rows].sort((a, b) => (parseInt(a.price_baht_month)||0) - (parseInt(b.price_baht_month)||0));
    else if (sort === "repeat") rows = [...rows].sort((a, b) => maxrun(b.msisdn) - maxrun(a.msisdn));
    else if (sort === "rarity") rows = [...rows].sort((a, b) => {
      const ka = rawStruct(a.msisdn).join(","), kb = rawStruct(b.msisdn).join(",");
      const ra = ka ? structureRarity[ka] || 1e9 : 1e9, rb = kb ? structureRarity[kb] || 1e9 : 1e9;
      return ra - rb;
    });
    else if (sort === "rare_mem") rows = [...rows].filter(n => memorableScore(n.msisdn) > 0).sort((a, b) => {
      const ma = memorableScore(a.msisdn), mb = memorableScore(b.msisdn);
      const ra = structureRarity[rawStruct(a.msisdn).join(",")] || 1e9;
      const rb = structureRarity[rawStruct(b.msisdn).join(",")] || 1e9;
      return (mb / rb) - (ma / ra);
    });
    else if (sort === "value") rows = [...rows].sort((a, b) => {
      const va = starSum(a) / Math.max(parseInt(a.price_baht_month)||1, 1);
      const vb = starSum(b) / Math.max(parseInt(b.price_baht_month)||1, 1);
      return vb - va;
    });
    return rows;
  }, [numbers, filters, sort, showFavs, favorites, structureRarity]);

  const shown = results.slice(0, limit);


  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">๙</span>
          <div>
            <span className="eyebrow">คลังเบอร์ทรู–ดีแทค</span>
            <h1>หาเบอร์มงคล</h1>
            <span className="sub">คัดเบอร์จากรูปแบบ เลขท้าย และงบรายเดือน</span>
          </div>
        </div>
        <button className="coffee" onClick={() => setCoffeeOpen(true)} title="เลี้ยงกาแฟ">สนับสนุนเว็บไซต์</button>
      </header>

      {coffeeOpen && (
        <dialog ref={coffeeDialog} className="coffee-modal" aria-label="เลี้ยงกาแฟ"
          onClose={() => setCoffeeOpen(false)}
          onClick={event => { if (event.target === event.currentTarget) setCoffeeOpen(false); }}>
          <div className="card" onClick={e => e.stopPropagation()}>
            <h3>สนับสนุนผู้พัฒนา</h3>
            <img
              className="qr-img"
              src="https://promptpay.io/0869532969"
              alt="PromptPay QR code"
              width={220}
              height={220}
            />
            <p>
              สแกน QR พร้อมเพย์ เพื่อส่งกำลังใจให้ผู้พัฒนา<br />
              ขอบคุณที่สนับสนุน
            </p>
            <button onClick={() => setCoffeeOpen(false)}>ปิด</button>
          </div>
        </dialog>
      )}

      {notice && <div className="notice" role="status">{notice} <button aria-label="ปิดข้อความ" onClick={() => setNotice(null)}>×</button></div>}

      {purchase && (
        <section ref={purchaseRef} tabIndex={-1} className="card purchase" role="status" aria-live="polite">
          <strong>เบอร์ {fmtNum(purchase.row.msisdn)}</strong>
          <p>{purchase.status === "checking" ? "กำลังตรวจสอบกับทรู..."
            : purchase.status === "error" ? "ยังตรวจสอบไม่ได้ กรุณาลองอีกครั้ง"
            : purchase.status === "unavailable" ? "ไม่พบเบอร์นี้ในกลุ่มที่เลือกขณะตรวจสอบ อาจถูกจองหรือขายแล้ว"
            : purchaseExpired ? "ตรวจสอบไว้เกิน 1 นาทีแล้ว เบอร์อาจเปลี่ยนสถานะ คุณตรวจสอบซ้ำหรือไปค้นหาที่ทรูได้"
            : "พบเบอร์นี้ที่ทรู เลือกแพ็กเกจและจองต่อได้ที่เว็บไซต์ทรู"}</p>
          {purchase.status === "available" && (
            <TrueHandoff url={purchase.url} />
          )}
          {purchase.status !== "checking" && <button onClick={() => handleBuy(purchase.row)}>ตรวจสอบอีกครั้ง</button>}
          <button onClick={() => setPurchase(null)} disabled={purchase.status === "checking"}>ปิด</button>
          {purchase.status === "available" && <p className="handoff-note">เปิดทรูในหน้านี้ หากยังไม่เห็นผล ให้กด “ค้นหาเบอร์” บนเว็บทรู</p>}
        </section>
      )}

      {loadError && <section className="card" role="alert">
        โหลดข้อมูลล่าสุดไม่ได้ {numbers.length > 0 ? "กำลังแสดงข้อมูลที่โหลดไว้ก่อนหน้า" : ""}
        <button onClick={() => { setLoadingData(!numbers.length); setReloadKey(key => key + 1); }}>ลองโหลดใหม่</button>
      </section>}

      {lastmod && (
        <section className="livebar card">
          <span className="status-dot" aria-hidden="true"></span>
          <div className="live-copy">
            <div className="live-title">
              อัปเดตล่าสุด <time dateTime={lastmod}>{fmtFileTime(lastmod)}</time>
            {snapshotStale ? " — ข้อมูลเกิน 8 ชั่วโมง" : ""}
            </div>
            <p>รวบรวมใหม่ทุก 6 ชั่วโมง · เช็กสถานะกับทรูก่อนจองทุกครั้ง</p>
          </div>
        </section>
      )}

      {loadingData ? (
        <div className="center">กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          <section className="filters card" aria-label="ค้นหาเบอร์">
            <div className="section-head">
              <div>
                <span className="section-index">01</span>
                <h2>ค้นหาเบอร์ที่ใช่</h2>
              </div>
              <p>กรอกเฉพาะเงื่อนไขที่ต้องการ ระบบจะคัดผลลัพธ์ทันที</p>
            </div>
            <div className="searchbar">
              <div className="search-row">
                <label className="field"><span>เลขท้าย</span>
                <input
                  className="search-input"
                  aria-label="เลขท้าย"
                  placeholder="เช่น 888"
                  value={filters.ends || ""}
                  onChange={e => setFilters({ ...filters, ends: e.target.value })}
                />
                </label>
                <label className="field"><span>ตัวเลขที่ต้องการ</span>
                <input
                  className="search-input"
                  aria-label="ตัวเลขที่ต้องการ"
                  placeholder="เช่น 8, 9"
                  value={filters.include || ""}
                  onChange={e => setFilters({ ...filters, include: e.target.value })}
                />
                </label>
                <label className="field"><span>ตัวเลขที่ไม่ต้องการ</span>
                <input
                  className="search-input"
                  aria-label="ตัวเลขที่ไม่ต้องการ"
                  placeholder="เช่น 4"
                  value={filters.exclude || ""}
                  onChange={e => setFilters({ ...filters, exclude: e.target.value })}
                />
                </label>
                <label className="field"><span>รูปแบบเบอร์</span>
                <input
                  className="search-input"
                  aria-label="รูปแบบเบอร์"
                  placeholder="เช่น 0658XXXXXX"
                  value={filters.mask || ""}
                  onChange={e => setFilters({ ...filters, mask: e.target.value })}
                />
                </label>
                <label className="field"><span>ลำดับตัวเลข</span>
                <input
                  className="search-input"
                  aria-label="ลำดับตัวเลข"
                  placeholder="เช่น 54321"
                  value={filters.seq || ""}
                  onChange={e => setFilters({ ...filters, seq: e.target.value })}
                />
                </label>
              </div>
              <div className="search-actions">
                <select aria-label="ระดับเลขซ้ำ" className="filter-select" value={filters.minrun || ""} onChange={e => setFilters({ ...filters, minrun: e.target.value })}>
                  <option value="">ซ้ำเลขทุกระดับ</option>
                  <option value="2">มีเลขคู่ (88)</option>
                  <option value="3">มีเลขตอง (888)</option>
                  <option value="4">มีเลขสี่ตัว (8888)</option>
                </select>
                <select aria-label="ราคาแพ็กเกจ" className="filter-select" value={filters.price || ""} onChange={e => setFilters({ ...filters, price: e.target.value })}>
                  <option value="">ราคาทั้งหมด</option>
                  <option value="under500">ต่ำกว่า 500</option>
                  <option value="under1000">ต่ำกว่า 1,000</option>
                  <option value="under1500">ต่ำกว่า 1,500</option>
                </select>
                <button className="btn" onClick={() => { setFilters({}); }}>ล้างค่า</button>
                <button className={showFavs ? "btn active" : "btn"} onClick={() => setShowFavs(!showFavs)}>
                  {showFavs ? "แสดงทั้งหมด" : "เบอร์ที่บันทึก"}
                </button>
              </div>
            </div>

            <div className="quick-row">
              <span className="quick-label">ค้นหาด่วน</span>
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

            <div className="sort-row">
              <label htmlFor="sort-order">เรียงตาม</label>
              <select id="sort-order" value={sort} onChange={e => setSort(e.target.value)}>
                <option value="repeat">เลขซ้ำมากที่สุด</option>
                <option value="memorable">จำง่าย</option>
                <option value="rarity">รูปแบบหายาก</option>
                <option value="rare_mem">หายากและจำง่าย</option>
                <option value="value">คะแนนต่อราคา</option>
                <option value="price">ราคาต่ำสุด</option>
              </select>
              <button className="random" onClick={randomPickClick}>สุ่มหนึ่งเบอร์</button>
            </div>
          </section>

          {randomPick && (
            <section className="card random-card">
              <span className="quick-label">เบอร์สุ่ม</span> <span className="num big">{fmtNum(randomPick.msisdn)}</span> — {randomPick.price_baht_month}฿/เดือน
              <button disabled={purchase?.status === "checking"} onClick={() => handleBuy(randomPick)}>เช็กเบอร์</button>
            </section>
          )}

          <section className="results">
            <div className="results-head">
              <div>
                <span className="section-index">02</span>
                <h2>เบอร์ที่พบ</h2>
              </div>
            </div>
            <div className="count">
              <strong>{results.length.toLocaleString()} <span>เบอร์</span></strong>
              {sampleFetchedAt && (
                <span className="updated">ดึงตัวอย่างเบอร์ล่าสุด {fmtFileTime(sampleFetchedAt)} (ไม่ใช่ทั้งรายการ)</span>
              )}
              <button
                className="refresh-btn"
                onClick={() => refreshData(false)}
                disabled={refreshing}
                title="ดึงตัวอย่างเบอร์ล่าสุดเพิ่มเติมจากทรู"
              >
                {refreshing ? "กำลังอัปเดต…" : "ดึงเบอร์ล่าสุด"}
              </button>
            </div>
            <div className="table-scroll">
            <table>
              <thead>
                <tr><th>หมายเลข</th><th>แพ็กเกจ / เดือน</th><th>แพทเทิร์น</th><th title="คะแนนรูปแบบเพื่อช่วยเปรียบเทียบ ไม่ใช่คำทำนาย">คะแนนจำง่าย</th><th></th><th></th></tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.msisdn}>
                    <td className="num">{fmtNum(r.msisdn)}</td>
                    <td className="price">{r.price_baht_month.toLocaleString()} <span>บาท</span></td>
                    <td className="runs">{runsOf(r.msisdn) || "-"}</td>
                    <td className="score">{memorableScore(r.msisdn)}</td>
                    <td>
                      <button className="buy" disabled={purchase?.status === "checking"}
                        aria-label={`ตรวจสอบเบอร์ ${fmtNum(r.msisdn)} ก่อนซื้อ`}
                        onClick={() => handleBuy(r)}>
                        เช็กเบอร์
                      </button>
                    </td>
                    <td>
                      <button
                        className={favorites[r.msisdn] ? "fav on" : "fav"}
                        aria-pressed={Boolean(favorites[r.msisdn])}
                        aria-label={`${favorites[r.msisdn] ? "ลบเบอร์โปรด" : "บันทึกเบอร์โปรด"} ${fmtNum(r.msisdn)}`}
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
            </div>
            {!results.length && <p role="status" className="empty">ไม่พบเบอร์ที่ตรงเงื่อนไข ลองล้างตัวกรองหรือโหลดข้อมูลใหม่</p>}
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

