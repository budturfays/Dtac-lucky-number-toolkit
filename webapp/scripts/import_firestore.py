"""Import the lucky-number CSV into Firestore (numbers collection).

Run:  python scripts/import_firestore.py

Requires a service account key JSON (from Firebase Console -> Project settings
-> Service accounts -> Generate new private key). Set the path below or via
GOOGLE_APPLICATION_CREDENTIALS env var.

Requires: pip install firebase-admin
"""
import csv
import os
import sys
import json
import time

# --- config ---
PROJECT_ID = "lucky-number-df6fa"
SERVICE_ACCOUNT = os.environ.get(
    "GOOGLE_APPLICATION_CREDENTIALS",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "service-account.json"),
)
COLLECTION = "numbers"
# Firestore batch write limit
BATCH = 400

CSV_PATHS = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "all_numbers.csv"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "all_numbers.csv"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "all_numbers.csv"),
]


def find_csv():
    for p in CSV_PATHS:
        if os.path.exists(p):
            return p
    sys.exit("all_numbers.csv not found. Place it next to the repo.")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", type=int, default=0,
                    help="when quota is hit, wait N seconds and retry (for daily quota resets)")
    args = ap.parse_args()
    if not os.path.exists(SERVICE_ACCOUNT):
        sys.exit(
            f"Service account key not found at {SERVICE_ACCOUNT}. "
            "Generate it in Firebase Console -> Project settings -> Service accounts, "
            "and set GOOGLE_APPLICATION_CREDENTIALS."
        )
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("firebase-admin not installed. Run: pip install firebase-admin")

    cred = credentials.Certificate(SERVICE_ACCOUNT)
    firebase_admin.initialize_app(cred, {"projectId": PROJECT_ID})
    db = firestore.client()

    src = find_csv()
    print(f"Reading {src} ...")
    rows = []
    with open(src, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append({
                "msisdn": r["msisdn"],
                "price": int(r["price_baht_month"]) if (r.get("price_baht_month") or "").isdigit() else 0,
                "grade": r.get("grade") or "",
                "sum": int(r.get("sum") or 0),
                "pool": r.get("pool") or "",
                "pools": r.get("pools") or "",
            })
    print(f"{len(rows)} rows. Importing in batches of {BATCH} ...")

    # resume: skip numbers already in Firestore
    try:
        existing = set()
        for d in db.collection(COLLECTION).stream():
            existing.add(d.id)
        if existing:
            before = len(rows)
            rows = [r for r in rows if r["msisdn"] not in existing]
            print(f"  skipping {before - len(rows)} already-imported numbers "
                  f"({len(rows)} to go)")
    except Exception:
        print("  (could not list existing — will attempt full import)")
        existing = set()

    total = 0
    t0 = time.time()
    imported = 0
    remaining = list(rows)
    while remaining:
        # get batch
        chunk = remaining[:BATCH]
        batch = db.batch()
        for r in chunk:
            ref = db.collection(COLLECTION).document(r["msisdn"])
            batch.set(ref, r)
        try:
            batch.commit()
            imported += len(chunk)
            remaining = remaining[BATCH:]
            print(f"  imported {imported}/{len(rows)}", flush=True)
        except Exception as e:
            msg = str(e)
            if "Quota exceeded" in msg or "RESOURCE_EXHAUSTED" in msg or "429" in msg:
                if args.watch > 0:
                    wait = args.watch
                    print(f"  quota hit — waiting {wait}s before retrying "
                          f"({len(remaining)} remaining) ...", flush=True)
                    time.sleep(wait)
                    continue  # retry same chunk
                print(f"\n  Quota exceeded at {imported}/{len(rows)}. "
                      f"Resume later with the same command "
                      f"(skips already-imported numbers).")
                break
            else:
                raise
    if imported == len(rows):
        print(f"Done in {time.time()-t0:.1f}s -> {len(rows)} docs in '{COLLECTION}'")
    else:
        print(f"Stopped with {imported}/{len(rows)} imported.")


if __name__ == "__main__":
    main()
