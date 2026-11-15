"use client";
// The live scene: an isometric (2.5D) view of the real hospital, the MayaJaal gateway in front of it,
// and the decoy hospital that is built beside it the moment someone starts acting like an attacker.
// Flat 2D captions sit on top. Driven only by the shared event store.

import { useMemo } from "react";
import type { MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";
import { roomFor, roomForPlacement, type RoomId } from "./story";

/* ------------------------------------------------------------------ projection */

const S = 24;                                // px per world unit
const C = Math.cos(Math.PI / 6), H = 0.5;    // isometric axes
const OX = 170, OY = 70;                     // screen origin
type P3 = [number, number, number];
const pt = ([x, y, z]: P3) => [OX + (x - y) * C * S, OY + (x + y) * H * S - z * S] as const;
const poly = (ps: P3[]) => ps.map((p) => pt(p).join(",")).join(" ");

interface Block { id: RoomId | "base" | "gate"; label?: string; x: number; y: number; w: number; d: number; h: number }

const CAMPUS: Block[] = [
  { id: "ward", label: "Ward", x: 0, y: 0, w: 3.6, d: 2.6, h: 1.1 },
  { id: "records", label: "Records", x: 4.2, y: 0, w: 2.2, d: 2.6, h: 1.7 },
  { id: "admin", label: "Admin", x: 7, y: 0, w: 1.4, d: 2.6, h: 0.9 },
  { id: "lab", label: "Lab", x: 0, y: 3.2, w: 2.8, d: 2.4, h: 0.9 },
  { id: "pharmacy", label: "Pharmacy", x: 3.4, y: 3.2, w: 2.2, d: 2.4, h: 0.7 },
  { id: "it", label: "IT · backups", x: 6.2, y: 3.2, w: 2.2, d: 2.4, h: 1.3 },
];
const DECOY_OFF = { x: 10.5, y: -10.5 };
const GATE: Block = { id: "gate", x: 9.6, y: -1.4, w: 1.2, d: 1.2, h: 2.1 };
const ENTRY: P3 = [13.4, 2.8, 0];

const roomTop = (id: RoomId, decoy: boolean): P3 => {
  if (id === "entrance") return [GATE.x + GATE.w / 2, GATE.y + GATE.d / 2, GATE.h + 0.3];
  const b = CAMPUS.find((c) => c.id === id) ?? CAMPUS[5];
  const ox = decoy ? DECOY_OFF.x : 0, oy = decoy ? DECOY_OFF.y : 0;
  return [b.x + b.w / 2 + ox, b.y + b.d / 2 + oy, b.h + 0.25];
};

function Box({ b, ox = 0, oy = 0, tone, hot, delay = 0, label }: {
  b: Block; ox?: number; oy?: number; tone: "real" | "decoy" | "gate" | "alert"; hot?: boolean; delay?: number; label?: string;
}) {
  const x = b.x + ox, y = b.y + oy, { w, d, h } = b;
  const top: P3[] = [[x, y, h], [x + w, y, h], [x + w, y + d, h], [x, y + d, h]];
  const left: P3[] = [[x, y + d, 0], [x + w, y + d, 0], [x + w, y + d, h], [x, y + d, h]];
  const right: P3[] = [[x + w, y, 0], [x + w, y + d, 0], [x + w, y + d, h], [x + w, y, h]];
  const st = {
    real: { top: "fill-background", l: "fill-surface-2", r: "fill-surface", s: hot ? "stroke-alert" : "stroke-border-strong", t: "fill-fg" },
    decoy: { top: "fill-shadow-bg", l: "fill-shadow/15", r: "fill-shadow/10", s: hot ? "stroke-shadow" : "stroke-shadow/50", t: "fill-shadow" },
    gate: { top: "fill-fg", l: "fill-fg/80", r: "fill-fg/60", s: "stroke-fg", t: "fill-background" },
    alert: { top: "fill-alert-bg", l: "fill-alert/20", r: "fill-alert/10", s: "stroke-alert", t: "fill-alert" },
  }[tone];
  const [lx, ly] = pt([x + w / 2, y + d / 2, h]);
  return (
    <g className={tone === "decoy" ? "mj-rise" : undefined} style={tone === "decoy" ? { animationDelay: `${delay}ms` } : undefined}>
      <polygon points={poly(left)} className={cn(st.l, st.s)} strokeWidth={hot ? 1.5 : 1} strokeLinejoin="round" />
      <polygon points={poly(right)} className={cn(st.r, st.s)} strokeWidth={hot ? 1.5 : 1} strokeLinejoin="round" />
      <polygon points={poly(top)} className={cn(st.top, st.s)} strokeWidth={hot ? 1.5 : 1} strokeLinejoin="round" />
      {label && <text x={lx} y={ly + 4} textAnchor="middle" className={cn("text-[10px] font-medium", st.t)}>{label}</text>}
    </g>
  );
}

function Slab({ ox, oy, decoy }: { ox: number; oy: number; decoy: boolean }) {
  const x = -0.5 + ox, y = -0.5 + oy, w = 9.4, d = 6.6;
  return (
    <polygon points={poly([[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]])}
      className={decoy ? "fill-shadow-bg/60 stroke-shadow/50" : "fill-surface stroke-border"} strokeDasharray={decoy ? "5 4" : undefined} />
  );
}

/* ------------------------------------------------------------------ data */

type Side = "real" | "decoy" | "blocked";
interface Visit { id: string; room: RoomId; side: Side }

function visits(events: MJEvent[]): Visit[] {
  const out: Visit[] = [];
  for (const e of events) {
    if (e.type === "run.started") out.length = 0;
    if (e.type !== "request" || e.actor !== "attacker") continue;
    const denied = e.data.status === 401 || e.data.status === 403;
    out.push({ id: e.id, room: roomFor(e.data.path), side: e.tier === "shadow" ? "decoy" : denied || e.tier === "none" ? "blocked" : "real" });
  }
  return out;
}

/* ------------------------------------------------------------------ scene */

const STAFF_PATHS = [
  [roomTop("ward", false), roomTop("lab", false)],
  [roomTop("lab", false), roomTop("pharmacy", false)],
  [roomTop("ward", false), roomTop("records", false)],
];

export function HospitalScene({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const v = useMJ((s) => s.view);
  const all = useMemo(() => visits(events), [events]);
  const last = all.at(-1) ?? null;
  const diverted = v.diverted;
  const labDown = ["compromised", "quarantined", "down"].includes(v.nodes["lum"] ?? "healthy");
  const blocked = new Set(all.filter((x) => x.side === "blocked").map((x) => x.room));

  // trackers on the decoy: planted (outline) and taken (filled)
  const trackers = useMemo(() => {
    const m = new Map<string, { room: RoomId; taken: boolean }>();
    for (const e of events) {
      if (e.type === "run.started") m.clear();
      if (e.type === "breadcrumb.planted") m.set(e.data.path, { room: roomForPlacement(e.data.path), taken: m.get(e.data.path)?.taken ?? false });
      if (e.type === "honeytoken.minted" && !m.has(e.data.placed_at)) m.set(e.data.placed_at, { room: roomForPlacement(e.data.placed_at), taken: false });
      if (e.type === "honeytoken.touched") {
        const k = e.data.where;
        m.set(k, { room: roomForPlacement(k), taken: true });
      }
    }
    return [...m.values()];
  }, [events]);

  // attacker marker and trail
  const markerAt: P3 | null = !last ? null
    : last.side === "blocked" ? [GATE.x + 0.6, GATE.y + 1.9, 0.2]
    : last.room === "entrance" ? [GATE.x + 0.6, GATE.y + 1.9, 0.2]
    : roomTop(last.room, last.side === "decoy");
  const trail: P3[] = [ENTRY, [GATE.x + 0.6, GATE.y + 1.9, 0]];
  for (const x of all) if (x.side !== "blocked" && x.room !== "entrance") trail.push(roomTop(x.room, x.side === "decoy"));

  const decoyBlocks = CAMPUS.map((b, i) => ({ b, delay: i * 70 }));
  const rows = [...CAMPUS].sort((a, b) => a.x + a.y - (b.x + b.y));

  return (
    <div data-demo="scene" className={cn("relative h-full w-full", className)}>
      <svg viewBox="8 18 820 270" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img"
        aria-label="Isometric view: the real hospital on the left, the MayaJaal gateway in front, the decoy hospital on the right.">
        {/* ground: real campus, decoy campus (only once built) */}
        <Slab ox={0} oy={0} decoy={false} />
        {diverted && <g className="mj-fade"><Slab ox={DECOY_OFF.x} oy={DECOY_OFF.y} decoy /></g>}

        {/* road from outside to the gateway, and gateway to each campus */}
        <polyline points={poly([ENTRY, [GATE.x + 0.6, GATE.y + 1.9, 0]])} fill="none" className="stroke-border-strong" strokeWidth={1.5} strokeDasharray="2 4" />
        <polyline points={poly([[GATE.x, GATE.y + 0.6, 0], [8.9, 1.3, 0]])} fill="none" className="stroke-border-strong" strokeWidth={1.5} />
        <polyline points={poly([[GATE.x + 1.2, GATE.y + 0.6, 0], [DECOY_OFF.x + 0, DECOY_OFF.y + 5, 0]])} fill="none"
          className={diverted ? "stroke-shadow" : "stroke-border"} strokeWidth={1.5} strokeDasharray="5 4" />

        {/* real campus */}
        {rows.map((b) => (
          <Box key={`r-${b.id}`} b={b} label={b.label}
            tone={b.id === "lab" && labDown ? "alert" : "real"}
            hot={(last?.side === "real" && last.room === b.id) || blocked.has(b.id as RoomId)} />
        ))}
        {/* records are encrypted at rest: a small lock on the vault */}
        <Lock at={[4.2 + 1.1, 0 + 1.3, 1.7]} />

        {/* staff activity in the real hospital (illustrative motion, not events) */}
        {STAFF_PATHS.map((seg, i) => {
          const [a, b] = seg.map((p) => pt([p[0], p[1], p[2] - 0.1]));
          return (
            <circle key={i} r={2.6} className="fill-fg-subtle">
              <animateMotion dur={`${3.2 + i * 0.7}s`} repeatCount="indefinite" path={`M${a[0]},${a[1]} L${b[0]},${b[1]} L${a[0]},${a[1]}`} />
            </circle>
          );
        })}

        {/* gateway */}
        <Box b={GATE} tone="gate" />
        {(() => { const [x, y] = pt([GATE.x + 0.6, GATE.y + 0.6, GATE.h + 0.55]); return (
          <text x={x} y={y} textAnchor="middle" className="fill-fg text-[11px] font-semibold">MayaJaal gateway</text>); })()}

        {/* decoy campus: rises when someone is diverted */}
        {diverted && decoyBlocks.sort((a, b) => a.b.x + a.b.y - (b.b.x + b.b.y)).map(({ b, delay }) => (
          <Box key={`d-${b.id}`} b={b} ox={DECOY_OFF.x} oy={DECOY_OFF.y} tone="decoy" delay={delay} label={b.label}
            hot={last?.side === "decoy" && last.room === b.id} />
        ))}
        {!diverted && (() => { const [x, y] = pt([DECOY_OFF.x + 4.5, DECOY_OFF.y + 3.2, 0]); return (
          <text x={x} y={y} textAnchor="middle" className="fill-fg-subtle text-[11px]">decoy builds here when needed</text>); })()}

        {/* trackers floating over decoy rooms */}
        {diverted && trackers.map((t, i) => {
          const [x, y] = pt(roomTop(t.room, true));
          const dx = (i % 3) * 12 - 12, dy = -22 - Math.floor(i / 3) * 12;
          return (
            <g key={i} className="mj-fade" style={{ animationDelay: `${400 + i * 80}ms` }}>
              <rect x={x + dx - 4} y={y + dy - 4} width={8} height={8} transform={`rotate(45 ${x + dx} ${y + dy})`}
                className={t.taken ? "fill-shadow stroke-shadow" : "fill-background stroke-shadow"} strokeWidth={1.25} />
            </g>
          );
        })}

        {/* blocked doors */}
        {[...blocked].map((room) => {
          const [x, y] = pt(roomTop(room as RoomId, false));
          return (
            <g key={room} className="mj-fade">
              <circle cx={x} cy={y - 18} r={8} className="fill-alert-bg stroke-alert" />
              <path d={`M${x - 3} ${y - 21} L${x + 3} ${y - 15} M${x + 3} ${y - 21} L${x - 3} ${y - 15}`} className="stroke-alert" strokeWidth={1.5} />
            </g>
          );
        })}

        {/* attacker path and marker */}
        {trail.length > 1 && last && (
          <polyline points={poly(trail)} fill="none" className="stroke-alert/70" strokeWidth={1.25} strokeDasharray="3 4" strokeLinejoin="round" />
        )}
        {markerAt && (() => {
          const [x, y] = pt(markerAt);
          return (
            <g style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 250ms ease-out" }}>
              <line x1={0} y1={0} x2={0} y2={-16} className="stroke-alert" strokeWidth={1.5} />
              <circle cy={-20} r={6} className="fill-alert stroke-background" strokeWidth={2} />
              <text y={-31} textAnchor="middle" className="fill-alert text-[10px] font-semibold">Attacker</text>
            </g>
          );
        })()}
      </svg>

      {/* flat captions for the two campuses */}
      <div className="pointer-events-none absolute inset-x-4 bottom-3 flex justify-between text-[12px]">
        <span className="text-fg-muted"><span className="font-medium text-fg">Real hospital</span> · staff working, records encrypted</span>
        <span className={diverted ? "text-shadow" : "text-fg-subtle"}>
          <span className="font-medium">Decoy hospital</span> · {diverted ? "built for this attacker" : "not built yet"}
        </span>
      </div>
    </div>
  );
}

function Lock({ at }: { at: P3 }) {
  const [x, y] = pt(at);
  return (
    <g transform={`translate(${x - 6} ${y - 24})`} aria-label="Encrypted">
      <path d="M3 6 V4 a3 3 0 0 1 6 0 V6" fill="none" className="stroke-fg" strokeWidth={1.25} />
      <rect x={1} y={6} width={10} height={8} rx={1.5} className="fill-fg" />
    </g>
  );
}
