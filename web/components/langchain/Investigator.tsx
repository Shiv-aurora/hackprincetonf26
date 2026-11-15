"use client";
// The Investigator, a LangChain Deep Agent (backend/mayajaal/investigator.py), shown working an incident:
// its own plan, the three sub-agents it delegated to, every tool call in order, and the case file it
// wrote. Starts from the recorded run; "Run a new investigation" asks the local hub for a live one.

import { useState } from "react";
import { Download, FileText, ListChecks, Play, Search, ShieldCheck, Users } from "lucide-react";
import { HUB_HTTP_URL } from "@/lib/contracts";
import { Badge, Button, cn } from "@/components/ui";
import { Markdown } from "./Markdown";

export interface Investigation {
  available?: boolean; model?: string; summary?: string; report?: string; plan?: string; run_id?: string;
  findings?: Record<string, string>;
  trace?: { tool: string; subagent: string | null; args: Record<string, string> }[];
}

const SUBAGENTS = [
  { name: "timeline-analyst", file: "/findings/timeline.md", role: "Rebuilds the attack stage by stage, with times and ATT&CK techniques, and when MayaJaal caught and diverted it.",
    tools: ["attack_timeline", "attacker_requests", "defender_decisions", "intent_history", "attack_technique"] },
  { name: "indicator-hunter", file: "/findings/indicators.md", role: "Pulls every clue (address, client, stolen login, trackers) and searches every other recorded session for each one.",
    tools: ["case_overview", "decoy_trackers", "attacker_requests", "search_other_sessions"] },
  { name: "response-planner", file: "/findings/response.md", role: "Turns the findings into ordered response steps, each with an owner, keeping the decoy session running.",
    tools: ["data_protection", "case_overview"] },
];

const WHY = [
  { icon: ListChecks, title: "Plans", body: "Writes its own investigation plan before it touches the evidence." },
  { icon: Users, title: "Delegates", body: "Hands three lines of inquiry to sub-agents, each with its own context and tools." },
  { icon: FileText, title: "Writes a case file", body: "Each sub-agent saves its findings; the lead reads them, checks, and writes the report." },
];

function Section({ n, title, sub, children }: { n: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-12">
      <p className="text-[13px] text-fg-subtle tabular-nums">{n}</p>
      <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.03em]">{title}</h2>
      {sub && <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-fg-muted">{sub}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function InvestigatorView({ recorded }: { recorded: Investigation }) {
  const [data, setData] = useState<Investigation>(recorded);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const trace = data.trace ?? [];
  const tasks = trace.filter((t) => t.tool === "task");

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch(`${HUB_HTTP_URL}/investigate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error(r.status === 404 ? "No run on the hub yet: start an attack first." : `Hub said ${r.status}`);
      const j = (await r.json()) as Investigation;
      if (!j.available) throw new Error("The hub has no ANTHROPIC_API_KEY set.");
      setData(j);
      setLive(true);
    } catch (e) {
      setNote(e instanceof TypeError
        ? "Runs against the local backend (scripts/dev.sh). Showing the recorded run."
        : `${e instanceof Error ? e.message : "Failed"} Showing the recorded run.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="pt-36 pb-12 sm:pt-44">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="shadow">{live ? "Live run" : "Recorded run"}</Badge>
          <Badge>{(data.model ?? "anthropic:claude-opus-5-5").replace("anthropic:", "")}</Badge>
          <Badge>LangChain Deep Agents</Badge>
        </div>
        <h1 className="mt-5 text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] sm:text-[56px]">The Investigator</h1>
        <p className="mt-4 max-w-[660px] text-[17px] leading-[1.65] text-fg-muted">
          A LangChain Deep Agent that works an incident the way an analyst would. It gets one attacker session,
          plans the investigation, sends three sub-agents through the evidence, and writes a case file.
        </p>
        <div className="mt-6 rounded-xl border border-border bg-surface px-5 py-4 text-[15px] leading-relaxed">
          <p className="text-[13px] text-fg-subtle">Its summary</p>
          <p className="mt-1">{data.summary?.replace(/^\*\*Summary:\*\*\s*/, "").split("\n\n")[0]}</p>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={run} disabled={busy} className="h-11 px-5">
            <Play className="size-4" aria-hidden /> {busy ? "Investigating… (1–3 min)" : "Run a new investigation"}
          </Button>
          <a href="/runs/investigation-mayajaal.md" download className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-5 text-sm hover:bg-surface-2">
            <Download className="size-4" aria-hidden /> Download case file
          </a>
          {note && <span className="text-[13px] text-fg-muted">{note}</span>}
        </div>
      </section>

      <Section n="01" title="Why a deep agent"
        sub="One prompt can summarise an event log. An investigation needs a plan, many tool calls across different evidence, and separate lines of inquiry that don't drown each other. That's what Deep Agents gives it.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.title} className="rounded-xl border border-border p-5">
              <w.icon className="size-5 text-fg-muted" aria-hidden />
              <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.02em]">{w.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-fg-muted">{w.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[13px] text-fg-subtle">
          MayaJaal&rsquo;s detection and decoy don&rsquo;t depend on it. The investigator reads the evidence and recommends.
        </p>
      </Section>

      <Section n="02" title="Its plan" sub="Written by the agent to /plan.md before anything else.">
        <div className="rounded-xl border border-border p-5"><Markdown text={data.plan ?? ""} /></div>
      </Section>

      <Section n="03" title="Three sub-agents" sub="Each one is sent off with the task tool, works in its own context with its own tools, and saves its findings.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {SUBAGENTS.map((s) => {
            const call = tasks.find((t) => t.subagent === s.name);
            const found = data.findings?.[s.file] ?? "";
            return (
              <article key={s.name} className="flex flex-col rounded-xl border border-border">
                <div className="border-b border-border p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-[14px] font-medium">{s.name}</h3>
                    <Badge tone={call ? "ok" : "neutral"}>{call ? "delegated" : "not called"}</Badge>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{s.role}</p>
                  {call?.args?.description && (
                    <p className="mt-3 text-[13px] text-fg-subtle"><span className="text-fg-muted">Asked: </span>{call.args.description}…</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.tools.map((t) => <code key={t} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">{t}</code>)}
                  </div>
                </div>
                <details className="group p-5">
                  <summary className="cursor-pointer text-[13px] text-fg-muted hover:text-fg">
                    Findings <span className="font-mono text-fg-subtle">{s.file}</span>
                  </summary>
                  <Markdown text={found || "_No findings file in this run._"} className="mt-4 text-[13px]" />
                </details>
              </article>
            );
          })}
        </div>
      </Section>

      <Section n="04" title="Every tool call, in order" sub={`The lead agent's ${trace.length} tool calls. Sub-agents' own calls happen inside each task.`}>
        <ol className="divide-y divide-border rounded-xl border border-border">
          {trace.map((t, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
              <span className="w-6 shrink-0 text-right text-fg-subtle tabular-nums">{i + 1}</span>
              <code className={cn("shrink-0 font-mono", t.tool === "task" && "text-shadow")}>{t.tool}</code>
              <span className="min-w-0 truncate text-fg-muted">
                {t.subagent ? `→ ${t.subagent}` : Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section n="05" title="The case file" sub="Written by the agent to /report.md.">
        <div className="rounded-xl border border-border p-5 sm:p-7"><Markdown text={data.report ?? ""} /></div>
      </Section>

      <Section n="06" title="Safe on hostile material">
        <ul className="grid grid-cols-1 gap-3 text-[14px] text-fg-muted md:grid-cols-3">
          {[
            { icon: Search, t: "Every tool is read-only over the event log. It can't touch the gateway, the decoy or the vault." },
            { icon: FileText, t: "Its filesystem is in memory (StateBackend): no disk, no shell." },
            { icon: ShieldCheck, t: "Anything the attacker typed (paths, client strings, file names) is treated as evidence, never as instructions." },
          ].map((x, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-border p-4"><x.icon className="mt-0.5 size-4 shrink-0" aria-hidden />{x.t}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}
