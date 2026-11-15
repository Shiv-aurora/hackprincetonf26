"use client";
// Loads the recorded runs the tour plays from web/public/runs/. Prefers the runs recorded from the real
// stack; falls back to the scripted fixture (labelled "Scripted" on screen). Never talks to the hub.

import { useEffect, useState } from "react";
import type { ConfigId, MJEvent } from "@/lib/contracts";

export type RunKind = "recorded" | "scripted";
export interface LoadedRun { events: MJEvent[]; kind: RunKind; file: string }

/** contracts/results.md, plus the recorder's two extra per-row fields. */
export interface ResultRow {
  run_id: string;
  config: ConfigId | string;
  believed_success: boolean;
  secrets_leaked: number;
  diverted: boolean | null;
  time_to_divert_s: number | null;
  real_records_taken?: number | null;
  /** Real patients the attacker was shown (any real clinical read). */
  real_records_exposed?: number | null;
  decoy_overlap_between_sessions?: number | null;
}
export interface ResultsFile { generated_at: string; note: string; runs: ResultRow[] }

export interface DemoData {
  status: "loading" | "ready" | "error";
  /** The attack story (steps 2–10). */
  attack: LoadedRun | null;
  /** The lab-outage story (steps 11–12). */
  continuity: LoadedRun | null;
  /** Benchmark results; null while recording (never invented). */
  results: ResultsFile | null;
}

const SCRIPTED = "/runs/demo-run.jsonl";

async function fetchRun(file: string, kind: RunKind): Promise<LoadedRun | null> {
  try {
    const res = await fetch(file, { cache: "no-store" });
    if (!res.ok) return null;
    const events: MJEvent[] = [];
    for (const line of (await res.text()).split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { events.push(JSON.parse(t) as MJEvent); } catch { /* skip a bad line */ }
    }
    // One run per file; if more were appended, keep the first. File order is the hub's order.
    const start = events.findIndex((e) => e.type === "run.started");
    if (start < 0) return null;
    const next = events.findIndex((e, i) => i > start && e.type === "run.started");
    const run = events.slice(start, next < 0 ? undefined : next);
    return run.length > 1 ? { events: run, kind, file } : null;
  } catch {
    return null;
  }
}

async function fetchResults(): Promise<ResultsFile | null> {
  try {
    const res = await fetch("/runs/results.json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as ResultsFile;
    return data && Array.isArray(data.runs) && data.runs.length > 0 ? data : null;
  } catch {
    return null;
  }
}

const hasAttack = (r: LoadedRun | null) => !!r && r.events.some((e) => e.actor === "attacker");
const hasOutage = (r: LoadedRun | null) => !!r
  && r.events.some((e) => e.type === "node.status" && e.data.status !== "healthy")
  && r.events.some((e) => e.type === "continuity.stats");

export function useDemoData(forceScripted: boolean): DemoData {
  const [data, setData] = useState<DemoData>({ status: "loading", attack: null, continuity: null, results: null });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [recorded, outage, scripted, results] = await Promise.all([
        forceScripted ? null : fetchRun("/runs/mayajaal.jsonl", "recorded"),
        forceScripted ? null : fetchRun("/runs/continuity.jsonl", "recorded"),
        fetchRun(SCRIPTED, "scripted"),
        fetchResults(),
      ]);
      if (!alive) return;
      const attack = hasAttack(recorded) ? recorded : hasAttack(scripted) ? scripted : null;
      const continuity = hasOutage(outage) ? outage : hasOutage(scripted) ? scripted : null;
      setData({ status: attack ? "ready" : "error", attack, continuity, results });
    })();
    return () => { alive = false; };
  }, [forceScripted]);

  return data;
}

export function runLabel(r: LoadedRun | null, source: "attack" | "continuity"): string {
  if (!r) return "";
  if (r.kind === "scripted") return "Scripted";
  return source === "continuity" ? "Recorded run · scripted outage" : "Recorded run · scripted attacker";
}
