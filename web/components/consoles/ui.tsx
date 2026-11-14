"use client";
// Shared primitives for the War Room consoles: glass panels, labels, honesty badge, counters.

import { useEffect, useRef, type ReactNode } from "react";
import { animate } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { WORLD, type EventDataMap, type MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Literal token values for things framer-motion must interpolate (CSS vars can't be tweened). */
export const C = {
  fg: "#e6edf7", dim: "#8a97ad", faint: "#4b5871", line: "#1c2537",
  real: "#2de2e6", shadow: "#b26bff", shadowHot: "#ff4fd8", alert: "#ffb02e", danger: "#ff4d5e", ok: "#3ddc97",
} as const;

/** Cinematic glide. Never bounce. */
export const GLIDE = [0.16, 1, 0.3, 1] as const;

const HOSPITALS = Object.fromEntries(WORLD.hospitals.map((h) => [h.id, h]));
export function hospitalShort(id: string | null | undefined): string {
  if (!id) return "—";
  return HOSPITALS[id]?.short ?? id;
}
export function hospitalName(id: string | null | undefined): string {
  if (!id) return "—";
  return HOSPITALS[id]?.name ?? id;
}
export function missionTitle(id: string | undefined): string {
  return WORLD.missions.find((m) => m.id === id)?.title ?? id ?? "—";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Translucent ink glass over the 3D scene. */
export function Glass({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line/80",
        "bg-ink-2/65 backdrop-blur-xl backdrop-saturate-150",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_30px_80px_-24px_rgba(0,0,0,0.85)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg-faint">{children}</h3>
      {right ? <div className="text-[11px] text-fg-dim">{right}</div> : null}
    </div>
  );
}

/** Mandatory honesty: anything not a live run is labelled on screen. */
export function runHonesty(run: EventDataMap["run.started"] | null): "live" | "scripted" | "replay" | null {
  if (!run) return null;
  if (run.model === "scripted") return "scripted";
  if (!run.live) return "replay";
  return "live";
}

export function RunBadge({ className }: { className?: string }) {
  const run = useMJ((s) => s.view.run);
  const ended = useMJ((s) => s.view.ended);
  const mode = runHonesty(run);
  if (!mode) return null;
  if (mode === "live") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-danger", className)}>
        <span className="relative flex size-1.5">
          {!ended && <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-70" />}
          <span className="relative inline-flex size-1.5 rounded-full bg-danger" />
        </span>
        {ended ? "LIVE · ENDED" : "LIVE"}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-alert", className)}>
      <span className="size-1.5 rounded-full bg-alert" />
      {mode === "scripted" ? "SCRIPTED DEMO" : "REPLAY"}
    </span>
  );
}

/** Number that glides to its new value. */
export function AnimatedNumber({
  value, decimals = 0, duration = 0.9, className, format,
}: { value: number; decimals?: number; duration?: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const fmt = format ?? ((n: number) => n.toFixed(decimals));
  const fmtRef = useRef(fmt);
  useEffect(() => { fmtRef.current = fmt; });
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (!ref.current) return;
    const controls = animate(from, value, {
      duration, ease: GLIDE,
      onUpdate: (v) => { if (ref.current) ref.current.textContent = fmtRef.current(v); },
    });
    return () => controls.stop();
  }, [value, duration]);
  return <span ref={ref} className={cn("tabular-nums", className)}>{fmt(value)}</span>;
}

/** The current attacker session id (latest session seen on an attacker event). */
export function attackerSessionOf(events: MJEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.actor === "attacker" && e.session_id) return e.session_id;
  }
  return null;
}
