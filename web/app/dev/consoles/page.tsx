"use client";
// Dev preview for the War Room consoles (Agent E). The 3D city goes where the gradient is.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { MJEvent } from "@/lib/contracts";
import { connectHub, useMJ } from "@/lib/events";
import {
  AttackerTerminal, ContinuityHUD, DefenderPanel, EventTimeline, TheReveal, type RevealPhase,
} from "@/components/consoles";

export default function ConsolesPreview() {
  useEffect(() => { connectHub(); }, []);
  const connected = useMJ((s) => s.connected);
  const canReveal = useMJ((s) => !!(s.view.reveal || s.view.exfil));
  const [replay, setReplay] = useState(0);
  const [selected, setSelected] = useState<MJEvent | null>(null);
  const [phase, setPhase] = useState<RevealPhase | null>(null);
  const [hold, setHold] = useState(false);

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink text-fg">
      <CityPlaceholder />

      <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)_68px] gap-3 p-4">
        {/* top bar */}
        <header className="flex items-center justify-between px-1">
          <div className="flex items-baseline gap-3">
            <span className="text-[17px] font-semibold tracking-[-0.01em]">
              Maya<span className="text-shadow">Jaal</span>
            </span>
            <span className="text-[11px] uppercase tracking-[0.3em] text-fg-faint">War Room · consoles preview</span>
          </div>
          <div className="flex items-center gap-4 text-[11.5px]">
            {selected && (
              <span className="font-mono text-fg-dim">
                selected: {selected.type} · {selected.hospital_id ?? "—"} · seq {selected.seq}
              </span>
            )}
            {phase && <span className="font-mono text-shadow">reveal: {phase}</span>}
            <span className="flex items-center gap-1.5 text-fg-dim">
              <span className={connected ? "size-1.5 rounded-full bg-real" : "size-1.5 rounded-full bg-fg-faint"} />
              {connected ? "hub connected" : "hub offline"}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-fg-dim">
              <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} className="accent-[var(--shadow)]" />
              hold ledger
            </label>
            <button
              type="button"
              disabled={!canReveal}
              onClick={() => setReplay((n) => n + 1)}
              className="flex items-center gap-1.5 rounded-full border border-shadow/50 bg-shadow/10 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-shadow uppercase transition-colors hover:bg-shadow/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="size-3" /> Replay reveal
            </button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[minmax(360px,29vw)_minmax(0,1fr)_minmax(360px,25vw)] gap-4">
          <AttackerTerminal />
          <div className="pointer-events-none relative min-h-0">
            <div className="pointer-events-auto absolute right-0 bottom-0 w-[min(100%,400px)]">
              <ContinuityHUD />
            </div>
          </div>
          <DefenderPanel />
        </div>

        <EventTimeline onSelect={setSelected} />
      </div>

      <TheReveal
        replayKey={replay}
        holdMs={hold ? Infinity : undefined}
        onPhase={(p) => setPhase(p)}
        onDone={() => setPhase(null)}
      />
    </main>
  );
}

function CityPlaceholder() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 50% 38%, rgba(45,226,230,0.10), transparent 70%)," +
            "radial-gradient(ellipse 60% 35% at 50% 78%, rgba(178,107,255,0.12), transparent 70%)," +
            "linear-gradient(180deg, #05070d 0%, #070b16 48%, #0b0716 52%, #05070d 100%)",
        }}
      />
      <div className="absolute top-1/2 right-[30%] left-[30%] h-px bg-gradient-to-r from-transparent via-real/30 to-transparent" />
      <div className="absolute top-[47%] left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.4em] text-fg-faint/60">
        3D city goes here
      </div>
    </div>
  );
}
