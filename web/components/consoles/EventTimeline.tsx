"use client";
// Bottom strip: significant events as chips, coloured by tier. Click → onSelect(event) (camera fly-to).

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, Crosshair, Eye, FileDown, Flag, Footprints, KeyRound, Play, Server, Sparkles, Split, Square, Syringe,
} from "lucide-react";
import type { MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { GLIDE, cn, formatBytes, hospitalShort } from "./ui";

type Tone = "real" | "shadow" | "reveal" | "alert" | "danger" | "neutral" | "ok";

export interface TimelineChip {
  ev: MJEvent;
  label: string;
  detail?: string;
  tone: Tone;
  icon: typeof Activity;
}

/** Map an event to a chip, or null if it isn't significant. Exported so other views can reuse it. */
export function chipFor(ev: MJEvent, isFirstContinuity = false): TimelineChip | null {
  const tierTone: Tone = ev.tier === "shadow" ? "shadow" : ev.tier === "real" ? "real" : "neutral";
  switch (ev.type) {
    case "run.started":
      return { ev, tone: "neutral", icon: Play, label: "Run started", detail: ev.data.attacker_label };
    case "run.ended":
      return { ev, tone: "neutral", icon: Square, label: "Run ended", detail: `${Math.round(ev.data.duration_s)} s` };
    case "session.diverted":
      return { ev, tone: "shadow", icon: Split, label: "Session diverted", detail: `${ev.data.from_tier} → ${ev.data.to_tier}` };
    case "honeytoken.touched":
      return { ev, tone: "shadow", icon: KeyRound, label: "Honeytoken touched", detail: ev.data.kind };
    case "breadcrumb.planted":
      return { ev, tone: "shadow", icon: Footprints, label: "Breadcrumb", detail: `${ev.data.info_gain.toFixed(2)} bits` };
    case "exfil":
      return { ev, tone: tierTone === "neutral" ? "alert" : tierTone, icon: FileDown, label: `Exfil ${ev.data.records.toLocaleString()} rec`, detail: formatBytes(ev.data.bytes) };
    case "agent.claim":
      return { ev, tone: "alert", icon: Flag, label: "Agent claims success" };
    case "reveal":
      return { ev, tone: "reveal", icon: Eye, label: "The Reveal", detail: `${ev.data.real_bytes} real bytes` };
    case "node.status": {
      const s = ev.data.status;
      const tone: Tone = s === "compromised" || s === "down" ? "danger" : s === "healthy" ? "ok" : "alert";
      return { ev, tone, icon: Server, label: `${hospitalShort(ev.hospital_id)} ${s}` };
    }
    case "keyshare.status":
      if (ev.data.state !== "captured") return null;
      return { ev, tone: "alert", icon: Crosshair, label: `Key share ${ev.data.share_index} captured`, detail: `${ev.data.shares_captured_total}/${ev.data.threshold}` };
    case "tamper.attempt":
      return { ev, tone: ev.data.accepted ? "danger" : tierTone, icon: Syringe, label: ev.data.accepted ? "Tamper accepted" : "Tamper rejected" };
    case "continuity.stats":
      if (isFirstContinuity) return null;
      return { ev, tone: ev.data.stat_on_time_pct >= 90 ? "ok" : "alert", icon: Activity, label: `STAT ${Math.round(ev.data.stat_on_time_pct)}%`, detail: "on time" };
    default:
      return null;
  }
}

const TONE: Record<Tone, string> = {
  real: "border-real/40 text-real bg-real/[0.07]",
  shadow: "border-shadow/45 text-[color-mix(in_srgb,var(--shadow)_70%,white)] bg-shadow/[0.1]",
  reveal: "border-shadow-hot/60 text-shadow-hot bg-gradient-to-r from-shadow/20 to-shadow-hot/20 shadow-[0_0_24px_-6px_var(--shadow-hot)]",
  alert: "border-alert/40 text-alert bg-alert/[0.07]",
  danger: "border-danger/50 text-danger bg-danger/[0.08]",
  ok: "border-ok/35 text-ok bg-ok/[0.06]",
  neutral: "border-line text-fg-dim bg-ink-3/40",
};

export interface EventTimelineProps {
  className?: string;
  onSelect?: (event: MJEvent) => void;
  /** Highlight a chip by event id (e.g. while the camera is there). */
  selectedId?: string | null;
}

export function EventTimeline({ className, onSelect, selectedId }: EventTimelineProps) {
  const events = useMJ((s) => s.events);
  const [localSel, setLocalSel] = useState<string | null>(null);
  const sel = selectedId !== undefined ? selectedId : localSel;
  const scroller = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);

  const { chips, t0 } = useMemo(() => {
    const chips: TimelineChip[] = [];
    let seenContinuity = false;
    const nodeState: Record<string, string> = {};
    for (const ev of events) {
      if (ev.actor === "clinician") continue;
      if (ev.type === "node.status" && ev.hospital_id) {
        const prev = nodeState[ev.hospital_id] ?? "healthy";
        nodeState[ev.hospital_id] = ev.data.status;
        if (prev === ev.data.status) continue; // roll-call / no change
      }
      const c = chipFor(ev, ev.type === "continuity.stats" && !seenContinuity);
      if (ev.type === "continuity.stats") seenContinuity = true;
      if (c) chips.push(c);
    }
    return { chips, t0: events[0]?.ts ?? 0 };
  }, [events]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || hovering.current) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [chips.length]);

  return (
    <div className={cn("relative flex h-full min-w-0 items-center gap-4 rounded-2xl border border-line/80 bg-ink-2/65 px-4 backdrop-blur-xl", className)}>
      <div className="flex shrink-0 flex-col">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-fg">Timeline</span>
        <span className="font-mono text-[10.5px] text-fg-faint">{chips.length} events</span>
      </div>
      <div className="h-8 w-px shrink-0 bg-line" />
      <div className="relative min-w-0 flex-1">
        {/* edge fade */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-ink-2/90 to-transparent" />
        <div
          ref={scroller}
          onMouseEnter={() => { hovering.current = true; }}
          onMouseLeave={() => { hovering.current = false; }}
          className="flex items-center gap-2 overflow-x-auto py-2 pr-2 pl-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chips.length === 0 && <span className="text-[12px] text-fg-faint">Significant events will appear here.</span>}
          <AnimatePresence initial={false}>
            {chips.map((c) => {
              const Icon = c.icon;
              const active = sel === c.ev.id;
              return (
                <motion.button
                  key={c.ev.id}
                  type="button"
                  layout="position"
                  initial={{ opacity: 0, x: 24, filter: "blur(4px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.6, ease: GLIDE }}
                  onClick={() => { setLocalSel(c.ev.id); onSelect?.(c.ev); }}
                  className={cn(
                    "group flex shrink-0 items-center gap-2 rounded-full border py-1.5 pr-3 pl-2.5 text-left transition-[transform,box-shadow] duration-300",
                    "hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40",
                    TONE[c.tone],
                    active && "ring-2 ring-fg/50",
                  )}
                  title={`${c.ev.type} · seq ${c.ev.seq}`}
                >
                  {c.tone === "reveal" ? <Sparkles className="size-3.5" strokeWidth={1.75} /> : <Icon className="size-3.5" strokeWidth={1.75} />}
                  <span className="text-[12px] font-medium whitespace-nowrap">{c.label}</span>
                  {c.detail && <span className="font-mono text-[10.5px] whitespace-nowrap opacity-70">{c.detail}</span>}
                  <span className="font-mono text-[10px] whitespace-nowrap text-fg-faint">T+{Math.max(0, Math.round((c.ev.ts - t0) / 1000))}s</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
