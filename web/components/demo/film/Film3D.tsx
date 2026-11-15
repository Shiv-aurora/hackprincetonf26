"use client";
// MayaJaal "film", WebGL edition: the same nine shots as the CSS-3D Film, drawn with three.js.
//
// One stylised city: six hospitals from world.json on a lit ground slab (window bands, roof crosses, soft
// shadow-mapped light), network arcs with live traffic, the Eastbank campus (data store, the MayaJaal
// gateway with the First Sight eye, the decoy twin that rises for the attacker) and the attacker's laptop on
// its own tile at the edge. A single camera rig eases between per-shot framings. Each framing is fitted to the
// frame from the focal objects' bounding points, and a lens shift keeps them clear of the insert panel, so
// consecutive shots read as one continuous fly-through at any resolution.
//
// Labels are DOM billboards (drei Html, fixed readable size). The 2D inserts sit in a layer above the canvas.
// Colours come from the CSS tokens, so dark (projector) and light both work. Reduced motion: the camera
// jumps, loops stop and every moving piece rests at its end state.

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { WORLD } from "@/lib/contracts";
import { cn } from "@/components/ui";
import { useRunFacts, type RunFacts } from "../story/useRunFacts";
import { CopyDialog, FingerprintCard, FirstSightGauge, KeySplit, TrackerDoc } from "./overlays";
import { Sharingan } from "./Sharingan";
import type { Shot } from "./Film";

const ORDER: Shot[] = ["network", "hospital", "request", "firstsight", "transfer", "swap", "tracker", "fingerprint", "disperse"];
const idx = (s: Shot) => ORDER.indexOf(s);

/* ================================================================== world layout (units, y up) */

type V3 = [number, number, number];
const S = 0.3; // world.json grid (0–100) → world units
const add = (p: V3, x: number, y: number, z: number): V3 => [p[0] + x, p[1] + y, p[2] + z];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const easeIO = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const arcPt = (a: V3, b: V3, peak: number, k: number): V3 =>
  [lerp(a[0], b[0], k), lerp(a[1], b[1], k) + 4 * peak * k * (1 - k), lerp(a[2], b[2], k)];

const NAME: Record<string, string> = {
  aur: "St. Aurelia", riv: "Riverside", nor: "Northgate", eas: "Eastbank", wes: "Westfield", lum: "Lumen Labs",
};
const DIMS: Record<string, { w: number; d: number; h: number }> = {
  aur: { w: 3.8, d: 2.8, h: 3.3 },
  riv: { w: 2.9, d: 2.3, h: 1.9 },
  nor: { w: 3.4, d: 2.5, h: 2.7 },
  eas: { w: 3.2, d: 2.5, h: 2.25 },
  wes: { w: 3.0, d: 2.3, h: 2.35 },
  lum: { w: 3.8, d: 2.2, h: 1.35 },
};
interface Hosp { id: string; label: string; kind: string; p: V3; w: number; d: number; h: number }
const HOSP: Hosp[] = WORLD.hospitals.map((h) => ({
  id: h.id, label: NAME[h.id] ?? h.short, kind: h.kind,
  p: [(h.x - 50) * S, 0, -(h.y - 50) * S] as V3,
  ...(DIMS[h.id] ?? { w: 3, d: 2.4, h: 2.2 }),
}));
const HBY = new Map(HOSP.map((h) => [h.id, h]));
const EB = HBY.get(WORLD.entry_point.hospital_id) ?? HOSP[0];
const E = EB.p;
const PAD_H = 0.06;

// Eastbank campus: the data store to the west, the gateway in the forecourt toward the attacker, the twin
// beside the gateway, the attacker's laptop on its own tile beyond the edge of the city.
const REAL = add(E, -3.5, 0, 1.0);
const GATE = add(E, 4.8, 0, 0.8);
const TWIN = add(GATE, 0.9, 0, 3.6);
const LAP = add(E, 12.6, 0, 2.2);
const GROUND = { x0: -15.5, x1: 18.2, z0: -14, z1: 12.4 };
const TILE = 3.2;

const RK = { w: 1.7, d: 1.2, h: 0.24, step: 0.38, base: 0.16, n: 4 };
const RK_H = RK.base + (RK.n - 1) * RK.step + RK.h;
const SLAB_NAMES = ["Backups", "Clinical notes", "Lab results", "Patient records"]; // bottom → top

const GW = { plinth: 1.9, ph: 0.14, post: 0.26, span: 0.78, h: 1.95, beam: 0.3 };
const GATE_TOP = GW.ph + GW.h + GW.beam;
const EYE = add(GATE, 0, GATE_TOP + 0.85, 0);
const SCREEN = add(LAP, -0.15, 1.15, -0.15);

const COPY_A = add(TWIN, 0, RK_H + 0.45, 0);
const COPY_B = add(LAP, 0, 1.1, 0);
const COPY_PEAK = 2.3;
const APEX = arcPt(COPY_A, COPY_B, COPY_PEAK, 0.5);
const BEACON_PEAK = 1.7;
const PKT_A = add(LAP, -0.7, 1.3, 0);
const PKT_B = add(GATE, 2.0, 1.2, 0);
const PKT_HELD = add(GATE, 0, 1.2, 0);

const box = (p: V3, w: number, h: number, d: number): V3[] => {
  const out: V3[] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) out.push([p[0] + x, p[1] + y, p[2] + z]);
  return out;
};
const hospPts = (h: Hosp, extra = 0) => box(h.p, h.w + 0.6, h.h + extra, h.d + 0.6);
const CITY = HOSP.flatMap((h) => hospPts(h, 1.25));
const STACK_PTS = (p: V3, extra = 0.5) => box(p, 2.0, RK_H + extra, 1.5);
const GATE_PTS = box(GATE, 2.0, EYE[1] + 0.7, 2.0);
const LAP_PTS = box(LAP, TILE, 2.6, TILE);

/* ================================================================== camera framings */

type Side = "none" | "right" | "center";
interface Spec { az: number; el: number; pts?: V3[]; look?: V3; dist?: number; insert: Side; panel?: number; pad?: number }
const FOV = 35;

const SPEC: Record<Shot, Spec> = {
  network: { az: 12, el: 50, pts: CITY, insert: "none", pad: 0.05 },
  hospital: { az: 12, el: 40, insert: "none", pad: 0.07, pts: [...hospPts(EB, 1.6), ...STACK_PTS(REAL), add(REAL, -3.0, 0.4, 0.6), ...box(GATE, 2.0, 1.0, 2.0)] },
  request: { az: 34, el: 14, insert: "none", pad: 0.08, pts: [...LAP_PTS, ...GATE_PTS, ...hospPts(EB, 0.4)] },
  firstsight: { az: 22, el: 15, insert: "right", panel: 480, pad: 0.12, pts: [...GATE_PTS, add(GATE, 2.2, 1.2, 0)] },
  transfer: { az: 14, el: 27, insert: "right", panel: 560, pad: 0.07, pts: [...STACK_PTS(TWIN, 1.2), ...LAP_PTS, ...GATE_PTS, add(APEX, 0, 0.8, 0)] },
  swap: { az: -24, el: 30, insert: "right", panel: 560, pad: 0.05, pts: [...STACK_PTS(TWIN, 1.3), ...STACK_PTS(REAL, 1.7), ...hospPts(EB, 1.2), ...GATE_PTS, ...LAP_PTS] },
  tracker: { az: 14, el: 16, look: APEX, dist: 3.1, insert: "center" },
  fingerprint: { az: 16, el: 21, insert: "right", panel: 560, pad: 0.08, pts: [...LAP_PTS, ...GATE_PTS, ...STACK_PTS(TWIN), add(EYE, 0, 1.2, 0)] },
  disperse: { az: 0, el: 58, insert: "right", panel: 560, pad: 0.05, pts: [...HOSP.flatMap((h) => hospPts(h, 2.6)), ...STACK_PTS(REAL, 1.2), add(REAL, 0, 0, 2.2)] },
};

interface Rig { lx: number; ly: number; lz: number; az: number; el: number; ld: number; ox: number; oy: number }
const DEG = Math.PI / 180;
const _fitCam = new THREE.PerspectiveCamera();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Reserved width of the right-hand insert, the same maths the insert layer uses to place the panel. */
function insertRight(side: Side, panel: number, w: number) {
  if (side !== "right") return 0;
  const gap = Math.max(20, w * 0.025);
  const scale = clamp((w * 0.46 - gap) / panel, 0.55, 1);
  return Math.min(w * 0.46, panel * scale + 2 * gap);
}

/** Fit a shot: dolly along the shot's direction until the focus points fill the free rect, then lens-shift. */
function fitShot(shot: Shot, W: number, H: number): Rig {
  const s = SPEC[shot];
  if (s.look && s.dist) return { lx: s.look[0], ly: s.look[1], lz: s.look[2], az: s.az, el: s.el, ld: Math.log(s.dist), ox: 0, oy: 0 };
  const pts = s.pts ?? [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const look = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  const dir = new THREE.Vector3(Math.sin(s.az * DEG) * Math.cos(s.el * DEG), Math.sin(s.el * DEG), Math.cos(s.az * DEG) * Math.cos(s.el * DEG));
  _fitCam.fov = FOV; _fitCam.aspect = W / H; _fitCam.near = 0.5; _fitCam.far = 1000;
  _fitCam.clearViewOffset(); _fitCam.updateProjectionMatrix();
  const pad = s.pad ?? 0.07;
  const right = insertRight(s.insert, s.panel ?? 560, W);
  const rect = { l: W * pad, r: W - Math.max(W * pad, right), t: H * (pad + 0.03), b: H * (1 - pad) };
  let dist = 40;
  const bb = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const measure = () => {
    _fitCam.position.copy(look).addScaledVector(dir, dist);
    _fitCam.lookAt(look);
    _fitCam.updateMatrixWorld();
    bb.x0 = Infinity; bb.x1 = -Infinity; bb.y0 = Infinity; bb.y1 = -Infinity;
    for (const p of pts) {
      _v.set(p[0], p[1], p[2]).project(_fitCam);
      const x = ((_v.x + 1) / 2) * W, y = ((1 - _v.y) / 2) * H;
      bb.x0 = Math.min(bb.x0, x); bb.x1 = Math.max(bb.x1, x); bb.y0 = Math.min(bb.y0, y); bb.y1 = Math.max(bb.y1, y);
    }
  };
  for (let i = 0; i < 12; i++) {
    measure();
    const k = Math.max((bb.x1 - bb.x0) / Math.max(1, rect.r - rect.l), (bb.y1 - bb.y0) / Math.max(1, rect.b - rect.t));
    dist = clamp(dist * Math.pow(k, 0.85), 3, 400);
  }
  measure();
  return {
    lx: look.x, ly: look.y, lz: look.z, az: s.az, el: s.el, ld: Math.log(dist),
    ox: (bb.x0 + bb.x1) / 2 - (rect.l + rect.r) / 2, oy: (bb.y0 + bb.y1) / 2 - (rect.t + rect.b) / 2,
  };
}

/** Critically damped spring (Unity's SmoothDamp): starts and lands softly, stable at any frame time. */
function smooth(cur: number, to: number, vel: number[], i: number, T: number, dt: number) {
  const omega = 2 / T, x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const ch = cur - to, tmp = (vel[i] + omega * ch) * dt;
  vel[i] = (vel[i] - omega * tmp) * e;
  return to + (ch + tmp) * e;
}
const RIG_KEYS = ["lx", "ly", "lz", "az", "el", "ld", "ox", "oy"] as const;

/* ================================================================== palette from the CSS tokens */

const VARS = ["--background", "--surface", "--surface-2", "--border", "--border-strong", "--fg", "--fg-muted", "--fg-subtle",
  "--focus", "--alert", "--alert-bg", "--shadow", "--shadow-bg", "--ok"] as const;
const FALLBACK = ["#0a0a0a", "#111111", "#1a1a1a", "#262626", "#3a3a3a", "#ededed", "#a1a1a1", "#707070",
  "#52a8ff", "#f5a524", "#2a1d05", "#b48cf2", "#1d1430", "#62c073"];

interface Pal {
  dark: boolean;
  bg: THREE.Color; surface2: THREE.Color; fg: THREE.Color; muted: THREE.Color; subtle: THREE.Color;
  focus: THREE.Color; alert: THREE.Color; alertBg: THREE.Color; shadow: THREE.Color; shadowBg: THREE.Color; ok: THREE.Color;
  ground: THREE.Color; grid: THREE.Color; pad: THREE.Color; tile: THREE.Color; edge: THREE.Color;
  body: THREE.Color; bodyEas: THREE.Color; cap: THREE.Color; glass: THREE.Color; glassEas: THREE.Color; unit: THREE.Color;
  door: THREE.Color; cross: THREE.Color; link: THREE.Color; rack: THREE.Color; rackDecoy: THREE.Color; plinth: THREE.Color;
  gate: THREE.Color; device: THREE.Color; screen: THREE.Color; paper: THREE.Color;
}

const _rgbA = { r: 0, g: 0, b: 0 }, _rgbB = { r: 0, g: 0, b: 0 };
/** Mix two colours in sRGB (perceptual) space, as CSS color-mix would. */
function mixS(a: THREE.Color, b: THREE.Color, k: number) {
  a.getRGB(_rgbA, THREE.SRGBColorSpace); b.getRGB(_rgbB, THREE.SRGBColorSpace);
  return new THREE.Color().setRGB(lerp(_rgbA.r, _rgbB.r, k), lerp(_rgbA.g, _rgbB.g, k), lerp(_rgbA.b, _rgbB.b, k), THREE.SRGBColorSpace);
}

function makePalette(key: string): Pal {
  const raw = key.split("|");
  const c = (i: number) => {
    const s = (raw[i] ?? "").trim();
    return new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(s) || /^rgb/i.test(s) ? s : FALLBACK[i]);
  };
  const [bg, , surface2, , , fg, muted, subtle, focus, alert, alertBg, shadow, shadowBg, ok] = VARS.map((_, i) => c(i));
  bg.getRGB(_rgbA, THREE.SRGBColorSpace);
  const dark = 0.2126 * _rgbA.r + 0.7152 * _rgbA.g + 0.0722 * _rgbA.b < 0.5;
  const g = (k: number) => mixS(bg, fg, k);
  const white = new THREE.Color("#ffffff");
  if (dark) {
    const body = g(0.3), glass = mixS(g(0.13), focus, 0.2);
    return {
      dark, bg, surface2, fg, muted, subtle, focus, alert, alertBg, shadow, shadowBg, ok,
      ground: g(0.065), grid: g(0.115), pad: g(0.1), tile: mixS(g(0.07), alert, 0.07), edge: g(0.04),
      body, bodyEas: mixS(g(0.36), focus, 0.1), cap: g(0.38), glass, glassEas: mixS(glass, focus, 0.38), unit: g(0.34),
      door: g(0.07), cross: mixS(body, focus, 0.5), link: g(0.26), rack: mixS(g(0.3), focus, 0.08),
      rackDecoy: mixS(g(0.22), shadow, 0.5), plinth: g(0.17), gate: g(0.5), device: g(0.3), screen: mixS(bg, alert, 0.08), paper: g(0.14),
    };
  }
  const glass = mixS(g(0.2), focus, 0.22);
  return {
    dark, bg, surface2, fg, muted, subtle, focus, alert, alertBg, shadow, shadowBg, ok,
    ground: g(0.05), grid: g(0.1), pad: g(0.012), tile: mixS(g(0.05), alert, 0.08), edge: g(0.12),
    body: white, bodyEas: mixS(white, focus, 0.07), cap: g(0.06), glass, glassEas: mixS(glass, focus, 0.32), unit: g(0.05),
    door: g(0.55), cross: mixS(white, focus, 0.5), link: g(0.3), rack: mixS(g(0.03), focus, 0.06),
    rackDecoy: mixS(white, shadow, 0.34), plinth: g(0.1), gate: white, device: g(0.14), screen: mixS(fg, alert, 0.06), paper: white,
  };
}

function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  return VARS.map((v) => cs.getPropertyValue(v).trim()).join("|");
}

/* ================================================================== scene context */

interface LabelReg { els: Map<string, HTMLDivElement>; packet: THREE.Vector3 }
interface Ctx { pal: Pal; reduce: boolean; shot: Shot; clock: { current: { shot: Shot; start: number; t: number } }; reg: RefObject<LabelReg> }
const SceneCtx = createContext<Ctx | null>(null);
function useCtx() {
  const c = useContext(SceneCtx);
  if (!c) throw new Error("Film3D scene context missing");
  return c;
}

const _o = new THREE.Object3D();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const damp = THREE.MathUtils.damp;

/** Recedes everything inside toward the background colour (0 = full colour, 1 = gone) and gives the group a
 *  gentle scale bump when `pulse` turns on. Children that animate their own colour write `userData.base`. */
function Focus({ position = [0, 0, 0], dim, pulse = false, children }: { position?: V3; dim: number; pulse?: boolean; children: ReactNode }) {
  const { pal, reduce } = useCtx();
  const g = useRef<THREE.Group>(null);
  const st = useRef({ k: -1, was: false, at: -1 });
  useFrame((state, dt) => {
    const grp = g.current;
    if (!grp) return;
    const s = st.current;
    s.k = s.k < 0 || reduce ? dim : damp(s.k, dim, 4, dt);
    const k = s.k * 0.8;
    grp.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!mat || Array.isArray(mat) || !mat.color) return;
      const ud = mat.userData as { base?: THREE.Color; ei?: number };
      if (!ud.base) ud.base = mat.color.clone();
      mat.color.copy(ud.base).lerp(pal.bg, k);
      if (mat.emissive) {
        if (ud.ei == null) ud.ei = mat.emissiveIntensity;
        mat.emissiveIntensity = ud.ei * (1 - k);
      }
    });
    if (pulse && !s.was) s.at = state.clock.elapsedTime + 0.55;
    s.was = pulse;
    const pt = (state.clock.elapsedTime - s.at) / 0.75;
    grp.scale.setScalar(!reduce && pulse && s.at > 0 && pt > 0 && pt < 1 ? 1 + 0.055 * Math.sin(Math.PI * pt) : 1);
  });
  return <group ref={g} position={position}>{children}</group>;
}

/** A flat ring on the ground that expands and fades `repeat` times when `play` turns on. */
function PulseRing({ p, r, color, play, delay = 0.7, repeat = 2 }: { p: V3; r: number; color: THREE.Color; play: boolean; delay?: number; repeat?: number }) {
  const { reduce } = useCtx();
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const st = useRef({ was: false, at: -1 });
  useFrame((state) => {
    const m = mesh.current, mt = mat.current;
    if (!m || !mt) return;
    const s = st.current;
    if (play && !s.was) s.at = state.clock.elapsedTime + delay;
    s.was = play;
    const dur = 1.5;
    const t = state.clock.elapsedTime - s.at;
    const on = play && !reduce && s.at > 0 && t > 0 && t < dur * repeat;
    m.visible = on;
    if (!on) return;
    const u = (t % dur) / dur;
    m.scale.setScalar(0.65 + 0.75 * u);
    mt.opacity = 0.9 * (1 - u) * Math.min(1, u * 8);
  });
  return (
    <mesh ref={mesh} position={[p[0], PAD_H + 0.04, p[2]]} rotation-x={-Math.PI / 2} visible={false} renderOrder={2}>
      <ringGeometry args={[r * 0.94, r, 72]} />
      <meshBasicMaterial ref={mat} color={color} transparent depthWrite={false} />
    </mesh>
  );
}

/** A steady translucent field on the ground (First Sight's scan field, the real store's lock). */
function Halo({ p, r, color, show }: { p: V3; r: number; color: THREE.Color; show: boolean }) {
  const { reduce } = useCtx();
  const grp = useRef<THREE.Group>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const line = useRef<THREE.MeshBasicMaterial>(null);
  const st = useRef({ k: 0 });
  useFrame((_, dt) => {
    const s = st.current;
    s.k = reduce ? (show ? 1 : 0) : damp(s.k, show ? 1 : 0, 4, dt);
    if (grp.current) { grp.current.visible = s.k > 0.01; grp.current.scale.setScalar(0.85 + 0.15 * s.k); }
    if (fill.current) fill.current.opacity = 0.16 * s.k;
    if (line.current) line.current.opacity = 0.9 * s.k;
  });
  return (
    <group ref={grp} position={[p[0], PAD_H + 0.025, p[2]]} rotation-x={-Math.PI / 2} visible={false}>
      <mesh renderOrder={1}><circleGeometry args={[r, 72]} /><meshBasicMaterial ref={fill} color={color} transparent depthWrite={false} /></mesh>
      <mesh renderOrder={1}><ringGeometry args={[r * 0.95, r, 72]} /><meshBasicMaterial ref={line} color={color} transparent depthWrite={false} /></mesh>
    </group>
  );
}

/* ================================================================== labels */

type Tone = "neutral" | "focus" | "alert" | "shadow" | "ok";
const TONE: Record<Tone, string> = {
  neutral: "border-border-strong text-fg",
  focus: "border-focus/60 text-focus",
  alert: "border-alert/70 bg-alert-bg/95 text-alert",
  shadow: "border-shadow/70 bg-shadow-bg/95 text-shadow",
  ok: "border-ok/60 text-ok",
};

interface LabelDef { id: string; at: V3 | "packet"; show: boolean; tone?: Tone; title: ReactNode; sub?: ReactNode; delay?: number; size?: "md" | "lg"; side?: "up" | "left" | "below"; lift?: number }

/** Writes each label's projected screen position (inside the canvas frame loop, after the camera moved). */
function LabelProjector() {
  const { reg } = useCtx();
  useFrame((state) => {
    const r = reg.current;
    if (!r) return;
    state.camera.updateMatrixWorld();
    const W = state.size.width, H = state.size.height;
    for (const el of r.els.values()) {
      const p = el.dataset.p;
      if (!p) continue;
      if (p === "packet") _v.copy(r.packet);
      else { const [x, y, z] = p.split(",").map(Number); _v.set(x, y, z); }
      _v.project(state.camera);
      el.style.transform = `translate3d(${(((_v.x + 1) / 2) * W).toFixed(1)}px,${(((1 - _v.y) / 2) * H).toFixed(1)}px,0)`;
      el.style.visibility = _v.z > 1 ? "hidden" : "visible";
    }
  });
  return null;
}

/** DOM labels above the canvas: fixed readable size, only the current shot's focal objects are shown. */
function LabelLayer({ shot, reduce, reg }: { shot: Shot; reduce: boolean; reg: RefObject<LabelReg> }) {
  const is = (...s: Shot[]) => s.includes(shot);
  const wide = is("network", "disperse");
  const list: LabelDef[] = [
    ...HOSP.map((h, k): LabelDef => {
      const eas = h.id === EB.id;
      return {
        id: `h-${h.id}`, title: h.label, show: wide || (eas && is("hospital", "swap")),
        at: [h.p[0], PAD_H + h.h + (eas && is("hospital") ? 1.2 : is("disperse") && !eas ? 2.0 : 0.8), h.p[2]],
        side: "up", size: eas && is("hospital") ? "lg" : "md", delay: wide ? 0.5 + k * 0.06 : 0.8,
        sub: eas && is("swap") ? <span className="font-medium text-ok">Care keeps running</span> : undefined,
      };
    }),
    ...SLAB_NAMES.map((n, k): LabelDef => ({
      id: `s-${k}`, title: n, side: "left", show: is("hospital"), delay: 1.1 + (RK.n - 1 - k) * 0.1,
      at: add(REAL, -RK.w / 2 - 0.05, PAD_H + RK.base + k * RK.step + RK.h / 2, RK.d / 2),
    })),
    { id: "gate", at: EYE, lift: 56, show: is("request"), title: "MayaJaal gateway", delay: 1.0 },
    { id: "fs", at: EYE, lift: 56, show: is("firstsight"), tone: "alert", title: "First Sight", delay: 0.8 },
    { id: "home", at: EYE, lift: 56, show: is("fingerprint"), tone: "shadow", title: "Trackers call home", delay: 1.2 },
    { id: "lap", at: add(LAP, 0, 2.15, 0), show: is("request", "transfer", "fingerprint"), tone: "alert", title: "Attacker", delay: 0.9 },
    { id: "pkt", at: "packet", show: is("request", "firstsight"), tone: "alert", title: "Stolen nurse login", delay: is("request") ? 1.6 : 0.3 },
    { id: "twin-r", at: add(TWIN, 0, PAD_H + RK_H + 0.75, 0), show: is("transfer"), tone: "focus", title: "Patient records", delay: 1.3 },
    { id: "twin", at: add(TWIN, 0, PAD_H + RK_H + 0.75, 0), show: is("swap"), tone: "shadow", title: "Decoy twin", sub: "Built for this login", size: "lg", delay: 1.0 },
    { id: "real", at: add(REAL, 0, PAD_H + RK_H + 1.4, 0), show: is("swap"), tone: "focus", title: "Real records", sub: "Locked · untouched", size: "lg", delay: 1.3 },
    { id: "live", at: add(REAL, 0, 0, 1.1), show: is("disperse"), tone: "focus", title: "Live records stay", side: "below", delay: 1.0 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      <div data-p={EYE.map((v) => v.toFixed(3)).join(",")} className="absolute top-0 left-0" style={{ transform: "translate3d(-9999px,-9999px,0)" }}
        ref={(el) => { const r = reg.current; if (!r) return; if (el) r.els.set("eye", el); else r.els.delete("eye"); }}>
        <EyeBadge shot={shot} reduce={reduce} />
      </div>
      {list.map((l) => {
        const side = l.side ?? "up";
        const d = l.show ? l.delay ?? 0.9 : 0;
        const place = side === "left" ? "-translate-x-full -translate-y-1/2 pr-1" : side === "below" ? "-translate-x-1/2 pt-2" : "-translate-x-1/2 -translate-y-full pb-1";
        return (
          <div key={l.id} data-p={l.at === "packet" ? "packet" : l.at.map((v) => v.toFixed(3)).join(",")}
            ref={(el) => { const r = reg.current; if (!r) return; if (el) r.els.set(l.id, el); else r.els.delete(l.id); }}
            className="absolute top-0 left-0" style={{ transform: "translate3d(-9999px,-9999px,0)" }}>
            <div className={cn("absolute top-0 left-0", place)} style={l.lift ? { paddingBottom: l.lift } : undefined}>
              <div className="flex items-center gap-2"
                style={{ opacity: l.show ? 1 : 0, translate: l.show ? "0 0" : "0 6px", transition: reduce ? "none" : `opacity 250ms ease ${d}s, translate 250ms ease ${d}s` }}>
                <div className={cn("rounded-md border bg-background/90 px-2 py-0.5 whitespace-nowrap", TONE[l.tone ?? "neutral"], l.size === "lg" && "px-3 py-1")}>
                  <div className={cn("leading-tight font-semibold tracking-[-0.01em]", l.size === "lg" ? "text-[22px]" : "text-[18px]")}>{l.title}</div>
                  {l.sub && <div className="text-[16px] leading-tight font-normal text-fg-muted">{l.sub}</div>}
                </div>
                {side === "left" && <span className="block h-px w-6 bg-focus/70" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The gateway's eye is the logo's red Sharingan (as in the CSS film): a 96px badge whose ring takes the colour
 *  of what is happening (amber suspicious, purple decoy). It turns once when First Sight fires and once more
 *  when the trackers call home; `spin` counts those turns, so stepping back turns it back. */
function EyeBadge({ shot, reduce }: { shot: Shot; reduce: boolean }) {
  const mode = shot === "firstsight" ? "fire" : shot === "transfer" || shot === "swap" ? "watch" : shot === "fingerprint" ? "ping" : "calm";
  const hidden = shot === "network" || shot === "hospital" || shot === "tracker";
  const back = shot === "transfer" || shot === "swap" || shot === "disperse";
  const col = mode === "fire" || mode === "watch" ? "var(--alert)" : mode === "ping" ? "var(--shadow)" : "var(--border-strong)";
  const spin = (idx(shot) >= idx("firstsight") ? 1 : 0) + (idx(shot) >= idx("fingerprint") ? 1 : 0);
  const ease = [0.2, 0.8, 0.2, 1] as const;
  const tr = reduce ? { duration: 0 } : { rotate: { duration: 1.2, ease }, scale: { duration: 0.4, ease } };
  return (
    <motion.div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2"
      initial={{ opacity: hidden ? 0 : back ? 0.5 : 1, scale: back ? 0.75 : 1 }}
      animate={{ opacity: hidden ? 0 : back ? 0.5 : 1, scale: back ? 0.75 : 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, delay: hidden ? 0 : 0.3, ease }}>
      <div className="relative grid size-[96px] place-items-center rounded-full border-[3px] bg-background transition-colors duration-500 motion-reduce:transition-none" style={{ borderColor: col }}>
        <motion.div className="grid place-items-center" initial={{ rotate: spin * 360, scale: mode === "calm" ? 0.92 : 1 }}
          animate={{ rotate: spin * 360, scale: mode === "calm" ? 0.92 : 1 }} transition={tr}>
          <Sharingan className="size-[80px]" />
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ================================================================== ground + buildings */

function Ground() {
  const { pal } = useCtx();
  const grid = useMemo(() => {
    const pts: number[] = [];
    const st = 1.25, y = 0.012;
    for (let x = GROUND.x0 + st; x < GROUND.x1 - 0.01; x += st) pts.push(x, y, GROUND.z0, x, y, GROUND.z1);
    for (let z = GROUND.z0 + st; z < GROUND.z1 - 0.01; z += st) pts.push(GROUND.x0, y, z, GROUND.x1, y, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, []);
  useEffect(() => () => grid.dispose(), [grid]);
  const W = GROUND.x1 - GROUND.x0, D = GROUND.z1 - GROUND.z0;
  return (
    <group>
      <mesh position={[(GROUND.x0 + GROUND.x1) / 2, -0.35, (GROUND.z0 + GROUND.z1) / 2]} receiveShadow>
        <boxGeometry args={[W, 0.7, D]} />
        <meshStandardMaterial color={pal.ground} roughness={1} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={pal.grid} />
      </lineSegments>
    </group>
  );
}

function Pad({ w, d, color }: { w: number; d: number; color: THREE.Color }) {
  return (
    <mesh position={[0, PAD_H / 2, 0]} receiveShadow>
      <boxGeometry args={[w, PAD_H, d]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

function RoofCross({ at, color, size = 0.86 }: { at: V3; color: THREE.Color; size?: number }) {
  return (
    <group position={at}>
      <mesh castShadow><boxGeometry args={[size, 0.09, size * 0.32]} /><meshStandardMaterial color={color} roughness={0.5} /></mesh>
      <mesh castShadow><boxGeometry args={[size * 0.32, 0.09, size]} /><meshStandardMaterial color={color} roughness={0.5} /></mesh>
    </group>
  );
}

function Building({ h }: { h: Hosp }) {
  const { pal } = useCtx();
  const eas = h.id === EB.id;
  const lab = h.kind === "pathology";
  const floors = Math.max(1, Math.floor((h.h - 0.7) / 0.48));
  const base = PAD_H;
  const top = base + h.h;
  const glass = eas ? pal.glassEas : pal.glass;
  return (
    <group>
      <Pad w={h.w + 1.1} d={h.d + 1.1} color={pal.pad} />
      <mesh position={[0, base + h.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[h.w, h.h, h.d]} />
        <meshStandardMaterial color={eas ? pal.bodyEas : pal.body} roughness={0.85} />
      </mesh>
      {Array.from({ length: floors }, (_, i) => (
        <mesh key={i} position={[0, base + 0.86 + i * 0.48, 0]}>
          <boxGeometry args={[h.w + 0.025, 0.17, h.d + 0.025]} />
          <meshStandardMaterial color={glass} roughness={0.3} metalness={0.15} />
        </mesh>
      ))}
      {/* lobby glazing and the entrance canopy on the south face */}
      <mesh position={[-h.w * 0.12, base + 0.27, h.d / 2 + 0.006]}>
        <boxGeometry args={[h.w * 0.5, 0.42, 0.02]} />
        <meshStandardMaterial color={glass} roughness={0.3} metalness={0.15} />
      </mesh>
      <mesh position={[-h.w * 0.12, base + 0.54, h.d / 2 + 0.26]} castShadow>
        <boxGeometry args={[h.w * 0.56, 0.06, 0.5]} />
        <meshStandardMaterial color={pal.cap} roughness={0.8} />
      </mesh>
      {/* roof cap, plant and the cross */}
      <mesh position={[0, top + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[h.w + 0.1, 0.1, h.d + 0.1]} />
        <meshStandardMaterial color={pal.cap} roughness={0.9} />
      </mesh>
      {lab
        ? [-0.3, 0, 0.3].map((k) => (
          <mesh key={k} position={[h.w * k, top + 0.3, -h.d * 0.15]} castShadow>
            <cylinderGeometry args={[0.24, 0.24, 0.42, 20]} />
            <meshStandardMaterial color={pal.unit} roughness={0.6} metalness={0.2} />
          </mesh>
        ))
        : (
          <mesh position={[-h.w * 0.24, top + 0.27, -h.d * 0.16]} castShadow>
            <boxGeometry args={[h.w * 0.3, 0.36, h.d * 0.36]} />
            <meshStandardMaterial color={pal.unit} roughness={0.7} />
          </mesh>
        )}
      {!lab && <RoofCross at={[h.w * 0.2, top + 0.15, h.d * 0.1]} color={eas ? pal.focus : pal.cross} size={eas ? 1.0 : 0.86} />}
      {h.id === "aur" && (
        <mesh position={[h.w * 0.2, top + 0.11, -h.d * 0.0]} receiveShadow>
          <cylinderGeometry args={[0.95, 0.95, 0.02, 40]} />
          <meshStandardMaterial color={pal.cap} roughness={0.9} />
        </mesh>
      )}
      {eas && (
        // Eastbank: a lower wing at the back, so its silhouette is its own
        <mesh position={[h.w * 0.12, base + h.h * 0.32, -h.d / 2 - 0.55]} castShadow receiveShadow>
          <boxGeometry args={[h.w * 0.72, h.h * 0.64, 1.1]} />
          <meshStandardMaterial color={pal.bodyEas} roughness={0.85} />
        </mesh>
      )}
    </group>
  );
}

/** A stack of server slabs (the data store). `decoy` turns it purple: the twin built for the attacker. */
function Rack({ decoy }: { decoy: boolean }) {
  const { pal, reduce } = useCtx();
  const g = useRef<THREE.Group>(null);
  const st = useRef({ k: decoy ? 1 : 0, body: new THREE.Color(), led: new THREE.Color() });
  useFrame((_, dt) => {
    const s = st.current;
    s.k = reduce ? (decoy ? 1 : 0) : damp(s.k, decoy ? 1 : 0, 3, dt);
    s.body.copy(pal.rack).lerp(pal.rackDecoy, s.k);
    s.led.copy(pal.focus).lerp(pal.shadow, s.k);
    g.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || Array.isArray(m) || (m.name !== "rack-body" && m.name !== "rack-led")) return;
      const c = m.name === "rack-body" ? s.body : s.led;
      const ud = m.userData as { base?: THREE.Color };
      (ud.base ??= new THREE.Color()).copy(c);
      if (m.name === "rack-led") m.emissive.copy(c);
    });
  });
  const slabs = Array.from({ length: RK.n }, (_, i) => RK.base + i * RK.step + RK.h / 2);
  return (
    <group ref={g}>
      <Pad w={2.3} d={1.8} color={pal.pad} />
      <mesh position={[0, PAD_H + 0.04, 0]} receiveShadow castShadow>
        <boxGeometry args={[RK.w + 0.2, 0.08, RK.d + 0.2]} />
        <meshStandardMaterial color={pal.plinth} roughness={0.8} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (RK.w / 2 - 0.06), PAD_H + RK_H / 2, -RK.d / 2 + 0.06]} castShadow>
          <boxGeometry args={[0.1, RK_H, 0.1]} />
          <meshStandardMaterial color={pal.plinth} roughness={0.7} />
        </mesh>
      ))}
      {slabs.map((y, i) => (
        <group key={i} position={[0, PAD_H + y, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[RK.w, RK.h, RK.d]} />
            <meshStandardMaterial name="rack-body" color={decoy ? pal.rackDecoy : pal.rack} roughness={0.5} metalness={0.1} />
          </mesh>
          {/* status strip + three lights on the front, a strip on the east side */}
          <mesh position={[-RK.w * 0.18, 0, RK.d / 2 + 0.008]}>
            <boxGeometry args={[RK.w * 0.42, 0.05, 0.02]} />
            <meshStandardMaterial name="rack-led" color={pal.focus} emissive={pal.focus} emissiveIntensity={0.6} roughness={0.4} />
          </mesh>
          {[0, 1, 2].map((j) => (
            <mesh key={j} position={[RK.w / 2 - 0.16 - j * 0.13, 0, RK.d / 2 + 0.008]}>
              <boxGeometry args={[0.06, 0.06, 0.02]} />
              <meshStandardMaterial name="rack-led" color={pal.focus} emissive={pal.focus} emissiveIntensity={0.6} />
            </mesh>
          ))}
          <mesh position={[RK.w / 2 + 0.008, 0, 0.1]}>
            <boxGeometry args={[0.02, 0.05, RK.d * 0.5]} />
            <meshStandardMaterial name="rack-led" color={pal.focus} emissive={pal.focus} emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Padlock({ color, scale = 1 }: { color: THREE.Color; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh castShadow><boxGeometry args={[0.5, 0.4, 0.2]} /><meshStandardMaterial color={color} roughness={0.45} metalness={0.2} /></mesh>
      <mesh position={[0, 0.2, 0]}><torusGeometry args={[0.15, 0.045, 12, 28, Math.PI]} /><meshStandardMaterial color={color} roughness={0.4} metalness={0.3} /></mesh>
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]}><cylinderGeometry args={[0.045, 0.045, 0.1, 12]} /><meshStandardMaterial color={color} roughness={0.4} metalness={0.3} /></mesh>
      ))}
    </group>
  );
}

function Gateway({ glow }: { glow: "calm" | "fire" | "ping" }) {
  const { pal, reduce } = useCtx();
  const strip = useRef<THREE.MeshStandardMaterial>(null);
  const strip2 = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    const to = glow === "fire" ? pal.alert : glow === "ping" ? pal.shadow : pal.subtle;
    for (const m of [strip.current, strip2.current]) {
      if (!m) continue;
      const ud = m.userData as { base?: THREE.Color };
      const b = (ud.base ??= m.color.clone());
      b.lerp(to, reduce ? 1 : 1 - Math.exp(-5 * dt));
      m.emissive.copy(b);
    }
  });
  const postY = GW.ph + GW.h / 2;
  return (
    <group>
      <Pad w={2.5} d={2.5} color={pal.pad} />
      <mesh position={[0, PAD_H + GW.ph / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[GW.plinth, GW.ph, GW.plinth]} />
        <meshStandardMaterial color={pal.plinth} roughness={0.8} />
      </mesh>
      {[-1, 1].map((sz) => (
        <group key={sz} position={[0, PAD_H + postY, sz * GW.span]}>
          <mesh castShadow receiveShadow><boxGeometry args={[GW.post, GW.h, GW.post]} /><meshStandardMaterial color={pal.gate} roughness={0.55} /></mesh>
          {/* scanner strip on the inner face */}
          <mesh position={[0, 0, -sz * (GW.post / 2 + 0.006)]}>
            <boxGeometry args={[0.07, GW.h * 0.82, 0.02]} />
            <meshStandardMaterial ref={sz < 0 ? strip : strip2} color={pal.subtle} emissive={pal.subtle} emissiveIntensity={0.7} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, PAD_H + GW.ph + GW.h + GW.beam / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[GW.post + 0.14, GW.beam, GW.span * 2 + GW.post + 0.3]} />
        <meshStandardMaterial color={pal.gate} roughness={0.55} />
      </mesh>
      <mesh position={[0, PAD_H + GATE_TOP + 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 0.4, 12]} />
        <meshStandardMaterial color={pal.gate} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Laptop() {
  const { pal } = useCtx();
  const lines = [0.62, 0.44, 0.7, 0.36, 0.54];
  return (
    <group>
      {/* its own tile, outside the city */}
      <mesh position={[0, -0.18, 0]} receiveShadow>
        <boxGeometry args={[TILE, 0.36, TILE]} />
        <meshStandardMaterial color={pal.tile} roughness={1} />
      </mesh>
      <Line points={[[-TILE / 2, 0.006, -TILE / 2], [TILE / 2, 0.006, -TILE / 2], [TILE / 2, 0.006, TILE / 2], [-TILE / 2, 0.006, TILE / 2], [-TILE / 2, 0.006, -TILE / 2]]}
        color={pal.alert} lineWidth={2} />
      <group rotation-y={Math.PI / 4}>
        {/* desk */}
        <mesh position={[0, 0.27, 0]} castShadow receiveShadow><boxGeometry args={[1.9, 0.54, 1.2]} /><meshStandardMaterial color={pal.device} roughness={0.8} /></mesh>
        {/* laptop base and keys */}
        <mesh position={[0, 0.575, 0.12]} castShadow receiveShadow><boxGeometry args={[1.25, 0.07, 0.82]} /><meshStandardMaterial color={pal.gate} roughness={0.45} metalness={0.2} /></mesh>
        <mesh position={[0, 0.613, 0.2]}><boxGeometry args={[1.0, 0.01, 0.42]} /><meshStandardMaterial color={pal.plinth} roughness={0.8} /></mesh>
        {/* screen, hinged at the back edge, tilted back, display facing the seat (+z) */}
        <group position={[0, 0.61, -0.29]} rotation-x={-0.22}>
          <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[1.25, 0.84, 0.05]} /><meshStandardMaterial color={pal.gate} roughness={0.45} metalness={0.2} /></mesh>
          <mesh position={[0, 0.42, 0.027]}><boxGeometry args={[1.12, 0.72, 0.005]} /><meshStandardMaterial color={pal.screen} roughness={0.3} /></mesh>
          {lines.map((w, i) => (
            <mesh key={i} position={[-0.47 + w * 0.42, 0.68 - i * 0.12, 0.032]}>
              <boxGeometry args={[w * 0.84, 0.045, 0.004]} />
              <meshStandardMaterial color={pal.alert} emissive={pal.alert} emissiveIntensity={i === 4 ? 0.9 : 0.45} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/* ================================================================== links + traffic */

interface Link { a: string; b: string; curve: THREE.QuadraticBezierCurve3; len: number; eas: boolean }
const LINKS: Link[] = WORLD.links.flatMap(([a, b]) => {
  const A = HBY.get(a), B = HBY.get(b);
  if (!A || !B) return [];
  const pa = new THREE.Vector3(A.p[0], PAD_H + A.h + 0.2, A.p[2]);
  const pb = new THREE.Vector3(B.p[0], PAD_H + B.h + 0.2, B.p[2]);
  const d = pa.distanceTo(pb);
  const mid = pa.clone().add(pb).multiplyScalar(0.5);
  mid.y = Math.max(pa.y, pb.y) + 0.4 + d * 0.11;
  const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
  return [{ a, b, curve, len: curve.getLength(), eas: a === EB.id || b === EB.id }];
});
// Eastbank's own ground cables: to its data store, and in from the gateway.
const CABLES = [
  new THREE.LineCurve3(new THREE.Vector3(E[0] - EB.w / 2, 0.1, REAL[2]), new THREE.Vector3(REAL[0] + 0.9, 0.1, REAL[2])),
  new THREE.LineCurve3(new THREE.Vector3(GATE[0] - 1.0, 0.1, GATE[2]), new THREE.Vector3(E[0] + EB.w / 2, 0.1, GATE[2])),
];

function Links({ dim, hotEas }: { dim: number; hotEas: boolean }) {
  const { pal, reduce } = useCtx();
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const st = useRef({ k: -1, hot: 0 });
  const geos = useMemo(() => LINKS.map((l) => new THREE.TubeGeometry(l.curve, 64, 0.03, 8, false)), []);
  const cables = useMemo(() => CABLES.map((c) => new THREE.TubeGeometry(c, 8, 0.05, 8, false)), []);
  useEffect(() => () => { for (const g of [...geos, ...cables]) g.dispose(); }, [geos, cables]);
  useFrame((_, dt) => {
    const s = st.current;
    s.k = s.k < 0 || reduce ? dim : damp(s.k, dim, 4, dt);
    s.hot = reduce ? (hotEas ? 1 : 0) : damp(s.hot, hotEas ? 1 : 0, 4, dt);
    mats.current.forEach((m, i) => {
      if (!m) return;
      const eas = i >= LINKS.length || LINKS[i].eas;
      const hot = eas ? s.hot : 0;
      m.color.copy(pal.link).lerp(pal.focus, hot * 0.4).lerp(pal.bg, (eas ? s.k * (1 - hot) : s.k) * 0.74);
    });
  });
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g}><meshStandardMaterial ref={(m) => { mats.current[i] = m; }} color={pal.link} roughness={0.6} /></mesh>
      ))}
      {cables.map((g, i) => (
        <mesh key={`c${i}`} geometry={g} receiveShadow><meshStandardMaterial ref={(m) => { mats.current[LINKS.length + i] = m; }} color={pal.link} roughness={0.7} /></mesh>
      ))}
    </group>
  );
}

const DOTS = [
  ...LINKS.flatMap((l, li) => [0, 1, 2].map((j) => ({ curve: l.curve as THREE.Curve<THREE.Vector3>, len: l.len, phase: (j / 3 + li * 0.137) % 1, rev: j === 1, eas: l.eas, cable: false }))),
  ...CABLES.flatMap((c, ci) => [0, 1, 2].map((j) => ({ curve: c as THREE.Curve<THREE.Vector3>, len: c.getLength(), phase: (j / 3 + ci * 0.21) % 1, rev: j === 1, eas: true, cable: true }))),
];

function Traffic() {
  const { pal, reduce, shot } = useCtx();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const sc = useRef<number[]>(DOTS.map(() => 0));
  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    DOTS.forEach((d, i) => {
      const on = shot === "network" ? !d.cable : shot === "hospital" ? d.eas : false;
      sc.current[i] = reduce ? (on ? 1 : 0) : damp(sc.current[i], on ? 1 : 0, 5, dt);
      const k = reduce ? 0.2 + 0.6 * d.phase : (t * (d.cable ? 0.9 : 1.6) / d.len + d.phase) % 1;
      d.curve.getPointAt(d.rev ? 1 - k : k, _v);
      _o.position.copy(_v);
      _o.quaternion.identity();
      _o.scale.setScalar(Math.max(1e-4, sc.current[i] * Math.min(1, k / 0.05, (1 - k) / 0.05)));
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, DOTS.length]} frustumCulled={false}>
      <sphereGeometry args={[0.12, 16, 12]} />
      <meshStandardMaterial color={pal.focus} emissive={pal.focus} emissiveIntensity={0.45} roughness={0.35} />
    </instancedMesh>
  );
}

/* ================================================================== moving pieces */

const NFILE = 8;
const BAR_W = [0.2, 0.14, 0.18];

/** The copy stream: file cards on arcs from the store to the attacker. Blue while it looks real, purple once
 *  the twin is revealed. Plays only during transfer / swap. */
function Files() {
  const { pal, reduce, shot, clock } = useCtx();
  const frame = useRef<THREE.InstancedMesh>(null);
  const paper = useRef<THREE.InstancedMesh>(null);
  const bars = useRef<THREE.InstancedMesh>(null);
  const frameMat = useRef<THREE.MeshStandardMaterial>(null);
  const barMat = useRef<THREE.MeshBasicMaterial>(null);
  const st = useRef({ vis: 0 });
  useFrame((state, dt) => {
    const f = frame.current, pp = paper.current, b = bars.current;
    if (!f || !pp || !b) return;
    const active = shot === "transfer" || shot === "swap";
    const s = st.current;
    s.vis = reduce ? (active ? 1 : 0) : damp(s.vis, active ? 1 : 0, 5, dt);
    const tone = idx(shot) >= idx("swap") ? pal.shadow : pal.focus;
    const kc = reduce ? 1 : 1 - Math.exp(-4 * dt);
    frameMat.current?.color.lerp(tone, kc); barMat.current?.color.lerp(tone, kc);
    const t = clock.current.t;
    const start = shot === "transfer" ? 1.0 : 0;
    const gap = 0.3, dur = 1.8, period = Math.max(dur + 0.25, NFILE * gap);
    for (let i = 0; i < NFILE; i++) {
      let k = 0, o = 0;
      if (reduce) { k = 0.12 + (0.76 * (i + 0.5)) / NFILE; o = 1; }
      else {
        const local = t - start - i * gap;
        if (local >= 0) {
          const u = local % period;
          if (u <= dur) { k = u / dur; o = Math.min(1, k / 0.08, (1 - k) / 0.1); }
        }
      }
      const p = arcPt(COPY_A, COPY_B, COPY_PEAK, k);
      _o.position.set(p[0], p[1], p[2]);
      _o.quaternion.copy(state.camera.quaternion);
      _o.rotateZ(0.35 - 0.7 * k);
      _o.scale.setScalar(Math.max(1e-4, o * s.vis * (0.9 + 0.25 * Math.sin(Math.PI * k))));
      _o.updateMatrix();
      f.setMatrixAt(i, _o.matrix); pp.setMatrixAt(i, _o.matrix);
      for (let j = 0; j < 3; j++) {
        _m2.compose(_v.set(-0.13 + BAR_W[j] / 2, 0.12 - j * 0.11, 0.032), _q.identity(), _s.set(BAR_W[j], 1, 1));
        _m.multiplyMatrices(_o.matrix, _m2);
        b.setMatrixAt(i * 3 + j, _m);
      }
    }
    f.instanceMatrix.needsUpdate = true; pp.instanceMatrix.needsUpdate = true; b.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={frame} args={[undefined, undefined, NFILE]} frustumCulled={false}>
        <boxGeometry args={[0.44, 0.56, 0.035]} />
        <meshStandardMaterial ref={frameMat} color={pal.focus} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={paper} args={[undefined, undefined, NFILE]} frustumCulled={false}>
        <boxGeometry args={[0.35, 0.47, 0.05]} />
        <meshStandardMaterial color={pal.paper} roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={bars} args={[undefined, undefined, NFILE * 3]} frustumCulled={false}>
        <boxGeometry args={[1, 0.04, 0.012]} />
        <meshBasicMaterial ref={barMat} color={pal.focus} />
      </instancedMesh>
    </group>
  );
}

/** Tracker shot: the one file the camera dives into, held at the top of its arc. */
function HeroFile({ show }: { show: boolean }) {
  const { pal, reduce } = useCtx();
  const g = useRef<THREE.Group>(null);
  const st = useRef({ k: 0 });
  useFrame((state, dt) => {
    const s = st.current;
    s.k = reduce ? (show ? 1 : 0) : damp(s.k, show ? 1 : 0, 4, dt);
    const grp = g.current;
    if (!grp) return;
    grp.visible = s.k > 0.01;
    grp.position.set(APEX[0], APEX[1] + (reduce ? 0 : Math.sin(state.clock.elapsedTime * 1.4) * 0.03), APEX[2]);
    grp.quaternion.copy(state.camera.quaternion);
    grp.rotateZ(-0.08 * s.k);
    grp.scale.setScalar(Math.max(1e-4, s.k * 1.25));
  });
  return (
    <group ref={g} visible={false}>
      <mesh><boxGeometry args={[0.44, 0.56, 0.035]} /><meshStandardMaterial color={pal.shadow} roughness={0.5} /></mesh>
      <mesh><boxGeometry args={[0.35, 0.47, 0.05]} /><meshStandardMaterial color={pal.paper} roughness={0.7} /></mesh>
      {BAR_W.map((w, j) => (
        <mesh key={j} position={[-0.13 + w / 2, 0.12 - j * 0.11, 0.032]}><boxGeometry args={[w, 0.04, 0.012]} /><meshBasicMaterial color={pal.shadow} /></mesh>
      ))}
    </group>
  );
}

/** Fingerprint: purple tracker beacons fly from the attacker's screen back to the eye. */
function Beacons({ n }: { n: number }) {
  const { pal, reduce, shot, clock } = useCtx();
  const dots = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const st = useRef({ vis: 0 });
  const COUNT = 6;
  useFrame((state, dt) => {
    const d = dots.current, r = rings.current;
    if (!d || !r) return;
    const active = shot === "fingerprint";
    const s = st.current;
    s.vis = reduce ? (active ? 1 : 0) : damp(s.vis, active ? 1 : 0, 5, dt);
    const t = clock.current.t;
    const gap = 0.7, dur = 1.5, period = Math.max(dur + 0.2, n * gap);
    for (let i = 0; i < COUNT; i++) {
      let k = 0, o = 0;
      if (i < n) {
        if (reduce) { k = 0.15 + (0.7 * (i + 0.5)) / n; o = 1; }
        else {
          const local = t - 0.9 - i * gap;
          if (local >= 0) { const u = local % period; if (u <= dur) { k = easeIO(u / dur); o = Math.min(1, u / dur / 0.08, (1 - u / dur) / 0.08); } }
        }
      }
      const p = arcPt(SCREEN, EYE, BEACON_PEAK, k);
      _o.position.set(p[0], p[1], p[2]);
      _o.quaternion.copy(state.camera.quaternion);
      _o.scale.setScalar(Math.max(1e-4, o * s.vis));
      _o.updateMatrix();
      d.setMatrixAt(i, _o.matrix); r.setMatrixAt(i, _o.matrix);
    }
    d.instanceMatrix.needsUpdate = true; r.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={dots} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 20, 14]} />
        <meshStandardMaterial color={pal.shadow} emissive={pal.shadow} emissiveIntensity={0.5} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <ringGeometry args={[0.26, 0.32, 32]} />
        <meshBasicMaterial color={pal.shadow} transparent opacity={0.5} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

/** Disperse: one encrypted piece (green padlock chip) flies from Eastbank's store to a hospital and stays. */
function Shard({ to, k }: { to: Hosp; k: number }) {
  const { pal, reduce, shot, clock } = useCtx();
  const g = useRef<THREE.Group>(null);
  const st = useRef({ vis: 0 });
  const a = add(REAL, 0, PAD_H + RK_H + 0.5, 0);
  const b = add(to.p, 0, PAD_H + to.h + 1.0, 0);
  const peak = 1.6 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.14;
  useFrame((state, dt) => {
    const grp = g.current;
    if (!grp) return;
    const active = shot === "disperse";
    const s = st.current;
    s.vis = reduce ? (active ? 1 : 0) : damp(s.vis, active ? 1 : 0, 6, dt);
    const t = clock.current.t;
    const u = reduce ? 1 : easeIO(clamp((t - 1.3 - k * 0.18) / 1.5, 0, 1));
    const o = reduce ? 1 : clamp((t - 1.3 - k * 0.18) / 0.2, 0, 1);
    const p = arcPt(a, b, peak, u);
    grp.position.set(p[0], p[1] + (u >= 1 && !reduce ? Math.sin(state.clock.elapsedTime * 1.6 + k) * 0.05 : 0), p[2]);
    grp.rotation.y = reduce ? 0.5 : 0.5 + (1 - u) * 3.2;
    grp.scale.setScalar(Math.max(1e-4, o * s.vis * 1.7));
    grp.visible = o * s.vis > 0.01;
  });
  return <group ref={g} visible={false}><Padlock color={pal.ok} /></group>;
}

/** The stolen nurse login: an amber card that travels from the laptop to the gateway and is held there. */
function Packet() {
  const { pal, reduce, shot, clock, reg } = useCtx();
  const g = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  const st = useRef({ vis: 0 });
  useFrame((state, dt) => {
    const grp = g.current;
    if (!grp) return;
    const on = shot === "request" || shot === "firstsight";
    const s = st.current;
    s.vis = reduce ? (on ? 1 : 0) : damp(s.vis, on ? 1 : 0, 6, dt);
    const t = clock.current.t;
    let p: V3 = PKT_HELD;
    if (shot === "request") {
      const k = reduce ? 1 : easeIO(clamp((t - 1.3) / 2.4, 0, 1));
      p = arcPt(PKT_A, PKT_B, 0.35, k);
    } else if (shot === "firstsight") {
      const k = reduce ? 1 : easeIO(clamp((t - 0.15) / 0.8, 0, 1));
      p = arcPt(PKT_B, PKT_HELD, 0.1, k);
      if (!reduce) p = add(p, 0, Math.sin(t * 3) * 0.04 * clamp(t - 1, 0, 1), 0);
    }
    const appear = shot === "request" && !reduce ? clamp((t - 0.9) / 0.3, 0, 1) : 1;
    grp.position.set(p[0], p[1], p[2]);
    reg.current?.packet.set(p[0], p[1] + 0.5, p[2]);
    grp.scale.setScalar(Math.max(1e-4, s.vis * appear));
    grp.visible = s.vis * appear > 0.01;
    const card = grp.children[0];
    if (card) card.quaternion.copy(state.camera.quaternion);
    const ring = scan.current;
    if (ring) {
      const live = shot === "firstsight";
      ring.visible = live;
      if (live) {
        ring.position.y = reduce ? 0 : Math.sin(t * 2.6) * 0.32;
        ring.rotation.set(Math.PI / 2, 0, 0);
      }
    }
  });
  return (
    <group ref={g} visible={false}>
      <group>
        <mesh><boxGeometry args={[0.66, 0.46, 0.05]} /><meshStandardMaterial color={pal.alert} roughness={0.5} /></mesh>
        <mesh><boxGeometry args={[0.56, 0.36, 0.06]} /><meshStandardMaterial color={pal.alertBg} roughness={0.7} /></mesh>
        <mesh position={[-0.15, 0.02, 0.036]}><boxGeometry args={[0.16, 0.18, 0.01]} /><meshBasicMaterial color={pal.alert} /></mesh>
        {[0.07, -0.02, -0.1].map((y, j) => (
          <mesh key={j} position={[0.1, y, 0.036]}><boxGeometry args={[[0.22, 0.18, 0.14][j], 0.035, 0.01]} /><meshBasicMaterial color={pal.alert} /></mesh>
        ))}
      </group>
      <mesh ref={scan} visible={false}>
        <torusGeometry args={[0.62, 0.03, 10, 64]} />
        <meshBasicMaterial color={pal.alert} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

/** Rises out of the ground when `show` turns on (the twin, the laptop tile). */
function Rise({ show, depth, delay = 0, children }: { show: boolean; depth: number; delay?: number; children: ReactNode }) {
  const { reduce } = useCtx();
  const g = useRef<THREE.Group>(null);
  const st = useRef({ y: show ? 0 : -depth, was: show, at: 0 });
  useFrame((state, dt) => {
    const grp = g.current;
    if (!grp) return;
    const s = st.current;
    if (show && !s.was) s.at = state.clock.elapsedTime + delay;
    s.was = show;
    const go = show && state.clock.elapsedTime >= s.at;
    s.y = reduce ? (show ? 0 : -depth) : damp(s.y, go ? 0 : -depth, 4.5, dt);
    grp.position.y = s.y;
    grp.visible = s.y > -depth + 0.02;
  });
  return <group ref={g}>{children}</group>;
}

/** The dashed path of a stream (copy arc, beacon arc, the attacker's way in). */
function Trail({ a, b, peak, color, show, n = 40 }: { a: V3; b: V3; peak: number; color: THREE.Color; show: boolean; n?: number }) {
  const pts = useMemo(() => Array.from({ length: n + 1 }, (_, i) => arcPt(a, b, peak, i / n)), [a, b, peak, n]);
  if (!show) return null;
  return <Line points={pts} color={color} lineWidth={2.5} dashed dashSize={0.16} gapSize={0.16} transparent opacity={0.8} />;
}

/* ================================================================== camera rig */

function CameraRig({ shot }: { shot: Shot }) {
  const { reduce } = useCtx();
  const size = useThree((s) => s.size);
  const target = useMemo(() => fitShot(shot, Math.max(1, size.width), Math.max(1, size.height)), [shot, size.width, size.height]);
  const st = useRef<{ cur: Rig; vel: number[] } | null>(null);
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    if (!st.current) {
      const cur = { ...target };
      if (!reduce) { cur.ld += 0.16; cur.el += 5; }
      st.current = { cur, vel: RIG_KEYS.map(() => 0) };
    }
    const { cur, vel } = st.current;
    const d = Math.min(dt, 0.25);
    for (let i = 0; i < RIG_KEYS.length; i++) {
      const key = RIG_KEYS[i];
      let to = target[key];
      if (key === "az") to = cur.az + ((((to - cur.az) % 360) + 540) % 360) - 180;
      cur[key] = reduce ? to : smooth(cur[key], to, vel, i, 0.48, d);
    }
    const dist = Math.exp(cur.ld);
    const az = cur.az * DEG, el = cur.el * DEG;
    cam.position.set(cur.lx + dist * Math.sin(az) * Math.cos(el), cur.ly + dist * Math.sin(el), cur.lz + dist * Math.cos(az) * Math.cos(el));
    _v2.set(cur.lx, cur.ly, cur.lz);
    cam.lookAt(_v2);
    const W = state.size.width, H = state.size.height;
    cam.setViewOffset(W, H, cur.ox, cur.oy, W, H);
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) { fog.near = dist * 0.95; fog.far = dist * (shot === "tracker" ? 2.2 : 3.2); }
  }, -1);
  return null;
}

/* ================================================================== the scene */

function World({ shot, pal, reduce, facts, reg }: { shot: Shot; pal: Pal; reduce: boolean; facts: RunFacts | null; reg: RefObject<LabelReg> }) {
  const clock = useRef({ shot, start: 0, t: 0 });
  useFrame((state) => {
    const c = clock.current;
    if (c.shot !== shot) { c.shot = shot; c.start = state.clock.elapsedTime; }
    c.t = reduce ? 60 : state.clock.elapsedTime - c.start;
  }, -2);
  const ctx = useMemo<Ctx>(() => ({ pal, reduce, shot, clock, reg }), [pal, reduce, shot, reg]);
  const sun = useMemo(() => { const o = new THREE.Object3D(); o.position.set(4, 0, -1); return o; }, []);

  const i = idx(shot);
  const from = (s: Shot) => i >= idx(s);
  const is = (...s: Shot[]) => s.includes(shot);
  const wide = is("network", "disperse");
  const decoy = from("swap");
  const beacons = clamp(facts?.trackers.length ?? 3, 1, 6);

  const dimOther = wide ? 0 : 0.72;
  const dimE = is("network", "hospital", "disperse") ? 0 : is("swap") ? 0.18 : 0.55;
  const dimGate = is("request", "firstsight", "fingerprint") ? 0 : is("network", "hospital") ? 0.3 : is("disperse") ? 0.45 : 0.28;
  const dimReal = is("network", "hospital", "swap", "disperse") ? 0 : 0.55;
  const dimLap = is("request", "transfer", "fingerprint") ? 0 : is("disperse") ? 0.6 : 0.25;
  const dimTwin = is("fingerprint") ? 0.4 : is("disperse") ? 0.6 : 0;
  const dimLinks = is("network") ? 0 : is("disperse") ? 0.3 : is("hospital") ? 0.5 : 0.8;
  const glow = is("firstsight", "transfer", "swap") ? "fire" : is("fingerprint") ? "ping" : "calm";

  return (
    <SceneCtx.Provider value={ctx}>
      <color attach="background" args={[pal.bg]} />
      <fog attach="fog" args={[pal.bg, 40, 140]} />
      <hemisphereLight args={[0xffffff, pal.dark ? 0x7c7c86 : 0xb4b4bc, pal.dark ? 2.2 : 1.95]} />
      <primitive object={sun} />
      <directionalLight target={sun} position={[4 - 15, 30, -1 + 17]} intensity={pal.dark ? 1.9 : 1.55} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.035} shadow-radius={4} shadow-intensity={pal.dark ? 0.75 : 0.5}>
        <orthographicCamera attach="shadow-camera" args={[-25, 25, 22, -22, 1, 90]} />
      </directionalLight>
      <CameraRig shot={shot} />

      <Ground />
      <Links dim={dimLinks} hotEas={is("hospital")} />
      <Traffic />

      {HOSP.map((h) => (
        <Focus key={h.id} position={h.p} dim={h.id === EB.id ? dimE : dimOther} pulse={h.id === EB.id && is("hospital")}>
          <Building h={h} />
        </Focus>
      ))}

      <Focus position={REAL} dim={dimReal} pulse={is("swap")}>
        <Rack decoy={false} />
        <SwapLock show={from("swap") && !is("tracker")} />
      </Focus>

      <Focus position={GATE} dim={dimGate} pulse={is("firstsight", "fingerprint")}>
        <Gateway glow={glow} />
      </Focus>

      <Focus position={TWIN} dim={dimTwin} pulse={is("transfer", "swap")}>
        <Rise show={from("transfer")} depth={RK_H + 0.6} delay={0.25}>
          <Rack decoy={decoy} />
        </Rise>
      </Focus>

      <Focus position={LAP} dim={dimLap} pulse={is("request")}>
        <Rise show={from("request")} depth={4} delay={0.15}>
          <Laptop />
        </Rise>
      </Focus>

      <Packet />
      <Files />
      <HeroFile show={is("tracker")} />
      <Beacons n={beacons} />
      {HOSP.filter((h) => h.id !== EB.id).map((h, k) => <Shard key={h.id} to={h} k={k} />)}

      <Trail a={add(LAP, -1.2, 0.08, -0.1)} b={add(GATE, 1.0, 0.08, 0)} peak={0} color={pal.alert} show={is("request", "firstsight")} n={2} />
      <Trail a={COPY_A} b={COPY_B} peak={COPY_PEAK} color={decoy ? pal.shadow : pal.focus} show={is("transfer", "swap")} />
      <Trail a={SCREEN} b={EYE} peak={BEACON_PEAK} color={pal.shadow} show={is("fingerprint")} />

      {/* ground cues: where to look */}
      <PulseRing p={E} r={2.9} color={pal.focus} play={is("hospital")} />
      <PulseRing p={LAP} r={2.1} color={pal.alert} play={is("request")} delay={1.0} />
      <Halo p={GATE} r={1.55} color={pal.alert} show={is("firstsight")} />
      <PulseRing p={GATE} r={1.6} color={pal.alert} play={is("firstsight")} delay={0.6} />
      <PulseRing p={TWIN} r={1.5} color={pal.focus} play={is("transfer")} delay={1.0} />
      <PulseRing p={TWIN} r={1.5} color={pal.shadow} play={is("swap")} delay={0.8} />
      <Halo p={REAL} r={1.45} color={pal.focus} show={is("swap")} />
      <PulseRing p={GATE} r={1.6} color={pal.shadow} play={is("fingerprint")} delay={1.3} />
      {HOSP.filter((h) => h.id !== EB.id).map((h, k) => (
        <PulseRing key={h.id} p={h.p} r={Math.max(h.w, h.d) * 0.85} color={pal.ok} play={is("disperse")} delay={2.7 + k * 0.18} repeat={1} />
      ))}

      <LabelProjector />
    </SceneCtx.Provider>
  );
}

/** The padlock over the real store once the twin is revealed. */
function SwapLock({ show }: { show: boolean }) {
  const { pal, reduce } = useCtx();
  const g = useRef<THREE.Group>(null);
  const st = useRef({ k: 0, was: false, at: 0 });
  useFrame((state, dt) => {
    const grp = g.current;
    if (!grp) return;
    const s = st.current;
    if (show && !s.was) s.at = state.clock.elapsedTime + 1.0;
    s.was = show;
    const go = show && (reduce || state.clock.elapsedTime >= s.at);
    s.k = reduce ? (show ? 1 : 0) : damp(s.k, go ? 1 : 0, 6, dt);
    grp.scale.setScalar(Math.max(1e-4, s.k));
    grp.visible = s.k > 0.01;
    grp.rotation.y = reduce ? 0.6 : 0.6 + Math.sin(state.clock.elapsedTime * 0.8) * 0.15;
  });
  return <group ref={g} position={[0, PAD_H + RK_H + 0.55, 0]} visible={false}><Padlock color={pal.focus} scale={1.25} /></group>;
}

/* ================================================================== inserts (2D panels above the canvas) */

function useBox(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 1920, h: 908 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function Insert({ side, w, h, children, reduce, delay = 0.5 }: { side: Side; w: number; h: number; children: ReactNode; reduce: boolean; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gap = Math.max(20, w * 0.025);
  const maxW = side === "center" ? w * 0.86 : w * 0.46 - gap, maxH = h - 2 * gap;
  const scale = box ? clamp(Math.min(maxW / box.w, maxH / box.h, 1), 0.55, 1) : 1;
  const style = side === "center" ? { left: "50%", top: "50%", translate: "-50% -50%" } : { right: gap, top: "50%", translate: "0 -50%" };
  return (
    <motion.div className="pointer-events-auto absolute" style={{ ...style, transformOrigin: side === "center" ? "50% 50%" : "100% 50%" }}
      initial={{ opacity: 0, scale: scale * (side === "center" ? 0.5 : 0.96), x: side === "center" ? 0 : 24 }}
      animate={{ opacity: 1, scale, x: 0 }}
      exit={{ opacity: 0, scale: scale * 0.97, transition: reduce ? { duration: 0 } : { duration: 0.25 } }}
      transition={reduce ? { duration: 0 } : { duration: side === "center" ? 0.55 : 0.45, delay, ease: [0.2, 0.8, 0.2, 1] }}>
      <div ref={ref}>{children}</div>
    </motion.div>
  );
}

function Inserts({ shot, facts, reduce, w, h }: { shot: Shot; facts: RunFacts | null; reduce: boolean; w: number; h: number }) {
  const fs = facts?.firstSight ?? null;
  return (
    <AnimatePresence>
      {shot === "firstsight" && (
        <Insert key="gauge" side="right" w={w} h={h} reduce={reduce} delay={0.8}>
          <FirstSightGauge score={fs?.score ?? null} threshold={fs?.threshold ?? null} signals={fs?.signals ?? []} />
        </Insert>
      )}
      {(shot === "transfer" || shot === "swap") && (
        <Insert key="copy" side="right" w={w} h={h} reduce={reduce} delay={0.7}>
          <CopyDialog total={facts ? facts.fakeRecords : null} decoy={shot === "swap"} />
        </Insert>
      )}
      {shot === "tracker" && (
        <Insert key="tracker" side="center" w={w} h={h} reduce={reduce} delay={0.95}>
          <TrackerDoc trackers={facts?.trackers ?? []} />
        </Insert>
      )}
      {shot === "fingerprint" && (
        <Insert key="fp" side="right" w={w} h={h} reduce={reduce} delay={0.7}>
          <FingerprintCard facts={facts} />
        </Insert>
      )}
      {shot === "disperse" && (
        <Insert key="key" side="right" w={w} h={h} reduce={reduce} delay={1.0}>
          <KeySplit holders={facts?.scatter?.holders ?? []} threshold={facts?.scatter?.keyThreshold ?? null} verified={!!facts?.scatter?.verified} />
        </Insert>
      )}
    </AnimatePresence>
  );
}

/* ================================================================== the film */

export function Film3D({ shot, className }: { shot: Shot; className?: string }) {
  const facts = useRunFacts();
  const reduce = !!useReducedMotion();
  const tokens = useSyncExternalStore(subscribeScheme, readTokens, () => "");
  const pal = useMemo(() => (tokens ? makePalette(tokens) : null), [tokens]);
  const ref = useRef<HTMLDivElement>(null);
  const reg = useRef<LabelReg>({ els: new Map(), packet: new THREE.Vector3(0, -99, 0) });
  const { w, h } = useBox(ref);
  return (
    <div ref={ref} className={cn("relative h-full w-full overflow-hidden bg-background select-none", className)}>
      {pal && (
        <Canvas key={tokens} shadows="percentage" dpr={[1, 2]} flat gl={{ antialias: true }}
          camera={{ fov: FOV, position: [0, 30, 40], near: 0.5, far: 600 }}>
          <World shot={shot} pal={pal} reduce={reduce} facts={facts} reg={reg} />
        </Canvas>
      )}
      {pal && <LabelLayer shot={shot} reduce={reduce} reg={reg} />}
      {/* tracker dive: the world recedes behind the document */}
      <motion.div className="pointer-events-none absolute inset-0 z-[25] bg-background" initial={{ opacity: 0 }}
        animate={{ opacity: shot === "tracker" ? 0.8 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.6, delay: shot === "tracker" ? 0.75 : 0 }} />
      <div className="pointer-events-none absolute inset-0 z-30">
        <Inserts shot={shot} facts={facts} reduce={reduce} w={w} h={h} />
      </div>
    </div>
  );
}
