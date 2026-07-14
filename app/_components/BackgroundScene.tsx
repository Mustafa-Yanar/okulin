'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Arka plan sahnesi ───────────────────────────────────────────────────────
// Panel içeriğinin ARKASINDA (fixed, z-0, pointer-events:none) çalışan enerjik
// hareketli sahne. 12 motor + "Kapalı". Kişisel tercih localStorage'da tutulur;
// seçici (BackgroundScenePicker) sidebar'da, aynı olay/anahtarla senkron.
//
// Performans: yalnız AKTİF motor DOM'da + çalışır (mod değişince öncekini söker),
// sekme gizliyken RAF durur, prefers-reduced-motion'da tek kare, mobilde parçacık az.
// --brand white-label ile dinamik → tek-renk motorlar (net) ve çok-renk paletin ilk
// rengi kurum markasını izler; diğer aksanlar dekoratif sabit festival paleti.

export interface BgSceneDef { key: string; name: string; swatch: string }

export const BG_SCENES: BgSceneDef[] = [
  { key: 'combo',   name: 'Mesh + Ağ',    swatch: 'linear-gradient(135deg,var(--brand,#6366f1),var(--teal))' },
  { key: 'conic',   name: 'Conic Dönen',  swatch: 'conic-gradient(var(--brand,#6366f1),var(--pink),var(--amber),var(--teal),var(--brand,#6366f1))' },
  { key: 'plasma',  name: 'Plazma',       swatch: 'radial-gradient(circle at 30% 30%,var(--pink),var(--brand,#6366f1))' },
  { key: 'twinkle', name: 'Parıltı',      swatch: 'radial-gradient(circle at 50% 40%,var(--brand,#6366f1),#0c0a1a)' },
  { key: 'dalga',   name: 'Dalga',        swatch: 'linear-gradient(120deg,var(--brand,#6366f1),var(--teal))' },
  { key: 'nokta',   name: 'Nokta Işıltı', swatch: 'radial-gradient(var(--brand,#6366f1) 30%,transparent 32%)' },
  { key: 'ripple',  name: 'Nabız',        swatch: 'radial-gradient(circle,transparent 40%,var(--brand,#6366f1) 42%,transparent 52%)' },
  { key: 'flow',    name: 'Akış',         swatch: 'linear-gradient(120deg,var(--teal),var(--brand,#6366f1),var(--pink))' },
  { key: 'sparks',  name: 'Kıvılcım',     swatch: 'radial-gradient(circle at 35% 35%,var(--amber),var(--pink),var(--brand,#6366f1))' },
  { key: 'vortex',  name: 'Girdap',       swatch: 'conic-gradient(var(--brand,#6366f1),var(--teal),var(--pink),var(--amber),var(--brand,#6366f1))' },
  { key: 'bubbles', name: 'Baloncuk',     swatch: 'radial-gradient(circle at 40% 60%,var(--teal),var(--brand,#6366f1))' },
  { key: 'neon',    name: 'Neon Çizgi',   swatch: 'linear-gradient(120deg,var(--pink),var(--brand,#6366f1),var(--teal))' },
  { key: 'off',     name: 'Kapalı',       swatch: 'var(--bg-muted)' },
];

export const BG_SCENE_DEFAULT = 'combo';
const LS_KEY = 'okulin:bgscene';
const EVENT = 'okulin:bgscene';

export function getBgScene(): string {
  if (typeof window === 'undefined') return BG_SCENE_DEFAULT;
  try { return localStorage.getItem(LS_KEY) || BG_SCENE_DEFAULT; } catch { return BG_SCENE_DEFAULT; }
}

export function setBgScene(key: string): void {
  try { localStorage.setItem(LS_KEY, key); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────
type Engine = { stop: () => void };
type EngineFactory = (cv: HTMLCanvasElement, reduce: boolean, mobile: boolean) => Engine;

function brandColor(): string {
  if (typeof window === 'undefined') return '#6366f1';
  return getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#6366f1';
}
function palette(): string[] {
  return [brandColor(), '#10c4ac', '#ff4d8d', '#ffab2e', '#ff6a48', '#9a5cff'];
}
const rnd = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// ── Motor: Mesh+Ağ'ın "ağ" katmanı (hareketli nokta + yakınlık çizgileri) ──
const net: EngineFactory = (cv, reduce, mobile) => {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, raf = 0;
  let pts: { x: number; y: number; vx: number; vy: number }[] = [];
  function init() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    const n = Math.min(mobile ? 34 : 70, Math.round(W * H / (mobile ? 44000 : 26000)));
    pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .45, vy: (Math.random() - .5) * .45 }));
  }
  function draw() {
    const c = brandColor();
    ctx.clearRect(0, 0, W, H);
    for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy);
      if (d < 135) { ctx.globalAlpha = (1 - d / 135) * .35; ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); }
    }
    ctx.globalAlpha = .6; ctx.fillStyle = c;
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 7); ctx.fill(); }
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  init(); const rz = () => init(); addEventListener('resize', rz); draw();
  return { stop() { cancelAnimationFrame(raf); removeEventListener('resize', rz); ctx.clearRect(0, 0, W, H); } };
};

const flow: EngineFactory = (cv, reduce, mobile) => {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, raf = 0, t = 0;
  let ps: { x: number; y: number; c: string }[] = [];
  const PAL = palette();
  function init() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    const n = Math.min(mobile ? 70 : 140, Math.round(W * H / (mobile ? 22000 : 13000)));
    ps = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, c: rnd(PAL) }));
  }
  function draw() {
    t += 0.003; ctx.clearRect(0, 0, W, H); ctx.globalAlpha = .55;
    for (const p of ps) { const ang = Math.sin(p.x * 0.0016 + t) + Math.cos(p.y * 0.0016 - t); p.x += Math.cos(ang) * 1.4; p.y += Math.sin(ang) * 1.4; if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  init(); const rz = () => init(); addEventListener('resize', rz); draw();
  return { stop() { cancelAnimationFrame(raf); removeEventListener('resize', rz); ctx.clearRect(0, 0, W, H); } };
};

const sparks: EngineFactory = (cv, reduce, mobile) => {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, raf = 0;
  let ps: { x: number; y: number; vx: number; vy: number; r: number; c: string; ph: number }[] = [];
  const PAL = palette();
  function init() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    const n = Math.min(mobile ? 48 : 95, Math.round(W * H / (mobile ? 32000 : 19000)));
    ps = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .7, vy: (Math.random() - .5) * .7, r: 1 + Math.random() * 2.4, c: rnd(PAL), ph: Math.random() * 6 }));
  }
  function draw(now: number) {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0; const tw = .5 + .5 * Math.sin(now * 0.004 + p.ph); ctx.globalAlpha = .35 + tw * .55; ctx.shadowBlur = 10; ctx.shadowColor = p.c; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (.7 + tw * .6), 0, 7); ctx.fill(); }
    ctx.shadowBlur = 0;
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  init(); const rz = () => init(); addEventListener('resize', rz); if (reduce) draw(0); else raf = requestAnimationFrame(draw);
  return { stop() { cancelAnimationFrame(raf); removeEventListener('resize', rz); ctx.clearRect(0, 0, W, H); } };
};

const vortex: EngineFactory = (cv, reduce, mobile) => {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, raf = 0, cx = 0, cy = 0;
  let ps: { a: number; r: number; sp: number; c: string; rr: number }[] = [];
  const PAL = palette();
  function init() {
    W = cv.width = innerWidth; H = cv.height = innerHeight; cx = W / 2; cy = H / 2; const m = Math.min(W, H);
    const n = Math.min(mobile ? 72 : 150, Math.round(W * H / (mobile ? 20000 : 12000)));
    ps = Array.from({ length: n }, () => { const r = 40 + Math.random() * m * 0.55; return { a: Math.random() * 6.28, r, sp: (0.001 + Math.random() * 0.005) * (1.1 - r / m), c: rnd(PAL), rr: 1 + Math.random() * 2.2 }; });
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) { p.a += p.sp; const x = cx + Math.cos(p.a) * p.r, y = cy + Math.sin(p.a) * p.r; ctx.globalAlpha = .5; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(x, y, p.rr, 0, 7); ctx.fill(); }
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  init(); const rz = () => init(); addEventListener('resize', rz); draw();
  return { stop() { cancelAnimationFrame(raf); removeEventListener('resize', rz); ctx.clearRect(0, 0, W, H); } };
};

const bubbles: EngineFactory = (cv, reduce, mobile) => {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, raf = 0;
  type B = { x: number; y: number; r: number; sp: number; ph: number; am: number; c: string };
  let ps: B[] = [];
  const PAL = palette();
  const mk = (): B => ({ x: Math.random() * W, y: H + 30, r: 8 + Math.random() * 30, sp: .4 + Math.random() * 1.1, ph: Math.random() * 6, am: 10 + Math.random() * 28, c: rnd(PAL) });
  function init() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    const n = Math.min(mobile ? 22 : 42, Math.round(W * H / (mobile ? 60000 : 38000)));
    ps = Array.from({ length: n }, () => { const b = mk(); b.y = Math.random() * H; return b; });
  }
  function draw(now: number) {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < ps.length; i++) { const p = ps[i]; p.y -= p.sp; const x = p.x + Math.sin(now * 0.001 + p.ph) * p.am; if (p.y + p.r < 0) ps[i] = mk(); ctx.globalAlpha = .26; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 7); ctx.fill(); ctx.globalAlpha = .6; ctx.lineWidth = 1.5; ctx.strokeStyle = p.c; ctx.stroke(); }
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  init(); const rz = () => init(); addEventListener('resize', rz); if (reduce) draw(0); else raf = requestAnimationFrame(draw);
  return { stop() { cancelAnimationFrame(raf); removeEventListener('resize', rz); ctx.clearRect(0, 0, W, H); } };
};

const neon: EngineFactory = (cv, reduce, mobile) => {
  const ctx = cv.getContext('2d')!;
  let W = 0, H = 0, raf = 0, t = 0;
  let ps: { x: number; y: number; tr: number[][]; c: string }[] = [];
  const PAL = palette();
  function init() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    const n = Math.min(mobile ? 26 : 52, Math.round(W * H / (mobile ? 50000 : 30000)));
    ps = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, tr: [], c: rnd(PAL) }));
  }
  function draw() {
    t += 0.003; ctx.clearRect(0, 0, W, H); ctx.lineWidth = 2; ctx.shadowBlur = 8;
    for (const p of ps) { const ang = Math.sin(p.x * 0.0015 + t) + Math.cos(p.y * 0.0015 - t); p.x += Math.cos(ang) * 2; p.y += Math.sin(ang) * 2; if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.tr = []; } p.tr.push([p.x, p.y]); if (p.tr.length > 14) p.tr.shift(); ctx.shadowColor = p.c; ctx.strokeStyle = p.c; ctx.globalAlpha = .6; ctx.beginPath(); for (let i = 0; i < p.tr.length; i++) { const q = p.tr[i]; if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } ctx.stroke(); }
    ctx.shadowBlur = 0;
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  init(); const rz = () => init(); addEventListener('resize', rz); draw();
  return { stop() { cancelAnimationFrame(raf); removeEventListener('resize', rz); ctx.clearRect(0, 0, W, H); } };
};

const ENGINES: Record<string, EngineFactory> = { combo: net, flow, sparks, vortex, bubbles, neon };
const CANVAS_MODES = new Set(['combo', 'flow', 'sparks', 'vortex', 'bubbles', 'neon']);

export default function BackgroundScene() {
  const [mode, setMode] = useState<string>(BG_SCENE_DEFAULT);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const twinkleRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Engine | null>(null);

  // İlk tercih + diğer bileşenlerden (seçici) ve sekmelerden gelen değişiklikler.
  useEffect(() => {
    setMode(getBgScene());
    const onEvt = (e: Event) => setMode((e as CustomEvent<string>).detail);
    const onStorage = (e: StorageEvent) => { if (e.key === LS_KEY && e.newValue) setMode(e.newValue); };
    window.addEventListener(EVENT, onEvt);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(EVENT, onEvt); window.removeEventListener('storage', onStorage); };
  }, []);

  // Aktif motoru başlat/durdur; sekme gizliyken duraklat.
  useEffect(() => {
    activeRef.current?.stop();
    activeRef.current = null;
    if (mode === 'off') return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = innerWidth < 768;

    // JS ile üretilen DOM'lu sahneler (parıltı noktaları / nabız halkaları)
    if (mode === 'twinkle' && twinkleRef.current) {
      const el = twinkleRef.current; el.innerHTML = '';
      const n = mobile ? 34 : 60;
      for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'bgs-tw'; const s = 2 + Math.random() * 3.5; d.style.cssText = `width:${s}px;height:${s}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${(-Math.random() * 3).toFixed(1)}s`; el.appendChild(d); }
    }
    if (mode === 'ripple' && rippleRef.current) {
      const el = rippleRef.current; el.innerHTML = '';
      const rc = ['var(--brand,#6366f1)', 'var(--teal)', 'var(--pink)', 'var(--amber)'];
      ([[25, 35], [75, 30], [60, 75], [30, 70], [50, 50]] as const).forEach((pos, i) => { const r = document.createElement('div'); r.className = 'bgs-ring'; r.style.cssText = `left:${pos[0]}%;top:${pos[1]}%;--tint:${rc[i % rc.length]};animation-delay:${(-i * 0.9).toFixed(1)}s`; el.appendChild(r); });
    }

    // Canvas motorları — sekme görünürlüğüne göre başlat/durdur.
    const factory = ENGINES[mode];
    const isCanvas = CANVAS_MODES.has(mode);
    function start() {
      if (!isCanvas || !factory || !canvasRef.current || activeRef.current) return;
      activeRef.current = factory(canvasRef.current, reduce, mobile);
    }
    function onVis() {
      if (document.hidden) { activeRef.current?.stop(); activeRef.current = null; }
      else if (!reduce) start();
    }
    start();
    if (isCanvas && !reduce) document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); activeRef.current?.stop(); activeRef.current = null; };
  }, [mode]);

  // Fare paralaksı (masaüstü + hareket açık).
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (matchMedia('(hover: none)').matches) return;
    const onMove = (e: MouseEvent) => { const x = (e.clientX / innerWidth - .5), y = (e.clientY / innerHeight - .5); if (rootRef.current) rootRef.current.style.transform = `translate(${x * 20}px,${y * 20}px)`; };
    addEventListener('mousemove', onMove, { passive: true });
    return () => removeEventListener('mousemove', onMove);
  }, []);

  const hasCanvas = CANVAS_MODES.has(mode);
  return (
    <div className="bgscene" ref={rootRef} data-mode={mode} aria-hidden="true">
      {mode === 'combo' && <div className="bgs-mesh" />}
      {mode === 'conic' && <div className="bgs-conic" />}
      {mode === 'plasma' && <div className="bgs-plasma" />}
      {mode === 'twinkle' && <div className="bgs-twinkle" ref={twinkleRef} />}
      {mode === 'dalga' && <><div className="bgs-wv" /><div className="bgs-wv bgs-wv2" /></>}
      {mode === 'nokta' && <><div className="bgs-grid" /><div className="bgs-gb" /></>}
      {mode === 'ripple' && <div className="bgs-ripple" ref={rippleRef} />}
      {hasCanvas && <canvas key={mode} ref={canvasRef} className="bgs-cv" />}
      {mode !== 'off' && <div className="bgs-grain" />}
    </div>
  );
}
