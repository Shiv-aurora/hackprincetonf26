"use client";
// MayaJaal "film": one CSS-3D world (perspective + preserve-3d boxes, SVG drawn on the ground plane) and a
// single camera that flies between nine story shots while the component stays mounted.
//
// Camera: a look-at rig. The shot's target point is moved to the origin, then the plane is swung (rotateZ),
// tilted (rotateX) and dollied (scale3d), so the target always projects to the middle of the stage. A 2D lens
// offset then slides the picture so the focal object sits in the free part of the frame when an insert panel
// is beside it. Zoom and offset are fitted to the measured frame from the focal object's 3D bounding points,
// so the framing holds at 1920×1080 and 1440×900 alike.
//
// Labels and moving sprites (file cards, shards, beacons, the eye) live in a flat 2D layer. Their anchors are
// projected with exactly the maths of the CSS transform, so text stays upright, crisp and at a fixed readable
// size while the world moves underneath.

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTime, useTransform, type MotionValue,
} from "framer-motion";
import { FileText, IdCard, Lock } from "lucide-react";
import { WORLD } from "@/lib/contracts";
import { cn } from "@/components/ui";
import { useRunFacts } from "../story/useRunFacts";
import { CopyDialog, FingerprintCard, FirstSightGauge, KeySplit, TrackerDoc } from "./overlays";

export type Shot = "network" | "hospital" | "request" | "firstsight" | "transfer" | "swap" | "tracker" | "fingerprint" | "disperse";
export const SHOTS: Shot[] = ["network", "hospital", "request", "firstsight", "transfer", "swap", "tracker", "fingerprint", "disperse"];

/* ================================================================== geometry (layout px)
   Layout plane: u → right, v → toward the viewer, z → up. Buildings are boxes on their own axes, set at 45°
   to the layout, which gives the isometric diamond. `off(p, dx, dy)` steps along those building axes. */

type V3 = [number, number, number];
const Q = Math.SQRT1_2;
const off = (p: V3, dx: number, dy: number, z = p[2]): V3 => [p[0] + (dx - dy) * Q, p[1] + (dx + dy) * Q, z];
const at = (p: V3, z: number): V3 => [p[0], p[1], z];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const arcPt = (a: V3, b: V3, peak: number, k: number): V3 =>
  [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k) + 4 * peak * k * (1 - k)];
const easeIO = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const DIMS: Record<string, { w: number; d: number; h: number }> = {
  aur: { w: 232, d: 170, h: 150 },
  riv: { w: 170, d: 138, h: 98 },
  nor: { w: 208, d: 156, h: 128 },
  eas: { w: 198, d: 150, h: 110 },
  wes: { w: 178, d: 140, h: 118 },
  lum: { w: 236, d: 128, h: 66 },
};
const NAME: Record<string, string> = {
  aur: "St. Aurelia", riv: "Riverside", nor: "Northgate", eas: "Eastbank", wes: "Westfield", lum: "Lumen Labs",
};

interface Hosp { id: string; label: string; kind: string; p: V3; w: number; d: number; h: number }
// world.json is a 0–100 grid (x east, y north). Turned half a turn so Eastbank, the way in, sits on the left.
const HOSP: Hosp[] = WORLD.hospitals.map((h) => ({
  id: h.id, label: NAME[h.id] ?? h.short, kind: h.kind,
  p: [-(h.x - 50) * 21, (h.y - 50) * 17, 0] as V3,
  ...(DIMS[h.id] ?? { w: 180, d: 140, h: 110 }),
}));
const HBY = new Map(HOSP.map((h) => [h.id, h]));
const EB = HBY.get(WORLD.entry_point.hospital_id) ?? HOSP[0];
const E = EB.p;

// Eastbank campus. The attacker's route runs along a building axis: laptop → gateway → hospital.
const GATE = off(E, 0, 330);
const LAP = off(E, 0, 900);
const REAL = off(E, 252, -26);
const TWIN = off(GATE, 210, 26);

const SLAB = { w: 128, d: 96, h: 18, step: 30, base: 10, n: 4 };
const STACK_H = SLAB.base + (SLAB.n - 1) * SLAB.step + SLAB.h;
const SLAB_NAMES = ["Backups", "Clinical notes", "Lab results", "Patient records"]; // bottom → top

const GW = { size: 150, ph: 16, post: 22, span: 64, h: 150, beam: 24 };
const GATE_TOP = GW.ph + GW.h + GW.beam;
const EYE: V3 = at(GATE, GATE_TOP + 46);
const TILE = { size: 236, t: 26 };
const LAP_ROT = 18;  // the laptop is turned toward the camera a little, so its screen reads
const SCREEN: V3 = at(off(LAP, 0, -26), 44);

const COPY_A: V3 = at(TWIN, STACK_H + 18);
const COPY_B: V3 = at(off(LAP, 0, -12), 42);
const COPY_PEAK = 250;
const APEX = arcPt(COPY_A, COPY_B, COPY_PEAK, 0.5);

const ISL = { u0: -1100, v0: -700, u1: 980, v1: 800, t: 44 };

/* ================================================================== camera maths */

const PERSP = 2400;
const RAD = Math.PI / 180;
interface CamPose { tu: number; tv: number; tz: number; tilt: number; swing: number; zoom: number }
interface Cam extends CamPose { lx: number; ly: number }
interface Proj { x: number; y: number; s: number }

/** Exactly the CSS chain: perspective(P) · scale3d(z) · rotateX(tilt) · rotateZ(swing) · translate3d(−target). */
function project(p: V3, c: CamPose): Proj {
  const x0 = p[0] - c.tu, y0 = p[1] - c.tv, z0 = p[2] - c.tz;
  const cs = Math.cos(c.swing * RAD), sn = Math.sin(c.swing * RAD);
  const x1 = x0 * cs - y0 * sn, y1 = x0 * sn + y0 * cs;
  const ct = Math.cos(c.tilt * RAD), st = Math.sin(c.tilt * RAD);
  const y2 = y1 * ct - z0 * st, z2 = y1 * st + z0 * ct;
  const f = PERSP / Math.max(80, PERSP - z2 * c.zoom);
  return { x: x1 * c.zoom * f, y: y2 * c.zoom * f, s: c.zoom * f };
}
const camOf = (v: number[]): CamPose => ({ tu: v[0], tv: v[1], tz: v[2], tilt: v[3], swing: v[4], zoom: v[5] });

const boxPts = (p: V3, w: number, d: number, h: number): V3[] => [
  off(p, -w / 2, -d / 2, p[2]), off(p, w / 2, -d / 2, p[2]), off(p, w / 2, d / 2, p[2]), off(p, -w / 2, d / 2, p[2]),
  off(p, -w / 2, -d / 2, p[2] + h), off(p, w / 2, -d / 2, p[2] + h), off(p, w / 2, d / 2, p[2] + h), off(p, -w / 2, d / 2, p[2] + h),
];
const ISLAND_PTS: V3[] = [[ISL.u0, ISL.v0, 0], [ISL.u1, ISL.v0, 0], [ISL.u0, ISL.v1, -ISL.t], [ISL.u1, ISL.v1, -ISL.t]];
const CITY_PTS: V3[] = HOSP.flatMap((h) => boxPts(h.p, h.w, h.d, h.h + 90));
const TILE_PTS: V3[] = [[LAP[0] - TILE.size / 2, LAP[1] - TILE.size / 2, 0], [LAP[0] + TILE.size / 2, LAP[1] + TILE.size / 2, -TILE.t], at(SCREEN, 130)];
const GATE_PTS: V3[] = [...boxPts(GATE, GW.size, GW.size, GATE_TOP), at(EYE, EYE[2] + 70)];
const STACK_PTS = (p: V3) => boxPts(p, SLAB.w, SLAB.d, STACK_H + 60);

type Side = "none" | "right" | "center";
interface Spec { tilt: number; swing: number; focus: V3[]; insert: Side; panel?: number; zoom?: number; maxZoom?: number; pad?: number }

const SPEC: Record<Shot, Spec> = {
  network: { tilt: 50, swing: 0, focus: [...ISLAND_PTS, ...CITY_PTS], insert: "none", pad: 0.035 },
  hospital: {
    tilt: 56, swing: -16, insert: "none", pad: 0.1, maxZoom: 1.45,
    focus: [...boxPts(E, EB.w, EB.d, EB.h + 70), ...STACK_PTS(REAL), [REAL[0] + 420, REAL[1] - 60, 120], off(REAL, 120, 120, 0)],
  },
  request: { tilt: 54, swing: 22, insert: "none", pad: 0.08, focus: [...TILE_PTS, ...GATE_PTS, ...boxPts(E, EB.w, EB.d, EB.h)] },
  firstsight: { tilt: 55, swing: 4, insert: "right", panel: 480, pad: 0.07, maxZoom: 1.9, focus: [...GATE_PTS, off(GATE, 0, 120, 30)] },
  transfer: { tilt: 54, swing: 8, insert: "right", panel: 560, pad: 0.06, focus: [...TILE_PTS, ...STACK_PTS(TWIN), ...GATE_PTS, at(APEX, APEX[2] + 40)] },
  swap: {
    tilt: 53, swing: -26, insert: "right", panel: 560, pad: 0.07, maxZoom: 1.3,
    focus: [...STACK_PTS(TWIN), ...STACK_PTS(REAL), ...boxPts(E, EB.w, EB.d, EB.h + 80), ...GATE_PTS],
  },
  tracker: { tilt: 54, swing: 8, insert: "center", zoom: 1.75, focus: [APEX] },
  fingerprint: { tilt: 54, swing: 2, insert: "right", panel: 560, pad: 0.07, focus: [...TILE_PTS, ...GATE_PTS, ...STACK_PTS(TWIN)] },
  disperse: { tilt: 50, swing: 0, insert: "right", panel: 560, pad: 0.03, focus: [...ISLAND_PTS, ...CITY_PTS] },
};

/** Fit a shot to a frame: dolly until the focus box fills the free rect, then offset the lens to centre it. */
function fit(shot: Shot, w: number, h: number): Cam {
  const s = SPEC[shot];
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of s.focus) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const c: CamPose = { tu: (lo[0] + hi[0]) / 2, tv: (lo[1] + hi[1]) / 2, tz: (lo[2] + hi[2]) / 2, tilt: s.tilt, swing: s.swing, zoom: s.zoom ?? 1 };
  const pad = s.pad ?? 0.06;
  const gap = Math.max(20, w * 0.025);
  const right = s.insert === "right" ? Math.min(w * 0.46, (s.panel ?? 520) + 2 * gap) : 0;
  const rect = { l: w * pad, r: w - Math.max(w * pad, right), t: h * (pad + 0.02), b: h * (1 - pad) };
  const bounds = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of s.focus) { const q = project(p, c); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    return { x0, x1, y0, y1 };
  };
  if (s.zoom == null) {
    for (let i = 0; i < 8; i++) {
      const b = bounds();
      const k = Math.min((rect.r - rect.l) / Math.max(1, b.x1 - b.x0), (rect.b - rect.t) / Math.max(1, b.y1 - b.y0));
      c.zoom = clamp(c.zoom * Math.pow(k, 0.9), 0.3, s.maxZoom ?? 2.2);
    }
  }
  if (s.insert === "center") return { ...c, lx: 0, ly: 0 };
  const b = bounds();
  return { ...c, lx: (rect.l + rect.r) / 2 - w / 2 - (b.x0 + b.x1) / 2, ly: (rect.t + rect.b) / 2 - h / 2 - (b.y0 + b.y1) / 2 };
}

/* ================================================================== palette (light + dark, scoped) */

const CSS = `
.mjf{--mjf-ground:#f3f3f5;--mjf-ground-s:#e6e6ea;--mjf-ground-e:#dcdce1;--mjf-ground-edge:#dadade;--mjf-dot:#dcdce2;
--mjf-pad:#fafafb;--mjf-pad-line:#e2e2e7;--mjf-cable:#cbd5e2;--mjf-shade:rgba(24,24,34,.06);
--mjf-top:#ffffff;--mjf-s:#ececf0;--mjf-e:#d9d9df;--mjf-n:#e2e2e7;--mjf-w:#f3f3f6;
--mjf-win-s:#cdd9e8;--mjf-win-e:#bccadc;--mjf-door:#aab4c2;--mjf-parapet:#e4e4ea;--mjf-unit-top:#f4f4f6;
--mjf-g-top:#ffffff;--mjf-g-s:#e8e8ee;--mjf-g-e:#d2d2da;--mjf-g-n:#dddde4;--mjf-g-w:#f5f5f8;
--mjf-p-top:#e8e8ed;--mjf-p-s:#d6d6de;--mjf-p-e:#c6c6d0;
--mjf-sl-top:#ffffff;--mjf-sl-s:#e8edf4;--mjf-sl-e:#d4dce8;
--mjf-dc-top:color-mix(in srgb,var(--shadow) 16%,#fff);--mjf-dc-s:color-mix(in srgb,var(--shadow) 24%,#eeeef4);--mjf-dc-e:color-mix(in srgb,var(--shadow) 34%,#dcdce6);
--mjf-tile:#fbf6ee;--mjf-tile-s:#ece2d2;--mjf-tile-e:#dfd3c0;
--mjf-dev-top:#e6e6eb;--mjf-dev-s:#cfcfd8;--mjf-dev-e:#bcbcc7;--mjf-screen:#1f1b15;--mjf-key:#d2d2da}
@media (prefers-color-scheme:dark){.mjf{--mjf-ground:#161619;--mjf-ground-s:#111114;--mjf-ground-e:#0d0d10;--mjf-ground-edge:#2c2c32;--mjf-dot:#27272d;
--mjf-pad:#1c1c21;--mjf-pad-line:#2b2b32;--mjf-cable:#2a3546;--mjf-shade:rgba(0,0,0,.34);
--mjf-top:#4b4b54;--mjf-s:#34343c;--mjf-e:#26262d;--mjf-n:#2d2d34;--mjf-w:#3d3d46;
--mjf-win-s:#43536a;--mjf-win-e:#313d4f;--mjf-door:#16191e;--mjf-parapet:#585862;--mjf-unit-top:#55555f;
--mjf-g-top:#7a7a86;--mjf-g-s:#5a5a65;--mjf-g-e:#44444e;--mjf-g-n:#4c4c56;--mjf-g-w:#666671;
--mjf-p-top:#2d2d35;--mjf-p-s:#222229;--mjf-p-e:#1a1a20;
--mjf-sl-top:#58626f;--mjf-sl-s:#3b4451;--mjf-sl-e:#2c333e;
--mjf-dc-top:color-mix(in srgb,var(--shadow) 58%,#2a2a34);--mjf-dc-s:color-mix(in srgb,var(--shadow) 42%,#22222b);--mjf-dc-e:color-mix(in srgb,var(--shadow) 30%,#1b1b23);
--mjf-tile:#1f1b15;--mjf-tile-s:#17140f;--mjf-tile-e:#110f0b;
--mjf-dev-top:#45454e;--mjf-dev-s:#31313a;--mjf-dev-e:#25252c;--mjf-screen:#140f08;--mjf-key:#2c2c34}}
.mjf .mjf-3d{transform-style:preserve-3d}
.mjf .mjf-f{position:absolute;left:0;top:0;transform-origin:0 0;backface-visibility:hidden;overflow:hidden;transition:background-color .6s cubic-bezier(.4,0,.2,1)}
.mjf .mjf-run{position:absolute;top:50%;left:0;animation:mjf-run var(--dur) linear infinite;animation-delay:var(--delay)}
.mjf .mjf-run.rev{animation-direction:reverse}
@keyframes mjf-run{from{transform:translate(0,-50%)}to{transform:translate(var(--len),-50%)}}
@media (prefers-reduced-motion:reduce){.mjf .mjf-f{transition:none}.mjf .mjf-run{animation:none;transform:translate(var(--rest),-50%)}}
`;

/* ================================================================== 3D primitives */

type Face = "top" | "s" | "e" | "n" | "w";
type Pal = Record<Face, string>;
const pal = (top: string, s: string, e: string, n: string, w: string): Pal => ({ top, s, e, n, w });
const BLD = pal("var(--mjf-top)", "var(--mjf-s)", "var(--mjf-e)", "var(--mjf-n)", "var(--mjf-w)");
const UNIT = pal("var(--mjf-unit-top)", "var(--mjf-s)", "var(--mjf-e)", "var(--mjf-n)", "var(--mjf-w)");
const GATEP = pal("var(--mjf-g-top)", "var(--mjf-g-s)", "var(--mjf-g-e)", "var(--mjf-g-n)", "var(--mjf-g-w)");
const PLINTH = pal("var(--mjf-p-top)", "var(--mjf-p-s)", "var(--mjf-p-e)", "var(--mjf-p-s)", "var(--mjf-p-top)");
const SLABP = pal("var(--mjf-sl-top)", "var(--mjf-sl-s)", "var(--mjf-sl-e)", "var(--mjf-sl-e)", "var(--mjf-sl-s)");
const DECOYP = pal("var(--mjf-dc-top)", "var(--mjf-dc-s)", "var(--mjf-dc-e)", "var(--mjf-dc-e)", "var(--mjf-dc-s)");
const TILEP = pal("var(--mjf-tile)", "var(--mjf-tile-s)", "var(--mjf-tile-e)", "var(--mjf-tile-e)", "var(--mjf-tile-s)");
const DEVP = pal("var(--mjf-dev-top)", "var(--mjf-dev-s)", "var(--mjf-dev-e)", "var(--mjf-dev-e)", "var(--mjf-dev-s)");

/** Dimming mixes a face colour toward the background by the inherited --mjf-dim (0..1). Opacity can't be
 *  used on 3D groups: it would flatten them. Face colour changes ease via the face's own transition. */
const mix = (c: string) => `color-mix(in srgb, ${c} calc(100% - var(--mjf-dim, 0) * 100%), var(--background))`;

function Box({ p, w, d, h, rot = 45, colors, faces, topStyle }: {
  p: V3; w: number; d: number; h: number; rot?: number; colors: Pal; faces?: Partial<Record<Face, ReactNode>>; topStyle?: CSSProperties;
}) {
  const f = (k: Face, fw: number, fh: number, transform: string, extra?: CSSProperties) => (
    <div className="mjf-f" style={{ width: fw, height: fh, transform, background: mix(colors[k]), ...extra }}>{faces?.[k]}</div>
  );
  return (
    <div className="mjf-3d absolute top-0 left-0" style={{ transform: `translate3d(${p[0]}px,${p[1]}px,${p[2]}px) rotateZ(${rot}deg)` }}>
      {f("top", w, d, `translate3d(${-w / 2}px,${-d / 2}px,${h}px)`, topStyle)}
      {f("s", w, h, `translate3d(${-w / 2}px,${d / 2}px,${h}px) rotateX(-90deg)`)}
      {f("n", w, h, `translate3d(${w / 2}px,${-d / 2}px,${h}px) rotateZ(180deg) rotateX(-90deg)`)}
      {f("e", d, h, `translate3d(${w / 2}px,${d / 2}px,${h}px) rotateZ(-90deg) rotateX(-90deg)`)}
      {f("w", d, h, `translate3d(${-w / 2}px,${-d / 2}px,${h}px) rotateZ(90deg) rotateX(-90deg)`)}
    </div>
  );
}

/** A group that dims everything inside it (colour toward the background). */
function Dim({ dim, children }: { dim: number; children: ReactNode }) {
  return <div className="mjf-3d absolute top-0 left-0" style={{ "--mjf-dim": dim } as CSSProperties}>{children}</div>;
}

/** Rises out of the ground (or up from below for floating pieces) when mounted; sinks on exit. */
function Rise({ depth, delay = 0, children }: { depth: number; delay?: number; children: ReactNode }) {
  const reduce = !!useReducedMotion();
  return (
    <motion.div className="mjf-3d absolute top-0 left-0" initial={{ z: -depth }} animate={{ z: 0 }} exit={{ z: -depth }}
      transition={reduce ? { duration: 0 } : { duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

/** Ribbon windows and a door for a facade. */
function Facade({ w, h, glass, door }: { w: number; h: number; glass: string; door?: boolean }) {
  const n = Math.max(1, Math.floor((h - 30) / 28));
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="absolute rounded-[2px]" style={{ left: 11, right: 11, top: 13 + i * 28, height: 11, background: mix(glass) }} />
      ))}
      {door && <div className="absolute bottom-0" style={{ left: w / 2 - 15, width: 30, height: 19, background: mix("var(--mjf-door)") }} />}
    </>
  );
}

function Building({ h: hs }: { h: Hosp }) {
  const { p, w, d, h } = hs;
  const lab = hs.kind === "pathology";
  const facade = (fw: number, glass: string, door?: boolean) => <Facade w={fw} h={h} glass={glass} door={door} />;
  return (
    <>
      <Box p={p} w={w} d={d} h={h} colors={BLD}
        topStyle={{ boxShadow: `inset 0 0 0 6px ${mix("var(--mjf-parapet)")}` }}
        faces={{
          s: facade(w, "var(--mjf-win-s)", true), e: facade(d, "var(--mjf-win-e)"),
          n: facade(w, "var(--mjf-win-e)"), w: facade(d, "var(--mjf-win-s)"),
          top: (
            <div className="absolute" style={{ left: w * 0.62 - 16, top: d * 0.62 - 16, width: 32, height: 32 }}>
              <div className="absolute top-[11px] left-0 h-[10px] w-[32px] rounded-[2px]" style={{ background: mix("var(--focus)") }} />
              <div className="absolute top-0 left-[11px] h-[32px] w-[10px] rounded-[2px]" style={{ background: mix("var(--focus)") }} />
            </div>
          ),
        }} />
      {lab
        ? [-0.3, 0, 0.3].map((k) => <Box key={k} p={off(p, w * k, -d * 0.18, h)} w={30} d={30} h={16} colors={UNIT} />)
        : <Box p={off(p, -w * 0.2, -d * 0.18, h)} w={w * 0.34} d={d * 0.4} h={18} colors={UNIT} />}
      {hs.id === "aur" && (
        <div className="mjf-3d absolute top-0 left-0" style={{ transform: `translate3d(${off(p, w * 0.22, -d * 0.2)[0]}px,${off(p, w * 0.22, -d * 0.2)[1]}px,${h + 1}px) rotateZ(45deg)` }}>
          <div className="absolute grid size-[54px] -translate-1/2 place-items-center rounded-full border-[3px] text-[24px] font-bold"
            style={{ borderColor: mix("var(--fg-subtle)"), color: mix("var(--fg-subtle)") }}>H</div>
        </div>
      )}
    </>
  );
}

function Stack({ p, decoy }: { p: V3; decoy: boolean }) {
  const colors = decoy ? DECOYP : SLABP;
  const band = decoy ? "var(--shadow)" : "var(--focus)";
  const front = (fw: number) => (
    <>
      <div className="absolute rounded-full" style={{ left: 12, top: 7, width: fw * 0.42, height: 4, background: mix(band) }} />
      {[0, 1, 2].map((i) => <div key={i} className="absolute size-[5px] rounded-full" style={{ right: 12 + i * 10, top: 6.5, background: mix(band) }} />)}
    </>
  );
  return (
    <>
      {Array.from({ length: SLAB.n }, (_, i) => (
        <Box key={i} p={at(p, SLAB.base + i * SLAB.step)} w={SLAB.w} d={SLAB.d} h={SLAB.h} colors={colors}
          topStyle={{ boxShadow: `inset 0 0 0 3px ${mix(band)}` }}
          faces={{ s: front(SLAB.w), e: front(SLAB.d) }} />
      ))}
      {/* the spine that holds the slabs */}
      <Box p={off(p, -SLAB.w / 2 + 6, -SLAB.d / 2 + 6, 0)} w={10} d={10} h={STACK_H} colors={colors} />
      <Box p={off(p, SLAB.w / 2 - 6, -SLAB.d / 2 + 6, 0)} w={10} d={10} h={STACK_H} colors={colors} />
    </>
  );
}

function Gateway() {
  const post = (sx: number) => <Box p={off(GATE, sx * GW.span, 0, GW.ph)} w={GW.post} d={GW.post} h={GW.h} colors={GATEP} />;
  return (
    <>
      <Box p={GATE} w={GW.size} d={GW.size} h={GW.ph} colors={PLINTH}
        faces={{ top: <div className="absolute inset-[18px] rounded-full border-[3px]" style={{ borderColor: mix("var(--mjf-ground-edge)") }} /> }} />
      {post(-1)}{post(1)}
      <Box p={at(GATE, GW.ph + GW.h)} w={GW.span * 2 + GW.post + 16} d={GW.post + 6} h={GW.beam} colors={GATEP} />
      {/* eye mount */}
      <Box p={at(GATE, GATE_TOP)} w={20} d={14} h={22} colors={GATEP} />
    </>
  );
}

function Laptop() {
  return (
    <>
      <Box p={[LAP[0], LAP[1], -TILE.t]} w={TILE.size} d={TILE.size} h={TILE.t} rot={0} colors={TILEP}
        topStyle={{ boxShadow: `inset 0 0 0 2px ${mix("var(--alert)")}` }} />
      {/* desk */}
      <Box p={LAP} w={150} d={104} h={20} rot={LAP_ROT} colors={DEVP} />
      {/* laptop base */}
      <Box p={at(LAP, 20)} w={116} d={80} h={6} rot={LAP_ROT} colors={DEVP}
        faces={{ top: <div className="absolute inset-x-[12px] top-[30px] bottom-[10px] rounded-[3px]" style={{ background: mix("var(--mjf-key)") }} /> }} />
      {/* screen, hinged on the far edge, display facing the attacker's seat */}
      <div className="mjf-3d absolute top-0 left-0" style={{ transform: `translate3d(${LAP[0]}px,${LAP[1]}px,26px) rotateZ(${LAP_ROT}deg)` }}>
        <div className="absolute overflow-hidden rounded-[4px] border-[4px]"
          style={{ left: -58, top: -40 - 76, width: 116, height: 76, transformOrigin: "50% 100%", transform: "rotateX(-76deg)", background: "var(--mjf-screen)", borderColor: mix("var(--mjf-dev-s)") }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="absolute h-[4px] rounded-full" style={{ left: 8, top: 9 + i * 11, width: [62, 44, 70, 36, 54][i], background: "var(--alert)", opacity: i === 4 ? 1 : 0.55 }} />
          ))}
        </div>
      </div>
    </>
  );
}

/** A cable on the ground between two points, optionally with dots running along it (both ways). */
function Cable({ a, b, width = 6, dots = 0, color = "var(--focus)", line = "var(--mjf-cable)", speed = 170, dashed = false, seed = 0 }: {
  a: V3; b: V3; width?: number; dots?: number; color?: string; line?: string; speed?: number; dashed?: boolean; seed?: number;
}) {
  const du = b[0] - a[0], dv = b[1] - a[1];
  const len = Math.hypot(du, dv), ang = Math.atan2(dv, du) / RAD;
  const H = 30, dur = Math.max(1.6, len / speed);
  return (
    <div className="absolute top-0 left-0" style={{ width: len, height: H, transformOrigin: "0 0", transform: `translate3d(${a[0]}px,${a[1]}px,2px) rotateZ(${ang}deg) translateY(${-H / 2}px)` }}>
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full"
        style={dashed
          ? { height: width, backgroundImage: `repeating-linear-gradient(90deg, ${line} 0 16px, transparent 16px 28px)` }
          : { height: width, background: line }} />
      {Array.from({ length: dots }, (_, i) => {
        const rev = i % 2 === 1;
        const k = (i * 0.618 + seed * 0.37) % 1;
        return (
          <span key={i} className={cn("mjf-run block size-[14px] -ml-[7px] rounded-full", rev && "rev")}
            style={{ background: color, "--len": `${len}px`, "--dur": `${dur}s`, "--delay": `${-k * dur}s`, "--rest": `${len * (0.2 + 0.6 * k)}px` } as CSSProperties} />
        );
      })}
    </div>
  );
}

/** Flat ring on the ground that pulses a couple of times when it mounts (the focal "you are here"). */
// Note: a flat (non-preserve-3d) element inside the 3D scene clips content at negative offsets, so every
// ground decal is a sized box placed by its own transform, with its content inside that box.
function GroundRing({ p, r, color, delay = 0, repeat = 1 }: { p: V3; r: number; color: string; delay?: number; repeat?: number }) {
  const reduce = !!useReducedMotion();
  const R = r * 1.5;
  return (
    <div className="absolute top-0 left-0" style={{ width: 2 * R, height: 2 * R, transform: `translate3d(${p[0] - R}px,${p[1] - R}px,${p[2] + 7}px)` }}>
      <motion.div className="absolute rounded-full border-[5px]" style={{ left: R - r, top: R - r, width: 2 * r, height: 2 * r, borderColor: color }}
        initial={{ opacity: 0, scale: 0.6 }} animate={reduce ? { opacity: 0, scale: 1 } : { opacity: [0, 0.9, 0], scale: [0.6, 1, 1.45] }}
        transition={reduce ? { duration: 0 } : { duration: 1.6, delay, repeat, repeatDelay: 0.2, ease: "easeOut" }} />
    </div>
  );
}

/** Steady ring on the ground (a field): fades in, stays. */
function GroundHalo({ p, r, color, fill, delay = 0 }: { p: V3; r: number; color: string; fill?: string; delay?: number }) {
  const reduce = !!useReducedMotion();
  return (
    <div className="absolute top-0 left-0" style={{ width: 2 * r, height: 2 * r, transform: `translate3d(${p[0] - r}px,${p[1] - r}px,${p[2] + 5}px)` }}>
      <motion.div className="absolute inset-0 rounded-full border-[4px]" style={{ borderColor: color, background: fill }}
        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.5, delay, ease: "easeOut" }} />
    </div>
  );
}

/** The twin's pad and contact shadow: a ground decal that fades in with the twin. */
function TwinPad() {
  const reduce = !!useReducedMotion();
  const S = 200, R = 240, sw = SLAB.w + 12, sd = SLAB.d + 12;
  return (
    <div className="absolute top-0 left-0" style={{ width: 2 * R, height: 2 * R, transform: `translate3d(${TWIN[0] - R}px,${TWIN[1] - R}px,3px)` }}>
      <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.5 }}>
        <div className="absolute rounded-[26px] border-2" style={{ left: R - S / 2, top: R - S / 2, width: S, height: S, transform: "rotate(45deg)", background: "var(--mjf-pad)", borderColor: "var(--mjf-pad-line)" }} />
        {[0.5, 0.28].map((k, j) => (
          <div key={j} className="absolute rounded-[14px]" style={{ left: R - sw / 2 + STACK_H * k - j * 8, top: R - sd / 2 + STACK_H * k * 0.18 - j * 8, width: sw + j * 16, height: sd + j * 16, transform: "rotate(45deg)", background: "var(--mjf-shade)" }} />
        ))}
      </motion.div>
    </div>
  );
}

function Island({ uid }: { uid: string }) {
  const W = ISL.u1 - ISL.u0, H = ISL.v1 - ISL.v0;
  const pads = HOSP.map((h) => ({ h, pw: h.w + 74, pd: h.d + 74 }));
  return (
    <div className="mjf-3d absolute top-0 left-0" style={{ transform: `translate3d(${ISL.u0}px,${ISL.v0}px,0px)` }}>
      <div className="mjf-f" style={{ width: W, height: H, background: "var(--mjf-ground)", boxShadow: "inset 0 0 0 2px var(--mjf-ground-edge)", borderRadius: 6 }}>
        <svg width={W} height={H} viewBox={`${ISL.u0} ${ISL.v0} ${W} ${H}`} className="absolute inset-0" aria-hidden>
          <defs>
            <pattern id={`${uid}-dots`} width={56} height={56} patternUnits="userSpaceOnUse" x={ISL.u0} y={ISL.v0}>
              <circle cx={28} cy={28} r={2.2} style={{ fill: "var(--mjf-dot)" }} />
            </pattern>
          </defs>
          <rect x={ISL.u0} y={ISL.v0} width={W} height={H} fill={`url(#${uid}-dots)`} />
          {/* soft contact shadows, cast to the right (light from the upper left) */}
          {HOSP.map((h) => [0.5, 0.3, 0.14].map((k, i) => (
            <rect key={`${h.id}-${i}`} x={-h.w / 2 - 8 - i * 10} y={-h.d / 2 - 8 - i * 10} width={h.w + 16 + i * 20} height={h.d + 16 + i * 20} rx={18 + i * 12}
              transform={`translate(${h.p[0] + h.h * k} ${h.p[1] + h.h * k * 0.18}) rotate(45)`} style={{ fill: "var(--mjf-shade)" }} />
          )))}
          {pads.map(({ h, pw, pd }) => (
            <rect key={h.id} x={-pw / 2} y={-pd / 2} width={pw} height={pd} rx={22} transform={`translate(${h.p[0]} ${h.p[1]}) rotate(45)`}
              style={{ fill: "var(--mjf-pad)", stroke: "var(--mjf-pad-line)" }} strokeWidth={2} />
          ))}
          {/* Eastbank campus: gateway forecourt and the data store's pad */}
          {[GATE, REAL].map((p, i) => (
            <rect key={i} x={-100} y={-100} width={200} height={200} rx={26} transform={`translate(${p[0]} ${p[1]}) rotate(45)`}
              style={{ fill: "var(--mjf-pad)", stroke: "var(--mjf-pad-line)" }} strokeWidth={2} />
          ))}
          {[REAL].map((p, i) => [0.5, 0.28].map((k, j) => (
            <rect key={`${i}-${j}`} x={-SLAB.w / 2 - 6 - j * 8} y={-SLAB.d / 2 - 6 - j * 8} width={SLAB.w + 12 + j * 16} height={SLAB.d + 12 + j * 16} rx={14}
              transform={`translate(${p[0] + STACK_H * k} ${p[1] + STACK_H * k * 0.18}) rotate(45)`} style={{ fill: "var(--mjf-shade)" }} />
          )))}
        </svg>
      </div>
      {/* slab thickness: front, left, right */}
      <div className="mjf-f" style={{ width: W, height: ISL.t, transform: `translate3d(0px,${H}px,0px) rotateX(-90deg)`, background: "var(--mjf-ground-s)" }} />
      <div className="mjf-f" style={{ width: H, height: ISL.t, transform: "rotateZ(90deg) rotateX(-90deg)", background: "var(--mjf-ground-e)" }} />
      <div className="mjf-f" style={{ width: H, height: ISL.t, transform: `translate3d(${W}px,${H}px,0px) rotateZ(-90deg) rotateX(-90deg)`, background: "var(--mjf-ground-e)" }} />
    </div>
  );
}

/* ================================================================== 2D layer (projected) */

type CamMVs = MotionValue<number>[];

function useAnchor(cam: CamMVs, p: V3) {
  const pr = useTransform(cam, (v: number[]) => project(p, camOf(v)));
  return { x: useTransform(pr, (q) => q.x), y: useTransform(pr, (q) => q.y), s: useTransform(pr, (q) => q.s) };
}

interface Pose { p: V3; o: number; k?: number; r?: number }
/** A sprite pose driven by the shot clock (seconds since the shot began) and the camera. */
function usePose(cam: CamMVs, clock: MotionValue<number>, fn: (t: number) => Pose, base = 1, range: [number, number] = [0.55, 2.4]) {
  const st = useTransform([clock, ...cam], (v: number[]) => {
    const q = fn(v[0]);
    const pr = project(q.p, camOf(v.slice(1)));
    return { x: pr.x, y: pr.y, s: clamp(pr.s * base * (q.k ?? 1), range[0], range[1]), o: q.o, r: q.r ?? 0 };
  });
  return {
    x: useTransform(st, (q) => q.x), y: useTransform(st, (q) => q.y), scale: useTransform(st, (q) => q.s),
    opacity: useTransform(st, (q) => q.o), rotate: useTransform(st, (q) => q.r),
  };
}

/** Pin at a projected point: children are positioned relative to the anchor (0,0). */
function Pin({ cam, p, children }: { cam: CamMVs; p: V3; children: ReactNode }) {
  const a = useAnchor(cam, p);
  return <motion.div className="absolute top-1/2 left-1/2 size-0" style={{ x: a.x, y: a.y }}>{children}</motion.div>;
}

type Tone = "neutral" | "focus" | "alert" | "shadow" | "ok" | "muted";
const TONE: Record<Tone, string> = {
  neutral: "border-border-strong bg-background text-fg",
  muted: "border-border bg-background text-fg-muted",
  focus: "border-focus/60 bg-background text-focus",
  alert: "border-alert/70 bg-alert-bg text-alert",
  shadow: "border-shadow/70 bg-shadow-bg text-shadow",
  ok: "border-ok/60 bg-background text-ok",
};

/** A label pinned above (or beside) a 3D point, always upright, fixed size. */
function Tag({ cam, p, show, tone = "neutral", title, sub, side = "up", delay = 0, dy = 12, size = "md" }: {
  cam: CamMVs; p: V3; show: boolean; tone?: Tone; title: ReactNode; sub?: ReactNode; side?: "up" | "right" | "left" | "down";
  delay?: number; dy?: number; size?: "md" | "lg";
}) {
  const reduce = !!useReducedMotion();
  const pos = side === "up" ? { left: 0, bottom: dy, translate: "-50% 0" }
    : side === "down" ? { left: 0, top: dy, translate: "-50% 0" }
      : side === "right" ? { left: dy, top: 0, translate: "0 -50%" } : { right: dy, top: 0, translate: "0 -50%" };
  return (
    <Pin cam={cam} p={p}>
      <motion.div className={cn("pointer-events-none absolute rounded-xl border px-3.5 py-1.5 whitespace-nowrap", TONE[tone], size === "lg" && "px-4 py-2")}
        style={pos}
        initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.94 }}
        transition={reduce ? { duration: 0 } : { duration: 0.35, delay: show ? delay : 0, ease: [0.2, 0.8, 0.2, 1] }}>
        <div className={cn("leading-tight font-semibold tracking-[-0.01em]", size === "lg" ? "text-[22px]" : "text-[19px]")}>{title}</div>
        {sub && <div className="mt-0.5 text-[16px] leading-tight font-normal text-fg-muted">{sub}</div>}
      </motion.div>
    </Pin>
  );
}

function Sprite({ pose, children }: { pose: ReturnType<typeof usePose>; children: ReactNode }) {
  return (
    <motion.div className="pointer-events-none absolute top-1/2 left-1/2 size-0"
      style={{ x: pose.x, y: pose.y, scale: pose.scale, opacity: pose.opacity, rotate: pose.rotate }}>
      <div className="absolute top-0 left-0 -translate-1/2">{children}</div>
    </motion.div>
  );
}

function FileCard({ decoy }: { decoy: boolean }) {
  return (
    <div className="relative grid h-[58px] w-[46px] place-items-center rounded-[7px] border-2 bg-background transition-colors duration-500 motion-reduce:transition-none"
      style={{ borderColor: decoy ? "var(--shadow)" : "var(--focus)", color: decoy ? "var(--shadow)" : "var(--focus)" }}>
      <FileText className="size-[26px]" strokeWidth={2} />
    </div>
  );
}

/** One looping flyer along an arc. `slot` staggers it inside the stream. */
function Flyer({ cam, clock, a, b, peak, slot, n, gap, dur, start, reduce, children, base = 0.95 }: {
  cam: CamMVs; clock: MotionValue<number>; a: V3; b: V3; peak: number; slot: number; n: number; gap: number; dur: number; start: number;
  reduce: boolean; children: ReactNode; base?: number;
}) {
  const period = Math.max(dur + 0.2, n * gap);
  const pose = usePose(cam, clock, (t) => {
    if (reduce) {
      const k = 0.12 + (0.76 * (slot + 0.5)) / n;
      return { p: arcPt(a, b, peak, k), o: 1, r: -14 + 28 * k };
    }
    const local = t - start - slot * gap;
    if (local < 0) return { p: a, o: 0 };
    const u = local % period;
    if (u > dur) return { p: b, o: 0 };
    const k = u / dur;
    const o = Math.min(1, k / 0.08, (1 - k) / 0.1);
    return { p: arcPt(a, b, peak, k), o, r: -16 + 30 * k, k: 0.85 + 0.25 * Math.sin(Math.PI * k) };
  }, base, [0.6, 1.4]);
  return <Sprite pose={pose}>{children}</Sprite>;
}

/** Dotted trajectory line through a projected 3D arc. */
function ArcTrail({ cam, a, b, peak, color, show, dash = "2 12", width = 3 }: { cam: CamMVs; a: V3; b: V3; peak: number; color: string; show: boolean; dash?: string; width?: number }) {
  const reduce = !!useReducedMotion();
  const d = useTransform(cam, (v: number[]) => {
    const c = camOf(v);
    let s = "";
    for (let i = 0; i <= 28; i++) { const q = project(arcPt(a, b, peak, i / 28), c); s += `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }
    return s;
  });
  return (
    <motion.svg className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible" width={1} height={1} aria-hidden
      initial={{ opacity: 0 }} animate={{ opacity: show ? 0.75 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.4 }}>
      <motion.path d={d} fill="none" style={{ stroke: color }} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
    </motion.svg>
  );
}

/** A straight dashed line between two projected points (the attacker's way in). */
function Route({ cam, a, b, color, show }: { cam: CamMVs; a: V3; b: V3; color: string; show: boolean }) {
  const reduce = !!useReducedMotion();
  const d = useTransform(cam, (v: number[]) => {
    const c = camOf(v), p = project(a, c), q = project(b, c);
    return `M${p.x.toFixed(1)},${p.y.toFixed(1)}L${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  });
  return (
    <motion.svg className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible" width={1} height={1} aria-hidden
      initial={{ opacity: 0 }} animate={{ opacity: show ? 1 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.5 }}>
      <motion.path d={d} fill="none" style={{ stroke: color }} strokeWidth={4} strokeDasharray="10 12" strokeLinecap="round" />
    </motion.svg>
  );
}

type EyeMode = "calm" | "fire" | "watch" | "ping";
function EyeBadge({ mode, reduce }: { mode: EyeMode; reduce: boolean }) {
  const col = mode === "fire" || mode === "watch" ? "var(--alert)" : mode === "ping" ? "var(--shadow)" : "var(--fg-muted)";
  const bg = mode === "fire" || mode === "watch" ? "var(--alert-bg)" : mode === "ping" ? "var(--shadow-bg)" : "var(--surface-2)";
  const open = mode === "calm" ? 0.45 : 1;
  const tr = reduce ? { duration: 0 } : { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const };
  return (
    <div className="relative grid size-[96px] place-items-center rounded-full border-[3px] bg-background transition-colors duration-500 motion-reduce:transition-none" style={{ borderColor: col }}>
      <svg viewBox="-40 -26 80 52" width={74} height={48} aria-hidden className="overflow-visible">
        <motion.g initial={{ scaleY: open }} animate={{ scaleY: open }} transition={tr}>
          <path d="M-36 0 Q0 -31 36 0 Q0 31 -36 0Z" style={{ fill: bg, stroke: col, transition: "fill .5s, stroke .5s" }} strokeWidth={4} />
          <circle r={13} style={{ fill: col, transition: "fill .5s" }} />
          <circle r={5.5} style={{ fill: "var(--background)" }} />
          <circle cx={-4} cy={-4} r={2.4} style={{ fill: "var(--background)" }} opacity={0.8} />
        </motion.g>
      </svg>
    </div>
  );
}

/** Expanding rings drawn in the 2D layer around a projected point (scan sweeps, pings). */
function Pulse({ cam, p, color, size, delay = 0, repeat = 1, every = 0.25, show }: {
  cam: CamMVs; p: V3; color: string; size: number; delay?: number; repeat?: number; every?: number; show: boolean;
}) {
  const reduce = !!useReducedMotion();
  if (!show || reduce) return null;
  return (
    <Pin cam={cam} p={p}>
      <motion.div className="pointer-events-none absolute rounded-full border-[3px]" style={{ left: -size / 2, top: -size / 2, width: size, height: size, borderColor: color }}
        initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 1.9] }}
        transition={{ duration: 1.3, delay, repeat, repeatDelay: every, ease: "easeOut" }} />
    </Pin>
  );
}

/* ================================================================== hooks */

function useFrame(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 1920, h: 860 });
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

function useCamera(shot: Shot, w: number, h: number, reduce: boolean) {
  const [c0] = useState(() => fit(shot, w, h));
  const tu = useMotionValue(c0.tu), tv = useMotionValue(c0.tv), tz = useMotionValue(c0.tz);
  const tilt = useMotionValue(c0.tilt), swing = useMotionValue(c0.swing), zoom = useMotionValue(c0.zoom);
  const lx = useMotionValue(c0.lx), ly = useMotionValue(c0.ly);
  const last = useRef<Shot | null>(null);
  useLayoutEffect(() => {
    const c = fit(shot, w, h);
    const pairs: [MotionValue<number>, number][] = [[tu, c.tu], [tv, c.tv], [tz, c.tz], [tilt, c.tilt], [swing, c.swing], [zoom, c.zoom], [lx, c.lx], [ly, c.ly]];
    const jump = reduce || last.current === null || last.current === shot;
    last.current = shot;
    if (jump) { for (const [m, v] of pairs) { m.stop(); m.set(v); } return; }
    const ctl = pairs.map(([m, v]) => animate(m, v, { duration: 1.3, ease: [0.65, 0, 0.35, 1] }));
    return () => { for (const a of ctl) a.stop(); };
  }, [shot, w, h, reduce, tu, tv, tz, tilt, swing, zoom, lx, ly]);
  const transform = useTransform([tu, tv, tz, tilt, swing, zoom], (v: number[]) =>
    `scale3d(${v[5]},${v[5]},${v[5]}) rotateX(${v[3]}deg) rotateZ(${v[4]}deg) translate3d(${-v[0]}px,${-v[1]}px,${-v[2]}px)`);
  return { list: [tu, tv, tz, tilt, swing, zoom], transform, lx, ly };
}

/** Seconds since the current shot began (a large constant under reduced motion = every end state). */
function useShotClock(shot: Shot, reduce: boolean) {
  const time = useTime();
  const start = useMotionValue(0);
  useLayoutEffect(() => { start.set(time.get()); }, [shot, start, time]);
  return useTransform([time, start], (v: number[]) => (reduce ? 60 : (v[0] - v[1]) / 1000));
}

/* ================================================================== the film */

const IDX = (s: Shot) => SHOTS.indexOf(s);
const noSub = () => () => {};
/** False on the server and during hydration, true after: the film draws client-side only, so there is no
 *  SSR/CSR float or reduced-motion mismatch, and nothing can be left stuck at its initial state. */
function useIsClient() {
  return useSyncExternalStore(noSub, () => true, () => false);
}

export function Film({ shot, className }: { shot: Shot; className?: string }) {
  const client = useIsClient();
  return (
    <div className={cn("mjf relative h-full w-full overflow-hidden bg-background select-none", className)}>
      <style>{CSS}</style>
      {client && <Stage shot={shot} />}
    </div>
  );
}

function Stage({ shot }: { shot: Shot }) {
  const facts = useRunFacts();
  const reduce = !!useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useFrame(ref);
  const cam = useCamera(shot, w, h, reduce);
  const clock = useShotClock(shot, reduce);

  const i = IDX(shot);
  const from = (s: Shot) => i >= IDX(s);
  const is = (...s: Shot[]) => s.includes(shot);

  const attackerOn = from("request") && !is("disperse");
  const twinOn = from("transfer");
  const decoy = from("swap");
  const wide = is("network", "disperse");
  const fs = facts?.firstSight ?? null;
  const beacons = Math.max(1, facts?.trackers.length ?? 3);

  // Dimming of the 3D pieces per shot (0 = full colour, 1 = background).
  const dimOther = wide ? 0 : 0.55;
  const dimE = is("network", "hospital", "disperse") ? 0 : is("swap") ? 0.15 : 0.42;
  const dimGate = is("request", "firstsight", "fingerprint") ? 0 : is("hospital") ? 0.55 : is("network") ? 0.35 : is("disperse") ? 0.4 : 0.22;
  const dimReal = is("network", "hospital", "swap", "disperse") ? 0 : 0.42;
  const dimLap = is("request", "transfer", "fingerprint") ? 0 : is("disperse") ? 0.5 : 0.2;

  return (
    <div ref={ref} className="absolute inset-0">
      {/* lens: slides the whole picture so the focal object sits in the free part of the frame */}
      <motion.div className="absolute inset-0" style={{ x: cam.lx, y: cam.ly }}>
        <div className="absolute inset-0" style={{ perspective: PERSP, perspectiveOrigin: "50% 50%" }}>
          <motion.div className="mjf-3d absolute top-1/2 left-1/2 size-0" style={{ transform: cam.transform }}>
            <Island uid={uid} />

            {/* network links */}
            {WORLD.links.map(([a, b], k) => {
              const A = HBY.get(a), B = HBY.get(b);
              if (!A || !B) return null;
              const hot = is("hospital") && (a === EB.id || b === EB.id);
              return <Cable key={`${a}-${b}`} a={A.p} b={B.p} seed={k} dots={is("network") || hot ? 4 : 0} width={hot ? 7 : 6} />;
            })}
            {/* Eastbank's own cables: to its data store, and the way in past the gateway */}
            <Cable a={E} b={REAL} dots={is("hospital") ? 3 : 0} seed={3} speed={120} />
            <Cable a={GATE} b={E} dots={is("hospital") ? 2 : 0} seed={7} speed={120} />

            {/* hospitals */}
            {HOSP.map((hs) => (
              <Dim key={hs.id} dim={hs.id === EB.id ? dimE : dimOther}><Building h={hs} /></Dim>
            ))}

            <Dim dim={dimReal}><Stack p={REAL} decoy={false} /></Dim>
            <Dim dim={dimGate}><Gateway /></Dim>

            <AnimatePresence>
              {twinOn && <TwinPad key="twinpad" />}
              {twinOn && (
                <Rise key="twin" depth={STACK_H + 20} delay={reduce ? 0 : 0.25}>
                  <Dim dim={is("fingerprint") ? 0.35 : is("disperse") ? 0.62 : 0}><Stack p={TWIN} decoy={decoy} /></Dim>
                </Rise>
              )}
              {attackerOn && (
                <Rise key="lap" depth={420} delay={reduce ? 0 : 0.15}>
                  <Dim dim={dimLap}><Laptop /></Dim>
                </Rise>
              )}
            </AnimatePresence>

            {/* focal rings on the ground */}
            {is("hospital") && <GroundRing key="r-eas" p={E} r={190} color="var(--focus)" delay={1.1} />}
            {is("request") && <GroundRing key="r-lap" p={LAP} r={150} color="var(--alert)" delay={1.0} />}
            {is("firstsight") && <GroundHalo key="h-gate" p={GATE} r={138} color="var(--alert)" fill="color-mix(in srgb, var(--alert) 12%, transparent)" delay={0.5} />}
            {is("firstsight") && <GroundRing key="r-gate" p={GATE} r={138} color="var(--alert)" delay={0.7} repeat={2} />}
            {is("transfer") && <GroundRing key="r-twin" p={TWIN} r={130} color="var(--focus)" delay={1.0} />}
            {is("swap") && <GroundRing key="r-twin2" p={TWIN} r={130} color="var(--shadow)" delay={0.9} />}
            {is("swap") && <GroundHalo key="h-real" p={REAL} r={124} color="var(--focus)" fill="color-mix(in srgb, var(--focus) 10%, transparent)" delay={1.2} />}
            {is("fingerprint") && <GroundRing key="r-gate2" p={GATE} r={138} color="var(--shadow)" delay={1.3} repeat={2} />}
            {is("disperse") && HOSP.filter((x) => x.id !== EB.id).map((x, k) => (
              <GroundRing key={`r-${x.id}`} p={x.p} r={Math.max(x.w, x.d) * 0.95} color="var(--ok)" delay={2.5 + k * 0.16} />
            ))}
          </motion.div>
        </div>

        {/* ----- 2D layer: routes, flyers, labels ----- */}
        <div className="pointer-events-none absolute inset-0">
          <Route cam={cam.list} a={at(off(LAP, 0, -60), 4)} b={at(GATE, 4)} color="var(--alert)" show={is("request", "firstsight")} />
          <Eye cam={cam.list} clock={clock} shot={shot} reduce={reduce} />

          {/* stream of copied files: twin stack → attacker */}
          <ArcTrail cam={cam.list} a={COPY_A} b={COPY_B} peak={COPY_PEAK} color={decoy ? "var(--shadow)" : "var(--focus)"} show={is("transfer", "swap")} />
          {is("transfer", "swap") && Array.from({ length: 8 }, (_, k) => (
            <Flyer key={k} cam={cam.list} clock={clock} a={COPY_A} b={COPY_B} peak={COPY_PEAK} slot={k} n={8} gap={0.26} dur={1.7}
              start={is("transfer") ? 1.1 : 0} reduce={reduce}>
              <FileCard decoy={decoy} />
            </Flyer>
          ))}

          {/* tracker beacons: the stolen files call home to the gateway */}
          <ArcTrail cam={cam.list} a={SCREEN} b={EYE} peak={170} color="var(--shadow)" show={is("fingerprint")} />
          {is("fingerprint") && Array.from({ length: beacons }, (_, k) => (
            <Flyer key={k} cam={cam.list} clock={clock} a={SCREEN} b={EYE} peak={170} slot={k} n={beacons} gap={0.7} dur={1.5} start={0.9} reduce={reduce}>
              <span className="block size-[22px] rounded-full border-[3px] border-background bg-shadow" style={{ boxShadow: "0 0 0 5px color-mix(in srgb, var(--shadow) 30%, transparent)" }} />
            </Flyer>
          ))}

          {/* encrypted pieces fly from Eastbank's store to the other hospitals, then stay */}
          {is("disperse") && HOSP.filter((x) => x.id !== EB.id).map((x, k) => (
            <Shard key={x.id} cam={cam.list} clock={clock} to={x} k={k} reduce={reduce} />
          ))}

          <Packet cam={cam.list} clock={clock} shot={shot} reduce={reduce} />
          <HeroFile cam={cam.list} clock={clock} active={is("tracker")} reduce={reduce} />
          <Pulse cam={cam.list} p={EYE} color="var(--alert)" size={110} delay={0.75} repeat={2} every={0.15} show={is("firstsight")} />
          <Pulse cam={cam.list} p={at(off(GATE, 0, 14), 50)} color="var(--alert)" size={90} delay={1.0} repeat={2} every={0.3} show={is("firstsight")} />

          {/* padlock on the real store once the twin is revealed */}
          <PadLock cam={cam.list} show={from("swap") && !is("tracker")} reduce={reduce} />

          {/* ----- labels ----- */}
          {HOSP.map((x, k) => {
            const eas = x.id === EB.id;
            const show = wide || (eas && !is("tracker"));
            return (
              <Tag key={x.id} cam={cam.list} p={at(x.p, x.h + (is("disperse") ? 84 : wide ? 46 : 26))} show={show} title={x.label}
                sub={eas && is("swap") ? <span className="font-medium text-ok">Care keeps running</span>
                  : eas && is("disperse") ? <span className="font-medium text-focus">Live records stay</span> : undefined}
                delay={wide ? 0.5 + k * 0.07 : 0.4} size={eas && is("hospital") ? "lg" : "md"} />
            );
          })}
          <SlabList cam={cam.list} show={is("hospital")} />
          <Tag cam={cam.list} p={at(GATE, GATE_TOP + 112)} show={is("request")} title="MayaJaal gateway" delay={0.9} />
          <Tag cam={cam.list} p={at(GATE, GATE_TOP + 112)} show={is("fingerprint")} tone="shadow" title="Trackers call home" delay={1.2} />
          <Tag cam={cam.list} p={at(LAP, 150)} show={is("request", "transfer", "fingerprint")} tone="alert" title="Attacker" delay={0.8} />
          <Tag cam={cam.list} p={off(TWIN, SLAB.w / 2, -SLAB.d / 2, STACK_H * 0.55)} side="right" dy={40} show={is("swap")} tone="shadow" title="Decoy twin" sub="Built for this login" delay={1.0} size="lg" />
          <Tag cam={cam.list} p={at(REAL, STACK_H + 110)} show={is("swap")} tone="focus" title="Real records" sub="Locked · untouched" delay={1.3} size="lg" />
        </div>
      </motion.div>

      {/* tracker dive: the world recedes behind the document */}
      <motion.div className="pointer-events-none absolute inset-0 bg-background" initial={{ opacity: 0 }}
        animate={{ opacity: is("tracker") ? 0.82 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.6, delay: is("tracker") ? 0.9 : 0 }} />

      <Inserts shot={shot} facts={facts} fs={fs} reduce={reduce} w={w} h={h} />
    </div>
  );
}

/* ================================================================== shot pieces */

/** The data store's contents, listed beside the stack in the same top-to-bottom order as the slabs. */
function SlabList({ cam, show }: { cam: CamMVs; show: boolean }) {
  const reduce = !!useReducedMotion();
  const names = [...SLAB_NAMES].reverse();
  return (
    <Pin cam={cam} p={off(REAL, SLAB.w / 2, -SLAB.d / 2, SLAB.base + (STACK_H - SLAB.base) / 2)}>
      <div className="pointer-events-none absolute top-0 left-[44px] flex -translate-y-1/2 items-stretch gap-3">
        <motion.span className="block w-[3px] rounded-full bg-focus" initial={{ opacity: 0, scaleY: 0.4 }} animate={{ opacity: show ? 0.8 : 0, scaleY: show ? 1 : 0.4 }}
          transition={reduce ? { duration: 0 } : { duration: 0.4, delay: show ? 1.1 : 0 }} />
        <div className="flex flex-col gap-2">
          {names.map((n, k) => (
            <motion.span key={n} className="flex items-center gap-2.5 rounded-lg border border-border-strong bg-background py-1 pr-3.5 pl-3 text-[19px] font-medium whitespace-nowrap text-fg"
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: show ? 1 : 0, x: show ? 0 : -8 }}
              transition={reduce ? { duration: 0 } : { duration: 0.35, delay: show ? 1.2 + k * 0.12 : 0 }}>
              <span className="block size-[9px] rounded-full bg-focus" />{n}
            </motion.span>
          ))}
        </div>
      </div>
    </Pin>
  );
}

function Packet({ cam, clock, shot, reduce }: { cam: CamMVs; clock: MotionValue<number>; shot: Shot; reduce: boolean }) {
  const startP = at(off(LAP, 0, -40), 46);
  const front = at(off(GATE, 0, 110), 46);
  const held = at(GATE, 58);
  const pose = usePose(cam, clock, (t) => {
    if (shot === "request") {
      const k = reduce ? 1 : easeIO(clamp((t - 1.3) / 2.4, 0, 1));
      const p = arcPt(startP, front, 26, k);
      return { p, o: reduce ? 1 : clamp((t - 0.9) / 0.3, 0, 1) };
    }
    if (shot === "firstsight") {
      const k = reduce ? 1 : easeIO(clamp((t - 0.15) / 0.7, 0, 1));
      const p = arcPt(front, held, 10, k);
      if (!reduce) p[2] += Math.sin(t * 3.2) * 4 * clamp(t - 0.9, 0, 1);
      return { p, o: 1 };
    }
    return { p: held, o: 0 };
  }, 1, [0.6, 1.6]);
  const tagOn = shot === "request" || shot === "firstsight";
  return (
    <>
      <Sprite pose={pose}>
        <div className={cn("grid h-[50px] w-[66px] place-items-center rounded-xl border-[3px] border-alert bg-alert-bg text-alert")}>
          <IdCard className="size-[30px]" strokeWidth={2} />
        </div>
      </Sprite>
      <PoseTag pose={pose} show={tagOn} reduce={reduce} />
    </>
  );
}

/** Unscaled label that rides along with a sprite pose. */
function PoseTag({ pose, show, reduce }: { pose: ReturnType<typeof usePose>; show: boolean; reduce: boolean }) {
  return (
    <motion.div className="pointer-events-none absolute top-1/2 left-1/2 size-0" style={{ x: pose.x, y: pose.y, opacity: pose.opacity }}>
      <motion.div className="absolute bottom-[42px] left-0 -translate-x-1/2 rounded-xl border border-alert/70 bg-alert-bg px-3.5 py-1.5 text-[19px] font-semibold whitespace-nowrap text-alert"
        initial={{ opacity: 0 }} animate={{ opacity: show ? 1 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.3, delay: show ? 1.2 : 0 }}>
        Stolen nurse login
      </motion.div>
    </motion.div>
  );
}

function Eye({ cam, clock, shot, reduce }: { cam: CamMVs; clock: MotionValue<number>; shot: Shot; reduce: boolean }) {
  const hidden = shot === "tracker" || shot === "network" || shot === "hospital";
  const back = shot === "transfer" || shot === "swap" || shot === "disperse";
  const full = back ? 0.45 : 1;
  const pose = usePose(cam, clock, (t) => ({ p: EYE, o: hidden ? 0 : reduce ? full : full * clamp((t - 0.3) / 0.4, 0, 1), k: back ? 0.75 : 1 }), 1, [0.45, 1.5]);
  const mode: EyeMode = shot === "firstsight" ? "fire" : shot === "transfer" || shot === "swap" ? "watch" : shot === "fingerprint" ? "ping" : "calm";
  return <Sprite pose={pose}><EyeBadge mode={mode} reduce={reduce} /></Sprite>;
}

function Shard({ cam, clock, to, k, reduce }: { cam: CamMVs; clock: MotionValue<number>; to: Hosp; k: number; reduce: boolean }) {
  const a = at(REAL, STACK_H + 20);
  const b = at(to.p, to.h + 30);
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const peak = 160 + dist * 0.22;
  const pose = usePose(cam, clock, (t) => {
    const kk = reduce ? 1 : easeIO(clamp((t - 1.2 - k * 0.16) / 1.4, 0, 1));
    const o = reduce ? 1 : clamp((t - 1.2 - k * 0.16) / 0.15, 0, 1);
    return { p: arcPt(a, b, peak, kk), o };
  }, 1.15, [0.7, 1.6]);
  return (
    <Sprite pose={pose}>
      <div className="grid size-[44px] place-items-center rounded-xl border-[3px] border-ok bg-background text-ok">
        <Lock className="size-[22px]" strokeWidth={2.4} />
      </div>
    </Sprite>
  );
}

function PadLock({ cam, show, reduce }: { cam: CamMVs; show: boolean; reduce: boolean }) {
  return (
    <Pin cam={cam} p={at(REAL, STACK_H + 46)}>
      <motion.div className="absolute top-0 left-0 grid size-[52px] -translate-1/2 place-items-center rounded-full border-[3px] border-focus bg-background text-focus"
        initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.6 }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, delay: show ? 1.1 : 0, ease: [0.2, 0.8, 0.2, 1] }}>
        <Lock className="size-[24px]" strokeWidth={2.4} />
      </motion.div>
    </Pin>
  );
}

/** Tracker shot: one file at the top of its arc grows toward the camera and becomes the document. */
function HeroFile({ cam, clock, active, reduce }: { cam: CamMVs; clock: MotionValue<number>; active: boolean; reduce: boolean }) {
  const pose = usePose(cam, clock, (t) => {
    if (!active || reduce) return { p: APEX, o: 0 };
    const grow = clamp((t - 0.85) / 0.55, 0, 1);
    return { p: APEX, o: clamp(t / 0.25, 0, 1) * (1 - clamp((t - 1.2) / 0.3, 0, 1)), k: 1 + grow * grow * 5, r: -6 * (1 - grow) };
  }, 1, [0.5, 12]);
  return <Sprite pose={pose}><FileCard decoy /></Sprite>;
}

/* ================================================================== inserts (2D panels) */

function fitScale(box: { w: number; h: number } | null, maxW: number, maxH: number) {
  if (!box) return 1;
  return clamp(Math.min(maxW / box.w, maxH / box.h, 1), 0.55, 1);
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
  const scale = fitScale(box, side === "center" ? w * 0.86 : w * 0.46 - gap, h - 2 * gap);
  const style: CSSProperties = side === "center"
    ? { left: "50%", top: "50%", translate: "-50% -50%" }
    : { right: gap, top: "50%", translate: "0 -50%" };
  return (
    <motion.div className="pointer-events-auto absolute z-10" style={{ ...style, transformOrigin: side === "center" ? "50% 50%" : "100% 50%" }}
      initial={{ opacity: 0, scale: scale * (side === "center" ? 0.4 : 0.96), x: side === "center" ? 0 : 24 }}
      animate={{ opacity: 1, scale, x: 0 }}
      exit={{ opacity: 0, scale: scale * 0.97, transition: reduce ? { duration: 0 } : { duration: 0.25 } }}
      transition={reduce ? { duration: 0 } : { duration: side === "center" ? 0.55 : 0.45, delay, ease: [0.2, 0.8, 0.2, 1] }}>
      <div ref={ref}>{children}</div>
    </motion.div>
  );
}

function Inserts({ shot, facts, fs, reduce, w, h }: {
  shot: Shot; facts: ReturnType<typeof useRunFacts>; fs: { score: number; threshold: number; signals: string[] } | null; reduce: boolean; w: number; h: number;
}) {
  return (
    <AnimatePresence>
      {shot === "firstsight" && (
        <Insert key="gauge" side="right" w={w} h={h} reduce={reduce} delay={0.7}>
          <FirstSightGauge score={fs?.score ?? null} threshold={fs?.threshold ?? null} signals={fs?.signals ?? []} />
        </Insert>
      )}
      {(shot === "transfer" || shot === "swap") && (
        <Insert key="copy" side="right" w={w} h={h} reduce={reduce} delay={0.6}>
          <CopyDialog total={facts ? facts.fakeRecords : null} decoy={shot === "swap"} />
        </Insert>
      )}
      {shot === "tracker" && (
        <Insert key="tracker" side="center" w={w} h={h} reduce={reduce} delay={1.1}>
          <TrackerDoc trackers={facts?.trackers ?? []} />
        </Insert>
      )}
      {shot === "fingerprint" && (
        <Insert key="fp" side="right" w={w} h={h} reduce={reduce} delay={0.6}>
          <FingerprintCard facts={facts} />
        </Insert>
      )}
      {shot === "disperse" && (
        <Insert key="key" side="right" w={w} h={h} reduce={reduce} delay={0.9}>
          <KeySplit holders={facts?.scatter?.holders ?? []} threshold={facts?.scatter?.keyThreshold ?? null} verified={!!facts?.scatter?.verified} />
        </Insert>
      )}
    </AnimatePresence>
  );
}
