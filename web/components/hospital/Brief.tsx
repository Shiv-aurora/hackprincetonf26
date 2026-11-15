"use client";
// Incident brief: what the hub's analyst (GET /analyst/brief) says about a run, readable at a glance.
//   BriefPanel — pure presentational: four fact blocks (who, how we noticed, what they took, what real left)
//                and the response playbook, one line per step (the reason shows on expand).
//   LiveBrief  — the live-view wrapper: fetches the brief when the run ends, or on "Load brief".
// The brief is rule-based unless `source` says a model added analysis; the badge says which.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { MJEvent } from "@/lib/contracts";
import { HUB_HTTP_URL } from "@/lib/contracts";
import { useMJ, useMJEvent } from "@/lib/events";
import { Badge, Button, cn } from "@/components/ui";

/* ------------------------------------------------------------------ types */

export interface BriefStep { when: string; who: string; do: string; why?: string }

export interface BriefFacts {
  attacker_seen?: boolean;
  session?: string;
  stolen_login?: { user?: string; role?: string; hospital?: string } | null;
  client?: { addresses?: string[]; software?: string | null; mean_gap_s?: number | null; gap_variation?: number | null } | null;
  detected?: { after_s?: number | null; by?: string | null } | null;
  diverted?: { after_s?: number | null; reason?: string | null } | null;
  requests?: { total?: number; real?: number; decoy?: number; refused?: number; real_data_served?: number } | null;
  techniques?: { id: string; name: string }[];
  trackers_taken?: { id: string; kind: string; where?: string }[];
  believes_stolen?: { records?: number | null; what?: string | null }[];
  claims_success?: boolean;
  likely_goal?: { goal?: string; confidence?: number } | null;
  real_secrets_leaked?: number;
  trail?: string[];
}

export interface BriefAnalyst {
  summary?: string;
  actor_type?: string;
  actor_reasoning?: string;
  likely_goal?: string;
  next_moves?: string[];
  priority_steps?: BriefStep[];
  caveats?: string[];
}

export interface Brief {
  run_id: string;
  source: string; // "rules" | "rules + <model>"
  facts: BriefFacts;
  actor_guess?: { type?: string; why?: string } | null;
  playbook?: BriefStep[];
  analyst?: BriefAnalyst | null;
  analyst_error?: string | null;
}

/* ------------------------------------------------------------------ helpers */

const nf = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** First clause: up to the first ":" and without a trailing parenthetical or full stop. */
const firstClause = (s: string) => s.split(":")[0].replace(/\s*\([^)]*\)\s*$/, "").replace(/\.\s*$/, "").trim();

const ACTOR: Record<string, string> = {
  script: "A script", ai_agent: "An AI agent", person: "A person", unclear: "Unclear",
};

function secs(s: number) {
  return s < 0.05 ? "at login" : `after ${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

interface Fact { label: string; value: string; sub?: string; title?: string; tone?: "danger" | "shadow" }

function factsOf(b: Brief): Fact[] {
  const f = b.facts ?? {};
  const req = f.requests ?? {};

  const actorType = b.analyst?.actor_type ?? b.actor_guess?.type;
  const why = b.actor_guess?.why ?? b.analyst?.actor_reasoning ?? "";
  const login = f.stolen_login?.user ? `${f.stolen_login.user}${f.stolen_login.role ? ` (${f.stolen_login.role})` : ""}` : "";
  const who: Fact = {
    label: "Who",
    value: actorType ? (ACTOR[actorType] ?? cap(actorType.replace(/_/g, " "))) : "Unknown",
    sub: why ? cap(firstClause(why)) : login ? `Using ${login}` : undefined,
    title: [why && cap(why), login && `Stolen login: ${login}`].filter(Boolean).join("\n") || undefined,
  };

  const by = f.detected?.by ?? "";
  const at = f.detected?.after_s;
  const div = f.diverted?.after_s;
  let noticed: Fact;
  if (by) {
    const clause = cap(firstClause(by));
    const when = at != null && !(at < 0.05 && /at login/i.test(clause)) ? cap(secs(at)) : null;
    const diverted = div != null ? `decoy ${secs(div)}` : (req.decoy ?? 0) > 0 ? null : "not diverted";
    noticed = {
      label: "How we noticed", value: clause, title: by,
      sub: cap([when, diverted].filter(Boolean).join(" · ")) || undefined,
    };
  } else {
    noticed = { label: "How we noticed", value: "Not detected", sub: "No alert during the run" };
  }

  const records = (f.believes_stolen ?? []).reduce((n, x) => n + (x.records ?? 0), 0);
  const trackers = f.trackers_taken?.length ?? 0;
  const fake = (req.decoy ?? 0) > 0;
  const took: Fact = {
    label: "What they took",
    value: records > 0 ? `${nf(records)} ${fake ? "fake " : ""}records` : "Nothing",
    sub: trackers > 0 ? `${plural(trackers, "tracker")} with them` : records > 0 ? "No trackers" : undefined,
    title: (f.believes_stolen ?? []).map((x) => `${nf(x.records ?? 0)} · ${x.what ?? ""}`).join("\n") || undefined,
    tone: fake && records > 0 ? "shadow" : undefined,
  };

  const realServed = req.real_data_served ?? 0;
  const secrets = f.real_secrets_leaked ?? 0;
  const left: Fact = {
    label: "What real left",
    value: `${plural(realServed, "real read")} · ${plural(secrets, "secret")}`,
    sub: req.total != null
      ? `${plural(req.total, "request")}: ${nf(req.real ?? 0)} real, ${nf(req.decoy ?? 0)} decoy, ${nf(req.refused ?? 0)} refused`
      : undefined,
    title: "Attacker requests that returned real patient data, and protected secrets that left the hospital.",
    tone: realServed > 0 || secrets > 0 ? "danger" : undefined,
  };

  return [who, noticed, took, left];
}

/* ------------------------------------------------------------------ panel */

const VISIBLE_STEPS = 4;

export function BriefPanel({ brief, className }: { brief: Brief; className?: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const seen = brief.facts?.attacker_seen !== false;
  const rulesOnly = !brief.source || brief.source === "rules";
  const steps = brief.playbook ?? [];
  const shown = all ? steps : steps.slice(0, VISIBLE_STEPS);

  return (
    <section className={cn("rounded-lg border border-border bg-background", className)} aria-label="Incident brief">
      <header className="flex h-10 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-[13px] font-medium text-fg">Incident brief</h3>
          <span className="truncate font-mono text-[11px] text-fg-subtle">{brief.run_id}</span>
        </div>
        <Badge className="h-5 shrink-0 px-2 text-[11px]">{rulesOnly ? "Rule-based brief" : "Rules + Claude analysis"}</Badge>
      </header>

      {!seen ? (
        <p className="px-4 py-5 text-[13px] text-fg-muted">No attacker activity in this run.</p>
      ) : (
        <>
          {brief.analyst?.summary && (
            <p className="line-clamp-2 border-b border-border px-4 py-3 text-[13px] text-fg" title={brief.analyst.summary}>
              {brief.analyst.summary}
            </p>
          )}

          <dl className="grid grid-cols-2 border-b border-border lg:grid-cols-4">
            {factsOf(brief).map((f, i) => (
              <div key={f.label} title={f.title}
                className={cn("flex min-w-0 flex-col gap-1 px-4 py-3",
                  i % 2 === 1 && "border-l border-border",
                  i >= 2 && "border-t border-border lg:border-t-0",
                  i === 2 && "lg:border-l")}>
                <dt className="text-xs text-fg-muted">{f.label}</dt>
                <dd className={cn("truncate text-[15px] font-medium tracking-[-0.01em] tabular-nums",
                  f.tone === "danger" ? "text-danger" : f.tone === "shadow" ? "text-shadow" : "text-fg")}>
                  {f.value}
                </dd>
                {f.sub && <dd className="truncate text-xs text-fg-subtle tabular-nums">{f.sub}</dd>}
              </div>
            ))}
          </dl>

          {steps.length > 0 ? (
            <div className="px-2 py-2">
              <ol className="flex flex-col">
                {shown.map((s, i) => {
                  const expanded = open === i;
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => setOpen(expanded ? null : i)} aria-expanded={expanded}
                        title={s.why ? `${s.do}\n\nWhy: ${s.why}` : s.do}
                        className="group flex w-full min-w-0 items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">
                        <span className="w-4 shrink-0 text-right text-xs text-fg-subtle tabular-nums">{i + 1}</span>
                        <span className="w-[92px] shrink-0 truncate text-xs text-fg-subtle">{s.when}</span>
                        <span className="w-[120px] shrink-0 truncate text-fg-muted max-sm:hidden">{cap(s.who)}</span>
                        <span className={cn("min-w-0 flex-1 text-fg", !expanded && "truncate")}>{s.do}</span>
                        {s.why && (
                          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 self-center text-fg-subtle transition-transform duration-150",
                            expanded && "rotate-90")} />
                        )}
                      </button>
                      {expanded && s.why && (
                        <p className="pt-0.5 pb-2 pr-2 pl-[calc(0.5rem+1rem+0.75rem+92px+0.75rem)] text-xs text-fg-muted max-sm:pl-10">
                          <span className="sm:hidden">{cap(s.who)} · </span>{s.why}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
              {steps.length > VISIBLE_STEPS && (
                <button type="button" onClick={() => { setAll((v) => !v); setOpen(null); }}
                  className="mt-0.5 ml-2 h-7 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
                  {all ? "Show fewer" : `Show ${steps.length - VISIBLE_STEPS} more`}
                </button>
              )}
            </div>
          ) : (
            <p className="px-4 py-3 text-[13px] text-fg-muted">No response steps.</p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ live wrapper */

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; brief: Brief }
  | { kind: "error"; message: string };

/** Live view: fetch the hub brief when the run ends (or on demand). Quiet until there is something to show. */
export function LiveBrief({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const runId = useMJ((s) => s.view.runId);
  const ended = useMJ((s) => !!s.view.ended);
  const [state, setState] = useState<State>({ kind: "idle" });
  const req = useRef(0);

  const load = useCallback(async (rid?: string | null) => {
    const n = ++req.current;
    setState({ kind: "loading" });
    try {
      const q = rid ? `?run_id=${encodeURIComponent(rid)}` : "";
      const r = await fetch(`${HUB_HTTP_URL}/analyst/brief${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "No run on the hub yet." : `Hub said ${r.status}.`);
      const b = (await r.json()) as Brief;
      if (n === req.current) setState({ kind: "ready", brief: b });
    } catch (e) {
      if (n !== req.current) return;
      setState({ kind: "error", message: e instanceof Error && e.message.endsWith(".") ? e.message : "Could not reach the hub." });
    }
  }, []);

  const onEvent = useCallback((ev: MJEvent) => {
    if (ev.type === "run.started") { req.current++; setState({ kind: "idle" }); }
    // Small delay so the hub has stored the run's final events before it writes the brief.
    if (ev.type === "run.ended") setTimeout(() => load(ev.run_id), 400);
  }, [load]);
  useMJEvent(onEvent);

  // Mounted after the run already ended (page opened late): fetch once.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ended && runId && fetchedFor.current !== runId) { fetchedFor.current = runId; load(runId); }
  }, [ended, runId, load]);

  if (state.kind === "ready") {
    return (
      <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}>
        <BriefPanel brief={state.brief} />
        <div className="mt-1.5 flex justify-end">
          <button type="button" onClick={() => load(runId)}
            className="h-7 rounded-md px-2 text-xs text-fg-subtle hover:bg-surface-2 hover:text-fg">Refresh brief</button>
        </div>
      </motion.div>
    );
  }

  return (
    <section aria-label="Incident brief"
      className={cn("flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-2", className)}>
      <div className="flex min-w-0 items-baseline gap-3">
        <h3 className="text-[13px] font-medium text-fg">Incident brief</h3>
        <span className={cn("truncate text-xs", state.kind === "error" ? "text-alert" : "text-fg-subtle")} aria-live="polite">
          {state.kind === "loading" ? "Writing the brief…"
            : state.kind === "error" ? state.message
            : runId && !ended ? "Appears when the run ends." : "Facts and response steps for the last run."}
        </span>
      </div>
      <Button size="sm" onClick={() => load(runId)} disabled={state.kind === "loading"}>
        {state.kind === "error" ? "Try again" : "Load brief"}
      </Button>
    </section>
  );
}
