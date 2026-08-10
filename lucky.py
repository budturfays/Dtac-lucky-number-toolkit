"""
lucky.py — ONE tool for everything lucky-number.

Just run:  python lucky.py

Includes:
  1. Find numbers     - repeats, memorable, patterns, mask, digits, value, random, exact
  2. Watch & check    - availability of specific numbers + scan for new memorable finds
  3. Update dataset   - refresh the local pool from True's API (quick or full)
  4. My numbers       - add/remove your own numbers (my_numbers.csv)
  5. Stats & info     - dataset overview, how it works

Data files (auto-managed):
  all_numbers.csv    - master pool (number + price + pool tags)
  my_numbers.csv     - your own numbers
  watchlist.txt      - numbers you want to keep checking
"""
import argparse
import csv
import json
import os
import random
import re
import sys
import threading
import time
import uuid
import urllib.request
from collections import Counter
from datetime import datetime
from queue import Queue

# ── paths & constants ────────────────────────────────────────────────────────
CANDIDATES = ["all_numbers.csv", "numbers_prices.csv", "numbers_AAAA.csv",
              "numbers_universal.csv", "numbers_khanthep.csv", "numbers_naga.csv",
              "numbers_ajchang.csv", "numbers_emperor.csv"]
MY_FILE = "my_numbers.csv"
WATCH_FILE = "watchlist.txt"
SNAP_FILE = "watch_snapshot.json"
BASE = "https://store.true.th/api"
POOLS = ["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"]
POOL_NAMES = {"universal": "พลังดาว", "rahu": "ฟันธงพระราหู", "khanthep": "ฟันธงขั้นเทพ",
              "naga": "ฟันธงนาคราช", "ajchang": "เฉพาะคุณ/ตอง", "emperor": "จักรพรรดิ"}

DATA_PATH = None
ROWS = []


# ── data loading ─────────────────────────────────────────────────────────────
def find_datafile():
    for name in CANDIDATES:
        if os.path.exists(name):
            return name
    return None


def load(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_all():
    """Store numbers + my numbers, merged, deduped."""
    global DATA_PATH
    DATA_PATH = find_datafile()
    if DATA_PATH:
        rows = load(DATA_PATH)
    else:
        rows = []
    if os.path.exists(MY_FILE):
        seen = {r["msisdn"] for r in rows}
        for r in load(MY_FILE):
            if r.get("msisdn") not in seen:
                r["price_baht_month"] = r.get("price_baht_month") or ""
                r.setdefault("grade", "mine")
                rows.append(r)
                seen.add(r["msisdn"])
    return rows


# ── helpers ─────────────────────────────────────────────────────────────────
def fmt_num(m):
    return f"{m[:3]} {m[3:6]} {m[6:]}" if len(m) == 10 else m


def runs_of(m):
    out = []
    i, n = 0, len(m)
    while i < n:
        j = i
        while j < n and m[j] == m[i]:
            j += 1
        if j - i >= 2:
            out.append(m[i] * (j - i))
        i = j
    return " ".join(out)


def maxrun(m):
    best = cur = 1
    for i in range(1, len(m)):
        cur = cur + 1 if m[i] == m[i - 1] else 1
        best = max(best, cur)
    return best


def star_tuple(r):
    try:
        arr = json.loads(r.get("luckyTypes") or "[]")
        return tuple(t.get("star", 0) for t in arr)[:3] if arr else (0, 0, 0)
    except Exception:
        return (0, 0, 0)


STRUCT_RARITY = None


def _raw_struct(m):
    out = []
    i, n = 0, len(m)
    while i < n:
        j = i
        while j < n and m[j] == m[i]:
            j += 1
        if j - i >= 2:
            out.append(j - i)
        i = j
    return tuple(sorted(out, reverse=True))


def _ensure_rarity():
    global STRUCT_RARITY
    if STRUCT_RARITY is None and ROWS:
        STRUCT_RARITY = Counter(_raw_struct(r["msisdn"]) for r in ROWS)


def memorable_score(m):
    s = 0
    mr = maxrun(m)
    if mr >= 4:
        s += 10
    elif mr >= 3:
        s += 6
    elif mr >= 2:
        s += 3
    a = d = 1
    seq3 = False
    for i in range(1, len(m)):
        a = a + 1 if int(m[i]) == int(m[i - 1]) + 1 else 1
        d = d + 1 if int(m[i]) == int(m[i - 1]) - 1 else 1
        if a >= 4 or d >= 4:
            s += 8
            break
        if a == 3 or d == 3:
            seq3 = True
    else:
        if seq3:
            s += 4
    for i in range(len(m) - 3):
        if m[i] == m[i + 2] and m[i + 1] == m[i + 3] and m[i] != m[i + 1]:
            s += 3
            break
    if m.endswith("0000"):
        s += 6
    elif m.endswith("000"):
        s += 3
    return s


def memorable_reasons(m):
    out = []
    mr = maxrun(m)
    if mr >= 4:
        out.append("quad")
    elif mr >= 3:
        out.append("tong")
    elif mr >= 2:
        out.append("pair")
    a = d = 1
    for i in range(1, len(m)):
        a = a + 1 if int(m[i]) == int(m[i - 1]) + 1 else 1
        d = d + 1 if int(m[i]) == int(m[i - 1]) - 1 else 1
        if a >= 4 or d >= 4:
            out.append("seq4")
            break
    else:
        if a >= 3 or d >= 3:
            out.append("seq3")
    for i in range(len(m) - 3):
        if m[i] == m[i + 2] and m[i + 1] == m[i + 3] and m[i] != m[i + 1]:
            out.append("abab")
            break
    if m.endswith("0000"):
        out.append("0000")
    elif m.endswith("000"):
        out.append("000")
    return " ".join(out) if out else "-"


# ── input helpers ───────────────────────────────────────────────────────────
def _input(prompt=""):
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print("\nbye")
        sys.exit(0)


def ask_choice(question, options, allow_multi=False, extra=None):
    print()
    print(question)
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    if extra:
        for e in extra:
            print(f"  {e}")
    while True:
        raw = _input("> ")
        if raw in ("q", "quit", "exit"):
            return "QUIT"
        if raw == "":
            return None
        if allow_multi:
            idxs = []
            ok = True
            for part in raw.replace(",", " ").split():
                if not part.isdigit() or not (1 <= int(part) <= len(options)):
                    ok = False
                    break
                idxs.append(int(part))
            if ok and idxs:
                return [options[i - 1] for i in idxs]
        elif raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1]
        print(f"  please pick 1-{len(options)}" + (" (comma-sep ok)" if allow_multi else ""))


def ask_number(question, default=None):
    print()
    print(question)
    while True:
        raw = _input("> ").strip()
        if raw in ("q", "quit", "exit"):
            return "QUIT"
        if raw == "" and default is not None:
            return default
        if raw.isdigit():
            return int(raw)
        print("  please enter a number")


def ask_text(question, default=None):
    print()
    print(question)
    raw = _input("> ").strip()
    if raw in ("q", "quit", "exit"):
        return "QUIT"
    if raw == "" and default is not None:
        return default
    return raw


def paused():
    print()
    _input("  Press Enter to continue...")


def beep():
    try:
        print("\a", end="", flush=True)
    except Exception:
        pass


# ── filtering / display ─────────────────────────────────────────────────────
def apply_filters(rows, filters):
    out = []
    for r in rows:
        m = r["msisdn"]
        if filters.get("minrun") and maxrun(m) < filters["minrun"]:
            continue
        if filters.get("ends") and not m.endswith(filters["ends"]):
            continue
        if filters.get("seq") and filters["seq"] not in m:
            continue
        if filters.get("mask"):
            mask = filters["mask"].replace(" ", "").replace("-", "")
            if not all(ch in "Xx?*_" or m[i] == ch for i, ch in enumerate(mask)):
                continue
        if filters.get("include") and not all(d in m for d in filters["include"]):
            continue
        if filters.get("exclude") and any(d in m for d in filters["exclude"]):
            continue
        if filters.get("pmin") is not None:
            p = int(r["price_baht_month"]) if r["price_baht_month"] else 0
            if p < filters["pmin"] or p > filters["pmax"]:
                continue
        if filters.get("grade") and r.get("grade") != filters["grade"]:
            continue
        if filters.get("exact") and m != filters["exact"]:
            continue
        if filters.get("pool"):
            pools = set(p for p in (r.get("pools") or r.get("pool") or "").split(",") if p)
            if filters["pool"] not in pools:
                continue
        out.append(r)
    return out


def sort_rows(rows, sort):
    if sort == "repeat":
        return sorted(rows, key=lambda r: (maxrun(r["msisdn"]),
                                           sum(len(x) for x in runs_of(r["msisdn"]).split()) if runs_of(r["msisdn"]) else 0),
                      reverse=True)
    if sort == "rarity":
        _ensure_rarity()
        def key(r):
            st = _raw_struct(r["msisdn"])
            if not st:
                return (10 ** 9, 0, 0)
            return (STRUCT_RARITY.get(st, 10 ** 9), -len(st), -sum(st))
        return sorted(rows, key=key)
    if sort == "memorable":
        return sorted(rows, key=lambda r: memorable_score(r["msisdn"]), reverse=True)
    if sort == "value":
        return sorted(rows, key=lambda r: (sum(star_tuple(r)) / max(int(r["price_baht_month"] or 1), 1),
                                           sum(star_tuple(r))), reverse=True)
    if sort == "stars":
        return sorted(rows, key=lambda r: sum(star_tuple(r)), reverse=True)
    if sort == "price":
        return sorted(rows, key=lambda r: int(r["price_baht_month"] or 0))
    return rows


def show_results(rows, title="results", how_many=10, sort="repeat"):
    if not rows:
        print("\n  (no numbers match — try loosening the filters)")
        return None
    rows = sort_rows(rows, sort)
    shown = rows[:how_many]
    print()
    print(f"  {len(rows)} match(es) — top {len(shown)}: {title}")
    print(f"  {'number':<14} {'price/mo':>8}  repeats")
    print("  " + "-" * 44)
    for r in shown:
        print(f"  {fmt_num(r['msisdn']):<14} {r['price_baht_month'] or '-':>8}  {runs_of(r['msisdn']) or '-'}")
    print()
    save = ask_text(f"Save these {len(rows)} to a CSV? (Enter to skip)")
    if save and save != "QUIT":
        save_rows(rows, save)
    return rows


def save_rows(rows, name="found.csv"):
    if not name.endswith(".csv"):
        name += ".csv"
    with open(name, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["msisdn", "price_baht_month"])
        for r in rows:
            w.writerow([r["msisdn"], r["price_baht_month"]])
    print(f"  saved {len(rows)} numbers -> {name}")


# ── search modes ────────────────────────────────────────────────────────────
def mode_repeats():
    repeat = ask_choice("How many same digits in a row?",
                        ["Any (all numbers)", "At least 2 (pair, e.g. 88)",
                         "At least 3 (tong, e.g. 888)", "At least 4 (quad, e.g. 8888)"])
    if repeat == "QUIT":
        return
    minrun = {"Any (all numbers)": 1, "At least 2 (pair, e.g. 88)": 2,
              "At least 3 (tong, e.g. 888)": 3, "At least 4 (quad, e.g. 8888)": 4}[repeat]
    ending = ask_text("Must it end with certain digits? (Enter to skip)")
    if ending == "QUIT":
        return
    if ending and not ending.isdigit():
        print("  (ignoring — not digits)")
        ending = ""
    n = ask_number("How many results? (default 10)", default=10)
    if n == "QUIT":
        return
    sort = ask_choice("How to sort?",
                      ["Richest repeats first", "RAREST structures first",
                       "Most memorable first", "Best value (stars/baht)"])
    if sort == "QUIT":
        return
    sort_key = {"Richest repeats first": "repeat", "RAREST structures first": "rarity",
                "Most memorable first": "memorable", "Best value (stars/baht)": "value"}[sort]
    rows = apply_filters(ROWS, {"minrun": minrun, "ends": ending or None})
    show_results(rows, f"repeat >= {minrun}" + (f", ends {ending}" if ending else ""), n, sort_key)


def mode_memorable():
    kinds = ask_choice("Which memorable feature?",
                       ["Anything easy to remember",
                        "Consecutive sequences (1234, 54321, 9876)",
                        "ABAB pairs (1212, 3434)",
                        "Round endings (000, 0000)"], allow_multi=True)
    if kinds == "QUIT":
        return
    if not kinds:
        return
    n = ask_number("How many results? (default 10)", default=10)
    if n == "QUIT":
        return
    def pick(r):
        m = r["msisdn"]
        mr = maxrun(m)
        a = d = 1
        seq = 1
        for i in range(1, len(m)):
            a = a + 1 if int(m[i]) == int(m[i - 1]) + 1 else 1
            d = d + 1 if int(m[i]) == int(m[i - 1]) - 1 else 1
            seq = max(seq, a, d)
        abab = any(m[i] == m[i + 2] and m[i + 1] == m[i + 3] and m[i] != m[i + 1]
                   for i in range(len(m) - 3))
        round_end = m.endswith("0000") or m.endswith("000")
        for k in kinds:
            if k.startswith("Anything") and memorable_score(m) >= 6:
                return True
            if k.startswith("Consecutive") and seq >= 4:
                return True
            if k.startswith("ABAB") and abab:
                return True
            if k.startswith("Round") and round_end:
                return True
        return False
    rows = [r for r in ROWS if pick(r)]
    show_results(rows, "easy-to-remember", n, "memorable")


def mode_pattern():
    kind = ask_choice("What pattern?",
                      ["Ends with certain digits (e.g. 888)",
                       "Contains digits anywhere (e.g. 88)",
                       "Starts with certain digits (e.g. 095)"])
    if kind == "QUIT":
        return
    val = ask_text("Digits:")
    if val == "QUIT":
        return
    val = val.replace(" ", "").replace("-", "")
    if not val.isdigit():
        print("  (ignoring — not digits)")
        paused()
        return
    n = ask_number("How many results? (default 10)", default=10)
    if n == "QUIT":
        return
    f = {}
    if kind.startswith("Ends"):
        f["ends"] = val
    elif kind.startswith("Contains"):
        f["seq"] = val
    else:
        f["mask"] = val + "XXXXXX"
    rows = apply_filters(ROWS, f)
    show_results(rows, f"{kind.split()[0]}: {val}", n, "repeat")


def mode_mask():
    print()
    print("Type a template. X = any digit.  e.g. 0658XXXXXX  or  09X-XXX-8888")
    mask = _input("> ").strip()
    if mask in ("q", "quit", "exit"):
        return
    if not mask:
        return
    clean = mask.replace(" ", "").replace("-", "")
    if len(clean) != 10 or not all(c.isdigit() or c in "Xx?*_" for c in clean):
        print(f"  '{mask}' isn't a valid 10-digit template")
        paused()
        return
    n = ask_number("How many results? (default 10)", default=10)
    if n == "QUIT":
        return
    rows = apply_filters(ROWS, {"mask": clean})
    show_results(rows, f"mask {mask}", n, "repeat")


def mode_digits():
    inc = ask_text("Digits that MUST appear? (e.g. 8,9 — Enter to skip)")
    if inc == "QUIT":
        return
    inc = [d for d in inc.replace(",", " ") if d.isdigit()] if inc else []
    exc = ask_text("Digits that must NOT appear? (e.g. 4 — Enter to skip)")
    if exc == "QUIT":
        return
    exc = [d for d in exc.replace(",", " ") if d.isdigit()] if exc else []
    n = ask_number("How many results? (default 10)", default=10)
    if n == "QUIT":
        return
    rows = apply_filters(ROWS, {"include": inc or None, "exclude": exc or None})
    show_results(rows, f"include {inc} / exclude {exc}", n, "repeat")


def mode_value():
    n = ask_number("How many results? (default 10)", default=10)
    if n == "QUIT":
        return
    rows = apply_filters(ROWS, {})
    show_results(rows, "best numerology stars per baht", n, "value")


def mode_random():
    repeat = ask_choice("Any repeat preference?",
                        ["Any", "At least a pair", "At least a tong (888)", "At least a quad (8888)"])
    if repeat == "QUIT":
        return
    minrun = {"Any": 1, "At least a pair": 2, "At least a tong (888)": 3, "At least a quad (8888)": 4}[repeat]
    pool = apply_filters(ROWS, {"minrun": minrun})
    if not pool:
        print("\n  (nothing matches)")
        paused()
        return
    picks = random.sample(pool, min(3, len(pool)))
    print("\n  Your random picks:")
    for r in picks:
        print(f"  {fmt_num(r['msisdn']):<14} {r['price_baht_month'] or '-':>8}  {runs_of(r['msisdn']) or '-'}")
    paused()


def mode_exact():
    num = ask_text("Type a full 10-digit number to check:")
    if num == "QUIT":
        return
    num = num.replace(" ", "").replace("-", "")
    if not num.isdigit() or len(num) != 10:
        print("  need exactly 10 digits")
        paused()
        return
    rows = apply_filters(ROWS, {"exact": num})
    if rows:
        r = rows[0]
        pools = r.get("pools") or r.get("pool") or ""
        print(f"\n  {fmt_num(num)} — {r['price_baht_month'] or '-'} ฿/เดือน  repeats: {runs_of(num) or '-'}")
        if pools:
            print(f"  pools: {pools}")
        if memorable_score(num):
            print(f"  memorable score: {memorable_score(num)}  ({memorable_reasons(num)})")
    else:
        print(f"\n  {fmt_num(num)} — not in the local dump (may be new, sold, or in another pool)")
    print("\n  Check availability LIVE on True's server?")
    chk = ask_choice("", ["Yes, check now", "No"])
    if chk == "Yes, check now":
        live_check([num])


# ── watch / availability ────────────────────────────────────────────────────
def make_headers():
    now = datetime.now()
    cid = now.strftime("%Y%m%d%H%M%S") + str(uuid.uuid4().hex[:4])
    sid = "VECOM-" + now.strftime("%Y%m%d") + "-" + str(uuid.uuid4())
    return {
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Origin": "https://store.true.th", "Referer": "https://store.true.th/",
        "correlationid": cid, "x-correlator-id": cid, "sessionid": sid,
    }


def api_post(body):
    body["pagination"] = {"page": 1, "size": 200}
    req = urllib.request.Request(BASE + "/lucky-number/product-list",
                                 data=json.dumps(body).encode(), headers=make_headers(), method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def check_exact(msisdn, pool="universal"):
    digits = msisdn[1:]
    idx = [{"index": i, "number": int(d)} for i, d in enumerate(digits)]
    try:
        resp = api_post({"type": pool, "number_index": idx})
    except Exception:
        return None
    for i in (resp.get("data") or {}).get("numbering") or []:
        if i["msisdn"] == msisdn:
            return i
    return None


def guess_pool(msisdn):
    """Find which pool a number belongs to, using local data."""
    for r in ROWS:
        if r["msisdn"] == msisdn:
            pools = (r.get("pools") or r.get("pool") or "").split(",")
            for p in pools:
                if p in POOLS:
                    return p
    return "universal"


def live_check(numbers):
    for m in numbers:
        pool = guess_pool(m)
        item = check_exact(m, pool)
        if item:
            price = (item.get("detail") or [{}])[0].get("rc")
            print(f"  ✅ {fmt_num(m)}  AVAILABLE  {price}฿  ({POOL_NAMES.get(pool, pool)})")
        else:
            print(f"  ❌ {fmt_num(m)}  not available in {POOL_NAMES.get(pool, pool)} "
                  f"(sold / reserved / other pool)")
        time.sleep(0.3)


def scan_memorable(draws=3, min_score=10, limit=15, quiet=False):
    found = {}
    for pool in POOLS:
        for _ in range(draws):
            try:
                resp = api_post({"type": pool})
            except Exception:
                continue
            for item in (resp.get("data") or {}).get("numbering") or []:
                m = item["msisdn"]
                sc = memorable_score(m)
                if sc >= min_score and m not in found:
                    found[m] = (sc, (item.get("detail") or [{}])[0].get("rc"), pool)
            time.sleep(0.3)
    ranked = sorted(found.items(), key=lambda kv: -kv[1][0])
    if not quiet:
        print(f"\n  Memorable numbers currently in stock ({len(ranked)}):")
        print(f"  {'number':<14} {'score':>5} {'price':>6}  pool")
        for m, (sc, p, pool) in ranked[:limit]:
            print(f"  {fmt_num(m):<14} {sc:>5} {str(p):>6}  {POOL_NAMES.get(pool, pool)}")
    return ranked


def mode_watch():
    while True:
        choice = ask_choice("Watch & check",
                            ["Check specific numbers (type them)",
                             "Check my watchlist file",
                             "Scan for memorable numbers in stock",
                             "Watch loop (repeat scan every N seconds)",
                             "Edit watchlist file",
                             "Back"])
        if choice in ("QUIT", "Back"):
            return
        if choice.startswith("Check specific"):
            nums = ask_text("Numbers (space separated):")
            if nums == "QUIT":
                continue
            nums = [n.strip() for n in re.split(r"[\s,]+", nums) if n.strip()]
            live_check(nums)
            paused()
        elif choice.startswith("Check my watchlist"):
            nums = read_watchlist()
            if not nums:
                print(f"  (no numbers in {WATCH_FILE} — use 'Edit watchlist file')")
            else:
                live_check(nums)
            paused()
        elif choice.startswith("Scan for memorable"):
            d = ask_number("Draws per pool? (default 3, more = better coverage)", default=3)
            if d == "QUIT":
                continue
            scan_memorable(draws=d)
            paused()
        elif choice.startswith("Watch loop"):
            secs = ask_number("Check every how many seconds? (default 60)", default=60)
            if secs == "QUIT":
                continue
            draws = ask_number("Draws per pool per check? (default 2)", default=2)
            if draws == "QUIT":
                continue
            autosave = ask_choice("Auto-save results to watch_log.csv?",
                                  ["Yes, save each check", "No, just watch"])
            if autosave == "QUIT":
                continue
            save_enabled = autosave and autosave.startswith("Yes")
            print(f"\n  Watching every {secs}s — memorable finds will BEEP. Ctrl+C to stop.")
            if save_enabled:
                print(f"  Auto-saving to watch_log.csv")
            print()
            # baseline of numbers already known in the local dump
            known = set(r["msisdn"] for r in ROWS) if ROWS else set()
            try:
                while True:
                    now = datetime.now().strftime("%H:%M:%S")
                    print(f"[{now}] checking...", flush=True)
                    ranked = scan_memorable(draws=draws, limit=5, quiet=True)
                    # genuinely NEW = memorable + seen live but not in local dump
                    new_finds = [(m, sc, p, pool) for m, (sc, p, pool) in ranked if m not in known]
                    if save_enabled:
                        with open("watch_log.csv", "a", encoding="utf-8-sig", newline="") as f:
                            w = csv.writer(f)
                            if f.tell() == 0:
                                w.writerow(["timestamp", "msisdn", "score", "price", "pool", "new"])
                            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            new_set = {f[0] for f in new_finds}
                            for m, (sc, p, pool) in ranked:
                                w.writerow([ts, m, sc, p, pool, "NEW" if m in new_set else ""])
                    if new_finds:
                        beep()
                        print(f"  🔔 NEW IN STOCK vs local dump ({len(new_finds)}):")
                        for m, sc, p, pool in new_finds:
                            print(f"     {fmt_num(m)}  score {sc}  {p}฿  {POOL_NAMES.get(pool, pool)}")
                    elif ranked:
                        print(f"  ({len(ranked)} memorable seen, all already in local dump)")
                    time.sleep(secs)
            except KeyboardInterrupt:
                print("\n  stopped")
        elif choice.startswith("Edit watchlist"):
            edit_watchlist()


def read_watchlist():
    if not os.path.exists(WATCH_FILE):
        return []
    with open(WATCH_FILE, encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip() and not l.startswith("#")]


def edit_watchlist():
    nums = read_watchlist()
    print(f"\n  Current watchlist ({len(nums)} numbers):")
    for n in nums:
        print(f"    {fmt_num(n)}")
    print("\n  Add numbers (space separated), or type 'clear' to empty the list:")
    raw = _input("> ").strip()
    if raw in ("q", "quit", "exit"):
        return
    if raw.lower() == "clear":
        open(WATCH_FILE, "w", encoding="utf-8").write("# lucky-number watchlist\n")
        print("  watchlist cleared")
        return
    add = [n.strip() for n in re.split(r"[\s,]+", raw) if n.strip().isdigit() and len(n.strip()) == 10]
    if add:
        with open(WATCH_FILE, "a", encoding="utf-8") as f:
            for n in add:
                f.write(n + "\n")
        print(f"  added {len(add)} number(s) to {WATCH_FILE}")
    else:
        print("  nothing valid added")


# ── update (fetch + merge) ──────────────────────────────────────────────────
def fetch_draws(pool, draws, size=200, workers=3, progress_cb=None):
    results = []
    lock = threading.Lock()
    progress = [0]

    def worker():
        while True:
            with lock:
                if not q.empty():
                    i = q.get_nowait()
                else:
                    return
            try:
                body = {"type": pool, "pagination": {"page": 1, "size": size}}
                req = urllib.request.Request(BASE + "/lucky-number/product-list",
                                             data=json.dumps(body).encode(), headers=make_headers(), method="POST")
                with urllib.request.urlopen(req, timeout=30) as r:
                    resp = json.loads(r.read().decode())
                results.append((resp.get("data") or {}).get("numbering") or [])
            except Exception:
                pass
            with lock:
                progress[0] += 1
                if progress_cb:
                    progress_cb(progress[0], draws)

    q = Queue()
    for _ in range(draws):
        q.put(1)
    threads = [threading.Thread(target=worker) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def mode_update():
    choice = ask_choice("Update dataset",
                        ["Quick refresh (universal + a few pools, ~1-2 min)",
                         "Full refresh (all pools, ~10 min)",
                         "Back"])
    if choice in ("QUIT", "Back"):
        return
    print()
    if choice.startswith("Quick"):
        plan = {"universal": 400, "rahu": 300, "khanthep": 200, "naga": 150, "ajchang": 200, "emperor": 50}
    else:
        plan = {"universal": 1000, "rahu": 600, "khanthep": 500, "naga": 400, "ajchang": 600, "emperor": 100}
    merged = {}
    for pool, draws in plan.items():
        print(f"  fetching {POOL_NAMES.get(pool, pool)} ({draws} draws)...", flush=True)
        batches = fetch_draws(pool, draws, workers=3)
        for batch in batches:
            for item in batch:
                merged.setdefault(item["msisdn"], (pool, item))
        print(f"    -> {len(merged)} unique so far", flush=True)
    # write combined CSV
    out = "all_numbers.csv"
    seen = {}
    if os.path.exists(out):
        for r in load(out):
            seen.setdefault(r["msisdn"], r)
    for msisdn, (pool, item) in merged.items():
        if msisdn in seen:
            continue
        d0 = (item.get("detail") or [{}])[0]
        grade = d0.get("grade") or d0.get("subGroupHora") or ""
        seen[msisdn] = {"pool": pool, "msisdn": msisdn, "grade": grade,
                        "nasCode": d0.get("nasCode"), "price_baht_month": d0.get("rc"),
                        "sum": item.get("sum"), "oper": item.get("oper"),
                        "luckyTypes": json.dumps(item.get("luckyType", []), ensure_ascii=False),
                        "pools": pool}
    fields = ["msisdn", "grade", "nasCode", "price_baht_month", "sum", "oper",
              "luckyTypes", "pool", "pools"]
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(seen.values())
    global ROWS
    ROWS = load_all()
    print(f"\n  saved {len(seen)} numbers -> {out}")
    print("  (Tip: run 'Update' again before buying — numbers sell out fast)")
    paused()


# ── my numbers ──────────────────────────────────────────────────────────────
def mode_my_numbers():
    while True:
        choice = ask_choice("My numbers",
                            ["Add number(s)",
                             "Remove number(s)",
                             "Show my numbers",
                             "Back"])
        if choice in ("QUIT", "Back"):
            return
        if choice.startswith("Add"):
            print("\n  Format: 0658123456 699  (number + optional price), one per line. Blank = done.")
            added = 0
            while True:
                line = _input("> ").strip()
                if line in ("q", "quit", "", "exit"):
                    break
                parts = line.replace("-", " ").replace(",", " ").split()
                num = "".join(c for c in parts[0] if c.isdigit()) if parts else ""
                if len(num) != 10:
                    print("  need a 10-digit number")
                    continue
                price = parts[-1] if len(parts) > 1 and parts[-1].isdigit() else ""
                with open(MY_FILE, "a", encoding="utf-8-sig", newline="") as f:
                    if f.tell() == 0:
                        f.write("msisdn,price_baht_month,grade,pool\n")
                    f.write(f"{num},{price},mine,mine\n")
                added += 1
                print(f"  added {fmt_num(num)}")
            if added:
                global ROWS
                ROWS = load_all()
            paused()
        elif choice.startswith("Remove"):
            mine = [r for r in ROWS if (r.get("pool") or "") == "mine"]
            if not mine:
                print("  (no my-numbers yet)")
                paused()
                continue
            print("\n  Your numbers:")
            for i, r in enumerate(mine, 1):
                print(f"    {i}. {fmt_num(r['msisdn'])}  {r.get('price_baht_month') or ''}฿")
            raw = ask_text("\n  Numbers to remove (space separated):")
            if raw == "QUIT":
                continue
            to_remove = set(n.strip() for n in re.split(r"[\s,]+", raw) if n.strip().isdigit())
            keep = [r for r in mine if r["msisdn"] not in to_remove]
            with open(MY_FILE, "w", encoding="utf-8-sig", newline="") as f:
                f.write("msisdn,price_baht_month,grade,pool\n")
                for r in keep:
                    f.write(f"{r['msisdn']},{r.get('price_baht_month') or ''},mine,mine\n")
            ROWS = load_all()
            print(f"  removed {len(mine) - len(keep)} number(s)")
            paused()
        elif choice.startswith("Show"):
            mine = [r for r in ROWS if (r.get("pool") or "") == "mine"]
            print(f"\n  Your numbers ({len(mine)}):")
            for r in mine:
                print(f"    {fmt_num(r['msisdn'])}  {r.get('price_baht_month') or '-'}฿")
            paused()


# ── stats ───────────────────────────────────────────────────────────────────
def mode_stats():
    dist = Counter(maxrun(r["msisdn"]) for r in ROWS)
    print()
    print(f"  Dataset: {DATA_PATH or '(no data file)'}  ({len(ROWS)} numbers)")
    print(f"  {'repeat pattern':<16}{'count':>8}")
    for k in sorted(dist):
        label = {1: "none", 2: "pair (88)", 3: "triple (888)", 4: "quad (8888)"}.get(k, f"{k}x")
        print(f"  {label:<16}{dist[k]:>8}")
    prices = [int(r["price_baht_month"]) for r in ROWS if r.get("price_baht_month", "").isdigit()]
    if prices:
        print(f"\n  price range: {min(prices)} - {max(prices)} ฿/เดือน")
    if os.path.exists(MY_FILE):
        print(f"  your numbers: {sum(1 for r in ROWS if (r.get('pool') or '') == 'mine')}")
    print("\n  Tips:")
    print("    - numbers sell out FAST; verify availability live before buying")
    print("    - the dump is a snapshot; run 'Update dataset' to refresh")
    print("    - use Watch to catch new memorable numbers")
    paused()


# ── main ────────────────────────────────────────────────────────────────────
def main():
    global ROWS
    ROWS = load_all()
    if not ROWS:
        print("No data found. Run 'Update dataset' first (option 3).")
    else:
        print(f"Data: {DATA_PATH} + {MY_FILE if os.path.exists(MY_FILE) else ''}  ({len(ROWS)} numbers)")

    while True:
        print()
        print("═" * 52)
        print("  LUCKY NUMBER TOOLKIT")
        print("═" * 52)
        choice = ask_choice(
            "What do you want to do?",
            ["Find numbers (repeats, memorable, patterns...)",
             "Watch & check availability (live)",
             "Update dataset (refresh from True's API)",
             "My numbers (add / remove yours)",
             "Stats & tips",
             "Quit"],
            extra=["(type q anytime to quit)"])
        if choice in ("QUIT", "Quit"):
            print("bye")
            return
        if choice is None:
            continue
        if choice.startswith("Find numbers"):
            sub = ask_choice("Search",
                             ["Repeats (tong / quad / rare structures)",
                              "Easy-to-remember (54321, 1234, 1212...)",
                              "Pattern (ends with / contains / starts with)",
                              "Type a template (0658XXXXXX)",
                              "Must / must-not digits",
                              "Best value (stars per baht)",
                              "Random lucky pick",
                              "Check a specific number",
                              "Back"])
            if sub in ("QUIT", "Back"):
                continue
            if sub.startswith("Repeats"):
                mode_repeats()
            elif sub.startswith("Easy-to-remember"):
                mode_memorable()
            elif sub.startswith("Pattern"):
                mode_pattern()
            elif sub.startswith("Type a template"):
                mode_mask()
            elif sub.startswith("Must / must-not"):
                mode_digits()
            elif sub.startswith("Best value"):
                mode_value()
            elif sub.startswith("Random"):
                mode_random()
            elif sub.startswith("Check a specific"):
                mode_exact()
        elif choice.startswith("Watch"):
            mode_watch()
        elif choice.startswith("Update"):
            mode_update()
        elif choice.startswith("My numbers"):
            mode_my_numbers()
        elif choice.startswith("Stats"):
            mode_stats()


if __name__ == "__main__":
    main()
