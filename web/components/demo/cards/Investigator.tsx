"use client";
// Demo step "Our LangChain agent writes the case file" (replaces the Brief step; the tour passes the step
// headline as `title`). The Investigator, a LangChain deep agent (backend/mayajaal/investigator.py), shown left
// to right as one flow: the plan it wrote before delegating → the three sub-agents it sent off, each with a
// one-line finding → every tool call the lead agent made → the case file, with a download link. Sized to be
// read from the back of a room: big counts, 17–22px text, code font only for the tool calls themselves.
//
// Everything is read at runtime from the recorded investigation, web/public/runs/investigation-mayajaal.json
// (model, plan, findings, trace, summary, report). The one-line findings are pulled out of each sub-agent's
// own findings file (its words and its numbers); when a pattern isn't found, that line is simply left out.
// Choreography finishes by ~3.9 s, then holds.

import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Download } from "lucide-react";
import type { Investigation } from "@/components/langchain/Investigator";
import { cn } from "@/components/ui";
import { CardStage, EASE, Pending, useRunFile } from "./Stage";

const FILE = "/runs/investigation-mayajaal.json";
const CASE_FILE = "/runs/investigation-mayajaal.md";   // the same /report.md, written by investigator.main()

// ------------------------------------------------------------------ reading the agent's own files

const plain = (s: string) => s.replace(/\*\*|`/g, "").replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
const firstSentence = (s: string) => s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A sub-agent's id as a name: "timeline-analyst" → "Timeline analyst". */
const human = (id: string) => cap(id.replace(/[-_]+/g, " "));

/** Each plan item's topic, its own words up to the first comma, colon, semicolon or bracket:
 *  "1. What happened, stage by stage, with times …" → "What happened". The full plan is in the case file. */
function planItems(md: string): string[] {
  return md.split("\n")
    .map((l) => l.match(/^\s*\d+\.\s+(.+)$/)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => plain(x).split(/[,;:]\s|\s\(|\s—\s/)[0].replace(/[.:]$/, ""));
}

interface Finding { lead: ReactNode | null; detail: ReactNode | null }

function timelineFinding(md: string): Finding {
  const lines = md.split("\n");
  const stages: string[] = [];
  for (const l of lines) {
    const m = l.match(/^##\s+\d+\.\s+(.+?)(?:\s+\(.*)?$/);
    if (m) stages.push(m[1]);
  }
  const t = md.match(/(\d+)\s+requests\.\s*(\d+)\s+real,\s*(\d+)\s+shadow[^,]*,\s*(\d+)\s+refused/i);
  return {
    lead: stages.length ? <Chain stages={stages} /> : null,
    detail: t && <>{t[1]} requests: <span className="text-focus">{t[2]} real</span>, <span className="text-shadow">{t[3]} decoy</span>, {t[4]} refused</>,
  };
}

function indicatorFinding(md: string): Finding {
  const verdict = md.split("\n").find((l) => /script, ai agent or person/i.test(l));
  const rows = md.split("\n").filter((l) => /^\|/.test(l.trim())).slice(2).map((l) => l.split("|").map((c) => c.trim()));
  const trackers = rows.filter((c) => /^tracker/i.test(c[2] ?? ""));
  const unseen = trackers.filter((c) => /not seen/i.test(c[4] ?? ""));
  return {
    lead: verdict ? cap(firstSentence(plain(verdict).replace(/^[^:]*:\s*/, ""))) : null,
    detail: trackers.length && unseen.length === trackers.length
      ? <>The <span className="text-shadow">{trackers.length} trackers</span> it took appear in no other session</>
      : rows.length ? `${rows.length} indicators checked` : null,
  };
}

function responseFinding(md: string): Finding {
  const rule = md.split("\n").find((l) => /rules for every step/i.test(l));
  const groups: { when: string; n: number; owned: number }[] = [];
  for (const block of md.split(/^##\s+/m).slice(1)) {
    const [head, ...body] = block.split("\n");
    const steps = body.filter((l) => /^\d+\.\s/.test(l));
    if (steps.length) groups.push({
      when: head.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase(),
      n: steps.length,
      owned: steps.filter((l) => /owners?:/i.test(l)).length,
    });
  }
  const n = groups.reduce((a, g) => a + g.n, 0);
  const owned = groups.reduce((a, g) => a + g.owned, 0);
  return {
    lead: rule ? cap(firstSentence(plain(rule).replace(/^[^:]*:\s*/, ""))) : null,
    detail: n > 0 && <>
      <span className="block">{n} steps{owned === n && ", each with an owner:"}</span>
      <span className="block">
        {groups.map((g, i) => <span key={g.when}>{i > 0 && "\u00a0· "}<span className="whitespace-nowrap">{g.n} {g.when}</span></span>)}
      </span>
    </>,
  };
}

// The three sub-agents as defined in backend/mayajaal/investigator.py (SUBAGENTS), the findings file each one
// saves, and how to pull its one-line finding out of that file.
const AGENTS = [
  { name: "timeline-analyst", file: "/findings/timeline.md", read: timelineFinding },
  { name: "indicator-hunter", file: "/findings/indicators.md", read: indicatorFinding },
  { name: "response-planner", file: "/findings/response.md", read: responseFinding },
];

interface Call { tool: string; sub: string | null; arg: string | null }

/** The lead agent's calls. A task names the sub-agent it starts; other calls keep their first short argument
 *  (a path, an indicator) when the line has room for it. */
function calls(inv: Investigation): Call[] {
  return (inv.trace ?? []).map((t) => {
    const sub = t.tool === "task" ? (t.subagent ?? t.args?.subagent_type ?? null) : null;
    const raw = Object.entries(t.args ?? {}).find(([k]) => k !== "content" && k !== "description" && k !== "subagent_type")?.[1];
    const arg = raw?.split("\n")[0] ?? null;
    return { tool: t.tool, sub, arg: !sub && arg && t.tool.length + arg.length <= 22 ? arg : null };
  });
}

function caseFile(inv: Investigation) {
  const md = inv.report ?? "";
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? null;
  const sections = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].replace(/\s*\(.*\)\s*$/, ""));
  const summary = md.match(/^##\s+Summary\s*\n+([^\n]+)/m)?.[1]
    ?? (inv.summary ?? "").replace(/^\*\*Summary:\*\*\s*/, "").split("\n")[0];
  return { title, sections, summary: summary ? firstSentence(plain(summary)) : null };
}

const loadInvestigation = () =>
  fetch(FILE, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Investigation>) : null))
    .then((j) => (j?.available && j.trace?.length ? j : null));

// ------------------------------------------------------------------ card

/** When each column starts, seconds. */
const COL = [0.2, 0.9, 1.8, 2.8];
/** Most items each list can show on the canvas. */
const MAX = { plan: 5, calls: 12, sections: 8 };

export function InvestigatorCard({ title }: { title: string }) {
  const { data, failed } = useRunFile("investigation", loadInvestigation);
  const model = (data?.model ?? "").replace(/^anthropic:/, "");
  return (
    <CardStage title={title} kicker={`Recorded run · LangChain deep agent${model ? ` · ${model}` : ""}`}>
      {data ? <Flow inv={data} /> : <Pending failed={failed} what="investigation" />}
    </CardStage>
  );
}

function Flow({ inv }: { inv: Investigation }) {
  const reduce = useReducedMotion() ?? false;
  const tr = (delay: number, duration = 0.3) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  const rise = (delay: number, y = 10) => ({ initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, transition: tr(delay) });

  const view = useMemo(() => {
    const f = inv.findings ?? {};
    return {
      plan: planItems(inv.plan ?? ""),
      rule: (inv.plan ?? "").match(/^Rule:\s*(.+)$/m)?.[1] ?? null,
      agents: AGENTS.map(({ read, ...a }) => ({ ...a, ...(f[a.file] ? read(f[a.file]) : { lead: null, detail: null }) })),
      calls: calls(inv),
      report: caseFile(inv),
    };
  }, [inv]);
  const used = new Set(view.calls.map((c) => c.sub).filter(Boolean));
  // What fits the canvas; longer runs list the first ones and say how many more.
  const shownCalls = view.calls.length > MAX.calls ? view.calls.slice(0, MAX.calls - 1) : view.calls;
  const moreCalls = view.calls.length - shownCalls.length;
  const agents = view.agents.filter((a) => used.has(a.name));
  const sections = view.report.sections;
  const shownSections = sections.length > MAX.sections ? sections.slice(0, MAX.sections - 1) : sections;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[252px_24px_392px_24px_296px_24px_minmax(0,1fr)]">
      {/* 1 · plan */}
      <Column n={1} noun="plan" sub="written before it delegates" tr={tr(COL[0])}>
        <ol className="flex flex-col gap-3.5">
          {view.plan.slice(0, MAX.plan).map((p, i) => (
            <motion.li key={i} {...rise(COL[0] + 0.2 + i * 0.09, 6)}
              className="flex gap-3 text-[20px] leading-[1.3] tracking-[-0.01em] text-fg">
              <span className="w-3 shrink-0 text-fg-subtle tabular-nums">{i + 1}</span>{p}
            </motion.li>
          ))}
          {view.plan.length > MAX.plan && (
            <li className="pl-6 text-[17px] text-fg-muted">and {view.plan.length - MAX.plan} more</li>
          )}
        </ol>
        {view.rule && (
          <motion.p {...rise(COL[0] + 0.25 + Math.min(view.plan.length, MAX.plan) * 0.09, 6)}
            className="mt-auto border-t border-border pt-3.5 text-[17px] leading-snug text-pretty text-fg-muted">
            <span className="font-semibold text-fg">Rule:</span> {view.rule}
          </motion.p>
        )}
      </Column>

      <Arrow tr={tr(COL[1] - 0.15, 0.3)} />

      {/* 2 · sub-agents */}
      <Column n={agents.length} noun={agents.length === 1 ? "sub-agent" : "sub-agents"} sub="each with its own tools" tr={tr(COL[1])} flush>
        {agents.map((a, i) => {
          const at = COL[1] + 0.15 + i * 0.22;
          return (
            <motion.div key={a.name} {...rise(at, 8)}
              className={cn("flex flex-1 flex-col justify-center px-5 py-3", i > 0 && "border-t border-border")}>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-fg">{human(a.name)}</span>
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(at + 0.3, 0.2)}>
                  <Check className="size-[22px] text-ok" strokeWidth={2.5} aria-label="Finished" />
                </motion.span>
              </p>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(at + 0.3, 0.3)}>
                {a.lead && <div className="mt-2 text-[20px] leading-snug tracking-[-0.01em] text-pretty text-fg">{a.lead}</div>}
                {a.detail && <div className="mt-1 text-[17px] leading-snug text-balance text-fg-muted">{a.detail}</div>}
              </motion.div>
            </motion.div>
          );
        })}
      </Column>

      <Arrow tr={tr(COL[2] - 0.15, 0.3)} />

      {/* 3 · tool calls */}
      <Column n={view.calls.length} noun="tool calls" sub="by the lead agent, in order" tr={tr(COL[2])} flush>
        <ol className="flex min-h-0 flex-1 flex-col py-2">
          {shownCalls.map((c, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={tr(COL[2] + 0.15 + i * 0.07, 0.25)}
              className="flex max-h-[46px] min-h-[34px] flex-1 items-center gap-2.5 px-4 text-[18px]">
              <span className="w-6 shrink-0 text-right text-[17px] text-fg-subtle tabular-nums">{i + 1}</span>
              <code className={cn("shrink-0 font-mono", c.sub ? "text-fg-muted" : "text-fg")}>{c.tool}</code>
              {c.sub
                ? <span className="min-w-0 truncate font-semibold tracking-[-0.01em] text-fg">{human(c.sub)}</span>
                : c.arg && <code className="min-w-0 truncate font-mono text-fg-subtle">{c.arg}</code>}
            </motion.li>
          ))}
          {moreCalls > 0 && (
            <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(COL[2] + 0.15 + shownCalls.length * 0.07, 0.25)}
              className="flex min-h-[34px] flex-1 items-center pr-4 pl-[58px] text-[17px] text-fg-muted">
              and {moreCalls} more
            </motion.li>
          )}
        </ol>
      </Column>

      <Arrow tr={tr(COL[3] - 0.15, 0.3)} />

      {/* 4 · case file */}
      <Column n={1} noun="case file" sub={sections.length ? `/report.md, ${sections.length} sections` : "/report.md"} tr={tr(COL[3])}>
        {view.report.summary && (
          <motion.p {...rise(COL[3] + 0.15, 6)} className="text-[19px] leading-snug font-medium tracking-[-0.01em] text-pretty text-fg">
            &ldquo;{view.report.summary}&rdquo;
          </motion.p>
        )}
        <ul className="mt-3.5 flex flex-col border-t border-border">
          {shownSections.map((sec, i) => (
            <motion.li key={`${i}-${sec}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(COL[3] + 0.3 + i * 0.05, 0.25)}
              className="flex gap-2.5 border-b border-border py-[3px] text-[17px] leading-snug text-fg">
              <span className="w-4 shrink-0 text-fg-subtle tabular-nums">{i + 1}</span>
              <span className="line-clamp-2">{sec}</span>
            </motion.li>
          ))}
          {shownSections.length < sections.length && (
            <li className="border-b border-border py-[3px] pl-[26px] text-[17px] text-fg-muted">and {sections.length - shownSections.length} more</li>
          )}
        </ul>
        <motion.div {...rise(COL[3] + 0.4 + shownSections.length * 0.05, 6)} className="mt-auto pt-4">
          <a href={CASE_FILE} download="investigation-mayajaal.md"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-fg px-3 text-[18px] font-medium whitespace-nowrap text-background transition-opacity hover:opacity-90">
            <Download className="size-5 shrink-0" aria-hidden /> Download case file
          </a>
        </motion.div>
      </Column>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Column({ n, noun, sub, tr, flush, children }: {
  n: number; noun: string; sub: string; tr: object; flush?: boolean; children: ReactNode;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={tr}
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
      <header className="h-[120px] shrink-0 border-b border-border bg-surface px-5 pt-4">
        <p className="flex items-baseline gap-2.5">
          <span className="text-[56px] leading-none font-semibold tracking-[-0.045em] text-fg">{n}</span>
          <span className="text-[24px] font-semibold tracking-[-0.025em] text-fg">{noun}</span>
        </p>
        <p className="mt-2.5 truncate text-[17px] text-fg-muted">{sub}</p>
      </header>
      <div className={cn("flex min-h-0 flex-1 flex-col", !flush && "px-5 py-4")}>{children}</div>
    </motion.section>
  );
}

function Arrow({ tr }: { tr: object }) {
  return (
    <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={tr}
      className="flex h-[120px] items-center justify-center text-fg-subtle" aria-hidden>
      <ArrowRight className="size-6" strokeWidth={1.75} />
    </motion.span>
  );
}

/** The timeline analyst's kill chain, stage names as it wrote them. */
function Chain({ stages }: { stages: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {stages.map((s, i) => (
        <span key={`${i}-${s}`} className="inline-flex items-center gap-1.5">
          <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[18px] leading-snug">{s}</span>
          {i < stages.length - 1 && <span className="text-fg-subtle" aria-hidden>→</span>}
        </span>
      ))}
    </span>
  );
}
