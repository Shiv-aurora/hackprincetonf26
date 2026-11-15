"use client";
// The War Room layout, shared by /war-room (live hub stream) and /demo (guided tour over a recorded run).
// Main stage: the explainer film's world driven by the events (film/LiveFilm). Right: what just happened.
// Below: who the attacker is and the headline numbers. Reads only the shared store; the caller decides where
// events come from.
//
// `data-demo` attributes name the panels the guided tour spotlights:
//   attacker · defender (headline · intel · decisions inside it) · map · timeline · continuity

import { useCallback, useState, type ReactNode } from "react";
import type { MJEvent } from "@/lib/contracts";
import { WORLD } from "@/lib/contracts";
import { Card, FloatingNav, cn } from "@/components/ui";
import { NetworkMap } from "@/components/map";
import { HospitalNumbers, TwoHospitals } from "@/components/hospital/HospitalView";
import { LearnedPanel, SwitchView } from "@/components/hospital/Live";
import { FlashStyles, LogPanel } from "@/components/hospital/Log";
import { LiveFilm } from "./film/LiveFilm";
import { AttackControls } from "@/components/hospital/AttackControls";
import { FingerprintPanel } from "@/components/hospital/Fingerprint";
import { LiveBrief } from "@/components/hospital/Brief";
import {
  AttackerTerminal, ColumnHeading, ContinuityHUD, DefenderPanel, EventTimeline,
  TheReveal, WarRoomSound, hospitalName, useHasContinuity,
} from "@/components/consoles";

export interface DashboardProps {
  /** "live": site header, sound, Reveal button. "demo": no chrome, room left for the tour's pills. */
  mode?: "live" | "demo";
  /** Demo only: show the Reveal sheet (mounted open while true). */
  revealOpen?: boolean;
}

export function Dashboard({ mode = "live", revealOpen = false }: DashboardProps) {
  const demo = mode === "demo";
  const hasContinuity = useHasContinuity();
  const [sel, setSel] = useState<{ id: string; hospital: string | null } | null>(null);
  const focus = sel?.hospital ?? null;

  const onSelect = useCallback((ev: MJEvent) => {
    setSel((cur) => (cur?.id === ev.id ? null : { id: ev.id, hospital: ev.hospital_id }));
  }, []);

  const ep = WORLD.entry_point;

  return (
    <div className={cn("flex min-h-dvh flex-col bg-background text-fg", demo && "h-dvh overflow-hidden")}>
      {!demo && <WarRoomSound />}
      <FlashStyles />
      {!demo && <FloatingNav cta={<AttackControls compact />} />}

      <DemoFrame demo={demo}>
      <main className={cn("mx-auto flex w-full max-w-[1840px] flex-col gap-4 px-4 sm:px-6", demo ? "min-h-0 flex-1" : "pt-20 pb-5")}>
        {/* The stage takes everything the log column doesn't; in live view it fills the first screen above
            the two rows below it. */}
        <div className={cn("grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_clamp(420px,30vw,560px)]",
          demo ? "flex-1" : "lg:h-[max(460px,calc(100dvh-410px))]")}>
          <section data-demo="scene" className="relative h-[min(64vh,560px)] overflow-hidden rounded-xl border border-border bg-background lg:h-auto lg:min-h-0">
            <LiveFilm />
          </section>
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
            <LogPanel className="min-h-[320px] lg:min-h-0" />
            <LearnedPanel />
          </div>
        </div>
        <FingerprintPanel />
        <HospitalNumbers />
        {!demo && <LiveBrief />}

        {!demo && (
          <details className="group mt-6">
            <summary className="flex h-9 w-fit cursor-pointer list-none items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
              <span className="transition-transform duration-150 group-open:rotate-90">›</span> More detail: request routing, floor plans, raw requests, gateway log
            </summary>
            <div className="mt-4 flex flex-col gap-5">
            <SwitchView className="lg:h-[460px]" />
            <TwoHospitals className="lg:h-[440px]" />
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-6">
              <section data-demo="attacker" className="flex min-h-0 flex-col">
                <ColumnHeading
                  title="What the attacker sees"
                  description={`Someone using a phished login for ${ep.username}, ${ep.role} at ${hospitalName(ep.hospital_id)}.`}
                />
                <AttackerTerminal className="h-[520px]" />
              </section>
              <section data-demo="defender" className="flex min-h-0 flex-col">
                <ColumnHeading
                  title="What actually happened"
                  description="Ground truth from the gateway, the shadow tier and the canary ledger."
                />
                <DefenderPanel className="lg:h-[520px]" />
              </section>
            </div>
            <div className={cn("grid grid-cols-1 gap-5 lg:gap-6",
              hasContinuity ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
              <Slot name="map" className="h-[260px]">
                <Card
                  title="City network"
                  className="h-full"
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
              </Slot>
              <Slot name="timeline" className="h-[260px]">
                <EventTimeline className="h-full" selected={sel?.id ?? null} onSelect={onSelect} />
              </Slot>
              {hasContinuity && (
                <Slot name="continuity" className="h-[260px]">
                  <ContinuityHUD className="h-full" />
                </Slot>
              )}
            </div>
            </div>
          </details>
        )}
      </main>
      </DemoFrame>

      {demo
        ? revealOpen && <div className="mj-demo-reveal"><TheReveal auto={false} defaultOpen /></div>
        : <TheReveal />}
    </div>
  );
}

/** Demo: leave room for the caption (top) and controls (bottom) pills, and on short screens (projectors)
 *  scale the dashboard down a step so every panel still fits without clipping. */
const ZOOM_CSS = `
@media (min-width: 1024px) and (max-height: 880px) { .mj-demo-zoom { zoom: 0.92 } }
@media (min-width: 1024px) and (max-height: 800px) { .mj-demo-zoom { zoom: 0.86 } }
@media (min-width: 1024px) and (max-height: 760px) { .mj-demo-zoom { zoom: 0.8 } }
@media (min-width: 1024px) and (max-height: 700px) { .mj-demo-zoom { zoom: 0.74 } }
@media (max-height: 880px) { .mj-demo-reveal { zoom: 0.9 } }
@media (max-height: 800px) { .mj-demo-reveal { zoom: 0.82 } }
@media (max-height: 760px) { .mj-demo-reveal { zoom: 0.76 } }
@media (max-height: 700px) { .mj-demo-reveal { zoom: 0.7 } }`;

function DemoFrame({ demo, children }: { demo: boolean; children: ReactNode }) {
  if (!demo) return <>{children}</>;
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-[112px] pb-[72px]">
      <style>{ZOOM_CSS}</style>
      <div className="mj-demo-zoom flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function Slot({ name, className, children }: { name: string; className?: string; children: ReactNode }) {
  return <div data-demo={name} className={cn("flex min-h-0 flex-col [&>*]:min-h-0 [&>*]:flex-1", className)}>{children}</div>;
}
