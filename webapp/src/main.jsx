import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase.js";
import "./styles.css";

// ── SEO (runtime metadata; static tags live in index.html) ────────────────
const SEO_TITLE = "เบอร์มงคล Finder – ค้นหาเบอร์สวยและเบอร์มงคล";
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

// ── FAQ content (mirrored in the JSON-LD FAQPage in index.html) ───────────
const FAQS = [
  {
    q: "เบอร์มงคลคืออะไร?",
    a: "เบอร์มงคล คือหมายเลขโทรศัพท์ที่มีตัวเลขหรือแพทเทิร์นเป็นมงคลตามความเชื่อ เช่น เบอร์ตอง 888 เบอร์สี่ตัวท้าย 8888 หรือเลขลำดับ 1234 54321 โดยเชื่อว่าช่วยเสริมโชคลาภ การงาน การเงิน และความสำเร็จให้ผู้ใช้งาน",
  },
  {
    q: "ดูดวงเบอร์โทรศัพท์อย่างไร?",
    a: "การดูดวงเบอร์โทรศัพท์นิยมวิเคราะห์จากตัวเลขและแพทเทิร์นของเบอร์ เช่น เลข 8 สื่อถึงความมั่งคั่ง เลข 9 สื่อถึงความก้าวหน้า เลข 7 สื่อถึงความสำเร็จ ส่วนเบอร์ตองและเลขเรียงติดกันก็ถือเป็นเลขมงคลยอดนิยม อย่างไรก็ตามความหมายของเลขอาจต่างกันไปตามศาสตร์ตัวเลขที่ใช้",
  },
  {
    q: "เบอร์ตองคืออะไร?",
    a: "เบอร์ตอง คือเบอร์โทรศัพท์ที่มีตัวเลขซ้ำกันติดกันตั้งแต่ 2 ตัวขึ้นไป เช่น เบอร์ตอง 888 เบอร์ตอง 999 เบอร์ตอง 555 หรือ 9999 ยิ่งตัวเลขเยอะและติดกันยาว ราคายิ่งสูงและเป็นที่ต้องการของตลาดเบอร์มงคล",
  },
  {
    q: "ราคาเบอร์มงคลเท่าไหร่?",
    a: "ราคาเบอร์มงคลของทรูและดีแทคขึ้นอยู่กับความสวยและความหายากของแพทเทิร์น เบอร์ตอง 3 ตัวท้ายอาจเริ่มต้นไม่กี่ร้อยบาทต่อเดือน ส่วนเบอร์สี่ตัว 8888 หรือเบอร์ลำดับ 54321 อาจมีราคาหลายพันถึงหลายหมื่นบาทต่อเดือน ราคาอัปเดตสดบนเว็บไซต์",
  },
  {
    q: "ซื้อเบอร์มงคลทรูได้ที่ไหน?",
    a: "ซื้อเบอร์มงคลทรูและดีแทคได้ผ่านเบอร์มงคล Finder ซึ่งรวบรวมเบอร์มงคลจากทรูและดีแทคไว้ในที่เดียว ตรวจสอบแพทเทิร์น ราคา และกดซื้อได้ทันที",
  },
  {
    q: "วิธีเลือกเบอร์มงคล?",
    a: "เริ่มจากกำหนดเลขที่ต้องการ เช่น เลขท้าย 888 หรือหลีกเลี่ยงเลขที่ไม่ชอบ จากนั้นใช้ตัวกรองค้นหาเบอร์ที่ลงท้ายด้วยเลขที่ต้องการ มีเลขที่ต้องการ หรือไม่มีเลขที่ไม่ต้องการ แล้วเปรียบเทียบราคากับแพทเทิร์นก่อนตัดสินใจ",
  },
];

function FaqSection() {
  return (
    <section className="card faq" aria-label="คำถามที่พบบ่อยเกี่ยวกับเบอร์มงคล">
      <h2>คำถามที่พบบ่อย</h2>
      {FAQS.map(f => (
        <details key={f.q} className="faq-item">
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </section>
  );
}

// ── number utilities (mirror of lucky.py) ──────────────────────────────────
function fmtNum(m) {
  return m.length === 10 ? `${m.slice(0,3)} ${m.slice(3,6)} ${m.slice(6)}` : m;
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

function buyUrl(n) {
  const pools = (n.pools || n.pool || "universal").split(",");
  let pool = pools.find(p => POOL_PAGES[p] || POOL_PAGES[p.split("-")[0]]);
  if (!pool) return POOL_PAGES.universal;
  return POOL_PAGES[pool] ? POOL_PAGES[pool] : POOL_PAGES[pool.split("-")[0]];
}

// ── local buy bridge (auto-buy in the background on this PC) ───────────────
// The web app is a static site; the actual buying is done by buy_bridge.py +
// buy_worker.py running on the user's machine. If the bridge is not running,
// the buy button falls back to opening the listing page in a new tab.
const BRIDGE_URL = "http://localhost:8765";

function bridgeFetch(path, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  return fetch(`${BRIDGE_URL}${path}`, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
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
  const [live, setLive] = useState(null);
  const [bridge, setBridge] = useState("checking"); // checking | up | down

  // apply runtime SEO metadata once the app mounts
  useEffect(() => { applySeo(); }, []);

  // probe the local buy bridge (for the status pill + auto-buy button behavior)
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await bridgeFetch("/health");
        if (!cancelled) setBridge(r.ok ? "up" : "down");
      } catch (e) {
        if (!cancelled) setBridge("down");
      }
    };
    probe();
    const timer = setInterval(probe, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // buy click: POST to the local bridge so buy_worker.py injects the number
  // in a hidden browser, lands on the offer page, then SHOWS the window for
  // the user to pick SIM / promo / package manually.
  const handleBuy = useCallback((e, row) => {
    const msisdn = row?.msisdn;
    if (!msisdn) return;
    if (e) e.preventDefault();
    if (bridge === "up") {
      bridgeFetch("/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msisdn }),
      })
        .then(async r => {
          if (!r.ok) throw new Error(`bridge ${r.status}`);
          setNotice(`⏳ กำลังกรอกเบอร์ ${fmtNum(msisdn)} ... หน้าต่างจะเปิดขึ้นเพื่อให้คุณเลือกซิม/โปรโมชันเอง`);
        })
        .catch(() => {
          // bridge down → fall back to opening the listing page
          window.open(buyUrl(row), "_blank", "noopener");
          setNotice("บริดจ์ไม่ทำงาน — เปิดหน้าเบอร์แทน (รัน python buy_bridge.py บนเครื่องนี้)");
        });
    } else {
      // no bridge → just open the listing page
      window.open(buyUrl(row), "_blank", "noopener");
    }
  }, [bridge]);

  // buy-me-a-coffee: Thai modal with a PromptPay QR code
  const [coffeeOpen, setCoffeeOpen] = useState(false);

  // subscribe to live inventory data (RTDB)
  useEffect(() => {
    const liveRef = ref(db, "live");
    const off = onValue(liveRef, snap => setLive(snap.val()), err => { /* offline ok */ });
    return off;
  }, []);

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
        setNumbers(data);
        setLoadingData(false);
        setDataFetchedAt(new Date());
        const rarity = {};
        for (const n of data) {
          const key = rawStruct(n.msisdn).join(",");
          rarity[key] = (rarity[key] || 0) + 1;
        }
        for (const k of Object.keys(rarity)) STRUCT_RARITY[k] = rarity[k];
      } catch (e) {
        if (!cancelled) { setNotice("Failed to load dataset"); setLoadingData(false); }
      }
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000); // refetch every 5 min
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

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
          <h1>เบอร์มงคล Finder</h1>
          <span className="sub">ค้นหาเบอร์มงคล • บันทึกเบอร์โปรดอัตโนมัติในเบราว์เซอร์</span>
        </div>
        <span
          className={`bridge ${bridge}`}
          title={bridge === "up"
            ? "ซื้ออัตโนมัติพร้อมใช้งาน (บริดจ์บนเครื่องนี้)"
            : bridge === "down"
              ? "บริดจ์ออฟไลน์ — ปุ่มซื้อจะเปิดแท็บตามปกติ"
              : "กำลังตรวจสอบบริดจ์..."}
        >
          {bridge === "up" ? "⚡ ซื้ออัตโนมัติ: พร้อม"
            : bridge === "down" ? "ซื้ออัตโนมัติ: ปิด"
            : "ตรวจสอบ..."}
        </span>
        <button className="coffee" onClick={() => setCoffeeOpen(true)} title="ซื้อกาแฟให้ผู้พัฒนา ☕">☕ ซื้อกาแฟให้</button>
      </header>

      {coffeeOpen && (
        <div className="coffee-modal" onClick={() => setCoffeeOpen(false)}>
          <div className="card" onClick={e => e.stopPropagation()}>
            <h3>☕ ซื้อกาแฟให้ผู้พัฒนา</h3>
            <div className="qr-placeholder">
              [ QR พร้อมเพย์ ]<br />
              ใส่ PromptPay ID ที่นี่
            </div>
            <p>
              สแกน QR พร้อมเพย์ เพื่อส่งกำลังใจให้ผู้พัฒนา<br />
              ขอบคุณที่ใช้เบอร์มงคล Finder! 🙏
            </p>
            <button onClick={() => setCoffeeOpen(false)}>ปิด</button>
          </div>
        </div>
      )}

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      {live && (
        <section className="livebar card">
          <div className="live-title">
            <span className="live-dot" /> สดจากทรู — อัปเดต {live.updatedAt || "..."}
          </div>
          <div className="live-pools">
            {live.pools && Object.values(live.pools).map(p => (
              <span key={p.name} className="pool-chip">
                {p.name}: <b>{p.total != null ? p.total.toLocaleString() : "?"}</b>
              </span>
            ))}
          </div>
          {live.memorable && live.memorable.length > 0 && (
            <div className="live-mem">
              <span className="live-mem-label">มีเบอร์เด็ดตอนนี้:</span>
              {live.memorable.slice(0, 5).map(m => (
                <span key={m.msisdn} className="mem-chip">{fmtNum(m.msisdn)}</span>
              ))}
            </div>
          )}
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
              <button className={!filters.ends && !filters.minrun && !filters.seq && !filters.mask && !filters.include && !filters.exclude && !filters.price && !showFavs && sort === "repeat" ? "chip on" : "chip"} onClick={() => setQuick({})}>ทั้งหมด</button>
              <button className="chip" onClick={() => setQuick({ ends: "888" })}>จบ 888</button>
              <button className="chip" onClick={() => setQuick({ minrun: "3" })}>ตอง 888</button>
              <button className="chip" onClick={() => setQuick({ minrun: "4" })}>สี่ตัว 8888</button>
              <button className="chip" onClick={() => setQuick({ seq: "54321" })}>54321</button>
              <button className="chip" onClick={() => setQuick({ seq: "1234" })}>1234</button>
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
                  (รีเฟรชอัตโนมัติทุก 5 นาที)
                </span>
              )}
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
                        title={bridge === "up"
                          ? "ซื้ออัตโนมัติผ่านเครื่องนี้ (ประมวลผลในเบราว์เซอร์)"
                          : "เปิดหน้าเบอร์"}
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

      <FaqSection />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
