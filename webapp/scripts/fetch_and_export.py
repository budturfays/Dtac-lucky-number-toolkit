"""
fetch_and_export.py — fetch fresh lucky numbers from True and AIS and export
to webapp/public/data/numbers.json for the web app.

Used by the GitHub Actions workflow (Refresh lucky numbers) so the site
gets fresh data on a schedule. Also usable locally.

The API returns RANDOM samples, so we draw many samples per pool and
dedupe to build a sampled catalog (not guaranteed complete). Draws run concurrently so the
scheduled GitHub Actions refresh finishes in ~2-3 min even from a US runner.

Usage:
  python scripts/fetch_and_export.py [--draws N] [--out PATH] [--workers N]
"""
import argparse
import concurrent.futures
import json
import os
import math
import re
import urllib.request
import urllib.error
import time
import uuid
from datetime import datetime

BASE = "https://store.true.th/api"
AIS_BASE = "https://croissant.ais.th/external/app/lucky/products"
AIS_SOURCE = "https://www.ais.th/consumers/package/exclusive-plan/lucky-number/find-number"
AIS_PAGE_SIZE = 100
POOLS = ["universal", "rahu", "khanthep", "naga", "ajchang", "emperor"]
# default draws per pool (moderate; the API returns random samples, so each
# refresh adds a fresh random sample on top of the previous snapshot)
DEFAULT_DRAWS = {"universal": 100, "rahu": 80, "khanthep": 60,
                 "naga": 50, "ajchang": 80, "emperor": 30}
DEFAULT_WORKERS = 8


def make_headers():
    now = datetime.now()
    cid = now.strftime("%Y%m%d%H%M%S") + str(uuid.uuid4().hex[:4])
    sid = "VECOM-" + now.strftime("%Y%m%d") + "-" + str(uuid.uuid4())
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Origin": "https://store.true.th",
        "Referer": "https://store.true.th/",
        "correlationid": cid,
        "x-correlator-id": cid,
        "sessionid": sid,
    }


def draw(pool, size=200):
    body = {"type": pool, "pagination": {"page": 1, "size": size}}
    req = urllib.request.Request(BASE + "/lucky-number/product-list",
                                 data=json.dumps(body).encode(),
                                 headers=make_headers(), method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode())
    return parse_numbering(resp)


def ais_body(page):
    return {"variables": {"filter": {
        "type_of_product": {"eq": "mobile"},
        "mobile_no": {"like": "0%%%%%%%%%"},
        "prefered_number": {"in": []}, "unwanted_number": {"in": []},
        "fortune_teller": {"eq": None}, "birthday": {"eq": ""},
        "prediction_type": {"in": []}, "letter_grade": None,
        "aggregate_score": None,
    }, "pageSize": AIS_PAGE_SIZE, "currentPage": page}}


def parse_ais_response(resp):
    if not isinstance(resp, dict) or not isinstance(resp.get("total_count"), int) or resp["total_count"] < 0:
        raise ValueError("unexpected AIS response")
    mobile = resp.get("mobile")
    if not isinstance(mobile, list):
        raise ValueError("missing AIS mobile list")
    for item in mobile:
        if not isinstance(item, dict) or not re.fullmatch(r"0\d{9}", str(item.get("mobile_no", ""))):
            raise ValueError("invalid AIS number")
    return mobile, resp["total_count"]


def fetch_ais_page(page):
    req = urllib.request.Request(
        AIS_BASE, data=json.dumps(ais_body(page)).encode(), method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "Mozilla/5.0", "Origin": "https://www.ais.th",
                 "Referer": AIS_SOURCE},
    )
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("AIS catalog request failed") from last_error


def fetch_all_ais():
    first = fetch_ais_page(1)
    first_rows, total = parse_ais_response(first)
    if total <= 0:
        raise RuntimeError("AIS returned an empty catalog; refusing partial deployment")
    pages = max(1, math.ceil(total / AIS_PAGE_SIZE))
    merged = {item["mobile_no"]: item for item in first_rows}
    print(f"  AIS: page 1/{pages}, {len(merged)}/{total} unique", flush=True)
    for page in range(2, pages + 1):
        response = fetch_ais_page(page)
        items, page_total = parse_ais_response(response)
        if page_total != total:
            raise RuntimeError("AIS total changed during export; refusing inconsistent snapshot")
        before = len(merged)
        for item in items:
            merged.setdefault(item["mobile_no"], item)
        if len(merged) == before:
            raise RuntimeError(f"AIS page {page} repeated earlier data")
        print(f"  AIS: page {page}/{pages}, {len(merged)}/{total} unique", flush=True)
    if len(merged) != total:
        raise RuntimeError(f"AIS catalog incomplete: got {len(merged)} of {total}")
    return merged


def parse_numbering(resp):
    if not isinstance(resp, dict) or resp.get("statusCode") != 200:
        raise ValueError("unexpected True response")
    data = resp.get("data")
    if not isinstance(data, dict):
        raise ValueError("missing True data")
    numbering = data.get("numbering")
    total = (data.get("pagination") or {}).get("totalItem")
    if numbering is None and "numbering" in data and total == 0:
        return []
    if not isinstance(numbering, list) or (not numbering and total != 0):
        raise ValueError("malformed numbering response")
    for item in numbering:
        if not isinstance(item, dict) or not re.fullmatch(r"0\d{9}", str(item.get("msisdn", ""))):
            raise ValueError("invalid number")
        details = item.get("detail")
        if not isinstance(details, list) or not details or not isinstance(details[0], dict):
            raise ValueError("missing price")
        price = details[0].get("rc")
        if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price < 0:
            raise ValueError("invalid price")
    return numbering


def ensure_pool_health(pool, succeeded, draws):
    if draws <= 0 or succeeded / draws < 0.8:
        raise RuntimeError(f"{pool}: only {succeeded}/{draws} valid responses; refusing partial deployment")


def star_sum(lt_str):
    try:
        arr = json.loads(lt_str)
        return sum(t.get("star", 0) for t in arr) if arr else 0
    except Exception:
        return 0


def score_breakdown(lucky_types):
    scores = {}
    for entry in lucky_types or []:
        name = str(entry.get("name") or "")
        value = int(entry.get("star") or 0)
        if "การงาน" in name:
            scores["work"] = value
        if "การเงิน" in name:
            scores["finance"] = value
        if "ความรัก" in name:
            scores["love"] = value
    return scores


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--draws", type=int, default=0,
                    help="override draws per pool (0 = use defaults)")
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                    help="concurrent draw threads (default %d)" % DEFAULT_WORKERS)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    if args.draws < 0 or not 1 <= args.workers <= 16:
        ap.error("draws must be nonnegative and workers must be 1..16")

    here = os.path.dirname(os.path.abspath(__file__))
    out = args.out or os.path.join(here, "..", "public", "data", "numbers.json")

    merged = {}
    for pool in POOLS:
        draws = args.draws if args.draws else DEFAULT_DRAWS[pool]
        print(f"  {pool}: {draws} draws, {args.workers} workers ...", flush=True)
        local = {}
        succeeded = 0

        def fetch(_):
            return draw(pool)

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
            done = 0
            for fut in concurrent.futures.as_completed(
                    (ex.submit(fetch, i) for i in range(draws))):
                done += 1
                try:
                    items = fut.result()
                    for it in items:
                        local.setdefault(it["msisdn"], (pool, it))
                    succeeded += 1
                except Exception as e:
                    # tolerate transient errors; keep going
                    if done % 50 == 0:
                        print(f"    error at draw {done}: {e}", flush=True)
                if done % 50 == 0:
                    print(f"    {done}/{draws} done, {len(local)} unique", flush=True)
        ensure_pool_health(pool, succeeded, draws)
        for msisdn, pair in local.items():
            merged.setdefault(msisdn, pair)
        print(f"    -> {len(merged)} unique so far", flush=True)

    rows = []
    for msisdn, (pool, it) in merged.items():
        d0 = (it.get("detail") or [{}])[0]
        lucky_types = it.get("luckyType", [])
        rows.append({
            "msisdn": msisdn,
            "price_baht_month": int(d0.get("rc") or 0),
            "pools": pool,
            "provider": "true",
            "stars": star_sum(json.dumps(it.get("luckyType", []), ensure_ascii=False)),
            "scores": score_breakdown(lucky_types),
        })
    ais_rows = fetch_all_ais()
    for msisdn, item in ais_rows.items():
        forecast = item.get("forcast") if isinstance(item.get("forcast"), dict) else {}
        scores = {name: forecast.get(source) for name, source in
                  (("work", "work"), ("finance", "finance"),
                   ("love", "adoration"), ("health", "health"))
                  if isinstance(forecast.get(source), (int, float))}
        aggregate = forecast.get("aggregate")
        rows.append({
            "msisdn": msisdn,
            # AIS's returned product price is not a monthly plan fee.
            "price_baht_month": None,
            "pools": "ais",
            "provider": "ais",
            "stars": aggregate if isinstance(aggregate, (int, float)) else 0,
            "scores": scores,
            "grade": forecast.get("grade"),
            "lucky_type": item.get("lucky_type"),
        })
    rows.sort(key=lambda r: (r["msisdn"], r["provider"]))
    if not rows:
        raise RuntimeError("empty catalog; refusing to overwrite or deploy")

    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    size_mb = os.path.getsize(out) / 1e6
    print(f"Wrote {len(rows)} numbers -> {out} ({size_mb:.1f} MB)")

    # companion meta so the web app's live bar can show the REAL timestamp of
    # the served numbers.json (its file mtime right after writing).
    # meta.json lives next to numbers.json so it is regenerated on every deploy.
    meta_path = os.path.join(os.path.dirname(out), "meta.json")
    lastmod = datetime.fromtimestamp(os.path.getmtime(out)).astimezone()
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(
            {"lastmod": lastmod.isoformat(timespec="seconds"), "count": len(rows),
             "providerCounts": {"true": len(merged), "ais": len(ais_rows)}},
            f, separators=(",", ":"),
        )
    print(f"Wrote meta -> {meta_path} (lastmod={lastmod.isoformat(timespec='seconds')})")


if __name__ == "__main__":
    main()
