"use client";
// "Start attack": asks the hub to run the scripted attacker (scripts/record_runs.py --dry) through the
// real gateway, under the chosen defense. Events stream back over the hub WebSocket like any run.

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { HUB_HTTP_URL } from "@/lib/contracts";
import { Button, cn } from "@/components/ui";

type Defense = "mayajaal" | "static" | "baseline";
const OPTIONS: { id: Defense; label: string }[] = [
  { id: "mayajaal", label: "MayaJaal" },
  { id: "static", label: "Static decoy" },
  { id: "baseline", label: "No defense" },
];

export function AttackControls({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [defense, setDefense] = useState<Defense>("mayajaal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A run in progress keeps the button busy until the hub says the attacker process has finished.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${HUB_HTTP_URL}/demo/attack`);
        const j = (await r.json()) as { running: boolean };
        if (!j.running) setBusy(false);
      } catch { setBusy(false); }
    }, 1500);
    return () => clearInterval(t);
  }, [busy]);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${HUB_HTTP_URL}/demo/attack`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: defense }),
      });
      if (!r.ok) throw new Error(r.status === 409 ? "An attack is already running" : `Hub said ${r.status}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not reach the hub");
    }
  };

  if (compact) {
    return (
      <Button size="sm" variant="primary" onClick={start} disabled={busy} title={error ?? "Runs the scripted attacker against the real gateway"}
        className={cn("shrink-0 rounded-full", error && "ring-1 ring-alert", className)}>
        <Play className="size-3.5" aria-hidden /> {busy ? "Attack running…" : "Start attack"}
      </Button>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div role="radiogroup" aria-label="Defense" className="flex h-8 items-center rounded-md border border-border p-0.5">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={defense === o.id} disabled={busy}
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
      <Button size="sm" variant="primary" onClick={start} disabled={busy}>
        <Play className="size-3.5" aria-hidden /> {busy ? "Attack running…" : "Start attack"}
      </Button>
      {error && <span className="text-xs text-alert">{error}</span>}
    </div>
  );
}
