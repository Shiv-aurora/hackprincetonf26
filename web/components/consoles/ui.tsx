"use client";
// Shared helpers for the War Room consoles: formatting, run honesty, derived selectors.

import { useMemo, type ReactNode } from "react";
import { WORLD, type EventDataMap, type MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { Badge, Dot, cn } from "@/components/ui";

const HOSPITALS = Object.fromEntries(WORLD.hospitals.map((h) => [h.id, h]));

export function hospitalShort(id: string | null | undefined): string {
  if (!id) return "";
  return HOSPITALS[id]?.short ?? id;
}
export function hospitalName(id: string | null | undefined): string {
  if (!id) return "";
  return HOSPITALS[id]?.name ?? id;
}
export function missionTitle(id: string | undefined): string {
  return WORLD.missions.find((m) => m.id === id)?.title ?? id ?? "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Elapsed time since run start as m:ss (deterministic, no wall clock). */
export function clock(ts: number, t0: number | null): string {
  const s = Math.max(0, Math.floor((ts - (t0 ?? ts)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Timestamp of the current run's first event. */
export function useRunStart(): number | null {
  return useMJ((s) => s.events[0]?.ts ?? null);
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
  const ended = useMJ((s) => !!s.view.ended);
  const mode = runHonesty(run);
  if (!mode) return null;
  if (mode === "live") {
    return (
      <Badge className={cn("text-fg", className)}>
        <Dot tone="ok" pulse={!ended} />
        {ended ? "Live run, ended" : "Live"}
      </Badge>
    );
  }
  return (
    <Badge className={cn("text-fg", className)} >
      <Dot tone="alert" />
      {mode === "scripted" ? "Scripted demo" : "Replay"}
    </Badge>
  );
}

export function StreamStatus() {
  const connected = useMJ((s) => s.connected);
  return (
    <span className="hidden items-center gap-2 text-[13px] text-fg-muted sm:inline-flex">
      <Dot tone={connected ? "ok" : "neutral"} />
      {connected ? "Connected" : "Offline"}
    </span>
  );
}

/** Column heading above a card: title + one-line description + optional right slot. */
export function ColumnHeading({ title, description, right }: { title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {description && <p className="mt-0.5 truncate text-[13px] text-fg-muted">{description}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export interface AttackerFacts {
  sessions: Set<string>;
  requests: { total: number; real: number; shadow: number; denied: number };
  clinicianRequests: number;
  decisions: Extract<MJEvent, { type: "policy.decision" }>[];
  clinicianAllowed: number;
  divertedAt: number | null;
  shadowSession: string | null;
}

/** Facts about the attacker session(s), derived from the current run's events. */
export function useAttackerFacts(): AttackerFacts {
  const events = useMJ((s) => s.events);
  return useMemo(() => {
    const sessions = new Set<string>();
    for (const e of events) if (e.actor === "attacker" && e.session_id) sessions.add(e.session_id);
    const requests = { total: 0, real: 0, shadow: 0, denied: 0 };
    let clinicianRequests = 0;
    const decisions: AttackerFacts["decisions"] = [];
    let clinicianAllowed = 0;
    let divertedAt: number | null = null;
    let shadowSession: string | null = null;
    for (const e of events) {
      if (e.type === "request") {
        if (e.actor !== "attacker") { clinicianRequests++; continue; }
        requests.total++;
        if (e.tier === "real") requests.real++;
        else if (e.tier === "shadow") requests.shadow++;
        if (e.data.status === 401 || e.data.status === 403) requests.denied++;
      } else if (e.type === "policy.decision") {
        const mine = e.session_id && sessions.has(e.session_id);
        if (mine || e.data.lane !== "normal") decisions.push(e);
        else clinicianAllowed++;
      } else if (e.type === "session.diverted" && divertedAt === null) {
        divertedAt = e.ts;
        shadowSession = e.session_id;
      }
    }
    return { sessions, requests, clinicianRequests, decisions, clinicianAllowed, divertedAt, shadowSession };
  }, [events]);
}

export function shortSession(id: string | null | undefined): string {
  return id ? id.replace(/^sess-/, "") : "";
}
