/**
 * VL shell on huazhechen/cuber: legal scramble + JEV decide loop.
 * Bridge: http://127.0.0.1:8767/decide → JEV_URL (default public trycloudflare)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import World from "./cuber/world";
import { TwistAction } from "./cuber/twister";
import Toucher from "./vue/Viewport/toucher";
import { configureRenderer } from "./cuber/three-compat";
import { PreferanceData } from "./data";

const MOVES = ["U", "U'", "U2", "D", "D'", "D2", "L", "L'", "L2", "R", "R'", "R2", "F", "F'", "F2", "B", "B'", "B2"];
const BRIDGE = "http://127.0.0.1:8767";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeScramble(seed: number, n = 8): string {
  const rnd = mulberry32(seed);
  const faces = ["U", "D", "L", "R", "F", "B"];
  const mods = ["", "'", "2"];
  const out: string[] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    let f = Math.floor(rnd() * 6);
    while (f === last) f = Math.floor(rnd() * 6);
    last = f;
    out.push(faces[f] + mods[Math.floor(rnd() * 3)]);
  }
  return out.join(" ");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function App() {
  const host = useRef<HTMLDivElement>(null);
  const historyRef = useRef<string[]>([]);
  const scrambleRef = useRef("");
  const autoStopRef = useRef(false);
  const snapshotRef = useRef<() => string>(() => "");
  const applyFastRef = useRef<(m: string) => void>(() => {});

  const [scrambleStr, setScrambleStr] = useState("");
  const [seed, setSeed] = useState(42);
  const [info, setInfo] = useState("huazhechen/cuber · 接 JEV 中");
  const [history, setHistory] = useState<string[]>([]);
  const [lastChoice, setLastChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);

  const ctx = useMemo(() => {
    const world = new World();
    world.controller.lock = true;
    const preferance = new PreferanceData(world);
    preferance.scale = 70;
    preferance.perspective = 45;
    return { world, preferance };
  }, []);

  const renderer = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.id = "vl-canvas";
    canvas.style.outline = "none";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const instance = configureRenderer(
      new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true }),
    );
    instance.autoClear = false;
    instance.setClearColor(0x12151c, 1);
    instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    return instance;
  }, []);

  const draw = useCallback(() => {
    if (ctx.world.dirty || ctx.world.cube.dirty) {
      renderer.clear();
      renderer.render(ctx.world.scene, ctx.world.camera);
      ctx.world.dirty = false;
      ctx.world.cube.dirty = false;
    }
  }, [ctx.world, renderer]);

  const resize = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = Math.max(1, el.clientHeight);
    ctx.world.width = w;
    ctx.world.height = h;
    ctx.world.resize();
    renderer.setSize(w, h, true);
    ctx.world.dirty = true;
  }, [ctx.world, renderer]);

  const resetCube = useCallback(() => {
    autoStopRef.current = true;
    setAutoOn(false);
    ctx.world.cube.twister.twist(new TwistAction("#"), true, true);
    setScrambleStr("");
    scrambleRef.current = "";
    historyRef.current = [];
    setHistory([]);
    setLastChoice("");
    setInfo("已还原");
    ctx.world.dirty = true;
  }, [ctx.world]);

  const applyMove = useCallback(
    (move: string, fast = false) => {
      ctx.world.cube.twister.twist(new TwistAction(move), fast, fast);
      ctx.world.dirty = true;
    },
    [ctx.world],
  );

  const doScramble = useCallback(
    (s = seed, turns = 8) => {
      autoStopRef.current = true;
      setAutoOn(false);
      ctx.world.cube.twister.twist(new TwistAction("#"), true, true);
      const exp = makeScramble(s, turns);
      ctx.world.cube.twister.setup(exp);
      setScrambleStr(exp);
      scrambleRef.current = exp;
      setSeed(s);
      historyRef.current = [];
      setHistory([]);
      setLastChoice("");
      setInfo(`seed=${s} · ${turns} turns · 合法面转`);
      ctx.world.dirty = true;
      return exp;
    },
    [ctx.world, seed],
  );

  const snapshot = useCallback(() => {
    // force a paint so preserveDrawingBuffer has content
    renderer.clear();
    renderer.render(ctx.world.scene, ctx.world.camera);
    ctx.world.dirty = false;
    ctx.world.cube.dirty = false;
    return renderer.domElement.toDataURL("image/png");
  }, [ctx.world, renderer]);

  snapshotRef.current = snapshot;
  applyFastRef.current = (m: string) => applyMove(m, true);

  const decideOnce = useCallback(async () => {
    const image = snapshotRef.current();
    const res = await fetch(`${BRIDGE}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        history: historyRef.current,
        scramble: scrambleRef.current,
        step: historyRef.current.length,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as {
      choice: string;
      elapsed_seconds: number;
      dry_run: boolean;
      top: [string, number][];
    };
  }, []);

  const stepJev = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      setInfo("截帧 → JEV 判定中…");
      await sleep(50); // let UI paint
      const data = await decideOnce();
      const move = data.choice;
      applyFastRef.current(move);
      historyRef.current = [...historyRef.current, move];
      setHistory([...historyRef.current]);
      setLastChoice(move);
      const top = (data.top || []).map(([k, v]) => `${k}=${Number(v).toFixed(2)}`).join(" ");
      setInfo(
        `JEV → ${move} · ${data.elapsed_seconds.toFixed(2)}s${data.dry_run ? " · dry-run" : ""} · ${top}`,
      );
    } catch (e) {
      setInfo(`JEV 失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, decideOnce]);

  const runAuto = useCallback(async () => {
    if (autoOn) {
      autoStopRef.current = true;
      setAutoOn(false);
      setInfo("已停止自动");
      return;
    }
    autoStopRef.current = false;
    setAutoOn(true);
    setBusy(true);
    const maxSteps = 40;
    try {
      for (let i = 0; i < maxSteps; i++) {
        if (autoStopRef.current) break;
        setInfo(`自动第 ${i + 1}/${maxSteps} 步 · 请求 JEV…`);
        await sleep(80);
        const data = await decideOnce();
        if (autoStopRef.current) break;
        applyFastRef.current(data.choice);
        historyRef.current = [...historyRef.current, data.choice];
        setHistory([...historyRef.current]);
        setLastChoice(data.choice);
        setInfo(
          `自动 #${i + 1}: ${data.choice} · ${data.elapsed_seconds.toFixed(2)}s${data.dry_run ? " · dry-run" : ""}`,
        );
        await sleep(200);
      }
    } catch (e) {
      setInfo(`自动中断: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAutoOn(false);
      setBusy(false);
    }
  }, [autoOn, decideOnce]);

  useEffect(() => {
    fetch(`${BRIDGE}/health`)
      .then((r) => r.json())
      .then((j) => setBridgeOk(!!j.jev))
      .catch(() => setBridgeOk(false));
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.appendChild(renderer.domElement);
    const toucher = new Toucher();
    toucher.init(renderer.domElement, ctx.world.controller.touch);
    resize();
    window.addEventListener("resize", resize);
    let live = true;
    const loop = () => {
      if (!live) return;
      draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    doScramble(42, 8);
    return () => {
      live = false;
      autoStopRef.current = true;
      window.removeEventListener("resize", resize);
    };
  }, []); // mount once

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "10px 12px",
          borderBottom: "1px solid #2a3140",
          background: "#1a1f2a",
        }}
      >
        <strong>Cuber VL × JEV</strong>
        <span style={{ opacity: 0.75, fontSize: 13 }}>{info}</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          bridge {bridgeOk === null ? "…" : bridgeOk ? "OK" : "离线/dry"}
        </span>
        <label style={{ marginLeft: "auto", fontSize: 13 }}>
          seed{" "}
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
            style={{ width: 72, background: "#12151c", color: "#e8eef7", border: "1px solid #3a4558", borderRadius: 4 }}
          />
        </label>
        <button onClick={() => doScramble(seed, 8)} disabled={busy}>
          打乱
        </button>
        <button onClick={resetCube} disabled={busy && !autoOn}>
          还原
        </button>
        <button className="primary" onClick={stepJev} disabled={busy}>
          JEV 一步
        </button>
        <button className="primary" onClick={runAuto} disabled={busy && !autoOn}>
          {autoOn ? "停止" : "自动跑"}
        </button>
      </header>
      <div ref={host} style={{ flex: 1, minHeight: 0 }} />
      <footer style={{ padding: "8px 12px", borderTop: "1px solid #2a3140", fontSize: 13, background: "#1a1f2a" }}>
        <div>
          scramble: <code>{scrambleStr || "(none)"}</code>
          {lastChoice ? (
            <>
              {" "}
              · last: <code>{lastChoice}</code>
            </>
          ) : null}
        </div>
        <div style={{ marginTop: 4 }}>
          history: <code>{history.length ? history.join(" ") : "(empty)"}</code>
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {MOVES.map((m) => (
            <button key={m} style={{ minWidth: 36 }} disabled={busy} onClick={() => applyMove(m, true)}>
              {m}
            </button>
          ))}
        </div>
      </footer>
      <style>{`
        button { background:#2a3548; color:#e8eef7; border:1px solid #3a4558; border-radius:6px; padding:6px 10px; cursor:pointer; }
        button:hover:not(:disabled) { background:#35425a; }
        button:disabled { opacity:0.45; cursor:not-allowed; }
        button.primary { background:#1f4d7a; border-color:#3a7ab8; }
        button.primary:hover:not(:disabled) { background:#2863a0; }
        code { color:#9ecbff; }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
