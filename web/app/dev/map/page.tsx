"use client";
// Dev preview for <NetworkMap />: full map on the live hub stream, focus picker, and compact variants.
import { useEffect, useState } from "react";
import { NetworkMap } from "@/components/map";
import { Badge, Button, Card, Dot, SiteHeader } from "@/components/ui";
import { WORLD, type MJEvent } from "@/lib/contracts";
import { connectHub, useMJ } from "@/lib/events";

// Local-only debug injection (never sent to the hub) to preview single beats on demand.
let fakeSeq = 1_000_000;
function inject(partial: Partial<MJEvent> & Pick<MJEvent, "type" | "data">) {
  const s = useMJ.getState();
  s.push({
    id: `dev-${fakeSeq}`, ts: Date.now(), run_id: s.view.runId ?? "dev", session_id: "sess-dev", seq: fakeSeq++,
    actor: "system", hospital_id: null, tier: "none", ...partial,
  } as MJEvent);
}
const req = (status: number) => ({ method: "GET", path: "/fhir/Patient", surface: "fhir" as const, status, bytes: 1, technique: null });
const BEATS: [string, () => void][] = [
  ["Real request", () => inject({ type: "request", actor: "attacker", hospital_id: "eas", tier: "real", data: req(200) })],
  ["Denied", () => inject({ type: "request", actor: "attacker", hospital_id: "eas", tier: "none", data: req(403) })],
  ["Clinician", () => inject({ type: "request", actor: "clinician", hospital_id: "aur", tier: "real", data: req(200) })],
  ["Divert", () => inject({ type: "session.diverted", actor: "defender", hospital_id: "eas", tier: "shadow",
    data: { from_tier: "real", to_tier: "shadow", reason: "dev" } })],
  ["Shadow request", () => inject({ type: "request", actor: "attacker", hospital_id: "eas", tier: "shadow", data: req(200) })],
  ["Reroute", () => inject({ type: "lab.order", hospital_id: "wes", data: { order_id: `DEV-${fakeSeq}`, urgency: "stat",
    test: "Lactate", from_hospital: "wes", to_hospital: "aur", status: "rerouted", eta_min: 23 } })],
  ["Reveal", () => inject({ type: "reveal", actor: "defender", hospital_id: "eas", tier: "shadow",
    data: { shadow_session: "dev", real_bytes: 0, records_faked: 2000, honeytokens_touched: 1 } })],
];

export default function MapPreview() {
  useEffect(() => { connectHub(); }, []);
  const connected = useMJ((s) => s.connected);
  const run = useMJ((s) => s.view.run);
  const diverted = useMJ((s) => s.view.diverted);
  const scripted = !!run && (!run.live || run.model === "scripted");
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <SiteHeader right={
        <span className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
          <Dot tone={connected ? "ok" : "neutral"} /> {connected ? "Connected" : "Connecting"}
        </span>
      } />
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">Network map</h1>
            <p className="mt-1 text-sm text-fg-muted">{WORLD.city} · {WORLD.hospitals.length} sites · {WORLD.links.length} links</p>
          </div>
          <div className="flex items-center gap-2">
            {scripted && <Badge>Scripted demo</Badge>}
            {diverted && <Badge tone="shadow">Session diverted</Badge>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-2 text-[13px] text-fg-muted">Focus</span>
          <Button size="sm" variant={focus === null ? "secondary" : "ghost"} onClick={() => setFocus(null)}>All</Button>
          {WORLD.hospitals.map((h) => (
            <Button key={h.id} size="sm" variant={focus === h.id ? "secondary" : "ghost"}
              onClick={() => setFocus(focus === h.id ? null : h.id)}>{h.short}</Button>
          ))}
        </div>

        <Card title="Meridian City" bodyClassName="p-0">
          <div className="aspect-[1000/620] w-full">
            <NetworkMap focusHospital={focus} />
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[13px] text-fg-muted">Simulate locally</span>
          {BEATS.map(([label, fn]) => <Button key={label} size="sm" onClick={fn}>{label}</Button>)}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[null, "eas", "lum"].map((f) => (
            <Card key={f ?? "all"} title={`Compact${f ? ` · ${f}` : ""}`} bodyClassName="p-2">
              <div className="h-40"><NetworkMap variant="compact" focusHospital={f} /></div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
