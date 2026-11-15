// Recorded runs under public/runs/ (the attack run by default), fetched once per file and shared by the
// research slides. undefined while loading, null if it could not be read.

import { useEffect, useState } from "react";

export interface RunEvent {
  type?: string;
  actor?: string;
  tier?: string;
  run_id?: string;
  hospital_id?: string | null;
  data?: Record<string, unknown>;
}

const cache = new Map<string, Promise<RunEvent[] | null>>();

function load(path: string): Promise<RunEvent[] | null> {
  return fetch(path)
    .then((r) => (r.ok ? r.text() : null))
    .then((text) => {
      if (text === null) return null;
      const out: RunEvent[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
      }
      return out;
    })
    .catch(() => null);
}

export function useRunEvents(path = "/runs/mayajaal.jsonl"): RunEvent[] | null | undefined {
  const [events, setEvents] = useState<RunEvent[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let p = cache.get(path);
    if (!p) { p = load(path); cache.set(path, p); }
    void p.then((e) => { if (alive) setEvents(e); });
    return () => { alive = false; };
  }, [path]);
  return events;
}
