// The recorded MayaJaal run (public/runs/mayajaal.jsonl), fetched once and shared by the research slides.
// undefined while loading, null if it could not be read.

import { useEffect, useState } from "react";

export interface RunEvent {
  type?: string;
  actor?: string;
  tier?: string;
  run_id?: string;
  data?: Record<string, unknown>;
}

let cache: Promise<RunEvent[] | null> | null = null;

function load(): Promise<RunEvent[] | null> {
  return fetch("/runs/mayajaal.jsonl")
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

export function useRunEvents(): RunEvent[] | null | undefined {
  const [events, setEvents] = useState<RunEvent[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    cache ??= load();
    void cache.then((e) => { if (alive) setEvents(e); });
    return () => { alive = false; };
  }, []);
  return events;
}
