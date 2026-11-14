"use client";
// NetworkMap — a flat, monochrome diagram of the Meridian City hospital network (the Jaal).
// API (frozen): <NetworkMap className? focusHospital?={id|null} variant?="full"|"compact" />
// Fills its parent (SVG viewBox, aspect preserved). Reads the shared store; never calls connectHub().
//
// Two layers in one diagram: the real network in neutral ink, and — once a session is diverted — a
// shadow copy of the network offset behind it in the shadow accent. The attacker's path re-points from
// the real entry hospital to its shadow copy. Persistent state comes from `view` (so replays render
// correctly); live events younger than 4 s add short transient animations.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WORLD, type MJEvent, type NodeState } from "@/lib/contracts";
import { useMJ, useMJEvent } from "@/lib/events";
import { cn } from "@/components/ui";
import {
  ATTACKER_PT, BY_ID, COMPACT_BOX, DEFAULT_LABEL, ENTRY_ID, FULL_BOX, HOSPITALS, LABEL, LINKS, NEIGHBORS,
  arcPath, hash, isLab, meta, shifted, trim, type Box, type Pt,
} from "./geometry";
import { Dot, Route, type Pulse } from "./Transients";

export interface NetworkMapProps {
  className?: string;
  focusHospital?: string | null;
  variant?: "full" | "compact";
}

const LIVE_WINDOW_MS = 4000;
const MAX_DOTS = 14;
const NODE_R = 6.5; // px, scaled by units-per-px
const TRANSITION = "transition-[stroke,fill,opacity,stroke-dasharray] duration-200 ease-out motion-reduce:transition-none";

const REAL_FADE = "transition-opacity duration-700 ease-out motion-reduce:transition-none";

const STATUS_TEXT: Partial<Record<NodeState, string>> = {
  degraded: "Degraded", compromised: "Compromised", quarantined: "Quarantined", down: "Down",
};

function nodeStyle(s: NodeState) {
  switch (s) {
    case "compromised": return { stroke: "var(--alert)", fill: "var(--alert-bg)", core: "var(--alert)", dash: false };
    case "quarantined": return { stroke: "var(--alert)", fill: "var(--background)", core: "var(--fg-subtle)", dash: true };
    case "degraded": return { stroke: "var(--alert)", fill: "var(--background)", core: "var(--fg)", dash: false };
    case "down": return { stroke: "var(--fg-subtle)", fill: "var(--surface-2)", core: "transparent", dash: false };
    default: return { stroke: "var(--fg)", fill: "var(--background)", core: "var(--fg)", dash: false };
  }
}

const isCut = (s: NodeState | undefined) => s === "quarantined" || s === "down";

// ------------------------------------------------------------------ hooks

/** Units-per-CSS-pixel of the SVG (viewBox meet scaling), so text and strokes stay crisp at any size. */
function useUnitsPerPx(ref: React.RefObject<HTMLDivElement | null>, box: Box) {
  const [u, setU] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (width: number, height: number) => {
      if (!width || !height) return;
      const scale = Math.min(width / box.w, height / box.h);
      setU(Math.min(2.6, Math.max(0.55, 1 / scale)));
    };
    measure(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(([e]) => measure(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, box]);
  return u;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// Primitive-valued selectors (strings) so components only re-render when the answer changes.
const selKeyOrder = (s: { events: MJEvent[] }) =>
  s.events.filter((e) => e.type === "keyshare.status" && e.data.state === "captured" && e.hospital_id)
    .map((e) => e.hospital_id).join(",");
const selDivert = (s: { events: MJEvent[] }) => {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.type === "session.diverted") return `${e.hospital_id ?? ""}|${e.session_id ?? ""}`;
  }
  return "";
};

// ------------------------------------------------------------------ component

export function NetworkMap({ className, focusHospital = null, variant = "full" }: NetworkMapProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const compact = variant === "compact";
  const box = compact ? COMPACT_BOX : FULL_BOX;
  const u = useUnitsPerPx(wrap, box);
  const uRef = useRef(u);
  useEffect(() => { uRef.current = u; }, [u]);
  const reduced = useReducedMotion();

  const nodes = useMJ((s) => s.view.nodes);
  const keyshares = useMJ((s) => s.view.keyshares);
  // A reveal implies a diverted session even if the diversion event was missed.
  const diverted = useMJ((s) => s.view.diverted || !!s.view.reveal);
  const reveal = useMJ((s) => s.view.reveal);
  const labOrders = useMJ((s) => s.view.labOrders);
  const keyOrder = useMJ(selKeyOrder);
  const divertKey = useMJ(selDivert);

  const entryId = (divertKey.split("|")[0] || ENTRY_ID) as string;
  const entry = BY_ID[entryId] ?? BY_ID[ENTRY_ID];
  const shadowSession = reveal?.shadow_session ?? (divertKey.split("|")[1] || "").replace(/^sess-/, "");

  // ---- transient pulses (live only)
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const done = useCallback((id: string) => setPulses((ps) => ps.filter((p) => p.id !== id)), []);

  const onEvent = useCallback((ev: MJEvent) => {
    if (ev.type === "run.started") { setPulses([]); setFlash(false); return; }
    if (Date.now() - ev.ts > LIVE_WINDOW_MS) return; // backlog / replay: state only, no animation
    const uu = uRef.current;
    const r = NODE_R * uu;

    if (ev.type === "request" && ev.hospital_id && BY_ID[ev.hospital_id]) {
      const target = BY_ID[ev.hospital_id];
      const denied = ev.data.status === 401 || ev.data.status === 403;
      let pulse: Pulse | null = null;
      if (ev.actor === "attacker") {
        const shadow = ev.tier === "shadow";
        pulse = { kind: "dot", id: ev.id, from: ATTACKER_PT, to: shadow ? shifted(target) : target,
                  tone: shadow ? "shadow" : "real", denied, rFrom: 4 * uu };
      } else if (ev.actor === "clinician") {
        const st = useMJ.getState().view.nodes;
        if (isCut(st[target.id])) return;
        const ns = NEIGHBORS[target.id].filter((n) => !isCut(st[n]));
        if (!ns.length) return;
        const src = BY_ID[ns[hash(ev.id) % ns.length]];
        pulse = { kind: "dot", id: ev.id, from: src, to: target, tone: "faint", denied, rFrom: r };
      }
      if (!pulse) return;
      const p = pulse;
      setPulses((ps) => {
        const dots = ps.filter((x) => x.kind === "dot");
        if (dots.length < MAX_DOTS) return [...ps, p];
        if (p.kind === "dot" && p.tone === "faint") return ps; // drop background traffic first
        const drop = dots.find((x) => x.kind === "dot" && x.tone === "faint") ?? dots[0];
        return [...ps.filter((x) => x !== drop), p];
      });
    } else if (ev.type === "lab.order" && ev.data.status === "rerouted") {
      const a = BY_ID[ev.data.from_hospital], b = ev.data.to_hospital ? BY_ID[ev.data.to_hospital] : null;
      if (!a || !b || a.id === b.id) return;
      const [p0, p1] = trim(a, b, r + 4 * uu, r + 4 * uu);
      const d = arcPath(p0, p1, 34);
      const id = `${ev.id}-route`;
      setPulses((ps) => (ps.filter((x) => x.kind === "route").length >= 6 ? ps : [...ps, { kind: "route", id, d }]));
    } else if (ev.type === "reveal") {
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 2600);
    }
  }, []);
  useMJEvent(onEvent);

  // ---- derived persistent state
  const r = NODE_R * u;
  const keyRank = useMemo(() => {
    const out: Record<string, number> = {};
    let n = 0;
    for (const id of keyOrder.split(",")) if (id && !(id in out)) out[id] = ++n;
    return out;
  }, [keyOrder]);
  const threshold = WORLD.key_shares.threshold;

  const reroutes = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; d: string; a: string; b: string }[] = [];
    for (const o of Object.values(labOrders)) {
      if (o.status !== "rerouted" || !o.to_hospital || o.to_hospital === o.from_hospital) continue;
      const a = BY_ID[o.from_hospital], b = BY_ID[o.to_hospital];
      const key = `${o.from_hospital}>${o.to_hospital}`;
      if (!a || !b || seen.has(key)) continue;
      seen.add(key);
      const [p0, p1] = trim(a, b, r + 4 * u, r + 4 * u);
      out.push({ key, d: arcPath(p0, p1, 34), a: a.id, b: b.id });
    }
    return out;
  }, [labOrders, r, u]);

  const focus = focusHospital && BY_ID[focusHospital] ? focusHospital : null;
  const dimNode = (id: string) => (focus && focus !== id ? 0.28 : 1);
  const dimLink = (a: string, b: string) => (focus && a !== focus && b !== focus ? 0.28 : 1);

  // Shadow copy: links and nodes are kept quiet; the reveal briefly brings the whole copy to full strength.
  const ghostLinks = flash ? 0.75 : 0.3;
  const ghostNodes = flash ? 1 : 0.6;
  const shadowEntryPt = shifted(entry);
  const [atkA, atkB] = trim(ATTACKER_PT, entry, 4 * u, r + 3 * u);
  const [atkSA, atkSB] = trim(ATTACKER_PT, shadowEntryPt, 4 * u, r + 3 * u);

  const fs = { name: 14 * u, meta: 12 * u };
  const halo = { paintOrder: "stroke" as const, stroke: "var(--background)", strokeWidth: 4 * u, strokeLinejoin: "round" as const };

  return (
    <div ref={wrap} className={cn("relative h-full w-full min-h-0 select-none", className)}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full overflow-visible"
        role="img" aria-label={`${WORLD.city} hospital network${diverted ? ", attacker diverted into a shadow copy" : ""}`}>

        {/* ---------- shadow copy (behind) ---------- */}
        <g className="transition-opacity duration-700 ease-out motion-reduce:transition-none"
          style={{ opacity: diverted ? 1 : 0 }} aria-hidden>
          {LINKS.map(([a, b]) => {
            const [p0, p1] = trim(shifted(BY_ID[a]), shifted(BY_ID[b]), r, r);
            return <line key={`s-${a}-${b}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} strokeWidth={u}
              className="transition-opacity duration-700 ease-out motion-reduce:transition-none"
              style={{ stroke: "var(--shadow)", opacity: ghostLinks * dimLink(a, b) }} />;
          })}
          {HOSPITALS.map((h) => {
            if (h.id === entry.id) return null;
            const p = shifted(h);
            return <NodeShape key={`s-${h.id}`} lab={isLab(h)} x={p.x} y={p.y} r={r} u={u}
              stroke="var(--shadow)" fill="var(--background)" core="var(--shadow)" dash={false}
              opacity={ghostNodes * dimNode(h.id)} coreOpacity={0.7} strokeW={1} />;
          })}
        </g>

        {/* ---------- real links ---------- */}
        <g className={REAL_FADE} style={{ opacity: flash ? 0.45 : 1 }}>
          {LINKS.map(([a, b]) => {
            const cut = isCut(nodes[a]) || isCut(nodes[b]);
            const [p0, p1] = trim(BY_ID[a], BY_ID[b], r + u, r + u);
            return <line key={`${a}-${b}`} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} strokeWidth={cut ? 1.25 * u : u}
              strokeDasharray={cut ? `0 ${3.5 * u}` : "none"} strokeLinecap={cut ? "round" : "butt"} className={TRANSITION}
              style={{ stroke: "var(--fg-subtle)", opacity: dimLink(a, b) * (cut ? 0.7 : 0.9) }} />;
          })}
        </g>

        {/* ---------- lab reroutes (VitalSwitch) ---------- */}
        <g aria-hidden>
          {reroutes.map((x) => (
            <path key={x.key} d={x.d} fill="none" strokeWidth={u} strokeDasharray={`${4 * u} ${4 * u}`} strokeLinecap="round"
              style={{ stroke: "var(--fg-muted)", opacity: 0.55 * dimLink(x.a, x.b) }} />
          ))}
        </g>

        {/* ---------- attacker origin + paths ---------- */}
        <g style={{ opacity: focus && focus !== entry.id ? 0.28 : 1 }}>
          <line x1={atkA.x} y1={atkA.y} x2={atkB.x} y2={atkB.y} strokeWidth={u} strokeDasharray={`${3 * u} ${3 * u}`}
            className={TRANSITION}
            style={{ stroke: diverted ? "var(--border-strong)" : "var(--fg-muted)", opacity: diverted ? 0.7 : 1 }} />
          <line x1={atkSA.x} y1={atkSA.y} x2={atkSB.x} y2={atkSB.y} strokeWidth={1.25 * u}
            strokeDasharray={`${3 * u} ${3 * u}`} className="transition-opacity duration-500 ease-out motion-reduce:transition-none"
            style={{ stroke: "var(--shadow)", opacity: diverted ? 1 : 0 }} />
          <rect x={ATTACKER_PT.x - 4 * u} y={ATTACKER_PT.y - 4 * u} width={8 * u} height={8 * u} rx={1.5 * u}
            transform={`rotate(45 ${ATTACKER_PT.x} ${ATTACKER_PT.y})`} strokeWidth={u}
            style={{ stroke: "var(--fg-muted)", fill: "var(--background)" }} />
          {!compact && (
            <g className="font-sans">
              <text x={ATTACKER_PT.x - 12 * u} y={ATTACKER_PT.y + 4 * u} textAnchor="end" fontSize={fs.name}
                fontWeight={500} style={{ fill: "var(--fg-muted)", ...halo }}>Attacker</text>
              <text x={ATTACKER_PT.x - 12 * u} y={ATTACKER_PT.y + 4 * u + fs.meta + 4 * u} textAnchor="end"
                fontSize={fs.meta} style={{ fill: "var(--fg-subtle)", ...halo }}>
                {WORLD.entry_point.username} · phished login
              </text>
            </g>
          )}
        </g>

        {/* ---------- shadow entry node (the copy the attacker is actually in) ---------- */}
        <g className="transition-opacity duration-500 ease-out motion-reduce:transition-none"
          style={{ opacity: diverted ? dimNode(entry.id) : 0 }} aria-hidden={!diverted}>
          <NodeShape lab={isLab(entry)} x={shadowEntryPt.x} y={shadowEntryPt.y} r={r} u={u} stroke="var(--shadow)"
            fill="var(--shadow-bg)" core="var(--shadow)" dash={false} opacity={1} coreOpacity={1} strokeW={1.25} />
          {!compact && (
            <ShadowCaption pt={shadowEntryPt} r={r} u={u} fs={fs} halo={halo}
              title={reveal ? `Shadow session ${shadowSession}` : `Shadow ${entry.short}`}
              sub={reveal
                ? `${reveal.real_bytes} real bytes · ${reveal.records_faked.toLocaleString("en-US")} records faked`
                : "Attacker diverted · seeded copy"} />
          )}
        </g>

        {/* ---------- real nodes ---------- */}
        <g className={REAL_FADE} style={{ opacity: flash ? 0.55 : 1 }}>
          {HOSPITALS.map((h) => {
            const st = nodes[h.id] ?? "healthy";
            const sty = nodeStyle(st);
            const lab = isLab(h);
            const L = LABEL[h.id] ?? DEFAULT_LABEL;
            const lx = h.x + L.dx * u, ly = h.y + L.dy * u;
            const statusText = STATUS_TEXT[st];
            const rank = keyshares[h.id] === "captured" ? keyRank[h.id] ?? 1 : 0;
            const isFocus = focus === h.id;
            return (
              <g key={h.id} className="transition-opacity duration-200 ease-out motion-reduce:transition-none"
                style={{ opacity: dimNode(h.id) }}>
                <title>{`${h.name} — ${statusText ?? "Healthy"}`}</title>
                {isFocus && (
                  <circle cx={h.x} cy={h.y} r={r + 7 * u} strokeWidth={u} style={{ fill: "none", stroke: "var(--fg-muted)" }} />
                )}
                {h.id === entry.id && (
                  <circle cx={h.x} cy={h.y} r={r + (isFocus ? 11 : 5) * u} strokeWidth={u}
                    className="transition-opacity duration-500 ease-out motion-reduce:transition-none"
                    style={{ fill: "none", stroke: "var(--shadow)", opacity: diverted ? 1 : 0 }} />
                )}
                <NodeShape lab={lab} x={h.x} y={h.y} r={r} u={u} stroke={sty.stroke} fill={sty.fill} core={sty.core}
                  dash={sty.dash} opacity={1} coreOpacity={1} strokeW={isFocus ? 1.5 : 1.25} />
                {!compact && (
                  <g className="font-sans">
                    <text x={lx} y={ly} textAnchor={L.anchor} fontSize={fs.name} fontWeight={500}
                      className={TRANSITION}
                      style={{ fill: st === "down" ? "var(--fg-subtle)" : "var(--fg)", ...halo }}>{h.short}</text>
                    <text x={lx} y={ly + fs.meta + 4 * u} textAnchor={L.anchor} fontSize={fs.meta} className="tabular-nums"
                      style={{ fill: statusText && st !== "down" ? "var(--alert)" : "var(--fg-subtle)", ...halo }}>
                      {statusText ?? meta(h)}
                    </text>
                  </g>
                )}
                {!compact && rank > 0 && (
                  <text x={h.x + r + 8 * u} y={h.y + 4 * u} fontSize={fs.meta} fontWeight={500}
                    className="font-sans tabular-nums" style={{ fill: "var(--alert)", ...halo }}>
                    Key {rank}/{threshold}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* ---------- transients ---------- */}
        <g aria-hidden>
          {pulses.map((p) => p.kind === "dot"
            ? <Dot key={p.id} p={p} u={u} r={r} reduced={reduced} onDone={done} />
            : <Route key={p.id} p={p} u={u} reduced={reduced} onDone={done} />)}
        </g>
      </svg>

      {/* legend only when the map is wide enough (~620px+) that it can't collide with labels */}
      {!compact && u < 1.6 && <Legend diverted={diverted} />}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function NodeShape({ lab, x, y, r, u, stroke, fill, core, dash, opacity, coreOpacity, strokeW = 1.25 }: {
  lab: boolean; x: number; y: number; r: number; u: number; stroke: string; fill: string; core: string;
  dash: boolean; opacity: number; coreOpacity: number; strokeW?: number;
}) {
  const sw = strokeW * u;
  const dashArr = dash ? `${2.5 * u} ${2 * u}` : "none";
  const c = 2.25 * u;
  return (
    <g className="transition-opacity duration-700 ease-out motion-reduce:transition-none" style={{ opacity }}>
      {lab ? (
        <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2 * u} strokeWidth={sw} strokeDasharray={dashArr}
          className={TRANSITION} style={{ stroke, fill }} />
      ) : (
        <circle cx={x} cy={y} r={r} strokeWidth={sw} strokeDasharray={dashArr} className={TRANSITION} style={{ stroke, fill }} />
      )}
      {lab
        ? <rect x={x - c} y={y - c} width={2 * c} height={2 * c} rx={0.5 * u} className={TRANSITION}
            style={{ fill: core, opacity: coreOpacity }} />
        : <circle cx={x} cy={y} r={c} className={TRANSITION} style={{ fill: core, opacity: coreOpacity }} />}
    </g>
  );
}

/** Caption beside the shadow entry node; flips above-left when it would run off the right edge. */
function ShadowCaption({ pt, r, u, fs, halo, title, sub }: {
  pt: Pt; r: number; u: number; fs: { name: number; meta: number }; halo: React.CSSProperties; title: string; sub: string;
}) {
  const width = Math.max(title.length * 0.56 * fs.name, sub.length * 0.52 * fs.meta);
  const right = pt.x + r + 8 * u;
  const fits = right + width < FULL_BOX.w - 8;
  const x = fits ? right : pt.x + r;
  const y1 = fits ? pt.y - 2 * u : pt.y - r - 10 * u - fs.meta - 4 * u;
  const anchor = fits ? "start" : "end";
  return (
    <g className="font-sans">
      <text x={x} y={y1} textAnchor={anchor} fontSize={fs.name} fontWeight={500} style={{ fill: "var(--shadow)", ...halo }}>
        {title}
      </text>
      <text x={x} y={y1 + fs.meta + 4 * u} textAnchor={anchor} fontSize={fs.meta} className="tabular-nums"
        style={{ fill: "var(--fg-muted)", ...halo }}>
        {sub}
      </text>
    </g>
  );
}

function Legend({ diverted }: { diverted: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      <span className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" /></svg>
        Hospital
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" /></svg>
        Shared lab
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 18 12" className="h-3 w-[18px]" aria-hidden><path d="M1 8Q9 2 17 8" fill="none" stroke="currentColor" strokeDasharray="3 2.5" /></svg>
        Lab reroute
      </span>
      <span className={cn("inline-flex items-center gap-1.5 transition-opacity duration-500", diverted ? "opacity-100" : "opacity-50")}>
        <svg viewBox="0 0 18 12" className="h-3 w-[18px]" aria-hidden><path d="M1 6h16" stroke="var(--shadow)" /></svg>
        <span className={diverted ? "text-shadow" : undefined}>Shadow copy</span>
      </span>
    </div>
  );
}
