"use client";
// War Room — the main demo screen. Owned by the integrator; composes the agents' components.
// 3D city (Agent D) full-bleed, consoles (Agent E) as glass panes, soundscape (Agent F).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { MJEvent } from "@/lib/contracts";
import { connectHub, useMJ } from "@/lib/events";
import { CityScene } from "@/components/city";
import {
  AttackerTerminal, ContinuityHUD, DefenderPanel, EventTimeline, RunBadge, TheReveal,
} from "@/components/consoles";
import { Mark } from "@/components/brand/Mark";
import { Soundscape, SoundToggle } from "@/lib/sound";

export default function WarRoom() {
  useEffect(() => { connectHub(); }, []);
  const connected = useMJ((s) => s.connected);
  const canReveal = useMJ((s) => !!(s.view.reveal || s.view.exfil));
  const [focus, setFocus] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);

  const onSelect = useCallback((ev: MJEvent) => {
    setFocus((cur) => (ev.hospital_id && ev.hospital_id !== cur ? ev.hospital_id : null));
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink text-fg">
      <Soundscape />
      <div className="absolute inset-0">
        <CityScene mode="live" focusHospital={focus} />
      </div>
      {/* soft vignette so panels stay legible over the scene */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(5,7,13,0.75)_100%)]" />

      <div className="pointer-events-none relative z-10 grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_68px] gap-3 p-4">
        <header className="pointer-events-auto flex items-center justify-between px-1">
          <Link href="/" className="flex items-center gap-3">
            <Mark className="size-7" />
            <span className="text-[17px] font-semibold tracking-[-0.01em]">
              Maya<span className="text-shadow">Jaal</span>
            </span>
            <span className="hidden text-[11px] uppercase tracking-[0.3em] text-fg-faint sm:inline">War Room</span>
          </Link>
          <div className="flex items-center gap-4 text-[11.5px]">
            <RunBadge />
            <span className="flex items-center gap-1.5 text-fg-dim">
              <span className={connected ? "size-1.5 rounded-full bg-real" : "size-1.5 rounded-full bg-fg-faint"} />
              {connected ? "stream connected" : "stream offline"}
            </span>
            {focus && (
              <button type="button" onClick={() => setFocus(null)}
                className="rounded-full border border-line px-3 py-1 text-fg-dim hover:text-fg">
                Free camera
              </button>
            )}
            <button
              type="button"
              disabled={!canReveal}
              onClick={() => setReplay((n) => n + 1)}
              className="flex items-center gap-1.5 rounded-full border border-shadow/50 bg-shadow/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-shadow transition-colors hover:bg-shadow/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="size-3" /> Reveal
            </button>
            <SoundToggle />
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[minmax(340px,27vw)_minmax(0,1fr)_minmax(340px,24vw)] gap-4">
          <div className="pointer-events-auto min-h-0"><AttackerTerminal className="h-full" /></div>
          <div className="relative min-h-0">
            <div className="pointer-events-auto absolute right-0 bottom-0 w-[min(100%,380px)]">
              <ContinuityHUD />
            </div>
          </div>
          <div className="pointer-events-auto min-h-0"><DefenderPanel className="h-full" /></div>
        </div>

        <div className="pointer-events-auto min-w-0"><EventTimeline onSelect={onSelect} /></div>
      </div>

      <TheReveal replayKey={replay} />
    </main>
  );
}
