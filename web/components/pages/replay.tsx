"use client";
// /replay — pick a recorded run and scrub through it. The store is re-folded from an event prefix,
// so every component reading useMJ (including the NetworkMap) re-renders exactly as it was then.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import type { MJEvent } from "@/lib/contracts";
import { disconnectHub, useMJ } from "@/lib/events";
import { Button, Card, Stat, cn } from "@/components/ui";
import { NetworkMap } from "@/components/map";
import {
  LeakCell, Notice, PageShell, RunKindBadge, clock, configTitle, hub, hubMessage, missionTitle,
} from "./shared";
import type { RunListItem } from "./types";

const SPEEDS = [1, 2, 4] as const;
const TICKS: Partial<Record<MJEvent["type"], { label: string; cls: string }>> = {
  "session.diverted": { label: "Divert", cls: "bg-shadow" },
  "honeytoken.touched": { label: "Honeytoken", cls: "bg-shadow" },
  exfil: { label: "Exfil", cls: "bg-fg" },
  "agent.claim": { label: "Claim", cls: "bg-fg" },
  reveal: { label: "Reveal", cls: "bg-shadow" },
};

export function ReplayPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("run");

  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Replay owns the store while mounted: no live events mixed in.
  useEffect(() => {
    disconnectHub();
    useMJ.getState().reset();
    return () => { useMJ.getState().reset(); };
  }, []);

  const [listNonce, setListNonce] = useState(0);
  const loadRuns = useCallback(() => setListNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    void hub<RunListItem[]>("/runs").then((r) => {
      if (!alive) return;
      if (r.ok) { setRuns(r.data); setListError(null); }
      else { setRuns([]); setListError(hubMessage(r, "The run list")); }
    });
    return () => { alive = false; };
  }, [listNonce]);

  const select = useCallback((id: string) => {
    router.replace(`${pathname}?run=${encodeURIComponent(id)}`, { scroll: false });
  }, [router, pathname]);

  // Default to the newest run when nothing is in the URL.
  useEffect(() => {
    if (!selected && runs && runs.length) select((runs.find((r) => r.ended) ?? runs[0]).run_id);
  }, [selected, runs, select]);

  const current = runs?.find((r) => r.run_id === selected) ?? null;

  return (
    <PageShell active="/replay" title="Replay"
      lede="Pick any recorded run and scrub through it. The map, the transcript and the defender's numbers are rebuilt from the event log at each moment.">
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <RunList runs={runs} error={listError} selected={selected} onSelect={select} onRefresh={loadRuns} />
        <div className="min-w-0">
          {selected
            ? <Player key={selected} runId={selected} meta={current} />
            : <Card><p className="text-sm text-fg-muted">{runs === null ? "Loading runs…" : "No run selected."}</p></Card>}
        </div>
      </div>
    </PageShell>
  );
}

function outcomeText(r: RunListItem) {
  const o = r.ended?.outcome;
  if (!o) return "In progress";
  if (o.secrets_leaked > 0) return `${o.secrets_leaked} protected leaked`;
  if (o.mission_won) return "Mission won";
  if (o.believed_success) return "Believed success · 0 leaked";
  if (o.suspected_honeypot) return "Suspected honeypot";
  return "No success";
}

function RunList({ runs, error, selected, onSelect, onRefresh }: {
  runs: RunListItem[] | null; error: string | null; selected: string | null;
  onSelect: (id: string) => void; onRefresh: () => void;
}) {
  return (
    <Card title="Runs" bodyClassName="p-0" className="lg:sticky lg:top-20 lg:self-start"
      action={<button type="button" onClick={onRefresh} aria-label="Refresh runs"
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg">
        <RotateCw className="size-3.5" /></button>}>
      {error && <p className="p-4 text-sm text-fg-muted">{error}</p>}
      {runs === null && <p className="p-4 text-sm text-fg-muted">Loading…</p>}
      {runs && runs.length === 0 && !error && <p className="p-4 text-sm text-fg-muted">No runs recorded yet.</p>}
      <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
        {runs?.map((r) => (
          <li key={r.run_id}>
            <button type="button" onClick={() => onSelect(r.run_id)} aria-current={r.run_id === selected}
              className={cn("flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface",
                r.run_id === selected && "bg-surface-2 hover:bg-surface-2")}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg">{r.started?.attacker_label ?? r.run_id}</span>
                <RunKindBadge started={r.started} className="h-5 px-2 text-[11px]" />
              </span>
              <span className="truncate text-xs text-fg-muted">
                {r.started?.model ?? "unknown model"} · {configTitle(r.started?.config)} · {missionTitle(r.started?.mission)}
              </span>
              <span className="flex items-center justify-between gap-2 text-xs">
                <span className={(r.ended?.outcome.secrets_leaked ?? 0) > 0 ? "text-danger" : "text-fg-subtle"}>{outcomeText(r)}</span>
                {r.first_ts != null && (
                  <span className="shrink-0 tabular-nums text-fg-subtle">
                    {new Date(r.first_ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Number of events whose offset is <= t (offsets sorted ascending). */
function prefixLen(offsets: number[], t: number) {
  let lo = 0, hi = offsets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (offsets[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

function Player({ runId, meta }: { runId: string; meta: RunListItem | null }) {
  const [events, setEvents] = useState<MJEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  useEffect(() => {
    let alive = true;
    void hub<MJEvent[]>(`/runs/${encodeURIComponent(runId)}`).then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.status === 404 ? "This run isn't on the hub any more." : hubMessage(r, "Loading the run")); return; }
      const evs = [...r.data].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
      setEvents(evs);
      tRef.current = 0;
      setT(0);
      setPlaying(true);
    });
    return () => { alive = false; };
  }, [runId]);

  const t0 = events?.[0]?.ts ?? 0;
  const offsets = useMemo(() => (events ?? []).map((e) => e.ts - t0), [events, t0]);
  const duration = offsets.length ? offsets[offsets.length - 1] : 0;
  const idx = prefixLen(offsets, t);

  // Re-fold the shared store whenever the visible prefix changes.
  useEffect(() => {
    if (events) useMJ.getState().load(events.slice(0, idx));
  }, [events, idx]);

  // Playback clock (performance.now in an effect, never during render).
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => {
    if (!playing || !events) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = Math.min(duration, tRef.current + (now - last) * speedRef.current);
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= duration) setPlaying(false); else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, events, duration]);

  const seek = useCallback((v: number) => { tRef.current = v; setT(v); }, []);
  const toggle = useCallback(() => {
    if (!playing && tRef.current >= duration) seek(0);
    setPlaying((p) => !p);
  }, [playing, duration, seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.code !== "Space" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault(); toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const ticks = useMemo(() => (events ?? [])
    .map((e, i) => ({ e, off: offsets[i], spec: TICKS[e.type] }))
    .filter((x) => x.spec), [events, offsets]);

  if (error) return <Notice>{error}</Notice>;
  if (!events) return <Card><p className="text-sm text-fg-muted">Loading run…</p></Card>;

  const started = events.find((e) => e.type === "run.started");
  const startedData = started?.type === "run.started" ? started.data : meta?.started ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card bodyClassName="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold tracking-[-0.02em] text-fg">{startedData?.attacker_label ?? runId}</h2>
          <RunKindBadge started={startedData} />
          <span className="text-sm text-fg-muted">
            {startedData?.model ?? "unknown model"} · {configTitle(startedData?.config)} · {missionTitle(startedData?.mission)}
          </span>
          <span className="ml-auto font-mono text-xs text-fg-subtle">{runId}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" onClick={toggle} className="w-[88px]" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => seek(0)} aria-label="Restart">
            <RotateCcw className="size-3.5" /> Restart
          </Button>
          <div role="group" aria-label="Playback speed" className="flex h-8 items-center rounded-md border border-border p-0.5">
            {SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}
                className={cn("h-full rounded px-2.5 text-[13px] tabular-nums text-fg-muted transition-colors hover:text-fg",
                  speed === s && "bg-surface-2 text-fg")}>{s}×</button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[13px] tabular-nums text-fg-muted">
            {clock(t)} <span className="text-fg-subtle">/ {clock(duration)}</span>
          </span>
        </div>
        <div>
          <div className="relative">
            <input type="range" min={0} max={Math.max(duration, 1)} step={100} value={t}
              onChange={(e) => seek(Number(e.target.value))} aria-label="Scrub through the run"
              className="mj-scrub relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent"
              style={{ ["--p" as string]: `${duration ? (t / duration) * 100 : 0}%` }} />
            <div className="pointer-events-none absolute inset-x-0 top-[calc(50%+7px)] h-2">
              {ticks.map(({ e, off, spec }) => (
                <span key={e.id} title={`${spec!.label} · ${clock(off)}`}
                  className={cn("absolute top-0 h-2 w-[2px] -translate-x-1/2 rounded-full", spec!.cls, off > t && "opacity-40")}
                  style={{ left: `${duration ? (off / duration) * 100 : 0}%` }} />
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            {ticks.map(({ e, off, spec }) => (
              <button key={e.id} type="button" onClick={() => seek(off)}
                className={cn("inline-flex items-center gap-1.5 text-xs transition-colors hover:text-fg",
                  off <= t ? "text-fg-muted" : "text-fg-subtle")}>
                <span className={cn("h-2.5 w-[2px] rounded-full", spec!.cls)} />
                {spec!.label} <span className="font-mono tabular-nums">{clock(off)}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>
      <style>{SCRUB_CSS}</style>
      <div className="grid gap-4 xl:grid-cols-2">
        <Transcript t0={t0} />
        <DefenderNumbers />
      </div>
      <div className="h-[440px] min-w-0"><NetworkMap variant="full" /></div>
      <Outcome />
    </div>
  );
}

const SCRUB_CSS = `
.mj-scrub::-webkit-slider-runnable-track { height: 4px; border-radius: 9999px;
  background: linear-gradient(to right, var(--fg) var(--p), var(--border-strong) var(--p)); }
.mj-scrub::-moz-range-track { height: 4px; border-radius: 9999px; background: var(--border-strong); }
.mj-scrub::-moz-range-progress { height: 4px; border-radius: 9999px; background: var(--fg); }
.mj-scrub::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; margin-top: -6px; width: 16px; height: 16px;
  border-radius: 9999px; background: var(--background); border: 1.5px solid var(--fg); }
.mj-scrub::-moz-range-thumb { width: 14px; height: 14px; border-radius: 9999px; background: var(--background); border: 1.5px solid var(--fg); }
`;

function Transcript({ t0 }: { t0: number }) {
  const log = useMJ((s) => s.view.attackerLog);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <Card title="Attacker transcript" action={<span className="text-xs text-fg-subtle">What the agent saw and said</span>}
      bodyClassName="p-0">
      <div ref={ref} className="h-[440px] overflow-y-auto px-4 py-3">
        {log.length === 0 && <p className="text-sm text-fg-subtle">Nothing yet. Press play or drag the slider.</p>}
        <ol className="flex flex-col gap-3">
          {log.map((l) => (
            <li key={l.id} className="grid grid-cols-[40px_minmax(0,1fr)] gap-3">
              <span className="pt-px font-mono text-[11px] tabular-nums text-fg-subtle">{clock(l.ts - t0)}</span>
              {l.kind === "thought" && <p className="text-[13px] leading-relaxed text-fg-muted">{l.text}</p>}
              {l.kind === "tool_call" && <p className="break-words font-mono text-[12.5px] text-fg">{l.text}</p>}
              {l.kind === "tool_result" && (
                <p className="line-clamp-3 whitespace-pre-wrap break-all rounded-md bg-surface px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-fg-muted">{l.text}</p>
              )}
              {l.kind === "claim" && (
                <div className="rounded-md border border-border px-3 py-2">
                  <p className="text-xs text-fg-subtle">Claims success</p>
                  <p className="mt-0.5 text-[13px] font-medium leading-relaxed text-fg">{l.text}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

const GOALS = ["exfil", "recon", "tamper", "disrupt", "benign"] as const;

function DefenderNumbers() {
  const v = useMJ((s) => s.view);
  return (
    <Card title="Defender's numbers" action={<span className="text-xs text-fg-subtle">Ground truth</span>}>
      <div className="flex h-full flex-col gap-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Stat label="Protected leaked" value={<LeakCell leaked={v.canary.leaked} total={v.canary.total} />}
            tone={v.canary.leaked > 0 ? "danger" : "neutral"} />
          <Stat label="Session" value={v.diverted ? "Shadow" : "Real"} tone={v.diverted ? "shadow" : "neutral"}
            sub={v.diverted ? "Diverted to the shadow hospital" : "Not diverted"} />
          <Stat label="Honeytokens touched" value={v.honeytokensTouched.length}
            sub={`${v.honeytokensMinted.length} minted`} tone={v.honeytokensTouched.length ? "shadow" : "neutral"} />
          <Stat label="Real requests" value={v.counts.real} />
          <Stat label="Shadow requests" value={v.counts.shadow} tone={v.counts.shadow ? "shadow" : "neutral"} />
          <Stat label="Denied" value={v.counts.denied} />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] text-fg-muted">Intent estimate</span>
            <span className="text-xs text-fg-subtle">Stage: {v.stage}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {GOALS.map((g) => {
              const p = v.posterior[g] ?? 0;
              return (
                <li key={g} className="grid grid-cols-[64px_minmax(0,1fr)_40px] items-center gap-3 text-[13px]">
                  <span className={cn("capitalize", g === v.topGoal ? "text-fg" : "text-fg-muted")}>{g}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span className={cn("block h-full rounded-full transition-[width] duration-200", g === v.topGoal ? "bg-fg" : "bg-fg-subtle")}
                      style={{ width: `${Math.round(p * 100)}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-fg-muted">{Math.round(p * 100)}%</span>
                </li>
              );
            })}
          </ul>
          {v.intentEvidence && <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{v.intentEvidence}</p>}
        </div>
        {v.breadcrumbs.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] text-fg-muted">Breadcrumbs planted</p>
            <ul className="flex flex-col gap-1">
              {v.breadcrumbs.map((b, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="truncate font-mono text-shadow">{b.path}</span>
                  <span className="shrink-0 tabular-nums text-fg-subtle">{b.info_gain.toFixed(2)} bits</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Outcome() {
  const exfil = useMJ((s) => s.view.exfil);
  const reveal = useMJ((s) => s.view.reveal);
  const ended = useMJ((s) => s.view.ended);
  const leaked = useMJ((s) => s.view.canary.leaked);
  if (!exfil && !reveal && !ended) return null;
  return (
    <Card title="What happened">
      <div className="grid gap-6 sm:grid-cols-3">
        <Stat label="Attacker believes it took" value={exfil ? exfil.records.toLocaleString("en-US") : "—"}
          sub={exfil ? "records" : "No exfil yet"} />
        <Stat label="Real patient bytes it received" value={reveal ? reveal.real_bytes : "—"}
          sub={reveal ? `${reveal.records_faked.toLocaleString("en-US")} records faked in session ${reveal.shadow_session}` : "Not revealed yet"}
          tone={reveal ? "shadow" : "neutral"} />
        <Stat label="Protected records leaked" value={<LeakCell leaked={leaked} />} tone={leaked > 0 ? "danger" : "neutral"}
          sub="From the gateway's canary ledger" />
      </div>
      {ended && <p className="mt-5 border-t border-border pt-4 text-sm leading-relaxed text-fg-muted">{ended.summary}</p>}
    </Card>
  );
}