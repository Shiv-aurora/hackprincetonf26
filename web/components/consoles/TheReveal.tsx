"use client";
// THE REVEAL. A full-screen sheet in plain typography: the agent's claim, the table it "stole", then a quiet
// strike-through and the truth. Typography and timing do the drama.
//
//   <TheReveal />                    opens on a fresh live `reveal` event; closes on Esc / click / new run
//   <TheReveal replayKey={n} />      bump n to open (or replay) it by hand

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { EventDataMap, MJEvent } from "@/lib/contracts";
import { useMJ, useMJEvent } from "@/lib/events";
import { Button, Kbd, cn } from "@/components/ui";
import { RunBadge, formatBytes, hospitalName, shortSession } from "./ui";

export interface TheRevealProps {
  /** Open automatically on a fresh live `reveal` event (default true). */
  auto?: boolean;
  /** Change this value to open the sheet (or replay it) on demand. */
  replayKey?: number;
  /** Ignore `reveal` events older than this — the hub sends a backlog on connect. Default 8 s. */
  freshMs?: number;
  onOpenChange?: (open: boolean) => void;
}

export function TheReveal({ auto = true, replayKey, freshMs = 8000, onOpenChange }: TheRevealProps) {
  const [state, setState] = useState({ open: false, key: 0 });
  const openCb = useRef(onOpenChange);
  useEffect(() => { openCb.current = onOpenChange; });
  useEffect(() => { openCb.current?.(state.open); }, [state.open]);

  const show = useCallback(() => setState((s) => ({ open: true, key: s.key + 1 })), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  const onEvent = useCallback((ev: MJEvent) => {
    if (ev.type === "run.started") close();
    if (auto && ev.type === "reveal" && Math.abs(Date.now() - ev.ts) <= freshMs) show();
  }, [auto, freshMs, show, close]);
  useMJEvent(onEvent);

  const lastReplay = useRef(replayKey);
  useEffect(() => {
    if (replayKey === lastReplay.current) return;
    lastReplay.current = replayKey;
    show();
  }, [replayKey, show]);

  if (!state.open) return null;
  return <RevealSheet key={state.key} onClose={close} onReplay={show} />;
}

// ------------------------------------------------------------------ sheet

type Phase = "claim" | "struck" | "numbers";
const T_STRIKE = 1600;
const STAGGER = 110;

interface Snapshot {
  exfil: EventDataMap["exfil"] | null;
  claim: string | null;
  reveal: EventDataMap["reveal"] | null;
  canary: { leaked: number; total: number };
  touched: number;
  minted: number;
  label: string;
  session: string;
}

function takeSnapshot(): Snapshot {
  const { view, events } = useMJ.getState();
  let sess: string | null = null;
  for (let i = events.length - 1; i >= 0 && !sess; i--) {
    if (events[i].actor === "attacker" && events[i].session_id) sess = events[i].session_id;
  }
  return {
    exfil: view.exfil,
    claim: view.claim,
    reveal: view.reveal,
    canary: view.canary,
    touched: view.reveal?.honeytokens_touched ?? new Set(view.honeytokensTouched.map((t) => t.token_id)).size,
    minted: view.honeytokensMinted.length,
    label: view.run?.attacker_label ?? "the attacker",
    session: view.reveal?.shadow_session ?? shortSession(sess),
  };
}

function RevealSheet({ onClose, onReplay }: { onClose: () => void; onReplay: () => void }) {
  const [snap] = useState(takeSnapshot);
  const [phase, setPhase] = useState<Phase>("claim");
  const [entered, setEntered] = useState(false);
  const rows = snap.exfil?.sample ?? [];

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const a = setTimeout(() => setPhase("struck"), T_STRIKE);
    const b = setTimeout(() => setPhase("numbers"), T_STRIKE + rows.length * STAGGER + 700);
    return () => { cancelAnimationFrame(raf); clearTimeout(a); clearTimeout(b); };
  }, [rows.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const struck = phase !== "claim";
  const leaked = snap.canary.leaked > 0;
  const realBytes = snap.reveal?.real_bytes;
  const faked = snap.reveal?.records_faked ?? snap.exfil?.records ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The Reveal"
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-50 overflow-y-auto bg-background transition-opacity duration-300 ease-out motion-reduce:transition-none",
        entered ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="mx-auto flex min-h-full max-w-[960px] flex-col px-6 py-8 sm:px-10 lg:py-10">
        {/* top row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-fg">The Reveal</span>
            <RunBadge />
          </div>
          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={onReplay}>Replay</Button>
            <Button size="sm" onClick={onClose}>Close <Kbd>Esc</Kbd></Button>
          </div>
        </div>

        {/* the claim */}
        <figure className="mt-10 lg:mt-12">
          <blockquote className={cn(
            "text-[26px] leading-[1.25] font-medium tracking-[-0.02em] text-balance transition-colors duration-700 sm:text-[32px]",
            struck ? "text-fg-subtle" : "text-fg",
          )}>
            “{snap.claim ?? "Exfiltration complete."}”
          </blockquote>
          <figcaption className="mt-3 text-[13px] text-fg-muted">
            {snap.label}, the attacking agent
            {snap.exfil && <> · {snap.exfil.records.toLocaleString("en-US")} records · {formatBytes(snap.exfil.bytes)}</>}
          </figcaption>
        </figure>

        {/* the copy that changes */}
        <div className="mt-8 grid">
          <p className={cn("col-start-1 row-start-1 self-end text-[15px] text-fg-muted transition-opacity duration-300",
            struck ? "opacity-0" : "opacity-100")}>
            {rows.length > 0 ? `A sample of what it took:` : "It did not keep a sample."}
          </p>
          <div className={cn("col-start-1 row-start-1 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
            struck ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")}>
            {leaked ? (
              <>
                <p className="text-[36px] leading-tight font-semibold tracking-[-0.03em] text-danger sm:text-[44px]">
                  {snap.canary.leaked} protected {snap.canary.leaked === 1 ? "record" : "records"} leaked.
                </p>
                <p className="mt-2 text-lg text-fg-muted">Some of this data came from the real hospital.</p>
              </>
            ) : (
              <>
                <p className="text-[36px] leading-tight font-semibold tracking-[-0.03em] text-fg sm:text-[44px]">
                  None of these people exist.
                </p>
                <p className="mt-2 text-lg text-fg-muted">
                  Generated for shadow session <span className="font-mono text-shadow">{snap.session || "—"}</span>.
                  {realBytes !== undefined && <> {realBytes.toLocaleString("en-US")} bytes came from the real hospital.</>}
                </p>
              </>
            )}
          </div>
        </div>

        {/* the table */}
        {rows.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <div className="min-w-[640px] text-[14px]">
              <div className="grid grid-cols-[120px_minmax(0,1.1fr)_110px_minmax(0,1fr)_minmax(0,1.4fr)] gap-4 border-b border-border pb-2 text-[13px] text-fg-muted">
                <span>MRN</span><span>Name</span><span>DOB</span><span>Hospital</span><span>Detail</span>
              </div>
              {rows.map((r, i) => (
                <div key={r.mrn + i} className="relative border-b border-border">
                  <div
                    className={cn("grid grid-cols-[120px_minmax(0,1.1fr)_110px_minmax(0,1fr)_minmax(0,1.4fr)] gap-4 py-2.5 transition-opacity duration-500 motion-reduce:transition-none",
                      struck ? "opacity-35" : "opacity-100")}
                    style={{ transitionDelay: struck ? `${i * STAGGER + 250}ms` : "0ms" }}
                  >
                    <span className="font-mono text-[13px] text-fg">{r.mrn}</span>
                    <span className="truncate text-fg">{r.name}</span>
                    <span className="font-mono text-[13px] tabular-nums text-fg">{r.dob}</span>
                    <span className="truncate text-fg-muted">{hospitalName(r.hospital_id)}</span>
                    <span className="truncate text-fg-muted">{r.detail}</span>
                  </div>
                  <span
                    aria-hidden
                    className={cn("pointer-events-none absolute top-1/2 right-0 left-0 h-px origin-left bg-fg transition-transform duration-500 ease-out motion-reduce:transition-none",
                      struck ? "scale-x-100" : "scale-x-0")}
                    style={{ transitionDelay: struck ? `${i * STAGGER}ms` : "0ms" }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* the numbers */}
        <div className={cn(
          "mt-8 grid grid-cols-1 gap-8 border-t border-border pt-6 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none sm:grid-cols-3",
          phase === "numbers" ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        )}>
          <Big label="Records faked" value={faked.toLocaleString("en-US")} />
          <Big label="Protected records leaked" value={<>{snap.canary.leaked}<span className="text-fg-subtle"> / {snap.canary.total}</span></>}
            danger={leaked} />
          <Big label="Honeytokens touched" value={<>{snap.touched}{snap.minted > 0 && <span className="text-fg-subtle"> / {snap.minted}</span>}</>} />
        </div>

        <p className="mt-auto pt-8 text-center text-xs text-fg-subtle">Press <Kbd>Esc</Kbd> or click anywhere to close</p>
      </div>
    </div>
  );
}

function Big({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-fg-muted">{label}</span>
      <span className={cn("text-5xl font-semibold tracking-[-0.04em] tabular-nums", danger ? "text-danger" : "text-fg")}>{value}</span>
    </div>
  );
}
