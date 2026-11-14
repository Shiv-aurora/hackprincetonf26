"use client";
// /results — benchmark by config. Reads GET /results (contracts/results.md); falls back to a
// clearly labelled SAMPLE so the layout can be reviewed before the benchmark is run.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WORLD } from "@/lib/contracts";
import { Badge, Card } from "@/components/ui";
import { SAMPLE_RESULTS } from "@/app/results/sample-results";
import {
  LeakCell, Notice, PageShell, Section, Table, Td, Th, YesNo, configTitle, hub, missionTitle, pct, secs,
} from "./shared";
import type { ConfigSummary, ResultRow, ResultsFile } from "./types";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function summarize(rows: ResultRow[]): ConfigSummary {
  const n = rows.length || 1;
  return {
    runs: rows.length,
    refused: rows.filter((r) => r.refused).length,
    secrets_leaked_total: rows.reduce((a, r) => a + (r.secrets_leaked ?? 0), 0),
    runs_with_leak: rows.filter((r) => r.secrets_leaked > 0).length,
    believed_success_rate: rows.filter((r) => r.believed_success).length / n,
    suspected_honeypot_rate: rows.filter((r) => r.suspected_honeypot).length / n,
    mission_won_rate: rows.filter((r) => r.mission_won).length / n,
    median_time_to_first_honeytoken_s: median(rows.map((r) => r.time_to_first_honeytoken_s).filter((x): x is number => x != null)),
    median_decoy_requests: median(rows.map((r) => r.decoy_requests).filter((x): x is number => x != null)),
  };
}

type State = { data: ResultsFile; sample: boolean } | null;

export function ResultsPage() {
  const [state, setState] = useState<State>(null);
  useEffect(() => {
    let alive = true;
    void hub<ResultsFile>("/results").then((r) => {
      if (!alive) return;
      const real = r.ok && Array.isArray(r.data?.runs) && r.data.runs.length > 0;
      setState(real ? { data: r.data, sample: false } : { data: SAMPLE_RESULTS, sample: true });
    });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    if (!state) return [];
    return WORLD.configs.map((c) => {
      const runs = state.data.runs.filter((r) => r.config === c.id);
      return { id: c.id, title: c.title, desc: c.desc, s: { ...summarize(runs), ...(runs.length ? {} : state.data.summary[c.id]) } };
    });
  }, [state]);

  return (
    <PageShell active="/results" title="Results"
      lede="The same attacker, three defences: a plain API, a static honeypot, and MayaJaal. What the attacker believed it got, next to what actually left the building.">
      {!state && <p className="text-sm text-fg-muted">Loading results…</p>}
      {state?.sample && (
        <Notice tone="alert" className="mb-8">
          <span className="font-medium">Sample data — benchmark not run yet.</span> These rows are placeholders that show the
          page layout. None of the numbers below are measured.
        </Notice>
      )}
      {state && (
        <>
          <Section title="By configuration">
            <Table>
              <thead>
                <tr>
                  <Th>Config</Th>
                  <Th className="text-right">Runs</Th>
                  <Th className="text-right">Refusals</Th>
                  <Th className="text-right">Protected records leaked</Th>
                  <Th className="text-right">Believed success</Th>
                  <Th className="text-right">Suspected honeypot</Th>
                  <Th className="text-right" title="Median time to first honeytoken">First honeytoken (median)</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, title, desc, s }) => (
                  <tr key={id}>
                    <Td>
                      <p className={id === "mayajaal" ? "font-medium text-shadow" : "font-medium"}>{title}</p>
                      <p className="text-xs text-fg-subtle">{desc}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{s.runs}</Td>
                    <Td className="text-right tabular-nums">{s.refused}</Td>
                    <Td className="text-right">
                      <span className={s.secrets_leaked_total > 0 ? "font-medium tabular-nums text-danger" : "tabular-nums"}>{s.secrets_leaked_total}</span>
                      <span className="text-xs text-fg-subtle"> in {s.runs_with_leak} run{s.runs_with_leak === 1 ? "" : "s"}</span>
                    </Td>
                    <Td className="text-right tabular-nums">{pct(s.believed_success_rate)}</Td>
                    <Td className="text-right tabular-nums">{pct(s.suspected_honeypot_rate)}</Td>
                    <Td className="text-right tabular-nums">{id === "baseline" && s.median_time_to_first_honeytoken_s == null ? <span className="text-fg-subtle">n/a</span> : secs(s.median_time_to_first_honeytoken_s)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section title="What the attacker believed vs. what actually leaked"
            desc="Share of runs per config. Believed: the agent claimed success. Leaked: the gateway's canary ledger saw at least one protected record leave.">
            <Card bodyClassName="p-5">
              <BelievedVsLeaked rows={rows.map((r) => ({
                config: r.title,
                believed: Math.round(r.s.believed_success_rate * 100),
                leaked: r.s.runs ? Math.round((r.s.runs_with_leak / r.s.runs) * 100) : 0,
              }))} />
            </Card>
          </Section>

          <Section title="Every run" desc="Refusals, failures and attacker wins included. Open any run to replay it.">
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th><Th>Config</Th><Th>Mission</Th><Th>Model</Th>
                  <Th>Believed success</Th><Th className="text-right">Protected leaked</Th><Th>Suspected honeypot</Th>
                  <Th className="text-right">First honeytoken</Th>
                </tr>
              </thead>
              <tbody>
                {state.data.runs.map((r) => (
                  <tr key={r.run_id}>
                    <Td>
                      {state.sample
                        ? <span className="text-fg-muted">{r.attacker_label}</span>
                        : <Link href={`/replay?run=${encodeURIComponent(r.run_id)}`} className="font-medium underline decoration-border-strong underline-offset-4 hover:decoration-fg">{r.attacker_label}</Link>}
                      {r.refused && <Badge className="ml-2 h-5 px-2 text-[11px]">Refused</Badge>}
                    </Td>
                    <Td className="text-fg-muted">{configTitle(r.config)}</Td>
                    <Td className="text-fg-muted">{missionTitle(r.mission)}</Td>
                    <Td className="font-mono text-[12.5px] text-fg-muted">{r.model}</Td>
                    <Td><YesNo v={r.believed_success} /></Td>
                    <Td className="text-right"><LeakCell leaked={r.secrets_leaked} /></Td>
                    <Td><YesNo v={r.suspected_honeypot} /></Td>
                    <Td className="text-right tabular-nums text-fg-muted">{secs(r.time_to_first_honeytoken_s)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section title="Methodology">
            <div className="max-w-2xl space-y-3 text-sm leading-relaxed text-fg-muted">
              <p>This is a small, operator-run proof of concept, not statistical proof. Runs were made by the MayaJaal team
                against a synthetic hospital network, plus any Arena and judge attempts recorded on the day.</p>
              <p>&ldquo;Believed success&rdquo; is what the attacking agent claimed. &ldquo;Protected records leaked&rdquo; comes from the
                gateway&apos;s canary ledger, which scans every response for the {WORLD.protected_canaries_total} protected secrets. It never
                uses the agent&apos;s own claim. Every run is kept, including refusals and runs the attacker won.</p>
              {state.data.note && !state.sample && <p className="text-fg">{state.data.note}</p>}
              <p className="text-xs text-fg-subtle">
                {state.sample ? "Sample file" : "Generated"} {state.data.generated_at.replace("T", " ").replace("Z", " UTC")}
              </p>
            </div>
          </Section>
        </>
      )}
    </PageShell>
  );
}

type ChartRow = { config: string; believed: number; leaked: number };
const SERIES = [
  { key: "believed", label: "Believed it succeeded", color: "var(--shadow)" },
  { key: "leaked", label: "Protected record actually leaked", color: "var(--fg)" },
] as const;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: unknown; value?: unknown }[]; label?: unknown }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-fg">{String(label)}</p>
      {SERIES.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <p key={s.key} className="flex items-center gap-2 text-fg-muted">
            <span className="size-2 rounded-sm" style={{ background: s.color }} />
            {s.label} <span className="ml-auto pl-3 tabular-nums text-fg">{String(p?.value ?? 0)}%</span>
          </p>
        );
      })}
    </div>
  );
}

/** Value above each bar, drawn even for a zero-height bar (0% leaked is the point). */
function BarValue(p: { x?: unknown; y?: unknown; width?: unknown; value?: unknown }) {
  const x = Number(p.x), y = Number(p.y), w = Number(p.width);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize={12}
      style={{ fill: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>{`${p.value ?? 0}%`}</text>
  );
}

function BelievedVsLeaked({ rows }: { rows: ChartRow[] }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2 text-[13px] text-fg-muted">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="28%" margin={{ top: 20, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="config" tickLine={false} axisLine={{ stroke: "var(--border-strong)" }}
              tick={{ fill: "var(--fg-muted)", fontSize: 13 }} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false}
              tick={{ fill: "var(--fg-subtle)", fontSize: 12 }} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip />} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={56} minPointSize={2} isAnimationActive={false}>
                <LabelList dataKey={s.key} content={BarValue} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}