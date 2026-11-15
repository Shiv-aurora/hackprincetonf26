"use client";
// The main visual: how MayaJaal handles one stolen login, hospital-wide.
//   Close view: the attacker, the MayaJaal gateway (First Sight at login), Eastbank Community, and the
//   decoy copy that is built beside it once the session is diverted.
//   Wide view: the camera pulls back to the whole city. An encrypted copy of Eastbank's records is cut
//   into pieces held across the six hospitals (key k of n). The lab-outage run shows the shared lab down
//   and urgent tests rerouting.
// Everything is a pure function of the shared event store, so the guided demo can jump to any prefix.

import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { WORLD, type EventDataMap, type Hospital, type MJEvent, type NodeState } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";

/* ------------------------------------------------------------------ geometry */

const C = Math.cos(Math.PI / 6);
interface Pt { x: number; y: number }
const add = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

// City plane (0-100 grid from world.json) in isometric projection. Rotated a quarter turn so that
// Eastbank, the entry point, sits on the left where the attacker comes in from outside.
const K = 24, OX = 1500, OY = -300;
const cityPt = (h: Hospital): Pt => {
  const a = 100 - h.y, b = h.x;
  return { x: OX + (a - b) * C * K, y: OY + (a + b) * 0.5 * K };
};
const HOSP = WORLD.hospitals.map((h) => ({ ...h, p: cityPt(h) }));
const byId = (id: string) => HOSP.find((h) => h.id === id);
const ENTRY_ID = WORLD.entry_point.hospital_id;
const E = byId(ENTRY_ID)?.p ?? { x: 669, y: 1188 };

// Buildings: iso boxes in local units.
const U = 26;
const iso = (o: Pt, x: number, y: number, z: number): Pt => ({ x: o.x + (x - y) * C * U, y: o.y + (x + y) * 0.5 * U - z * U });
const pts = (o: Pt, ps: [number, number, number][]) => ps.map(([x, y, z]) => { const q = iso(o, x, y, z); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");
const BW = 5, BD = 4, BH = 2.6;                 // hospital footprint and height
const roofOf = (o: Pt): Pt => iso(o, 0, 0, BH);

// Layout of the close view, relative to Eastbank.
const D = add(E, 150, 235);                      // decoy copy, beside the real hospital
const G = add(E, -300, 95);                      // MayaJaal gateway
const GW = 1.8, GH = 2.6;
const WP = {
  A0: add(E, -540, 150),                         // outside: the stolen login
  GL: add(G, -150, 34),                           // at the gateway
  GR: add(G, 46, 18),                            // leaving the gateway
  STEP: add(E, -170, 52),                        // bounced at the lock
  RD: add(E, -50, 20),                           // real door
  RR: roofOf(E),                                 // inside the real hospital
  DD: add(D, -50, 20),                           // decoy door
  DR: roofOf(D),                                 // inside the decoy
  X: add(E, -510, 262),                          // gone, with what they took
} as const;
type WPKey = keyof typeof WP;
const LOCK = add(E, -112, 40);
const CARD = { x: E.x - 640, y: E.y - 248, w: 410, h: 218 };

type Box4 = [number, number, number, number];
const CLOSE: Box4 = [E.x - 660, E.y - 320, 1140, 660];
const WIDE: Box4 = [-100, -40, 2864, 1660];
const vb = (b: Box4) => b.map((n) => n.toFixed(1)).join(" ");

const NS = { vectorEffect: "non-scaling-stroke" as const };

/* ------------------------------------------------------------------ derivation */

type Phase = "idle" | "approach" | "login" | "stepup" | "decoy" | "real" | "exfil";
type Vault = EventDataMap["vault.scattered"];

interface Flow {
  mode: "idle" | "attack" | "outage";
  phase: Phase;
  trail: WPKey[];
  firstSight: { score: number; threshold: number; chips: string[] } | null;
  stepUp: boolean;
  diverted: boolean;
  scatter: Vault | null;
  wide: boolean;
  shadowBytes: number;
  lures: number;
  touched: number;
  exfil: { records: number; fake: boolean } | null;
  ended: EventDataMap["run.ended"]["outcome"] | null;
  leaked: number;
  protectedTotal: number;
  lum: NodeState;
  reroutedAny: boolean;
  steps: string[];
  step: number;   // index of the current step, -1 before anything
}

function chipsFrom(reason: string): string[] {
  const r = reason.toLowerCase();
  const out: string[] = [];
  if (r.includes("script")) out.push("Script, not the EHR app");
  if (r.includes("device")) out.push("Unknown device");
  if (r.includes("hour") || r.includes("night")) out.push("Unusual hour");
  if (r.includes("location") || r.includes("network") || r.includes("ip")) out.push("New network");
  return out.length ? out.slice(0, 3) : ["Script, not the EHR app", "Unknown device"];
}

const ATTACK_STEPS = ["Login", "First Sight", "Scatter", "Step-up", "Decoy", "Leaves with fakes"];
const OUTAGE_STEPS = ["Lab hit", "Isolated", "Tests rerouted"];

function derive(events: MJEvent[]): Flow {
  let phase: Phase = "idle";
  const trail: WPKey[] = [];
  const go = (...k: WPKey[]) => { for (const x of k) if (trail.at(-1) !== x) trail.push(x); };
  let firstSight: Flow["firstSight"] = null;
  let stepUp = false, diverted = false, scatter: Vault | null = null;
  let scatterIdx = -1, lastAttackIdx = -1, anyAttack = false;
  let shadowBytes = 0, touched = 0;
  const lurePaths = new Set<string>();
  let exfil: Flow["exfil"] = null, ended: Flow["ended"] = null, leaked = 0, protectedTotal = WORLD.protected_canaries_total;
  let lum: NodeState = "healthy", reroutedAny = false, mission = "";
  let reached = -1, outageReached = -1;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case "run.started":
        phase = "approach"; trail.length = 0; go("A0");
        firstSight = null; stepUp = false; diverted = false; scatter = null; scatterIdx = -1; lastAttackIdx = -1;
        anyAttack = false; shadowBytes = 0; touched = 0; lurePaths.clear(); exfil = null; ended = null; leaked = 0;
        lum = "healthy"; reroutedAny = false; mission = e.data.mission; reached = -1; outageReached = -1;
        break;
      case "request": {
        if (e.actor !== "attacker") break;
        anyAttack = true; lastAttackIdx = i;
        const p = e.data.path.toLowerCase();
        if (trail.length === 0) go("A0");
        if (p.startsWith("/auth")) { phase = "login"; go("GL"); reached = Math.max(reached, 0); break; }
        if (e.tier === "shadow") {
          shadowBytes += e.data.bytes;
          if (phase !== "decoy") go(trail.at(-1) === "STEP" ? "STEP" : "GL", "GR", "DD");
          go("DR"); phase = "decoy";
        } else if (e.data.status === 401 || e.data.status === 403 || e.tier === "none") {
          if (!diverted) { phase = "stepup"; stepUp = true; go("GL", "STEP"); reached = Math.max(reached, 3); }
        } else if (e.tier === "real") {
          if (phase !== "real") go("GL", "GR", "RD");
          go("RR"); phase = "real";
        }
        break;
      }
      case "policy.decision": {
        const m = e.data.reason.match(/score ([\d.]+)\s*(?:≥|>=|>)\s*([\d.]+)/);
        if (e.data.reason.startsWith("First Sight") && !firstSight) {
          firstSight = { score: m ? Number(m[1]) : NaN, threshold: m ? Number(m[2]) : NaN, chips: chipsFrom(e.data.reason) };
          reached = Math.max(reached, 1);
        }
        break;
      }
      case "vault.scattered": scatter = e.data; scatterIdx = i; reached = Math.max(reached, 2); break;
      case "session.diverted": diverted = true; reached = Math.max(reached, 4); break;
      case "honeytoken.minted": lurePaths.add(e.data.placed_at); break;
      case "breadcrumb.planted": lurePaths.add(e.data.path); break;
      case "honeytoken.touched": touched++; break;
      case "canary.check": leaked = e.data.leaked; protectedTotal = e.data.protected_total; break;
      case "exfil":
        exfil = { records: e.data.records, fake: diverted };
        phase = "exfil"; go(diverted ? "DD" : "RD", "X"); reached = Math.max(reached, 5);
        break;
      case "run.ended": ended = e.data.outcome; leaked = Math.max(leaked, e.data.outcome?.secrets_leaked ?? 0); break;
      case "node.status":
        if (e.hospital_id === "lum") {
          lum = e.data.status;
          if (e.data.status === "compromised" || e.data.status === "down") outageReached = Math.max(outageReached, 0);
          if (e.data.status === "quarantined") outageReached = Math.max(outageReached, 1);
        }
        break;
      case "lab.order":
        if (e.data.status === "rerouted") { reroutedAny = true; if (lum !== "healthy") outageReached = Math.max(outageReached, 2); }
        break;
    }
  }

  const lumDown = lum === "compromised" || lum === "quarantined" || lum === "down";
  const mode: Flow["mode"] = events.length === 0 ? "idle"
    : !anyAttack && (lumDown || reroutedAny || mission === "disrupt") ? "outage" : "attack";
  const wide = !!ended || mode === "outage" || (scatterIdx >= 0 && scatterIdx > lastAttackIdx);
  if (mode === "attack" && phase === "approach") reached = -1;
  return {
    mode, phase, trail, firstSight, stepUp, diverted, scatter, wide, shadowBytes, lures: lurePaths.size, touched,
    exfil, ended, leaked, protectedTotal, lum, reroutedAny,
    steps: mode === "outage" ? OUTAGE_STEPS : ATTACK_STEPS,
    step: mode === "outage" ? outageReached : wide && scatter && !ended ? 2 : reached,
  };
}

/* ------------------------------------------------------------------ primitives */

type Tone = "real" | "decoy" | "gate" | "gateAlert" | "alert" | "piece";
const TONES: Record<Tone, { top: string; l: string; r: string; s: string }> = {
  real: { top: "fill-background", l: "fill-surface-2", r: "fill-surface", s: "stroke-border-strong" },
  decoy: { top: "fill-shadow-bg", l: "fill-shadow/15", r: "fill-shadow/10", s: "stroke-shadow" },
  gate: { top: "fill-fg", l: "fill-fg/80", r: "fill-fg/60", s: "stroke-fg" },
  gateAlert: { top: "fill-alert", l: "fill-alert/80", r: "fill-alert/60", s: "stroke-alert" },
  alert: { top: "fill-alert-bg", l: "fill-alert/25", r: "fill-alert/15", s: "stroke-alert" },
  piece: { top: "fill-fg", l: "fill-fg/80", r: "fill-fg/65", s: "stroke-background" },
};

function IsoBox({ at, w, d, h, tone, dashed, windows, cross, z0 = 0 }: {
  at: Pt; w: number; d: number; h: number; tone: Tone; dashed?: boolean; windows?: boolean; cross?: boolean; z0?: number;
}) {
  const t = TONES[tone];
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2, z1 = z0 + h;
  const dash = dashed ? "6 4" : undefined;
  const face = (ps: [number, number, number][], fill: string) => (
    <polygon points={pts(at, ps)} className={cn(fill, t.s)} strokeWidth={1.25} strokeLinejoin="round" strokeDasharray={dash} {...NS} />
  );
  const win: ReactNode[] = [];
  if (windows) {
    const ink = tone === "decoy" ? "stroke-shadow/45" : tone === "alert" ? "stroke-alert/50" : "stroke-border-strong";
    for (const zr of [z0 + h * 0.36, z0 + h * 0.7]) {
      for (let i = 0; i < 3; i++) {
        const a = y0 + 0.6 + i * ((d - 1.2) / 3), b = a + 0.5;
        win.push(<polyline key={`r${zr}${i}`} points={pts(at, [[x1, a, zr], [x1, b, zr]])} className={ink} strokeWidth={2.5} fill="none" {...NS} />);
      }
    }
  }
  const crossInk = tone === "decoy" ? "fill-shadow/35" : tone === "alert" ? "fill-alert/40" : "fill-border-strong";
  return (
    <g>
      {face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], t.l)}
      {face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], t.r)}
      {face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], t.top)}
      {win}
      {cross && (() => {
        const zc = z0 + h / 2, a = 0.22, b = 0.72;
        return (
          <g>
            <polygon points={pts(at, [[-a, y1, zc - b], [a, y1, zc - b], [a, y1, zc + b], [-a, y1, zc + b]])} className={crossInk} />
            <polygon points={pts(at, [[-b, y1, zc - a], [b, y1, zc - a], [b, y1, zc + a], [-b, y1, zc + a]])} className={crossInk} />
          </g>
        );
      })()}
    </g>
  );
}

function Pad({ at, tone }: { at: Pt; tone: "real" | "decoy" | "alert" }) {
  const m = 0.9;
  return (
    <polygon points={pts(at, [[-BW / 2 - m, -BD / 2 - m, 0], [BW / 2 + m, -BD / 2 - m, 0], [BW / 2 + m, BD / 2 + m, 0], [-BW / 2 - m, BD / 2 + m, 0]])}
      className={tone === "decoy" ? "fill-shadow-bg/50 stroke-shadow/50" : tone === "alert" ? "fill-alert-bg/60 stroke-alert/50" : "fill-surface stroke-border"}
      strokeWidth={1} strokeDasharray={tone === "decoy" ? "5 4" : undefined} {...NS} />
  );
}

function Lock({ at, s = 1, tone }: { at: Pt; s?: number; tone: "fg" | "alert" }) {
  const al = tone === "alert";
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${s})`}>
      <path d="M-7 -4 V-9 a7 7 0 0 1 14 0 V-4" fill="none" className={al ? "stroke-alert" : "stroke-fg"} strokeWidth={2.5} {...NS} />
      <rect x={-11} y={-4} width={22} height={17} rx={3} className={al ? "fill-alert" : "fill-fg"} />
      <circle cx={0} cy={4} r={2.4} className="fill-background" />
    </g>
  );
}

function Diamond({ at, r, filled }: { at: Pt; r: number; filled: boolean }) {
  return (
    <polygon points={`${at.x},${at.y - r} ${at.x + r},${at.y} ${at.x},${at.y + r} ${at.x - r},${at.y}`}
      className={filled ? "fill-shadow stroke-shadow" : "fill-background stroke-shadow"} strokeWidth={1.5} {...NS} />
  );
}

/* ------------------------------------------------------------------ scene */

const fmt = (n: number) => n.toLocaleString("en-US");
const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// Wide-view label placement per hospital (Eastbank's label sits above it, out of the decoy's way).
const labelBelow = (id: string) => id !== ENTRY_ID;

export function FlowScene({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const labOrders = useMJ((s) => s.view.labOrders);
  const f = useMemo(() => derive(events), [events]);
  const reduce = useReducedMotion();
  const tr = (duration: number, delay = 0) => (reduce ? { duration: 0 } : { duration, delay, ease: [0.2, 0, 0, 1] as const });
  const show = (on: boolean, delay = 0) => ({ initial: { opacity: 0 }, animate: { opacity: on ? 1 : 0 }, transition: tr(0.22, delay) });

  const wide = f.wide;
  const box = wide ? WIDE : CLOSE;
  const lumDown = f.lum === "compromised" || f.lum === "quarantined" || f.lum === "down";
  const attack = f.mode !== "outage";
  const flagged = !!f.firstSight;

  // Lab reroutes (outage run): cross-hospital arcs, and how many tests each lab picked up.
  const reroutes = useMemo(() => {
    const pairs = new Map<string, { from: string; to: string; n: number }>();
    const load = new Map<string, number>();
    for (const o of Object.values(labOrders)) {
      if (!o.to_hospital || o.to_hospital === "lum" || (o.status !== "rerouted" && o.status !== "completed")) continue;
      load.set(o.to_hospital, (load.get(o.to_hospital) ?? 0) + 1);
      if (o.to_hospital === o.from_hospital) continue;
      const k = `${o.from_hospital}>${o.to_hospital}`;
      const cur = pairs.get(k) ?? { from: o.from_hospital, to: o.to_hospital, n: 0 };
      cur.n++; pairs.set(k, cur);
    }
    return { pairs: [...pairs.values()], load };
  }, [labOrders]);

  const holders = f.scatter?.holders ?? [];
  const marker = f.mode === "idle" ? null : WP[f.trail.at(-1) ?? "A0"];
  const markerTone = f.phase === "decoy" || (f.phase === "exfil" && f.exfil?.fake) ? "shadow" : "alert";
  const sorted = [...HOSP].sort((a, b) => a.p.y - b.p.y);
  const decoyOn = f.diverted;
  const realTone = f.phase === "real" ? "alert" : "real";

  return (
    <div data-demo="scene" className={cn("relative h-full w-full overflow-hidden", className)}>
      <motion.svg
        initial={{ viewBox: vb(box) }} animate={{ viewBox: vb(box) }} transition={tr(0.7)}
        preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img"
        aria-label="MayaJaal at Eastbank Community: a stolen login is caught at the gateway, sent to a decoy hospital, and the real records are protected across six hospitals.">

        {/* city: links between hospitals (wide view only) */}
        <motion.g {...show(wide)}>
        {WORLD.links.map(([a, b]) => {
          const pa = byId(a)?.p, pb = byId(b)?.p;
          if (!pa || !pb) return null;
          const cut = lumDown && (a === "lum" || b === "lum");
          return <line key={`${a}${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            className={cut ? "stroke-alert/60" : "stroke-border-strong"} strokeWidth={1.25} strokeDasharray={cut ? "3 6" : "1 0"} {...NS} />;
        })}
        </motion.g>

        {/* ground pads */}
        {HOSP.map((h) => <Pad key={h.id} at={h.p} tone={h.id === "lum" && lumDown ? "alert" : "real"} />)}
        <motion.g {...show(decoyOn)}><Pad at={D} tone="decoy" /></motion.g>

        {/* roads in the close view: outside → gateway → real hospital, and gateway → decoy */}
        {attack && (
          <g>
            <polyline points={[WP.A0, WP.GL].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-border-strong" strokeWidth={1.5} strokeDasharray="2 5" {...NS} />
            <polyline points={[WP.GR, WP.RD].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="stroke-border-strong" strokeWidth={1.5} {...NS} />
            <motion.polyline {...show(decoyOn, 0.1)} points={[WP.GR, WP.DD].map((p) => `${p.x},${p.y}`).join(" ")} fill="none"
              className="stroke-shadow" strokeWidth={1.75} strokeDasharray="6 4" {...NS} />
          </g>
        )}

        {/* scatter routes: Eastbank → every other holder */}
        <motion.g {...show(wide)}>
        {f.scatter && holders.filter((h) => h !== ENTRY_ID).map((h, i) => {
          const p = byId(h)?.p;
          if (!p) return null;
          return (
            <motion.line key={`route-${h}`} x1={E.x} y1={E.y} x2={p.x} y2={p.y}
              initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={tr(0.6, 0.3 + i * 0.08)}
              className="stroke-fg/45" strokeWidth={1.5} {...NS} />
          );
        })}
        </motion.g>

        {/* lab reroutes (outage) */}
        {lumDown && reroutes.pairs.map((r, i) => {
          const a = byId(r.from)?.p, b = byId(r.to)?.p;
          if (!a || !b) return null;
          const ra = add(a, 0, -40), rb = add(b, 0, -40);
          const mx = (ra.x + rb.x) / 2, my = Math.min(ra.y, rb.y) - 160;
          return (
            <g key={`rr-${r.from}-${r.to}`}>
              <motion.path d={`M${ra.x} ${ra.y} Q${mx} ${my} ${rb.x} ${rb.y}`} fill="none" className="stroke-fg"
                strokeWidth={1.75} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={tr(0.8, 0.1 * i)} {...NS} />
              <circle cx={rb.x} cy={rb.y} r={10} className="fill-fg" />
            </g>
          );
        })}

        {/* buildings, back to front */}
        {sorted.map((h) => {
          const down = h.id === "lum" && lumDown;
          return (
            <g key={`b-${h.id}`}>
              <IsoBox at={h.p} w={BW} d={BD} h={h.id === "lum" ? BH * 0.75 : BH} tone={down ? "alert" : h.id === ENTRY_ID ? realTone : "real"} windows cross={h.id !== "lum"} />
              {h.id === "lum" && down && <Lock at={add(roofOf(h.p), 0, 2)} s={2.6} tone="alert" />}
            </g>
          );
        })}

        {/* encrypted pieces: travel once from Eastbank to each holder, then sit on its roof (wide view) */}
        <motion.g {...show(wide)}>
        {f.scatter && holders.map((h, i) => {
          const p = byId(h)?.p;
          if (!p) return null;
          const from = roofOf(E), to = add(roofOf(p), h === "lum" ? 0 : 0, h === "lum" ? 17 : 0);
          return (
            <motion.g key={`piece-${h}`} initial={{ x: from.x, y: from.y - 6, opacity: 0 }} animate={{ x: to.x, y: to.y - 6, opacity: 1 }}
              transition={tr(0.8, 0.35 + i * 0.08)}>
              <IsoBox at={{ x: 0, y: 0 }} w={1.5} d={1.5} h={1.2} tone="piece" />
            </motion.g>
          );
        })}
        </motion.g>

        {/* MayaJaal gateway */}
        {attack && (
          <g>
            <IsoBox at={G} w={GW} d={GW} h={GH} tone={flagged ? "gateAlert" : "gate"} />
            <motion.g {...show(!wide)}>
              <text x={G.x} y={G.y + 72} textAnchor="middle" className="fill-fg text-[22px] font-semibold">MayaJaal gateway</text>
            </motion.g>
          </g>
        )}

        {/* decoy hospital */}
        <motion.g initial={{ opacity: 0, y: 14 }} animate={{ opacity: decoyOn ? 1 : 0, y: decoyOn ? 0 : 14 }} transition={tr(0.25, 0.1)}>
          <IsoBox at={D} w={BW} d={BD} h={BH} tone="decoy" dashed windows cross />
        </motion.g>

        {/* trackers on the decoy */}
        {decoyOn && f.lures + f.touched > 0 && (() => {
          const n = Math.max(f.lures, f.touched);
          return (
            <g>
              {Array.from({ length: n }, (_, i) => (
                <motion.g key={`tk-${i}`} {...show(true, 0.05 * i)}>
                  <Diamond at={add(D, (i - (n - 1) / 2) * 34, -192)} r={11} filled={i < f.touched} />
                </motion.g>
              ))}
            </g>
          );
        })()}

        {/* lock at the real hospital's door (step-up) */}
        {attack && (
          <motion.g {...show(f.stepUp)}>
            <circle cx={LOCK.x} cy={LOCK.y} r={22} className="fill-background stroke-alert" strokeWidth={1.5} {...NS} />
            <Lock at={add(LOCK, 0, -2)} tone="alert" />
            <motion.g {...show(f.stepUp && !wide)}>
              <text x={LOCK.x - 20} y={LOCK.y + 62} textAnchor="middle" className="fill-fg text-[23px] font-semibold">Badge + MFA</text>
              <text x={LOCK.x - 20} y={LOCK.y + 88} textAnchor="middle" className="fill-fg-muted text-[19px]">nothing real shown</text>
            </motion.g>
          </motion.g>
        )}

        {/* attacker trail and marker */}
        {attack && f.trail.length > 1 && (
          <polyline points={f.trail.map((k) => `${WP[k].x},${WP[k].y}`).join(" ")} fill="none" className="stroke-alert/70"
            strokeWidth={1.5} strokeDasharray="3 5" strokeLinejoin="round" {...NS} />
        )}
        {attack && marker && (
          <motion.g initial={{ x: marker.x, y: marker.y }} animate={{ x: marker.x, y: marker.y }} transition={tr(0.45)}>
            <line x1={0} y1={0} x2={0} y2={-26} className={markerTone === "shadow" ? "stroke-shadow" : "stroke-alert"} strokeWidth={2} {...NS} />
            <circle cy={-34} r={11} className={cn(markerTone === "shadow" ? "fill-shadow" : "fill-alert", "stroke-background")} strokeWidth={2.5} {...NS} />
            <motion.g {...show(!wide)}>
              {!f.exfil && <text y={-56} textAnchor="middle" className="fill-alert text-[21px] font-semibold">Stolen nurse login</text>}
              {f.exfil && (
                <g>
                  <rect x={-125} y={-92} width={250} height={38} rx={8} className={f.exfil.fake ? "fill-shadow-bg stroke-shadow" : "fill-background stroke-danger"} strokeWidth={1.25} {...NS} />
                  <text y={-66} textAnchor="middle" className={cn("text-[21px] font-semibold tabular-nums", f.exfil.fake ? "fill-shadow" : "fill-danger")}>
                    {fmt(f.exfil.records)} {f.exfil.fake ? "fake" : "real"} records
                  </text>
                </g>
              )}
            </motion.g>
            <motion.g {...show(wide)}>
              <text y={-62} textAnchor="middle" className="fill-alert text-[48px] font-semibold">Attacker</text>
              {f.exfil && (
                <text x={-40} y={66} className={cn("text-[48px] font-semibold tabular-nums", f.exfil.fake ? "fill-shadow" : "fill-danger")}>
                  {fmt(f.exfil.records)} {f.exfil.fake ? "fake" : "real"} records
                </text>
              )}
            </motion.g>
          </motion.g>
        )}

        {/* ---------------- close-view labels */}
        <motion.g {...show(!wide)}>
          <text x={E.x} y={E.y - 192} textAnchor="middle" className="fill-fg text-[28px] font-semibold tracking-[-0.02em]">{byId(ENTRY_ID)?.name ?? "Eastbank Community"}</text>
          <text x={E.x} y={E.y - 162} textAnchor="middle" className="fill-fg-muted text-[20px]">
            Real hospital{decoyOn ? " · care keeps running" : ""}
          </text>
          {!decoyOn && attack && (
            <text x={D.x + 10} y={D.y + 40} textAnchor="middle" className="fill-fg-subtle text-[19px]">decoy builds here if needed</text>
          )}
        </motion.g>
        <motion.g {...show(!wide && decoyOn, 0.15)}>
          <text x={D.x} y={D.y + 92} textAnchor="middle" className="fill-shadow text-[23px] font-semibold">Decoy · built for this attacker</text>
        </motion.g>

        {/* fake data counter on the decoy */}
        <motion.g {...show(!wide && decoyOn && (f.shadowBytes > 0 || !!f.exfil), 0.1)}>
          <text x={E.x + 268} y={E.y + 98} className="fill-shadow text-[38px] font-semibold tabular-nums tracking-[-0.02em]">
            {f.exfil?.fake ? fmt(f.exfil.records) : mb(f.shadowBytes)}
          </text>
          <text x={E.x + 268} y={E.y + 126} className="fill-shadow text-[20px]">{f.exfil?.fake ? "fake records taken" : "fake data served"}</text>
          {f.touched + f.lures > 0 && (
            <g>
              <Diamond at={{ x: E.x + 278, y: E.y + 156 }} r={9} filled={f.touched > 0} />
              <text x={E.x + 296} y={E.y + 163} className="fill-shadow text-[20px] tabular-nums">
                {f.touched > 0 ? `${f.touched} tracker${f.touched === 1 ? "" : "s"} hit` : `${f.lures} lure${f.lures === 1 ? "" : "s"} set`}
              </text>
            </g>
          )}
        </motion.g>

        {/* First Sight: score meter and the signals behind it */}
        {f.firstSight && (() => {
          const fs = f.firstSight;
          const ok = Number.isFinite(fs.score) && Number.isFinite(fs.threshold);
          const max = ok ? Math.max(fs.threshold * 2, fs.score * 1.2) : 1;
          const TW = 262, tx = CARD.x + 22, ty = CARD.y + 66;
          const fill = ok ? Math.min(1, fs.score / max) * TW : TW;
          const tick = ok ? tx + (fs.threshold / max) * TW : tx;
          return (
            <motion.g {...show(!wide)}>
              <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx={12} className="fill-background stroke-alert" strokeWidth={1.25} {...NS} />
              <text x={tx} y={CARD.y + 40} className="fill-alert text-[26px] font-semibold tracking-[-0.02em]">First Sight</text>
              <text x={CARD.x + CARD.w - 22} y={CARD.y + 40} textAnchor="end" className="fill-fg-muted text-[19px]">caught at login</text>
              <rect x={tx} y={ty} width={TW} height={14} rx={7} className="fill-surface-2 stroke-border-strong" strokeWidth={1} {...NS} />
              <motion.rect x={tx} y={ty} height={14} rx={7} className="fill-alert" initial={{ width: 0 }} animate={{ width: fill }} transition={tr(0.5, 0.1)} />
              {ok && (
                <g>
                  <line x1={tick} x2={tick} y1={ty - 8} y2={ty + 22} className="stroke-fg" strokeWidth={2} {...NS} />
                  <text x={tick} y={ty + 44} textAnchor="middle" className="fill-fg-muted text-[18px] tabular-nums">limit {fs.threshold.toFixed(1)}</text>
                  <text x={CARD.x + CARD.w - 22} y={ty + 16} textAnchor="end" className="fill-alert text-[32px] font-semibold tabular-nums">{fs.score.toFixed(1)}</text>
                </g>
              )}
              {fs.chips.slice(0, 2).map((c, i) => (
                <g key={c}>
                  <rect x={tx} y={CARD.y + 128 + i * 42} width={c.length * 10.6 + 30} height={34} rx={8} className="fill-alert-bg stroke-alert/60" strokeWidth={1} {...NS} />
                  <text x={tx + 15} y={CARD.y + 151 + i * 42} className="fill-fg text-[19px] font-medium">{c}</text>
                </g>
              ))}
              <line x1={G.x - 10} y1={CARD.y + CARD.h} x2={G.x - 10} y2={G.y - 100} className="stroke-alert" strokeWidth={1.5} strokeDasharray="3 4" {...NS} />
            </motion.g>
          );
        })()}

        {/* ---------------- wide-view labels */}
        <motion.g {...show(wide)}>
          {HOSP.map((h) => {
            const below = labelBelow(h.id);
            const down = h.id === "lum" && lumDown;
            const y = below ? h.p.y + 120 : h.p.y - 190;
            const load = lumDown ? reroutes.load.get(h.id) ?? 0 : 0;
            return (
              <g key={`wl-${h.id}`}>
                <text x={h.p.x} y={y} textAnchor="middle" className={cn("text-[52px] font-semibold tracking-[-0.02em]", down ? "fill-alert" : "fill-fg")}>{h.short}</text>
                {down && <text x={h.p.x} y={h.p.y - 150} textAnchor="middle" className="fill-alert text-[46px] font-medium">{f.lum === "quarantined" ? "Lab down · isolated" : "Lab down"}</text>}
                {!down && load > 0 && <text x={h.p.x} y={y + 52} textAnchor="middle" className="fill-fg-muted text-[46px] tabular-nums">+{load} test{load === 1 ? "" : "s"}</text>}
                {h.id === ENTRY_ID && f.scatter && <text x={h.p.x} y={y + 54} textAnchor="middle" className="fill-fg-muted text-[46px]">live records stay</text>}
              </g>
            );
          })}
          {decoyOn && <text x={D.x + 40} y={D.y + 125} textAnchor="middle" className="fill-shadow text-[50px] font-semibold">Decoy</text>}
        </motion.g>

        {/* scatter summary (wide) */}
        <motion.g {...show(wide && !!f.scatter, 0.2)}>
          {f.scatter && (
            <g>
              <text x={-40} y={200} className="fill-fg text-[60px] font-semibold tracking-[-0.025em]">Encrypted copy → {holders.length} hospitals</text>
              <g transform="translate(-14 258)">
                <circle cx={0} cy={0} r={16} fill="none" className="stroke-fg" strokeWidth={2.5} {...NS} />
                <path d="M16 0 H58 M44 0 V16 M56 0 V12" fill="none" className="stroke-fg" strokeWidth={2.5} {...NS} />
              </g>
              <text x={66} y={276} className="fill-fg text-[52px] font-medium tabular-nums">Key: any {f.scatter.key_threshold} of {holders.length}</text>
              <text x={-40} y={346} className="fill-fg-muted text-[46px] tabular-nums">
                {f.scatter.pieces} pieces × {f.scatter.replicas} copies{f.scatter.verified ? " · rebuild tested" : ""}
              </text>
            </g>
          )}
        </motion.g>
      </motion.svg>

      <style>{`@keyframes mj-chip { 0% { transform: scale(.94) } 45% { transform: scale(1.12) } 100% { transform: scale(1) } }
@keyframes mj-ring { 0% { box-shadow: 0 0 0 0 currentColor } 100% { box-shadow: 0 0 0 12px transparent } }
.mj-chip-on { animation: mj-chip 600ms ease-out, mj-ring 1100ms ease-out 3 }
@media (prefers-reduced-motion: reduce) { .mj-chip-on { animation: none } }`}</style>
      {/* step indicator */}
      <ol className="pointer-events-none absolute top-3 left-4 right-4 flex flex-wrap items-center gap-1.5" aria-label="Steps">
        {f.steps.map((s, i) => {
          const cur = i === f.step, done = i < f.step;
          const tone = !cur ? "" : f.mode === "outage" ? (i < 2 ? "border-alert bg-alert-bg text-alert" : "border-fg bg-fg text-background")
            : i === 1 || i === 3 ? "border-alert bg-alert-bg text-alert" : i === 4 || i === 5 ? "border-shadow bg-shadow-bg text-shadow" : "border-fg bg-fg text-background";
          return (
            <li key={`${s}-${cur ? "on" : "off"}`} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1 text-[16px] font-medium transition-colors duration-200",
              cur ? cn(tone, "mj-chip-on") : done ? "border-border-strong bg-background text-fg" : "border-border bg-background text-fg-subtle")}>
              <span className="font-mono text-[14px] tabular-nums opacity-70">{i + 1}</span>{s}
            </li>
          );
        })}
      </ol>

      {/* close view: the six hospitals still hold the encrypted pieces */}
      <motion.div {...show(!wide && !!f.scatter)} className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-2.5 rounded-md border border-border bg-background/95 px-3 py-1.5 text-[15px] text-fg-muted">
        <span className="flex gap-1">{holders.map((h) => <span key={h} className="size-2.5 rounded-[3px] bg-fg" />)}</span>
        Encrypted copy held by {holders.length} hospitals
      </motion.div>

      {/* outcome / continuity readout */}
      {(f.ended || (f.mode === "outage" && lumDown)) && (
        <Readout f={f} show={show} />
      )}
    </div>
  );
}

function Readout({ f, show }: { f: Flow; show: (on: boolean, delay?: number) => object }) {
  const stats = useMJ((s) => s.view.continuity);
  if (f.mode === "outage") {
    if (!stats) return null;
    return (
      <motion.div {...show(true, 0.2)} className="pointer-events-none absolute right-4 bottom-3 rounded-lg border border-border bg-background/95 px-4 py-3">
        <div className="text-[30px] leading-none font-semibold tabular-nums tracking-[-0.02em] text-fg">{Math.round(stats.stat_on_time_pct)}%</div>
        <div className="mt-1.5 text-[15px] text-fg-muted">stat tests on time</div>
      </motion.div>
    );
  }
  const leaked = f.leaked;
  return (
    <motion.div {...show(true, 0.3)} className="pointer-events-none absolute right-4 bottom-3 rounded-lg border border-border bg-background/95 px-4 py-3">
      <div className={cn("text-[30px] leading-none font-semibold tabular-nums tracking-[-0.02em]", leaked > 0 ? "text-danger" : "text-fg")}>
        {leaked} of {f.protectedTotal}
      </div>
      <div className="mt-1.5 text-[15px] text-fg-muted">real secrets leaked</div>
    </motion.div>
  );
}
