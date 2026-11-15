"use client";
// Facts for the "how it works" story scenes, read from the recorded MayaJaal run so nothing on screen is
// invented: web/public/runs/brief-mayajaal.json (the incident brief) and mayajaal.jsonl (First Sight's
// score, the scatter). Returns null until loaded; scenes show their shapes without numbers meanwhile.

import { useEffect, useState } from "react";

export interface RunFacts {
  runId: string;
  login: { user: string; role: string; hospital: string };
  client: { address: string; software: string; meanGapS: number | null };
  firstSight: { score: number; threshold: number; signals: string[] } | null;
  divertedAfterS: number | null;
  trackers: { id: string; kind: string; where: string }[];
  fakeRecords: number;
  techniques: { id: string; name: string }[];
  realSecretsLeaked: number;
  realDataServed: number;
  scatter: { pieces: number; replicas: number; holders: string[]; keyThreshold: number; verified: boolean; bytes: number } | null;
}

interface BriefLike {
  run_id?: string;
  facts?: {
    stolen_login?: { user?: string; role?: string; hospital?: string };
    client?: { addresses?: string[]; software?: string; mean_gap_s?: number };
    diverted?: { after_s?: number };
    trackers_taken?: { id: string; kind: string; where: string }[];
    believes_stolen?: { records: number }[];
    techniques?: { id: string; name: string }[];
    real_secrets_leaked?: number;
    requests?: { real_data_served?: number };
  };
}

let cache: Promise<RunFacts | null> | null = null;

async function load(): Promise<RunFacts | null> {
  try {
    const [b, log] = await Promise.all([
      fetch("/runs/brief-mayajaal.json", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<BriefLike>) : null)),
      fetch("/runs/mayajaal.jsonl", { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")),
    ]);
    if (!b?.facts) return null;
    const f = b.facts;
    let firstSight: RunFacts["firstSight"] = null;
    let scatter: RunFacts["scatter"] = null;
    for (const line of log.split("\n")) {
      if (!line.trim()) continue;
      let e: { type?: string; data?: Record<string, unknown> };
      try { e = JSON.parse(line); } catch { continue; }
      if (!firstSight && e.type === "policy.decision" && typeof e.data?.reason === "string" && e.data.reason.startsWith("First Sight")) {
        const reason = e.data.reason;
        const m = reason.match(/score ([\d.]+) ≥ ([\d.]+)/);
        const signals: string[] = [];
        if (/script/i.test(reason)) signals.push("Script, not the EHR app");
        if (/device/i.test(reason)) signals.push("Not a hospital device");
        if (m) firstSight = { score: Number(m[1]), threshold: Number(m[2]), signals };
      }
      if (!scatter && e.type === "vault.scattered" && e.data) {
        const d = e.data as { pieces: number; replicas: number; holders: string[]; key_threshold: number; verified: boolean; bytes: number };
        scatter = { pieces: d.pieces, replicas: d.replicas, holders: d.holders, keyThreshold: d.key_threshold, verified: d.verified, bytes: d.bytes };
      }
    }
    return {
      runId: b.run_id ?? "",
      login: { user: f.stolen_login?.user ?? "", role: f.stolen_login?.role ?? "", hospital: f.stolen_login?.hospital ?? "" },
      client: { address: f.client?.addresses?.[0] ?? "", software: f.client?.software ?? "", meanGapS: f.client?.mean_gap_s ?? null },
      firstSight,
      divertedAfterS: f.diverted?.after_s ?? null,
      trackers: f.trackers_taken ?? [],
      fakeRecords: (f.believes_stolen ?? []).reduce((a, x) => a + (x.records ?? 0), 0),
      techniques: f.techniques ?? [],
      realSecretsLeaked: f.real_secrets_leaked ?? 0,
      realDataServed: f.requests?.real_data_served ?? 0,
      scatter,
    };
  } catch {
    return null;
  }
}

export function useRunFacts(): RunFacts | null {
  const [facts, setFacts] = useState<RunFacts | null>(null);
  useEffect(() => {
    let alive = true;
    cache ??= load();
    void cache.then((f) => { if (alive) setFacts(f); });
    return () => { alive = false; };
  }, []);
  return facts;
}
