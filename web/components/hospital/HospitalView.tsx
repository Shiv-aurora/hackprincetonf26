"use client";
// The hospital, simulated: the real hospital and its fake copy as two flat floor plans, the attacker's
// path through the rooms, one plain-English sentence for what just happened, and the numbers that matter.
// Everything is derived from the shared event store (live hub or a recorded run).

import { useMemo, type ReactNode } from "react";
import { WORLD } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";
import { hospitalName } from "@/components/consoles";
import {
  FLOOR, ROOMS, attackerVisits, roomForPlacement, storyBeats, type Beat, type RoomId, type Side, type Visit,
} from "./story";

const center = (id: RoomId) => {
  const r = ROOMS.find((x) => x.id === id)!;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 + 8 };
};

/* ------------------------------------------------------------------ narrator */

const TONE_TEXT: Record<Beat["tone"], string> = {
  neutral: "text-fg", shadow: "text-shadow", alert: "text-alert", danger: "text-danger", ok: "text-ok",
};
const TONE_DOT: Record<Beat["tone"], string> = {
  neutral: "bg-fg-subtle", shadow: "bg-shadow", alert: "bg-alert", danger: "bg-danger", ok: "bg-ok",
};

export function Narrator({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const beats = useMemo(() => storyBeats(events), [events]);
  const now = beats.at(-1);
  const before = beats.slice(-4, -1).reverse();
  return (
    <div data-demo="narrator" className={cn("flex min-h-[92px] flex-col justify-center gap-2", className)}>
      <p key={now?.id ?? "idle"} className={cn("mj-fade flex items-start gap-3 text-[22px] leading-snug font-semibold tracking-[-0.02em] text-balance",
        now ? TONE_TEXT[now.tone] : "text-fg-muted")}>
        <span className={cn("mt-[11px] size-2 shrink-0 rounded-full", now ? TONE_DOT[now.tone] : "bg-border-strong")} />
        {now?.text ?? "Waiting for activity on the hospital network."}
      </p>
      {before.length > 0 && (
        <ol className="flex flex-wrap gap-x-5 gap-y-1 pl-5 text-[13px] text-fg-subtle">
          {before.map((b) => <li key={b.id} className="max-w-[440px] truncate">{b.text}</li>)}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ floor plan */

function RoomDecor({ id, side }: { id: RoomId; side: Side }) {
  const r = ROOMS.find((x) => x.id === id)!;
  const ink = side === "copy" ? "stroke-shadow/40" : "stroke-border-strong";
  const fill = side === "copy" ? "fill-shadow/5" : "fill-surface-2";
  const items: ReactNode[] = [];
  const ox = r.x + 14, oy = r.y + 34;
  if (id === "ward") {
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++)
      items.push(<rect key={`b${row}${i}`} x={ox + i * 40} y={oy + row * 42} width={26} height={16} rx={3} className={cn(fill, ink)} />);
  } else if (id === "records") {
    for (let i = 0; i < 4; i++)
      items.push(<rect key={i} x={ox + i * 30} y={oy} width={20} height={56} rx={2} className={cn(fill, ink)} />);
  } else if (id === "lab") {
    items.push(<rect key="a" x={ox} y={oy + 6} width={44} height={30} rx={4} className={cn(fill, ink)} />);
    items.push(<rect key="b" x={ox + 56} y={oy + 6} width={44} height={30} rx={4} className={cn(fill, ink)} />);
    items.push(<line key="c" x1={ox} y1={oy + 58} x2={ox + 100} y2={oy + 58} className={ink} />);
  } else if (id === "pharmacy") {
    for (let i = 0; i < 3; i++)
      items.push(<line key={i} x1={ox} y1={oy + i * 18} x2={ox + 150} y2={oy + i * 18} className={ink} strokeWidth={3} />);
  } else if (id === "admin") {
    items.push(<rect key="d" x={ox + 20} y={oy + 8} width={70} height={26} rx={3} className={cn(fill, ink)} />);
    items.push(<circle key="c" cx={ox + 55} cy={oy + 48} r={7} className={cn(fill, ink)} />);
  } else if (id === "it") {
    for (let i = 0; i < 3; i++) {
      items.push(<rect key={`r${i}`} x={ox + i * 34} y={oy} width={24} height={52} rx={2} className={cn(fill, ink)} />);
      for (let k = 0; k < 4; k++)
        items.push(<line key={`l${i}${k}`} x1={ox + i * 34 + 5} y1={oy + 9 + k * 11} x2={ox + i * 34 + 19} y2={oy + 9 + k * 11} className={ink} />);
    }
  }
  return <g aria-hidden>{items}</g>;
}

const STAFF: { room: RoomId; dx: number; dy: number }[] = [
  { room: "ward", dx: -50, dy: 6 }, { room: "ward", dx: 40, dy: -18 }, { room: "lab", dx: 30, dy: 20 },
  { room: "pharmacy", dx: -30, dy: 26 }, { room: "records", dx: 36, dy: 30 },
];

function FloorPlan({ side, visits, active, labDown, markers, faded, caption }: {
  side: Side; visits: Visit[]; active: Visit | null; labDown: boolean;
  markers: { room: RoomId; label: string }[]; faded: boolean; caption: ReactNode;
}) {
  const copy = side === "copy";
  const mine = visits.filter((v) => v.side === side || (side === "real" && v.side === "blocked"));
  const trail = mine.filter((v) => v.side === side).map((v) => center(v.room));
  const here = active && (active.side === side || (side === "real" && active.side === "blocked")) ? active : null;
  const dot = here ? center(here.side === "blocked" ? "entrance" : here.room) : null;
  const blocked = [...new Set(mine.filter((v) => v.side === "blocked").map((v) => v.room))];

  return (
    <div className={cn("relative h-full w-full transition-opacity duration-200", faded && "opacity-35")}>
      <svg viewBox={`0 0 ${FLOOR.w} ${FLOOR.h}`} className="h-full w-full" role="img"
        aria-label={copy ? "Floor plan of the fake copy of the hospital" : "Floor plan of the real hospital"}>
        {/* outer wall */}
        <rect x={8} y={8} width={FLOOR.w - 16} height={FLOOR.h - 16} rx={10} fill="none"
          className={copy ? "stroke-shadow/60" : "stroke-border-strong"} strokeDasharray={copy ? "5 4" : undefined} strokeWidth={1.25} />
        {ROOMS.map((r) => {
          const isLab = r.id === "lab" && labDown && !copy;
          const hot = here?.room === r.id && here.side !== "blocked";
          return (
            <g key={r.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6}
                className={cn("transition-colors duration-200",
                  isLab ? "fill-alert-bg stroke-alert" : copy ? "fill-background stroke-shadow/30" : "fill-background stroke-border",
                  hot && !isLab && (copy ? "stroke-shadow" : "stroke-alert"))}
                strokeDasharray={isLab ? "4 3" : undefined} strokeWidth={hot ? 1.5 : 1} />
              <text x={r.x + 12} y={r.y + 20} className={cn("text-[12px] font-medium",
                isLab ? "fill-alert" : copy ? "fill-shadow" : "fill-fg")}>{r.label}</text>
              {r.id !== "entrance" && <RoomDecor id={r.id} side={side} />}
              {isLab && <text x={r.x + 12} y={r.y + r.h - 12} className="fill-alert text-[11px]">Shared lab down · rerouting</text>}
            </g>
          );
        })}
        {/* staff keep working (the copy has look-alike staff) */}
        {STAFF.map((s, i) => {
          const c = center(s.room);
          return <circle key={i} cx={c.x + s.dx} cy={c.y + s.dy} r={4} className={copy ? "fill-shadow/50" : "fill-fg-subtle"} />;
        })}
        {/* lures and honeytokens planted in the copy */}
        {markers.map((m, i) => {
          const r = ROOMS.find((x) => x.id === m.room)!;
          const x = r.x + r.w - 18 - (i % 3) * 14, y = r.y + 14;
          return (
            <g key={i}>
              <title>{m.label}</title>
              <rect x={x - 4.5} y={y - 4.5} width={9} height={9} transform={`rotate(45 ${x} ${y})`} className="fill-shadow" />
            </g>
          );
        })}
        {/* denied doors */}
        {blocked.map((room) => {
          const r = ROOMS.find((x) => x.id === room)!;
          const x = r.x + r.w / 2, y = r.y + r.h - 2;
          return (
            <g key={room} className="mj-fade">
              <circle cx={x} cy={y} r={9} className="fill-alert-bg stroke-alert" />
              <path d={`M${x - 3.5} ${y - 3.5} L${x + 3.5} ${y + 3.5} M${x + 3.5} ${y - 3.5} L${x - 3.5} ${y + 3.5}`}
                className="stroke-alert" strokeWidth={1.5} />
            </g>
          );
        })}
        {/* the attacker's path and position */}
        {trail.length > 1 && (
          <polyline points={trail.map((p) => `${p.x},${p.y}`).join(" ")} fill="none"
            className={copy ? "stroke-shadow" : "stroke-alert"} strokeWidth={1.5} strokeDasharray="4 4" strokeLinejoin="round" />
        )}
        {dot && (
          <g style={{ transform: `translate(${dot.x}px, ${dot.y}px)`, transition: "transform 250ms ease-out" }}>
            <circle r={7} className="fill-alert stroke-background" strokeWidth={2} />
            <text y={-13} textAnchor="middle" className="fill-alert text-[11px] font-medium">Attacker</text>
          </g>
        )}
      </svg>
      {caption}
    </div>
  );
}

/* ------------------------------------------------------------------ the two hospitals */

export function TwoHospitals({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const v = useMJ((s) => s.view);
  const visits = useMemo(() => attackerVisits(events), [events]);
  const active = visits.at(-1) ?? null;
  const labDown = v.nodes["lum"] === "compromised" || v.nodes["lum"] === "quarantined" || v.nodes["lum"] === "down";
  const markers = useMemo(() => [
    ...v.breadcrumbs.map((b) => ({ room: roomForPlacement(b.path), label: `Lure: ${b.path}` })),
    ...v.honeytokensMinted.map((h) => ({ room: roomForPlacement(h.placed_at), label: `Honeytoken: ${h.placed_at}` })),
  ], [v.breadcrumbs, v.honeytokensMinted]);
  const name = hospitalName(WORLD.entry_point.hospital_id);
  const inCopy = active?.side === "copy";

  return (
    <div className={cn("grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-2", className)}>
      <section data-demo="real" className="flex min-h-0 flex-col rounded-xl border border-border bg-background">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-[13px] font-medium">{name} · the real hospital</h3>
          <span className="text-xs text-fg-muted tabular-nums">
            {v.canary.leaked > 0
              ? <span className="text-danger">{v.canary.leaked} of {v.canary.total} secrets leaked</span>
              : "Staff working normally"}
          </span>
        </header>
        <div className="min-h-0 flex-1 p-3">
          <FloorPlan side="real" visits={visits} active={active} labDown={labDown} markers={[]} faded={false} caption={null} />
        </div>
      </section>
      <section data-demo="copy" className={cn("flex min-h-0 flex-col rounded-xl border bg-background transition-colors duration-200",
        v.diverted ? "border-shadow/40" : "border-border")}>
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className={cn("text-[13px] font-medium", v.diverted ? "text-shadow" : "text-fg-muted")}>
            {name} · the copy <span className="font-normal text-fg-subtle">(fake)</span>
          </h3>
          <span className="text-xs text-fg-muted">
            {v.diverted ? (inCopy ? "The attacker is in here" : "Built for this attacker") : "Not built yet"}
          </span>
        </header>
        <div className="relative min-h-0 flex-1 p-3">
          <FloorPlan side="copy" visits={visits} active={active} labDown={false} markers={markers}
            faded={!v.diverted}
            caption={!v.diverted && (
              <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-fg-muted">
                Built the moment someone starts acting like an attacker. Every attacker gets a different one.
              </p>
            )} />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ the numbers */

export function HospitalNumbers({ className }: { className?: string }) {
  const v = useMJ((s) => s.view);
  const realTaken = v.exfil && !v.diverted ? v.exfil.records : 0;
  const believed = v.exfil?.records ?? 0;
  const care = v.continuity;
  const items: { label: string; value: ReactNode; sub: string; tone?: string }[] = [
    { label: "Real patient records taken", value: realTaken.toLocaleString("en-US"),
      sub: v.diverted ? "Everything they took came from the copy" : "Records that left the real hospital",
      tone: realTaken > 0 ? "text-danger" : undefined },
    { label: "Records the attacker thinks it has", value: believed.toLocaleString("en-US"),
      sub: v.diverted && believed > 0 ? "All fake" : "So far", tone: v.diverted && believed > 0 ? "text-shadow" : undefined },
    { label: "Protected secrets leaked", value: <>{v.canary.leaked}<span className="text-fg-subtle"> / {v.canary.total}</span></>,
      sub: "Checked on every response", tone: v.canary.leaked > 0 ? "text-danger" : undefined },
    { label: care ? "Urgent lab tests on time" : "Clinical work", value: care ? `${Math.round(care.stat_on_time_pct)}%` : "Normal",
      sub: care ? "While the shared lab is down" : "Patient care was never faked or paused" },
  ];
  return (
    <div data-demo="numbers" className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4", className)}>
      {items.map((it) => (
        <div key={it.label} className="bg-background px-5 py-4">
          <p className="text-[13px] text-fg-muted">{it.label}</p>
          <p className={cn("mt-1 text-[30px] font-semibold tracking-[-0.03em] tabular-nums", it.tone)}>{it.value}</p>
          <p className="text-xs text-fg-subtle">{it.sub}</p>
        </div>
      ))}
    </div>
  );
}
