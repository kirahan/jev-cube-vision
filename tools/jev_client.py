"""Minimal HTTP client for self-hosted JEV POST /v1/decide.

Env:
  JEV_URL      base URL, with or without trailing /v1 (both normalized)
  JEV_API_KEY  optional Bearer token

Text and multimodal (VL) decide share the same endpoint. For images, pass
state as a list mixing strings and {"image": "<url or data URL>"} parts via
decide_mm().
"""
from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.request
from typing import Any


def normalize_base(url: str | None) -> str | None:
    if not url:
        return None
    u = url.strip().rstrip("/")
    if u.endswith("/v1"):
        u = u[: -len("/v1")]
    return u.rstrip("/") or None


def decide_url(base: str) -> str:
    return f"{base.rstrip('/')}/v1/decide"


class DecideResult:
    __slots__ = ("choice", "probabilities", "options", "elapsed_seconds", "raw", "dry_run")

    def __init__(
        self,
        choice: str,
        probabilities: list[float],
        options: list[str],
        elapsed_seconds: float,
        raw: dict[str, Any] | None = None,
        dry_run: bool = False,
    ):
        self.choice = choice
        self.probabilities = probabilities
        self.options = options
        self.elapsed_seconds = elapsed_seconds
        self.raw = raw or {}
        self.dry_run = dry_run

    def as_dict(self) -> dict[str, float]:
        return dict(zip(self.options, self.probabilities))

    def format_probs(self, top: int = 4) -> str:
        pairs = sorted(self.as_dict().items(), key=lambda x: -x[1])[:top]
        return "  ".join(f"{k}={v:.3f}" for k, v in pairs)


def _fake_choice(options: list[str], rng: random.Random | None) -> DecideResult:
    r = rng or random.Random()
    choice = r.choice(options)
    probs = [0.05] * len(options)
    idx = options.index(choice)
    probs[idx] = 0.05 + 0.7
    s = sum(probs)
    probs = [p / s for p in probs]
    return DecideResult(choice, probs, list(options), 0.0, dry_run=True)


def _parse_decide_response(
    data: dict[str, Any],
    options: list[str],
    wall: float,
) -> DecideResult:
    opts = list(data.get("options") or options)
    probs = list(data.get("probabilities") or [])
    if len(probs) != len(opts):
        probs = [1.0 / len(opts)] * len(opts)
    choice = data.get("choice")
    if choice is None and "choice_index" in data:
        ci = int(data["choice_index"])
        choice = opts[ci] if 0 <= ci < len(opts) else opts[0]
    if choice not in opts:
        choice = opts[max(range(len(opts)), key=lambda i: probs[i])]
    elapsed = float(data.get("elapsed_seconds", wall))
    return DecideResult(str(choice), [float(p) for p in probs], opts, elapsed, raw=data)


def _post_decide(body: dict[str, Any], timeout: float) -> DecideResult:
    base = normalize_base(os.environ.get("JEV_URL"))
    assert base is not None
    key = os.environ.get("JEV_API_KEY")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(decide_url(base), data=payload, headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e
    wall = time.perf_counter() - t0
    return _parse_decide_response(data, list(body.get("options") or []), wall)


def decide(
    state: Any,
    question: str,
    options: list[str],
    *,
    dry_run: bool = False,
    timeout: float = 120.0,
    rng: random.Random | None = None,
) -> DecideResult:
    """POST {JEV_URL}/v1/decide with kind=choice, or fake a legal pick in dry-run."""
    if len(options) < 2:
        raise ValueError("choice requires at least 2 options")
    if dry_run or not normalize_base(os.environ.get("JEV_URL")):
        return _fake_choice(options, rng)

    body = {
        "kind": "choice",
        "state": state if isinstance(state, (str, dict, list)) else json.dumps(state, ensure_ascii=False),
        "question": question,
        "options": list(options),
    }
    return _post_decide(body, timeout)


def _normalize_state_part(part: Any) -> Any:
    """Keep strings/dicts as-is; coerce other values to JSON text."""
    if isinstance(part, str):
        return part
    if isinstance(part, dict) and "image" in part:
        img = part["image"]
        if not isinstance(img, str):
            raise TypeError('state image part must be {"image": "<url or data URL>"}')
        return {"image": img}
    if isinstance(part, (dict, list)):
        return json.dumps(part, ensure_ascii=False)
    return str(part)


def decide_mm(
    state_parts: list[Any],
    question: str,
    options: list[str],
    *,
    dry_run: bool = False,
    timeout: float = 300.0,
    rng: random.Random | None = None,
    kind: str = "choice",
) -> DecideResult:
    """Multimodal decide: state is a list mixing text and {"image": data/URL} parts.

    Example state_parts:
      ["Board:\\n", {"image": "data:image/png;base64,..."}, "\\nLegend: ..."]

    Posts the same /v1/decide endpoint as decide(); VL servers (JEV-27B-VL /
    serve_decide.py) accept images inside state. Dry-run fakes a legal choice
    without contacting the server.
    """
    if kind == "choice" and len(options) < 2:
        raise ValueError("choice requires at least 2 options")
    if dry_run or not normalize_base(os.environ.get("JEV_URL")):
        return _fake_choice(list(options), rng)

    parts = [_normalize_state_part(p) for p in state_parts]
    body: dict[str, Any] = {
        "kind": kind,
        "state": parts,
        "question": question,
    }
    if kind == "choice":
        body["options"] = list(options)
    return _post_decide(body, timeout)
