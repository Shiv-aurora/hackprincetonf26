"use client";
// Compact list of the run's key events, newest first. Click a row → focus that hospital on the map.

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { Card, Dot, cn } from "@/components/ui";
import { clock, formatBytes, hospitalShort, useRunStart } from "./ui";

type Tone = "neutral" | "shadow" | "alert" | "danger" | "ok";

export interface KeyEvent {
  ev: MJEvent;
  label: string;
  detail?: string;
  tone: Tone;
}

/** Pick out the events worth showing in the list. Exported so other views (Replay) can reuse it. */
export function keyEvents(events: MJEvent[]): KeyEvent[] {
  const out: KeyEvent[] = [];
  const nodeState: Record<string, string> = {};
  let continuitySeen = false;
  let reroutingSeen = false;
  for (const ev of events) {
    const k = keyEventFor(ev);
    if (k) out.push(k);
    if (ev.type === "node.status" && ev.hospital_id) {
      const prev = nodeState[ev.hospital_id] ?? "healthy";
      nodeState[ev.hospital_id] = ev.data.status;
      if (ev.data.status !== prev) {
        const s = ev.data.status;
        out.push({ ev, label: `${hospitalShort(ev.hospital_id)} ${s}`, detail: ev.data.reason || undefined,
          tone: s === "healthy" ? "ok" : "alert" });
      }
    } else if (ev.type === "continuity.stats") {
      if (continuitySeen) {
        out.push({ ev, label: `STAT on time ${Math.round(ev.data.stat_on_time_pct)}%`,
          detail: ev.data.unservable ? `${ev.data.unservable} unservable` : undefined,
          tone: ev.data.stat_on_time_pct < 80 ? "alert" : "neutral" });
      }
      continuitySeen = true;
    } else if (ev.type === "lab.order" && ev.data.status === "rerouted" && !reroutingSeen) {
      reroutingSeen = true;
      out.push({ ev, label: "Lab orders rerouting",
        detail: `${hospitalShort(ev.data.from_hospital)} → ${hospitalShort(ev.data.to_hospital)}`, tone: "neutral" });
    }
  }
  return out;
}

function keyEventFor(ev: MJEvent): KeyEvent | null {
  switch (ev.type) {
    case "run.started":
      return { ev, tone: "neutral", label: "Run started", detail: ev.data.attacker_label };
    case "run.ended":
      return { ev, tone: "neutral", label: "Run ended", detail: `${Math.round(ev.data.duration_s)} s` };
    case "session.diverted":
      return { ev, tone: "shadow", label: "Session diverted to shadow", detail: ev.data.reason };
    case "honeytoken.touched":
      return { ev, tone: "shadow", label: "Honeytoken touched", detail: ev.data.where };
    case "breadcrumb.planted":
      return { ev, tone: "shadow", label: "Breadcrumb planted", detail: `${ev.data.path} · ${ev.data.info_gain.toFixed(2)} bits` };
    case "exfil":
      return { ev, tone: "neutral", label: `Exfil ${ev.data.records.toLocaleString("en-US")} records`, detail: formatBytes(ev.data.bytes) };
    case "agent.claim":
      return { ev, tone: "neutral", label: "Agent claims success" };
    case "reveal":
      return { ev, tone: "shadow", label: "Reveal", detail: `${ev.data.real_bytes} real bytes` };
    case "canary.check":
      return ev.data.leaked > 0
        ? { ev, tone: "danger", label: `Protected records leaked ${ev.data.leaked} / ${ev.data.protected_total}` }
        : null;
    case "keyshare.status":
      return ev.data.state === "captured"
        ? { ev, tone: "alert", label: `Key share ${ev.data.share_index} captured`, detail: `${ev.data.shares_captured_total} / ${ev.data.threshold}` }
        : null;
    case "tamper.attempt":
      return { ev, tone: ev.data.accepted ? "danger" : "neutral", label: ev.data.accepted ? "Tampered result accepted" : "Tampered result rejected", detail: ev.data.resource };
    default:
      return null;
  }
}

export interface EventTimelineProps {
  className?: string;
  /** Id of the selected event (highlighted). */
  selected?: string | null;
  onSelect?: (ev: MJEvent) => void;
}

export function EventTimeline({ className, selected, onSelect }: EventTimelineProps) {
  const events = useMJ((s) => s.events);
  const t0 = useRunStart();
  const reduce = useReducedMotion();
  const rows = useMemo(() => keyEvents(events).reverse(), [events]);

  return (
    <Card title="Events" className={className} bodyClassName="overflow-y-auto p-0"
      action={<span className="text-xs tabular-nums text-fg-subtle">{rows.length}</span>}>
      {rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-fg-subtle">No events yet</p> : (
        <ul className="py-1">
          {rows.map((k) => {
            const active = !!selected && k.ev.id === selected;
            return (
              <motion.li key={`${k.ev.id}-${k.label}`}
                initial={reduce ? false : { opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                <button type="button" onClick={() => onSelect?.(k.ev)}
                  className={cn("grid w-full grid-cols-[36px_8px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-1.5 text-left text-[13px] transition-colors hover:bg-surface",
                    active && "bg-surface-2 hover:bg-surface-2")}>
                  <span className="font-mono text-xs tabular-nums text-fg-subtle">{clock(k.ev.ts, t0)}</span>
                  <Dot tone={k.tone} />
                  <span className="min-w-0 truncate">
                    <span className={k.tone === "danger" ? "text-danger" : "text-fg"}>{k.label}</span>
                    {k.detail && <span className="ml-2 text-fg-subtle">{k.detail}</span>}
                  </span>
                  <span className="text-xs text-fg-subtle">{hospitalShort(k.ev.hospital_id)}</span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
