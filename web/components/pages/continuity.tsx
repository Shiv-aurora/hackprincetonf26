"use client";
// /continuity — the shared-lab outage. Live stats from the store, VitalSwitch rerouting, honest limits.
import { useEffect, useMemo, useState } from "react";
import { WORLD, type NodeState } from "@/lib/contracts";
import { connectHub, useMJ } from "@/lib/events";
import { Button, Card, Dot, Stat, cn } from "@/components/ui";
import { NetworkMap } from "@/components/map";
import { Notice, PageShell, RunKindBadge, Section, Table, Td, Th, hub, hubMessage } from "./shared";

// GET /scenario/compare is being built in parallel; accept a few plausible shapes.
interface PolicyRow { name: string; desc?: string; stat: number | null; urgent: number | null; routine: number | null; unservable: number | null }

const asPct = (x: unknown) => (typeof x === "number" ? (x <= 1 && x > 0 ? x * 100 : x) : null);
const firstStr = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  return undefined;
};

function parseCompare(raw: unknown): PolicyRow[] {
  let items: [string | undefined, Record<string, unknown>][] = [];
  if (Array.isArray(raw)) items = raw.map((x) => [undefined, x as Record<string, unknown>]);
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const list = o.policies ?? o.rows ?? o.results ?? o.comparison;
    if (Array.isArray(list)) items = list.map((x) => [undefined, x as Record<string, unknown>]);
    else if (list && typeof list === "object") items = Object.entries(list as Record<string, Record<string, unknown>>);
    else items = Object.entries(o).filter(([, v]) => v && typeof v === "object") as [string, Record<string, unknown>][];
  }
  return items.map(([key, o]) => {
    const s = (o.stats && typeof o.stats === "object" ? o.stats : o) as Record<string, unknown>;
    return {
      name: firstStr(o, ["title", "name", "label", "policy", "id"]) ?? key ?? "Policy",
      desc: firstStr(o, ["desc", "description"]),
      stat: asPct(s.stat_on_time_pct ?? s.stat),
      urgent: asPct(s.urgent_on_time_pct ?? s.urgent),
      routine: asPct(s.routine_on_time_pct ?? s.routine),
      unservable: typeof s.unservable === "number" ? s.unservable : null,
    };
  });
}

const fmtPct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x)}%`);

const NODE_TEXT: Record<NodeState, string> = {
  healthy: "Healthy", degraded: "Degraded", compromised: "Compromised", quarantined: "Isolated", down: "Down",
};
const NODE_TONE: Record<NodeState, "neutral" | "ok" | "alert" | "danger"> = {
  healthy: "ok", degraded: "alert", compromised: "danger", quarantined: "alert", down: "danger",
};

const SHORT = Object.fromEntries(WORLD.hospitals.map((h) => [h.id, h.short]));

function Hospitals() {
  const nodes = useMJ((s) => s.view.nodes);
  return (
    <Card title="Labs" action={<span className="text-xs text-fg-subtle">Capacity per hour</span>} bodyClassName="p-0">
      <ul className="divide-y divide-border">
        {WORLD.hospitals.map((h) => {
          const st = nodes[h.id] ?? "healthy";
          return (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <Dot tone={NODE_TONE[st]} />
              <span className="min-w-0 flex-1 truncate text-fg">{h.name}</span>
              <span className={cn("text-xs", st === "healthy" ? "text-fg-subtle" : "text-fg-muted")}>{NODE_TEXT[st]}</span>
              <span className="w-10 text-right tabular-nums text-fg-muted">{h.lab_capacity_per_hr}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const STATUS_TEXT = { queued: "Queued", rerouted: "Rerouted", completed: "Done", late: "Late", unservable: "Unservable" } as const;

function RecentOrders() {
  const orders = useMJ((s) => s.view.labOrders);
  const recent = useMemo(() => Object.values(orders).slice(-8).reverse(), [orders]);
  return (
    <Card title="Recent lab orders" bodyClassName="p-0">
      {recent.length === 0 && <p className="p-4 text-[13px] text-fg-subtle">No orders yet.</p>}
      <ul className="divide-y divide-border">
        {recent.map((o) => (
          <li key={o.order_id} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-[13px]">
            <span className={cn("text-xs", o.urgency === "stat" ? "font-medium text-fg" : "text-fg-muted")}>
              {{ stat: "STAT", urgent: "Urgent", routine: "Routine" }[o.urgency]}
            </span>
            <span className="truncate text-fg-muted">
              {o.test} · {SHORT[o.from_hospital] ?? o.from_hospital}
              {o.to_hospital && o.to_hospital !== o.from_hospital && <> → <span className="text-fg">{SHORT[o.to_hospital] ?? o.to_hospital}</span></>}
            </span>
            <span className={cn("text-xs", o.status === "unservable" || o.status === "late" ? "text-alert" : "text-fg-subtle")}>
              {STATUS_TEXT[o.status]}{o.eta_min != null && o.status !== "completed" && o.status !== "unservable" ? ` · ${o.eta_min}m` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type RunState = { kind: "idle" } | { kind: "starting" } | { kind: "started" } | { kind: "error"; msg: string };

export function ContinuityPage() {
  useEffect(() => { connectHub(); }, []);
  const connected = useMJ((s) => s.connected);
  const stats = useMJ((s) => s.view.continuity);
  const runStarted = useMJ((s) => s.view.run);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [compare, setCompare] = useState<PolicyRow[] | null | "missing">(null);

  useEffect(() => {
    let alive = true;
    void hub<unknown>("/scenario/compare").then((r) => {
      if (!alive) return;
      const rows = r.ok ? parseCompare(r.data) : [];
      setCompare(rows.length ? rows : "missing");
    });
    return () => { alive = false; };
  }, []);

  const start = async () => {
    setRun({ kind: "starting" });
    connectHub();
    const r = await hub<unknown>("/scenario/synnovis/start", { method: "POST", json: {} });
    setRun(r.ok ? { kind: "started" } : { kind: "error", msg: hubMessage(r, "Starting the outage") });
  };

  return (
    <PageShell active="/continuity" title="Keep care running"
      lede="When the shared pathology lab goes dark, VitalSwitch reroutes lab orders to hospitals that still have capacity. STAT first, then urgent, then routine. When there is no room left, it says so."
      right={<span className="flex items-center gap-2 text-xs text-fg-muted"><Dot tone={connected ? "ok" : "neutral"} />{connected ? "Live" : "Offline"}</span>}
      actions={
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button variant="primary" onClick={start} disabled={run.kind === "starting"}>
            {run.kind === "starting" ? "Starting…" : "Run the Synnovis-style outage"}
          </Button>
          {run.kind === "started" && <span className="text-xs text-fg-muted">Started. Watch the numbers below.</span>}
          {run.kind === "error" && <span className="text-xs text-fg-muted">{run.msg}</span>}
        </div>
      }>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        {([
          ["STAT on time", stats?.stat_on_time_pct, "Results needed within the hour"],
          ["Urgent on time", stats?.urgent_on_time_pct, "Same-shift results"],
          ["Routine on time", stats?.routine_on_time_pct, "Can wait; deferred first"],
        ] as const).map(([label, v, sub]) => (
          <div key={label} className="bg-background p-5">
            <Stat label={label} value={fmtPct(v)} sub={sub} tone={v != null && v < 80 ? "alert" : "neutral"} />
          </div>
        ))}
        <div className="bg-background p-5">
          <Stat label="Can't be served" value={stats ? stats.unservable : "—"} sub="Orders no healthy lab had room for"
            tone={stats && stats.unservable > 0 ? "alert" : "neutral"} />
        </div>
      </div>
      <div className="mt-3 flex min-h-6 items-center gap-2 text-xs text-fg-subtle">
        {!stats ? "Waiting for continuity numbers from the event stream." : (
          <>
            <RunKindBadge started={runStarted} className="h-5 px-2 text-[11px]" />
            <span>Live numbers from the current event stream{runStarted?.model === "scripted" ? " (scripted demo run)" : ""}.</span>
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-[420px] min-w-0 lg:h-auto lg:min-h-[480px]"><NetworkMap variant="full" focusHospital="lum" /></div>
        <div className="flex min-w-0 flex-col gap-4">
          <Hospitals />
          <RecentOrders />
        </div>
      </div>

      <Section title="Three ways to handle the outage" desc="Same outage, same order stream, three routing policies.">
        {compare === null && <p className="text-sm text-fg-muted">Loading comparison…</p>}
        {compare === "missing" && <Notice>The policy comparison isn&apos;t available on this hub yet. It appears here once the scenario service serves it.</Notice>}
        {Array.isArray(compare) && (
          <Table>
            <thead>
              <tr>
                <Th>Policy</Th><Th className="text-right">STAT on time</Th><Th className="text-right">Urgent on time</Th>
                <Th className="text-right">Routine on time</Th><Th className="text-right">Can&apos;t be served</Th>
              </tr>
            </thead>
            <tbody>
              {compare.map((p) => (
                <tr key={p.name}>
                  <Td>
                    <p className={cn("font-medium", /vital/i.test(p.name) && "text-shadow")}>{p.name}</p>
                    {p.desc && <p className="text-xs text-fg-subtle">{p.desc}</p>}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtPct(p.stat)}</Td>
                  <Td className="text-right tabular-nums">{fmtPct(p.urgent)}</Td>
                  <Td className="text-right tabular-nums">{fmtPct(p.routine)}</Td>
                  <Td className="text-right tabular-nums">{p.unservable ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="What this shows">
        <div className="grid gap-6 text-sm leading-relaxed text-fg-muted md:grid-cols-3">
          <div>
            <p className="mb-1.5 font-medium text-fg">What happened in 2024</p>
            <p>A ransomware attack on Synnovis, the pathology provider for several London NHS trusts, disrupted blood
              testing for weeks and forced thousands of appointments and procedures to be postponed.</p>
          </div>
          <div>
            <p className="mb-1.5 font-medium text-fg">What VitalSwitch does</p>
            <p>It isolates the failed lab from the network, then sends each new order to the nearest healthy hospital lab
              with spare capacity. STAT orders go first, routine orders wait.</p>
          </div>
          <div>
            <p className="mb-1.5 font-medium text-fg">The limits are real</p>
            <p>Every lab has a fixed hourly capacity, listed on this page. When all of them are full, an order is
              counted as unservable and shown, not hidden. This is a simulation of a fictional city. It does not show
              what would have happened in the real incident.</p>
          </div>
        </div>
      </Section>
    </PageShell>
  );
}
