"use client";
// "Start attack": asks the hub to run the scripted attacker (scripts/record_runs.py --dry) through the
// real gateway, under the chosen defense. Events stream back over the hub WebSocket like any run.
//
// Where no hub is reachable (the hosted site has no backend), it plays the recorded run of that defense
// instead (public/runs/<defense>.jsonl, recorded on the running system), at its recorded pace, through the
// same store. That run is marked not-live and the button says "Recorded run", never "live".

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { HUB_HTTP_URL, type MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { Button, cn } from "@/components/ui";

type Defense = "mayajaal" | "static" | "baseline";
type Busy = null | "live" | "recorded";
const OPTIONS: { id: Defense; label: string }[] = [
  { id: "mayajaal", label: "MayaJaal" },
  { id: "static", label: "Static decoy" },
  { id: "baseline", label: "No defense" },
];
const MAX_GAP_MS = 1500;   // long pauses in the recording are shortened so the replay keeps moving

async function hubUp(): Promise<boolean> {
  try {
    const r = await fetch(`${HUB_HTTP_URL}/demo/attack`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function loadRecorded(defense: Defense): Promise<MJEvent[]> {
  const text = await (await fetch(`/runs/${defense}.jsonl`)).text();
  return text.split("\n").filter((l) => l.trim()).map((l) => {
    const ev = JSON.parse(l) as MJEvent;
    if (ev.type === "run.started") return { ...ev, data: { ...ev.data, live: false } } as MJEvent;
    return ev;
  });
}

export function AttackControls({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [defense, setDefense] = useState<Defense>("mayajaal");
  const [busy, setBusy] = useState<Busy>(null);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A live run keeps the button busy until the hub says the attacker process has finished.
  useEffect(() => {
    if (busy !== "live") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${HUB_HTTP_URL}/demo/attack`);
        const j = (await r.json()) as { running: boolean };
        if (!j.running) setBusy(null);
      } catch { setBusy(null); }
    }, 1500);
    return () => clearInterval(t);
  }, [busy]);

  const playRecorded = async () => {
    setBusy("recorded");
    setRecorded(true);
    try {
      const events = await loadRecorded(defense);
      const push = useMJ.getState().push;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      let at = 0;
      events.forEach((ev, i) => {
        if (i > 0) at += Math.min(Math.max(ev.ts - events[i - 1].ts, 0), MAX_GAP_MS);
        timers.current.push(setTimeout(() => push(ev), at));
      });
      timers.current.push(setTimeout(() => setBusy(null), at + 300));
    } catch {
      setBusy(null);
      setError("Could not load the recorded run");
    }
  };

  const start = async () => {
    setError(null);
    if (!(await hubUp())) return playRecorded();
    setRecorded(false);
    setBusy("live");
    try {
      const r = await fetch(`${HUB_HTTP_URL}/demo/attack`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: defense }),
      });
      if (!r.ok) throw new Error(r.status === 409 ? "An attack is already running" : `Hub said ${r.status}`);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Could not reach the hub");
    }
  };

  const label = busy === "recorded" ? "Playing…" : busy ? "Attack running…" : "Start attack";
  const hint = error ?? (recorded
    ? "No backend on this site: this plays the attack recorded on the running system, at its recorded pace"
    : "Runs the scripted attacker against the real gateway");
  const badge = recorded && (
    <span title={hint} className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] text-fg-muted sm:inline-flex">
      <span className="size-1.5 rounded-full bg-fg-subtle" aria-hidden /> Recorded run
    </span>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {badge}
        <Button size="sm" variant="primary" onClick={start} disabled={busy !== null} title={hint}
          className={cn("shrink-0 rounded-full", error && "ring-1 ring-alert", className)}>
          <Play className="size-3.5" aria-hidden /> {label}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div role="radiogroup" aria-label="Defense" className="flex h-8 items-center rounded-md border border-border p-0.5">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={defense === o.id} disabled={busy !== null}
            onClick={() => setDefense(o.id)}
            className={cn("h-full rounded-[5px] px-2.5 text-[12px] transition-colors disabled:opacity-60",
              defense === o.id ? "bg-surface-2 font-medium text-fg" : "text-fg-muted hover:text-fg")}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="hidden text-xs text-fg-subtle xl:inline" title="Replays the public outline of a real incident on our synthetic hospital; no real patient data is used.">
        Stolen login · modelled on Change Healthcare (2024)
      </span>
      {badge}
      <Button size="sm" variant="primary" onClick={start} disabled={busy !== null} title={hint}>
        <Play className="size-3.5" aria-hidden /> {label}
      </Button>
      {error && <span className="text-xs text-alert">{error}</span>}
    </div>
  );
}
