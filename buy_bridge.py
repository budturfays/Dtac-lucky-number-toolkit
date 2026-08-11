"""
buy_bridge.py — tiny local HTTP bridge between the web app and buy_worker.py.

The web app (https://lucky-number-th.web.app) is a static site on Firebase and
cannot write local files. This bridge runs on your PC at http://localhost:8765
and turns a "buy" click in the web app into a line in buy_queue.txt, which
buy_worker.py --watch then processes automatically (it drives a real browser to
select & reserve the number on True's site).

Usage:
  python buy_bridge.py                   # listen on http://localhost:8765
  python buy_bridge.py --auto-worker     # also start buy_worker.py --watch
  python buy_bridge.py --port 9000       # pick another port

Endpoints (CORS: Access-Control-Allow-Origin: *):
  GET  /health   -> {"ok": true}
  GET  /queue    -> {"count": N, "pending": [...]}
  POST /buy      -> body {"msisdn":"0954321133"} -> {"queued": true, ...}

Note: the worker and this bridge are local only — they work while this PC is
on and the bridge is running.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
QUEUE_FILE = os.path.join(HERE, "buy_queue.txt")
PROCESSED_FILE = os.path.join(HERE, "buy_processed.log")
WORKER_PY = os.path.join(HERE, "buy_worker.py")
HOST = os.environ.get("LUCKY_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("LUCKY_BRIDGE_PORT", "8765"))
MSISDN_RE = re.compile(r"^\d{10}$")


def is_queued(msisdn):
    if os.path.exists(QUEUE_FILE):
        with open(QUEUE_FILE, encoding="utf-8") as f:
            for line in f:
                if line.strip() == msisdn:
                    return True
    if os.path.exists(PROCESSED_FILE):
        with open(PROCESSED_FILE, encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 2 and parts[1] == msisdn:
                    return True
    return False


def read_pending():
    if not os.path.exists(QUEUE_FILE):
        return []
    out = []
    with open(QUEUE_FILE, encoding="utf-8") as f:
        for line in f:
            m = line.strip()
            if m and m not in out:
                out.append(m)
    return out


def append_queue(msisdn):
    with open(QUEUE_FILE, "a", encoding="utf-8") as f:
        f.write(msisdn + "\n")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload, ctype="application/json"):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome Private Network Access preflight (public site -> localhost)
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path == "/health":
            self._send(200, {"ok": True})
        elif path == "/queue":
            pending = read_pending()
            self._send(200, {"count": len(pending), "pending": pending})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path != "/buy":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._send(400, {"error": "invalid JSON body"})
            return
        msisdn = str(data.get("msisdn") or "").strip()
        if not MSISDN_RE.match(msisdn):
            self._send(400, {"error": "msisdn must be exactly 10 digits"})
            return
        dup = is_queued(msisdn)
        if not dup:
            append_queue(msisdn)
            print(f"[bridge] queued {msisdn}")
        else:
            print(f"[bridge] {msisdn} already queued/processed — ignoring duplicate")
        self._send(200, {"queued": True, "msisdn": msisdn, "alreadyQueued": dup})

    def log_message(self, fmt, *args):
        print("[bridge %s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Local HTTP bridge for the web app -> buy_worker.")
    ap.add_argument("--host", default=HOST, help="bind address (default 127.0.0.1)")
    ap.add_argument("--port", type=int, default=PORT, help="port (default 8765)")
    ap.add_argument("--auto-worker", action="store_true",
                    help="also start buy_worker.py --watch in the background")
    args = ap.parse_args()

    if args.auto_worker:
        try:
            flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
            proc = subprocess.Popen(
                [sys.executable, WORKER_PY, "--watch"],
                cwd=HERE, creationflags=flags,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"[bridge] auto-started buy_worker.py --watch (pid {proc.pid})")
        except Exception as e:
            print(f"[bridge] could not auto-start worker: {e}")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[bridge] listening on http://{args.host}:{args.port}")
    print(f"[bridge] queue file: {QUEUE_FILE}")
    print("[bridge] keep this running while you use 'ซื้อ' in the web app")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] stopped")


if __name__ == "__main__":
    main()
