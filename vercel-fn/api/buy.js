/**
 * Vercel serverless function — POST /api/buy {"msisdn": "0954321133", "pool": "universal"}
 *
 * Drives a headless Chromium browser (playwright-core + @sparticuz/chromium) to
 * auto-select a Thai lucky number on True's store — the exact flow from
 * buy_worker.py:
 *   1. open the pool's listing page (POOL_PAGES)
 *   2. inject the 9 position digits into input.numberPosition boxes
 *      (native value setter + input/change events in ONE evaluate call)
 *   3. click "ค้นหาเบอร์" (exact text match)
 *   4. wait for .number-card, find the exact card, click its "เลือก" button
 *   5. land on /lucky-number-offer where the number is reserved
 *
 * Returns {"ok": true, "offerUrl", "msisdn"} or {"ok": false, "error"}.
 * CORS is wide open so the Firebase-hosted web app can call it cross-origin.
 *
 * Runtime: Node.js 20 (Vercel Functions). The @sparticuz/chromium binary is
 * Linux-only — on Vercel that's fine. For local runs set CHROMIUM_PATH to a
 * local Chromium (see README.md).
 */
// @sparticuz/chromium >= 149 is ESM-only; load it lazily via dynamic import()
// from this CommonJS module (plain require() throws ERR_REQUIRE_ESM).
let _chromiumPromise;
function loadChromium() {
  if (!_chromiumPromise) {
    _chromiumPromise = import("@sparticuz/chromium").then((m) => m.default || m);
  }
  return _chromiumPromise;
}
const { chromium: playwright } = require("playwright-core");

// Mirror of buy_worker.py / lucky.py POOL_PAGES.
const POOL_PAGES = {
  rahu: "https://store.true.th/lucky-number/postpaid/funtong-phrarahu",
  universal:
    "https://store.true.th/lucky-number/postpaid/somjade?type=all&priceplan=all",
  khanthep:
    "https://store.true.th/lucky-number/postpaid/funtong-khanthep?type=all&priceplan=all",
  naga: "https://store.true.th/lucky-number/postpaid/funtong-bernaga?priceplan=all",
  ajchang:
    "https://store.true.th/lucky-number/postpaid/morchang-personalize?type=all&priceplan=all",
  emperor:
    "https://store.true.th/lucky-number/postpaid/morchang-emperor?type=all&priceplan=all",
};

const MSISDN_RE = /^\d{10}$/;
const DEFAULT_POOL = "universal";
const MAX_WALL_MS = 55000; // stay under Vercel Hobby's 60s wall-time limit

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function resolveExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  // Only call @sparticuz/chromium on Linux (Vercel). It throws on other OSes.
  const chromium = await loadChromium();
  return chromium.executablePath();
}

async function launchBrowser() {
  const chromium = await loadChromium();
  const executablePath = await resolveExecutable();
  return playwright.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
}

/**
 * Race `promise` against a hard deadline. `onTimeout` lets the caller clean up
 * (e.g. close the browser) so nothing leaks if we must return before the flow
 * finishes.
 */
function withDeadline(promise, ms, onTimeout) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout && onTimeout();
      } catch (_) {
        /* cleanup best-effort */
      }
      reject(new Error("deadline exceeded"));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * One full select-number run, mirroring buy_worker.py:select_number exactly
 * (digit injection in one evaluate via the native value setter, exact "ค้นหาเบอร์"
 * click, digits-only card comparison, "เลือก" click).
 */
async function selectNumber(msisdn, pool) {
  const pageUrl = POOL_PAGES[pool] || POOL_PAGES[DEFAULT_POOL];
  const digits = msisdn.slice(1); // box 0 is the fixed leading 0

  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Dismiss the cookie banner if present.
    try {
      await page.locator("#onetrust-accept-btn-handler").first().click({ timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch (_) {
      /* no banner — fine */
    }

    // Wait for the position boxes (React hydrate) instead of a fixed 6s sleep.
    await page.waitForSelector("input.numberPosition", { timeout: 15000 });
    await page.waitForTimeout(500);

    const injected = await page.evaluate(
      (d) => {
        const inputs = [...document.querySelectorAll("input.numberPosition")];
        if (inputs.length < 10) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        for (let i = 0; i < 9; i++) {
          const box = inputs[i + 1]; // box 0 = fixed leading 0
          setter.call(box, d[i]);
          box.dispatchEvent(new Event("input", { bubbles: true }));
          box.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      },
      digits
    );
    if (!injected) {
      throw new Error("could not inject digits — input.numberPosition layout changed");
    }

    // Exact text match: other "ค้นหาเบอร์..." elements are CTA links that
    // would redirect away from the listing.
    await page.getByRole("button", { name: "ค้นหาเบอร์", exact: true }).first().click();

    try {
      await page.waitForSelector(".number-card", { timeout: 15000 });
    } catch (_) {
      /* fall through — count what's there */
    }
    await page.waitForTimeout(1500);

    const cards = page.locator(".number-card");
    let clicked = false;
    for (let i = 0; i < (await cards.count()); i++) {
      const text = (await cards.nth(i).innerText()).replace(/\D/g, "");
      if (text.slice(0, 10) === msisdn) {
        await cards.nth(i).locator("button", { hasText: "เลือก" }).first().click();
        clicked = true;
        break;
      }
    }

    // Give the SPA time to route to the offer page (it can first update the
    // listing URL with a ?specify=<9-digits> param, then navigate).
    try {
      await page.waitForURL(/lucky-number-offer/, { timeout: 8000 });
    } catch (_) {
      /* stayed on listing — still report what we got */
    }
    await page.waitForTimeout(1000);

    return {
      ok: clicked,
      offerUrl: page.url(),
      msisdn,
      pool: POOL_PAGES[pool] ? pool : DEFAULT_POOL,
      onOfferPage: page.url().includes("/lucky-number-offer"),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function handleBuy(msisdn, pool) {
  return withDeadline(
    selectNumber(msisdn, pool),
    MAX_WALL_MS,
    () => {
      /* browser closed by selectNumber's finally when the race resolves */
    }
  );
}

function sendJson(res, status, payload) {
  cors(res);
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    // GET is handy for a quick health check after deploy.
    sendJson(res, 200, {
      ok: true,
      service: "lucky-number-buy",
      usage: "POST /api/buy with JSON body { msisdn: '0954321133', pool?: 'universal' }",
      pools: Object.keys(POOL_PAGES),
    });
    return;
  }

  let body = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body);
    else if (Buffer.isBuffer(body)) body = JSON.parse(body.toString("utf-8") || "{}");
  } catch (_) {
    sendJson(res, 400, { ok: false, error: "invalid JSON body" });
    return;
  }
  body = body || {};

  const msisdn = String(body.msisdn || "").trim();
  if (!MSISDN_RE.test(msisdn)) {
    sendJson(res, 400, { ok: false, error: "msisdn must be exactly 10 digits" });
    return;
  }
  const pool = String(body.pool || "").trim().toLowerCase() || DEFAULT_POOL;

  try {
    const result = await handleBuy(msisdn, pool);
    if (result.ok) {
      sendJson(res, 200, result);
    } else {
      sendJson(res, 404, {
        ok: false,
        error: "number not found in search results (may be unavailable/sold)",
        msisdn,
        pool: result.pool,
      });
    }
  } catch (e) {
    sendJson(res, 502, {
      ok: false,
      error: e && e.message ? e.message : String(e),
      msisdn,
      pool,
    });
  }
};
