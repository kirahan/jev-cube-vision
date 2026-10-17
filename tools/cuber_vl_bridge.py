#!/usr/bin/env python3
"""CORS bridge: VL page → JEV /v1/decide (avoids browser CORS to tunnel)."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from jev_client import decide_mm, normalize_base  # noqa: E402

def _load_dotenv() -> None:
    env_path = ROOT.parent / ".env"
    if not env_path.is_file():
        env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


_load_dotenv()
os.environ.setdefault(
    "JEV_URL",
    "https://jay-publications-dude-passed.trycloudflare.com",
)


BASIC = ["U", "U'", "U2", "D", "D'", "D2", "L", "L'", "L2", "R", "R'", "R2", "F", "F'", "F2", "B", "B'", "B2"]

QUESTION = (
    "You are looking at a scrambled 3x3 Rubik's Cube from a fixed human camera "
    "(same pose as a physical cube on a table: you can see roughly U, F, and R only — "
    "NOT the back, left, or bottom fully). "
    "Pick ONE Singmaster face turn to apply next toward solving. "
    "Do not undo the previous move; avoid repeating the same face."
)

LEGEND = (
    "Singmaster options are U/D/L/R/F/B with ' and 2. "
    "Colors: white≈U, yellow≈D, green≈F, blue≈B, orange≈L, red≈R. "
    "Image is a single human view — no net."
)


def invert_one(move: str) -> str:
    if move.endswith("2"):
        return move
    if move.endswith("'"):
        return move[0]
    return move[0] + "'"


def filter_options(history: list[str]) -> list[str]:
    opts = list(BASIC)
    if not history:
        return opts
    last = history[-1]
    inv = invert_one(last)
    opts = [m for m in opts if m != inv]
    if len(history) >= 2 and history[-1][0] == history[-2][0]:
        face = history[-1][0]
        opts = [m for m in opts if m[0] != face]
    return opts if len(opts) >= 2 else list(BASIC)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/health":
            base = normalize_base(os.environ.get("JEV_URL"))
            body = json.dumps({"ok": True, "jev": bool(base), "jev_url": base or None}).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/decide":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._json(400, {"error": f"bad json: {e}"})
            return
        image = data.get("image")
        if not image or not isinstance(image, str):
            self._json(400, {"error": "image (data URL) required"})
            return
        history = list(data.get("history") or [])
        step = int(data.get("step") or len(history))
        scramble = str(data.get("scramble") or "")
        dry = bool(data.get("dry_run")) or not normalize_base(os.environ.get("JEV_URL"))
        opts = filter_options(history)
        text = (
            f"Step {step}. Scramble: {scramble or '(unknown)'}. "
            f"Moves so far: {' '.join(history) if history else '(none)'}.\n{LEGEND}"
        )
        parts = [text + "\n", {"image": image}, "\nChoose the next face turn."]
        try:
            res = decide_mm(parts, QUESTION, opts, dry_run=dry, timeout=180.0)
        except Exception as e:
            self._json(502, {"error": str(e)})
            return
        self._json(
            200,
            {
                "choice": res.choice,
                "probabilities": res.probabilities,
                "options": res.options,
                "elapsed_seconds": res.elapsed_seconds,
                "dry_run": res.dry_run,
                "top": sorted(
                    zip(res.options, res.probabilities), key=lambda x: -x[1]
                )[:4],
            },
        )

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    port = int(os.environ.get("VL_BRIDGE_PORT", "8767"))
    if not normalize_base(os.environ.get("JEV_URL")):
        print("WARN: JEV_URL unset — /decide will dry-run", file=sys.stderr)
    else:
        print(f"JEV_URL={os.environ['JEV_URL']}", file=sys.stderr)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"cuber VL bridge http://127.0.0.1:{port}/decide", file=sys.stderr)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
