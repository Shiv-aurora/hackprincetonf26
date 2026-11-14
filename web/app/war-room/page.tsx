"use client";
// War Room — the main demo screen. Left: what the attacker believes. Right: what actually happened.
// Below: the city network, key events and lab continuity. The Reveal sheet sits on top.

import { useCallback, useEffect, useState } from "react";
import type { MJEvent } from "@/lib/contracts";
import { WORLD } from "@/lib/contracts";
import { connectHub, useMJ } from "@/lib/events";
import { Button, Card, SiteHeader, cn } from "@/components/ui";
import { NetworkMap } from "@/components/map";
import {
  AttackerTerminal, ColumnHeading, ContinuityHUD, DefenderPanel, EventTimeline, RunBadge, SoundButton,
  StreamStatus, TheReveal, WarRoomSound, hospitalName, playRevealCue, useHasContinuity,
} from "@/components/consoles";

export default function WarRoom() {
  useEffect(() => { connectHub(); }, []);
  const canReveal = useMJ((s) => !!(s.view.reveal || s.view.exfil));
  const hasContinuity = useHasContinuity();
  const [sel, setSel] = useState<{ id: string; hospital: string | null } | null>(null);
  const focus = sel?.hospital ?? null;
  const [replay, setReplay] = useState(0);

  const onSelect = useCallback((ev: MJEvent) => {
    setSel((cur) => (cur?.id === ev.id ? null : { id: ev.id, hospital: ev.hospital_id }));
  }, []);

  const ep = WORLD.entry_point;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-fg lg:h-dvh lg:overflow-hidden">
      <WarRoomSound />
      <SiteHeader
        active="/war-room"
        right={<>
          <RunBadge />
          <StreamStatus />
          <span className="hidden h-5 w-px bg-border sm:block" />
          <Button size="sm" disabled={!canReveal} onClick={() => { playRevealCue(); setReplay((n) => n + 1); }}>
            Reveal
          </Button>
          <SoundButton />
        </>}
      />

      <main className="mx-auto flex w-full max-w-[1400px] min-h-0 flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-6">
          <section className="flex min-h-0 flex-col">
            <ColumnHeading
              title="What the attacker sees"
              description={`An AI agent using a phished login for ${ep.username}, ${ep.role} at ${hospitalName(ep.hospital_id)}.`}
            />
            <AttackerTerminal className="h-[480px] lg:h-auto lg:flex-1" />
          </section>
          <section className="flex min-h-0 flex-col">
            <ColumnHeading
              title="What actually happened"
              description="Ground truth from the gateway, the shadow tier and the canary ledger."
            />
            <DefenderPanel className="lg:flex-1" />
          </section>
        </div>

        <div className="grid shrink-0 grid-cols-1 gap-5 lg:h-[clamp(172px,23vh,240px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-6">
          <Card
            title="City network"
            className="h-[240px] lg:h-auto"
            bodyClassName="relative p-0"
            action={focus
              ? <button type="button" onClick={() => setSel(null)} className="text-xs text-fg-muted hover:text-fg">
                  {hospitalName(focus)} · Clear
                </button>
              : <span className="text-xs text-fg-subtle">{WORLD.hospitals.length} hospitals</span>}
          >
            <div className="absolute inset-0">
              <NetworkMap focusHospital={focus} variant="full" />
            </div>
          </Card>
          <div className={cn("grid min-h-0 grid-cols-1 gap-5 lg:gap-4",
            hasContinuity && "sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]")}>
            <EventTimeline className="h-[260px] lg:h-auto" selected={sel?.id ?? null} onSelect={onSelect} />
            {hasContinuity && <ContinuityHUD className="lg:h-auto" />}
          </div>
        </div>
      </main>

      <TheReveal replayKey={replay} />
    </div>
  );
}
