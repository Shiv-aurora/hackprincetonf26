"use client";
// Dev preview for the hero city: full-screen CityScene on the live hub stream + a tiny debug overlay.
import { useCallback, useEffect, useState } from "react";
import { CityScene } from "@/components/city";
import { WORLD, type MJEvent } from "@/lib/contracts";
import { connectHub, useMJ, useMJEvent } from "@/lib/events";

// Local-only debug injection (never sent to the hub): lets us preview single FX beats on demand.
let fakeSeq = 1_000_000;
function inject(partial: Partial<MJEvent> & Pick<MJEvent, "type" | "data">) {
  const s = useMJ.getState();
  const ev = {
    id: `dev-${fakeSeq}`, ts: Date.now(), run_id: s.view.runId ?? "dev", session_id: "dev", seq: fakeSeq++,
    actor: "system", hospital_id: null, tier: "none", ...partial,
  } as MJEvent;
  s.push(ev);
}
const FAKE: Record<string, () => void> = {
  "atk real": () => inject({ type: "request", actor: "attacker", hospital_id: "eas", tier: "real",
    data: { method: "GET", path: "/x", surface: "fhir", status: 200, bytes: 1, technique: null } }),
  "atk 403": () => inject({ type: "request", actor: "attacker", hospital_id: "eas", tier: "real",
    data: { method: "GET", path: "/x", surface: "portal", status: 403, bytes: 1, technique: null } }),
  "atk shadow": () => inject({ type: "request", actor: "attacker", hospital_id: "eas", tier: "shadow",
    data: { method: "GET", path: "/x", surface: "shell", status: 200, bytes: 1, technique: null } }),
  clin: () => inject({ type: "request", actor: "clinician", hospital_id: "aur", tier: "real",
    data: { method: "GET", path: "/x", surface: "fhir", status: 200, bytes: 1, technique: null } }),
  divert: () => inject({ type: "session.diverted", actor: "defender", hospital_id: "eas", tier: "shadow",
    data: { from_tier: "real", to_tier: "shadow", reason: "dev" } }),
  reveal: () => inject({ type: "reveal", actor: "defender", hospital_id: "eas", tier: "shadow",
    data: { shadow_session: "dev", real_bytes: 0, records_faked: 1000, honeytokens_touched: 3 } }),
  "lum comp": () => inject({ type: "node.status", hospital_id: "lum", data: { status: "compromised", reason: "dev" } }),
  "lum quar": () => inject({ type: "node.status", hospital_id: "lum", data: { status: "quarantined", reason: "dev" } }),
  "lum ok": () => inject({ type: "node.status", hospital_id: "lum", data: { status: "healthy", reason: "dev" } }),
  "lab wes→aur": () => inject({ type: "lab.order", hospital_id: "wes", data: {
    order_id: `o${fakeSeq}`, urgency: "stat", test: "CBC", from_hospital: "wes", to_hospital: "aur", status: "rerouted", eta_min: 30 } }),
  "lab riv→eas": () => inject({ type: "lab.order", hospital_id: "riv", data: {
    order_id: `o${fakeSeq}`, urgency: "urgent", test: "CBC", from_hospital: "riv", to_hospital: "eas", status: "rerouted", eta_min: 30 } }),
};

export default function CityDevPage() {
  const [last, setLast] = useState<string[]>([]);
  const [mode, setMode] = useState<"live" | "landing">("live");
  const [focus, setFocus] = useState<string | null>(null);
  const connected = useMJ((s) => s.connected);

  useEffect(() => {
    connectHub();
    (window as unknown as { __cityFx?: Record<string, () => void> }).__cityFx = FAKE;
  }, []);
  const onEvent = useCallback((ev: MJEvent) => {
    const tag = `${ev.type}${ev.hospital_id ? ` · ${ev.hospital_id}` : ""}${ev.tier !== "none" ? ` · ${ev.tier}` : ""}`;
    setLast((l) => [tag, ...l].slice(0, 6));
  }, []);
  useMJEvent(onEvent);

  return (
    <div className="fixed inset-0 bg-[#05070d]">
      <CityScene mode={mode} focusHospital={focus} />
      <div className="pointer-events-auto absolute left-3 top-3 z-50 w-72 rounded border border-white/10 bg-black/60 p-2 font-mono text-[10px] leading-4 text-cyan-100/80 backdrop-blur">
        <div className="mb-1 flex items-center justify-between">
          <span>city dev · hub {connected ? "connected" : "offline"}</span>
          <button className="rounded border border-white/20 px-1" onClick={() => setMode((m) => (m === "live" ? "landing" : "live"))}>
            {mode}
          </button>
        </div>
        <div className="mb-1 flex flex-wrap gap-1">
          <button className={`rounded border px-1 ${focus === null ? "border-cyan-300" : "border-white/20"}`} onClick={() => setFocus(null)}>auto</button>
          {WORLD.hospitals.map((h) => (
            <button key={h.id} className={`rounded border px-1 ${focus === h.id ? "border-cyan-300" : "border-white/20"}`} onClick={() => setFocus(h.id)}>
              {h.id}
            </button>
          ))}
        </div>
        <div className="mb-1 flex flex-wrap gap-1">
          {Object.entries(FAKE).map(([k, fn]) => (
            <button key={k} className="rounded border border-fuchsia-300/30 px-1 text-fuchsia-100/80" onClick={fn}>{k}</button>
          ))}
        </div>
        {last.map((l, i) => <div key={i} style={{ opacity: 1 - i * 0.14 }}>{l}</div>)}
      </div>
    </div>
  );
}
