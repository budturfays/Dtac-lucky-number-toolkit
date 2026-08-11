"""
buy_worker.py — process the buy queue with a real (headed) browser.

Reads numbers from buy_queue.txt (one 10-digit number per line) and, for each,
drives a Chromium window through True's store: opens the right pool listing,
auto-fills the 9 position boxes, clicks "ค้นหาเบอร์", finds the exact number
card, clicks "เลือก", and lands on the offer page (/lucky-number-offer) where
the number is reserved. The browser is left OPEN so you can finish the checkout.

This is the "background" half of the click-to-buy flow:

    web app (lucky-number-th.web.app)
        -> POST http://localhost:8765/buy   (buy_bridge.py)
        -> appends to buy_queue.txt
        -> this worker picks it up and drives the browser

Usage:
  python buy_worker.py                   # process everything currently queued once
  python buy_worker.py --watch           # poll buy_queue.txt every 5s, forever
  python buy_worker.py --max 2           # up to 2 browser windows at once
  python buy_worker.py --close-after 20  # auto-close the browser 20s after selecting
  python buy_worker.py --headless        # run without a visible window (for testing)

Files:
  buy_queue.txt      numbers waiting to be bought (appended by buy_bridge.py)
  buy_processed.log  history: timestamp, msisdn, status (selected/failed)
  buy_worker.log     this worker's run log
"""
import argparse
import logging
import os
import sys
import threading
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)  # lucky.py reads its CSVs from the working directory
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# Reuse the pool-page mapping / pool guessing from lucky.py when possible.
_FALLBACK_POOLS = {
    "rahu": "https://store.true.th/lucky-number/postpaid/funtong-phrarahu",
    "universal": "https://store.true.th/lucky-number/postpaid/somjade?type=all&priceplan=all",
    "khanthep": "https://store.true.th/lucky-number/postpaid/funtong-khanthep?type=all&priceplan=all",
    "naga": "https://store.true.th/lucky-number/postpaid/funtong-bernaga?priceplan=all",
    "ajchang": "https://store.true.th/lucky-number/postpaid/morchang-personalize?type=all&priceplan=all",
    "emperor": "https://store.true.th/lucky-number/postpaid/morchang-emperor?type=all&priceplan=all",
}
_FALLBACK_NAMES = {"universal": "พลังดาว", "rahu": "ฟันธงพระราหู", "khanthep": "ฟันธงขั้นเทพ",
                   "naga": "ฟันธงนาคราช", "ajchang": "เฉพาะคุณ/ตอง", "emperor": "จักรพรรดิ"}

try:
    from lucky import POOL_PAGES, POOL_NAMES, guess_pool, fmt_num, load_all  # noqa: F401
except Exception:
    POOL_PAGES = dict(_FALLBACK_POOLS)
    POOL_NAMES = dict(_FALLBACK_NAMES)
    guess_pool = lambda msisdn: "universal"  # noqa: E731
    fmt_num = lambda m: f"{m[:3]} {m[3:6]} {m[6:]}" if len(m) == 10 else m  # noqa: E731

    def load_all():  # noqa: E811
        return []

QUEUE_FILE = os.path.join(HERE, "buy_queue.txt")
PROCESSED_FILE = os.path.join(HERE, "buy_processed.log")
LOG_FILE = os.path.join(HERE, "buy_worker.log")
LOCK_FILE = os.path.join(HERE, "buy_worker.lock")

_log = logging.getLogger("buy_worker")
_open_browsers = []
_browsers_lock = threading.Lock()
_stop = threading.Event()  # set on Ctrl+C so open browsers get closed cleanly


# ── logging ─────────────────────────────────────────────────────────────────
def setup_logging():
    _log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    _log.addHandler(fh)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    _log.addHandler(sh)
    _log.propagate = False


# ── queue files ─────────────────────────────────────────────────────────────
def read_queue():
    """Pending 10-digit numbers, in order, skipping anything already handled."""
    seen = processed_set()
    pending = []
    if not os.path.exists(QUEUE_FILE):
        return []
    with open(QUEUE_FILE, encoding="utf-8") as f:
        for line in f:
            m = line.strip()
            if m.isdigit() and len(m) == 10 and m not in seen and m not in pending:
                pending.append(m)
    return pending


def clear_claimed(pending):
    """Drop the claimed numbers from the queue file (they move to the worker)."""
    claimed = set(pending)
    if not os.path.exists(QUEUE_FILE) or not claimed:
        return
    with open(QUEUE_FILE, encoding="utf-8") as f:
        lines = f.read().splitlines()
    keep = [l for l in lines if l.strip() not in claimed]
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(keep) + ("\n" if keep else ""))


def processed_set():
    seen = set()
    if not os.path.exists(PROCESSED_FILE):
        return seen
    with open(PROCESSED_FILE, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2:
                seen.add(parts[1])
    return seen


def append_processed(msisdn, status):
    with open(PROCESSED_FILE, "a", encoding="utf-8") as f:
        f.write("%s\t%s\t%s\n" % (
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msisdn, status))


# ── offer-page completion (after เลือก on the card) ─────────────────────────
def _dismiss_popups(page):
    """Close any visible dialog/overlay/popup that would block the offer page."""
    try:
        page.evaluate("""() => {
            const selectors = '[role=dialog], .modal, [class*=popup], [class*=modal], [class*=overlay]';
            const els = [...document.querySelectorAll(selectors)].filter(e => e.offsetParent !== null);
            for (const e of els) {
                // click a close button inside if present
                const close = e.querySelector('button[class*=close], [aria-label*=close], [aria-label*=ปิด]');
                if (close) { close.click(); continue; }
                // or just the cookie accept button
                const accept = e.querySelector('#onetrust-accept-btn-handler, [id*=accept]');
                if (accept) accept.click();
            }
            return els.length;
        }""")
    except Exception:
        pass


def _select_sim(page):
    """Click the SIM type card (eSIM preferred, else ซิมการ์ด). Returns chosen text."""
    return page.evaluate("""() => {
        const divs = [...document.querySelectorAll('div')].filter(d => {
            const t = (d.innerText||'').trim();
            return /^(eSIM|ซิมการ์ด)/.test(t) && t.length < 60 && !d.querySelector('input,button');
        });
        divs.sort((a,b) => (a.innerText||'').length - (b.innerText||'').length);
        const card = divs.find(d => /eSIM/i.test(d.innerText||'')) || divs[0];
        if (card) { card.click(); return card.innerText.replace(/\\s+/g,' ').trim(); }
        return null;
    }""")


def _pick_cheapest_package(page):
    """Click the 'เลือก' button on the package card with the lowest price.
    Returns the chosen price or None."""
    return page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')].filter(b => (b.innerText||'').trim() === 'เลือก');
        let best = null;
        for (const b of btns) {
            let n = b, depth = 0, cardText = '';
            while (n && depth < 6) {
                const t = (n.innerText||'').replace(/\\s+/g,' ');
                if (/บาท/.test(t) && t.length < 300) { cardText = t; break; }
                n = n.parentElement; depth++;
            }
            const m = cardText.match(/([\\d,]+)\\s*บาท/);
            if (!m) continue;
            const price = parseInt(m[1].replace(/,/g,''));
            if (!best || price < best.price) best = {price, btn: b};
        }
        if (best) { best.btn.click(); return best.price; }
        return null;
    }""")


def _check_terms_and_focus_id(page):
    """On /verify: tick the consent checkbox if present and not checked,
    and focus the national-ID field so the user just types it.
    Returns the field placeholder if found."""
    return page.evaluate("""() => {
        // consent checkbox
        const cbs = [...document.querySelectorAll('input[type=checkbox]')];
        for (const cb of cbs) {
            if (cb.checked === false && cb.offsetParent !== null &&
                !/ot-|category|cookie/i.test(cb.id + ' ' + (cb.name||''))) {
                cb.click();
                break;
            }
        }
        // national-ID field
        const idField = [...document.querySelectorAll('input')].find(
            e => (e.placeholder||'').includes('บัตรประชาชน'));
        if (idField) { idField.focus(); return idField.placeholder; }
        return null;
    }""")


# ── single-number browser flow ──────────────────────────────────────────────
def _register(browser):
    with _browsers_lock:
        _open_browsers.append(browser)


def _unregister(browser):
    with _browsers_lock:
        if browser in _open_browsers:
            _open_browsers.remove(browser)


def _close_all_browsers():
    with _browsers_lock:
        browsers = list(_open_browsers)
    for b in browsers:
        try:
            b.close()
        except Exception:
            pass


def select_number(msisdn, headless=False, close_after=0, phase_done=None):
    """Drive a headed browser to select `msisdn` on True's site.

    The browser is left open on the offer page so the user can complete the
    checkout. `phase_done` (a threading.Event) is set as soon as the number has
    been selected (or clearly failed), so the worker can move on to the next
    queued number without waiting for the user to close the window.
    """
    pool = guess_pool(msisdn)
    page_url = POOL_PAGES.get(pool) or POOL_PAGES["universal"]
    digits = msisdn[1:]  # 9 position digits; leading 0 is fixed by the site
    _log.info("Opening %s (%s) to auto-select %s ...", page_url,
              POOL_NAMES.get(pool, pool), msisdn)
    from playwright.sync_api import sync_playwright
    browser = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            _register(browser)
            try:
                ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
                page = ctx.new_page()
                page.goto(page_url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(6000)
                # dismiss cookie banner if present
                try:
                    page.locator("#onetrust-accept-btn-handler").first.click(timeout=3000)
                    page.wait_for_timeout(1000)
                except Exception:
                    pass
                boxes = page.locator("input.numberPosition")
                if boxes.count() < 10:
                    _log.error("position boxes not found — select %s manually in the window",
                               msisdn)
                    result = False
                else:
                    # Inject the 9 digits directly via the native value setter +
                    # input/change events in ONE evaluate call (no per-box typing).
                    injected = page.evaluate("""(digits) => {
                        const inputs = [...document.querySelectorAll('input.numberPosition')];
                        if (inputs.length < 10) return false;
                        const setter = Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype, 'value').set;
                        for (let i = 0; i < 9; i++) {
                            const box = inputs[i + 1]; // box 0 = fixed leading 0
                            setter.call(box, digits[i]);
                            box.dispatchEvent(new Event('input', { bubbles: true }));
                            box.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                        return true;
                    }""", digits)
                    if not injected:
                        _log.error("could not inject digits for %s — select manually",
                                   msisdn)
                        result = False
                    page.wait_for_timeout(500)
                    # exact text match: other "ค้นหาเบอร์ฟันธง..." buttons are CTA
                    # links that would redirect away from the listing
                    page.get_by_role("button", name="ค้นหาเบอร์", exact=True).first.click()
                    try:
                        page.wait_for_selector(".number-card", timeout=20000)
                    except Exception:
                        pass
                    page.wait_for_timeout(2000)
                    cards = page.locator(".number-card")
                    result = False
                    for i in range(cards.count()):
                        text = "".join(c for c in cards.nth(i).inner_text() if c.isdigit())
                        if text[:10] == msisdn:
                            cards.nth(i).locator("button", has_text="เลือก").first.click()
                            result = True
                            break
                    page.wait_for_timeout(5000)
                    if result:
                        _log.info("✅ SELECTED %s — browser on: %s", msisdn, page.url)
                        # Hand off to the user on the offer page: dismiss popups
                        # only, then LEAVE the window visible so the user picks
                        # SIM type / promo / package themselves.
                        _dismiss_popups(page)
                        _log.info("  Offer page ready — window is VISIBLE so you can "
                                  "pick SIM type + promo + package yourself.")
                        _log.info("  (Automation stopped here by design: promo/SIM/package "
                                  "selection is manual.)")
                    else:
                        _log.error("card for %s not found (%d shown) — may be "
                                   "unavailable, select manually in the window",
                                   msisdn, cards.count())
            finally:
                _unregister(browser)
            if phase_done:
                phase_done.set()
            if result:
                if close_after > 0:
                    _log.info("auto-closing browser in %ds (--close-after)", close_after)
                    for _ in range(close_after):
                        if _stop.is_set():
                            break
                        time.sleep(1)
                else:
                    while browser.is_connected() and not _stop.is_set():
                        time.sleep(1)
                    _log.info("browser for %s closed by user", msisdn)
            else:
                _log.info("nothing selected for %s — closing its browser in 10s", msisdn)
                for _ in range(10):
                    if _stop.is_set():
                        break
                    time.sleep(1)
            return result
    except KeyboardInterrupt:
        raise
    except Exception as e:
        _log.error("browser error for %s: %s", msisdn, e)
        try:
            if browser:
                browser.close()
        except Exception:
            pass
        return False


def _job(msisdn, headless, close_after, phase_done):
    try:
        ok = select_number(msisdn, headless=headless, close_after=close_after,
                           phase_done=phase_done)
        append_processed(msisdn, "selected" if ok else "failed")
    except Exception as e:
        _log.error("unexpected error for %s: %s", msisdn, e)
        append_processed(msisdn, "error")
        try:
            phase_done.set()
        except Exception:
            pass


def _wait_any_phase(active):
    for item in list(active):
        msisdn, evt = item
        if evt.is_set():
            active.remove(item)


def run_once(max_workers=1, headless=False, close_after=0):
    pending = read_queue()
    if not pending:
        _log.info("queue is empty — nothing to do")
        return
    _log.info("processing %d queued number(s): %s", len(pending), ", ".join(pending))
    clear_claimed(pending)
    active = []  # (msisdn, phase_done_event) for threads whose browser is live

    def start(m):
        evt = threading.Event()
        # non-daemon: the process must stay alive while a browser is open so the
        # user can complete the checkout after the worker has moved on
        t = threading.Thread(target=_job, args=(m, headless, close_after, evt))
        t.start()
        active.append((m, evt))

    idx = 0
    while idx < len(pending):
        while active and len(active) >= max_workers:
            _wait_any_phase(active)
            if len(active) >= max_workers:
                time.sleep(0.5)
        start(pending[idx])
        idx += 1
    # wait until every job has finished its selection phase
    while active:
        _wait_any_phase(active)
        time.sleep(0.5)
    _log.info("all queued numbers handed to browsers — %d browser window(s) may "
              "still be open for checkout", len(pending))


# ── single-instance guard ───────────────────────────────────────────────────
def _acquire_lock():
    try:
        fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL)
        os.close(fd)
        return True
    except FileExistsError:
        # stale lock (left over from a crash > 1h ago)? break it.
        try:
            if time.time() - os.path.getmtime(LOCK_FILE) > 3600:
                os.remove(LOCK_FILE)
                fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL)
                os.close(fd)
                return True
        except Exception:
            pass
        return False


def _release_lock():
    try:
        os.remove(LOCK_FILE)
    except OSError:
        pass


# ── main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(
        description="Process buy_queue.txt with a real (headed) browser on True's site.")
    ap.add_argument("--watch", action="store_true",
                    help="keep running, polling the queue every --poll seconds")
    ap.add_argument("--poll", type=int, default=5,
                    help="seconds between queue checks in watch mode (default 5)")
    ap.add_argument("--max", type=int, default=1, dest="max_workers",
                    help="max browsers selecting at once (default 1)")
    ap.add_argument("--close-after", type=int, default=0,
                    help="auto-close the browser N seconds after selecting (0 = keep open)")
    ap.add_argument("--headless", action="store_true",
                    help="run without a visible browser window (testing only)")
    args = ap.parse_args()

    setup_logging()
    try:
        load_all()  # populate lucky.py's pool data so guess_pool works
    except Exception:
        pass

    if not _acquire_lock():
        _log.error("another buy_worker seems to be running (%s exists) — exit",
                   LOCK_FILE)
        return 1

    _log.info("queue: %s | processed log: %s", QUEUE_FILE, PROCESSED_FILE)
    try:
        if args.watch:
            _log.info("watch mode: polling %s every %ds — Ctrl+C to stop",
                      QUEUE_FILE, args.poll)
            while True:
                run_once(args.max_workers, args.headless, args.close_after)
                time.sleep(args.poll)
        else:
            run_once(args.max_workers, args.headless, args.close_after)
            _log.info("done")
        return 0
    except KeyboardInterrupt:
        _log.info("stopping — closing any open browsers")
        _stop.set()
        _close_all_browsers()
        return 0
    finally:
        _release_lock()


if __name__ == "__main__":
    sys.exit(main())
