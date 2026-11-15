"use client";
// The Investigator, a LangChain Deep Agent (backend/mayajaal/investigator.py), shown working an incident:
// its own plan, the three sub-agents it delegated to, every tool call in order, and the case file it
// wrote. Starts from the recorded run; "Run a new investigation" asks the local hub for a live one.
// Same visual language as the landing page: big quiet headline, number strip, numbered circles,
// frame-and-panel cards, no accent colour.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Download, Play } from "lucide-react";
import { HUB_HTTP_URL } from "@/lib/contracts";
import { Button, ButtonLink, cn } from "@/components/ui";
import { Markdown } from "./Markdown";

export interface Investigation {
  available?: boolean; model?: string; summary?: string; report?: string; plan?: string; run_id?: string;
  findings?: Record<string, string>;
  trace?: { tool: string; subagent: string | null; args: Record<string, string> }[];
}

const SUBAGENTS = [
  { name: "timeline-analyst", title: "Timeline analyst", file: "/findings/timeline.md",
    role: "Rebuilds the attack stage by stage, with times and ATT&CK techniques, and when MayaJaal caught and diverted it.",
    tools: ["attack_timeline", "attacker_requests", "defender_decisions", "intent_history", "attack_technique"] },
  { name: "indicator-hunter", title: "Indicator hunter", file: "/findings/indicators.md",
    role: "Pulls every clue (address, client, stolen login, trackers) and searches every other recorded session for each one.",
    tools: ["case_overview", "decoy_trackers", "attacker_requests", "search_other_sessions"] },
  { name: "response-planner", title: "Response planner", file: "/findings/response.md",
    role: "Turns the findings into ordered response steps, each with an owner, keeping the decoy session running.",
    tools: ["data_protection", "case_overview"] },
];

const WHY = [
  { title: "It plans", body: "Before touching the evidence it writes its own plan: what to establish, and who does what." },
  { title: "It delegates", body: "Three lines of inquiry go to sub-agents, each with its own context and only the tools it needs." },
  { title: "It writes a case file", body: "Each sub-agent saves its findings. The lead reads them, checks anything surprising, and writes the report." },
];

const SAFETY = [
  { title: "Read-only", body: "Every tool reads the event log. It can't touch the gateway, the decoy, the vault or the network." },
  { title: "No disk, no shell", body: "Its files live in memory (StateBackend). There is nothing on the machine for it to run or change." },
  { title: "Evidence, not instructions", body: "Anything the attacker typed (paths, client strings, file names) is treated as evidence and never followed." },
];

function Head({ id, title, sub }: { id?: string; title: string; sub?: string }) {
  return (
    <div id={id} className="scroll-mt-24">
      <h2 className="text-[36px] font-semibold tracking-[-0.035em] sm:text-[40px]">{title}</h2>
      {sub && <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-fg-muted">{sub}</p>}
    </div>
  );
}

function Circle({ n }: { n: number }) {
  return (
    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-fg text-[12px] text-background tabular-nums">{n}</span>
  );
}

function Reading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-background p-2", className)}>
      <div className="rounded-lg border border-border bg-surface px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  );
}

const SECONDARY_LINK = "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-background px-5 text-sm font-medium text-fg transition-[background] hover:bg-surface-2";

export function InvestigatorView({ recorded }: { recorded: Investigation }) {
  const [data, setData] = useState<Investigation>(recorded);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const trace = useMemo(() => data.trace ?? [], [data.trace]);
  const tasks = trace.filter((t) => t.tool === "task");

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // After a live run the download is the new report, not the recorded one.
  const download = useMemo(() => {
    if (!live || !data.report) return { href: "/runs/investigation-mayajaal.md", name: "investigation-mayajaal.md" };
    return { href: URL.createObjectURL(new Blob([data.report], { type: "text/markdown" })),
             name: `investigation-${data.run_id ?? "live"}.md` };
  }, [live, data.report, data.run_id]);

  const run = async () => {
    setBusy(true);
    setElapsed(0);
    setNote(null);
    try {
      const r = await fetch(`${HUB_HTTP_URL}/investigate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error(r.status === 404 ? "No run on the hub yet. Start an attack first." : `The hub answered ${r.status}.`);
      const j = (await r.json()) as Investigation;
      if (!j.available) throw new Error("The hub has no API key set.");
      setData(j);
      setLive(true);
    } catch (e) {
      setNote(e instanceof TypeError
        ? "Live runs need the backend on this machine (scripts/dev.sh). Showing the recorded run."
        : `${e instanceof Error ? e.message : "That didn't work."} Showing the recorded run.`);
    } finally {
      setBusy(false);
    }
  };

  const summary = (data.summary ?? "").replace(/^\*\*Summary:\*\*\s*/, "").split("\n\n")[0];
  const stats = [
    { value: "1", label: "plan, written by the agent before it starts" },
    { value: String(tasks.length || 3), label: "sub-agents sent off with their own context and tools" },
    { value: String(trace.length), label: "tool calls by the lead agent, every one listed below" },
  ];

  return (
    <>
      <section className="pt-32 pb-12 sm:pt-40">
        <p className="text-[13px] text-fg-muted">
          LangChain Deep Agents · {live ? "live run" : "recorded run"} · {(data.model ?? "claude-opus-5-5").replace("anthropic:", "")}
        </p>
        <h1 className="mt-4 max-w-[900px] text-[44px] leading-[1.03] font-semibold tracking-[-0.045em] text-balance sm:text-[60px]">
          The Investigator.
        </h1>
        <p className="mt-3 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-fg-muted sm:text-[34px]">
          An agent that works the case for you.
        </p>
        <p className="mt-6 max-w-[680px] text-[17px] leading-[1.65] text-pretty text-fg-muted">
          Hand it one attacker session. It plans the investigation, sends three sub-agents through the evidence,
          checks every past session for the same clues, and writes a case file a hospital can act on.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={run} disabled={busy} className="h-11 px-5">
            <Play className="size-4" aria-hidden />
            {busy ? `Investigating… ${elapsed}s` : "Run a new investigation"}
          </Button>
          <a href={download.href} download={download.name} className={SECONDARY_LINK}>
            <Download className="size-4" aria-hidden /> Download case file
          </a>
        </div>
        {busy && <p className="mt-3 text-[13px] text-fg-muted">A full investigation takes one to three minutes.</p>}
        {note && <p className="mt-3 text-[13px] text-fg-muted">{note}</p>}
      </section>

      <section className="grid grid-cols-1 gap-10 border-t border-border py-12 sm:grid-cols-3 sm:gap-8">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[34px] font-semibold tracking-[-0.03em] tabular-nums">{s.value}</p>
            <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-fg-muted">{s.label}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-border py-12">
        <p className="text-[13px] text-fg-muted">What it concluded</p>
        <p className="mt-3 max-w-[860px] text-[20px] leading-[1.55] tracking-[-0.01em] text-pretty">{summary}</p>
      </section>

      <section className="pt-20">
        <Head title="Why it needs a deep agent"
          sub="One prompt can summarise a log. An investigation needs a plan, many tool calls across different evidence, and separate lines of inquiry that don't drown each other." />
        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-3">
          {WHY.map((w, i) => (
            <div key={w.title}>
              <p className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]"><Circle n={i + 1} />{w.title}</p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-fg-muted">{w.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[13px] text-fg-subtle">
          MayaJaal&rsquo;s detection and decoy don&rsquo;t depend on it. The investigator reads the evidence and recommends.
        </p>
      </section>

      <section className="pt-20">
        <Head title="Its plan" sub="Written to /plan.md before it delegates." />
        <Reading className="mt-10"><Markdown text={data.plan ?? ""} /></Reading>
      </section>

      <section className="pt-20">
        <Head title="Three sub-agents" sub="Each one is sent off with its own instructions and tools, and saves what it finds." />
        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {SUBAGENTS.map((s, i) => {
            const call = tasks.find((t) => t.subagent === s.name);
            const found = data.findings?.[s.file] ?? "";
            return (
              <article key={s.name} className="flex flex-col rounded-xl border border-border bg-background p-2">
                <div className="rounded-lg border border-border bg-surface px-4 py-4">
                  <p className="text-[12px] text-fg-subtle">Tools</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.tools.map((t) => (
                      <code key={t} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]">{t}</code>
                    ))}
                  </div>
                </div>
                <div className="flex flex-1 flex-col px-3 pt-5 pb-4">
                  <p className="text-[13px] text-fg-subtle tabular-nums">0{i + 1} · <span className="font-mono">{s.name}</span></p>
                  <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{s.role}</p>
                  {call?.args?.description && (
                    <p className="mt-3 text-[13px] leading-relaxed text-fg-subtle">
                      <span className="text-fg-muted">The lead asked: </span>&ldquo;{call.args.description.trim()}&hellip;&rdquo;
                    </p>
                  )}
                  <details className="mt-4 border-t border-border pt-4">
                    <summary className="cursor-pointer text-[13px] font-medium text-fg hover:opacity-80">
                      Read its findings <span className="font-normal text-fg-subtle">{s.file}</span>
                    </summary>
                    <Markdown text={found || "No findings file in this run."} className="mt-4 text-[13px]" />
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="pt-20">
        <Head title="Every tool call, in order"
          sub={`The lead agent's ${trace.length} calls. Each "task" hands work to a sub-agent, which makes its own calls inside it.`} />
        <ol className="mt-10 divide-y divide-border rounded-xl border border-border">
          {trace.map((t, i) => (
            <li key={i} className="flex items-baseline gap-4 px-4 py-3 text-[13px]">
              <span className="w-5 shrink-0 text-right text-fg-subtle tabular-nums">{i + 1}</span>
              <code className={cn("shrink-0 font-mono", t.tool === "task" ? "font-semibold text-fg" : "text-fg")}>{t.tool}</code>
              <span className="min-w-0 truncate text-fg-muted">
                {t.subagent
                  ? `hands off to ${t.subagent}`
                  : Object.entries(t.args).map(([k, v]) => `${k}: ${v.split("\n")[0]}`).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pt-20">
        <Head title="The case file" sub="Written to /report.md at the end. This is what the hospital gets." />
        <Reading className="mt-10"><Markdown text={data.report ?? ""} /></Reading>
      </section>

      <section className="py-20">
        <Head title="Safe on hostile material" sub="Everything it reads was shaped by the attacker, so it is built to only read and write." />
        <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-3">
          {SAFETY.map((s, i) => (
            <div key={s.title}>
              <p className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]"><Circle n={i + 1} />{s.title}</p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-24 flex flex-col items-start justify-between gap-6 rounded-xl border border-border px-6 py-10 sm:flex-row sm:items-center sm:px-10">
        <div>
          <h2 className="text-[28px] font-semibold tracking-[-0.03em]">See the attack it investigated.</h2>
          <p className="mt-2 text-[15px] text-fg-muted">Three minutes, on top of the real dashboard.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/demo" variant="primary" className="h-11 px-5">
            Watch the demo <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href="/war-room" className="h-11 px-5">Open the live dashboard</ButtonLink>
        </div>
      </section>
    </>
  );
}
