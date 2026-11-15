"use client";
// Right column: what actually happened. Ground truth from the gateway, shadow tier and canary ledger.

import { motion, useReducedMotion } from "framer-motion";
import type { BreadcrumbKind, Goal, Lane, PolicyAction, Stage } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { Card, Stat, cn } from "@/components/ui";
import { clock, useAttackerFacts, useRunStart } from "./ui";

export interface DefenderPanelProps {
  className?: string;
}

export function DefenderPanel({ className }: DefenderPanelProps) {
  return (
    <Card className={cn("overflow-hidden", className)} bodyClassName="flex min-h-0 flex-col p-0">
      <Headline />
      <div data-demo="intel" className="grid shrink-0 grid-cols-1 border-b border-border md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:divide-x md:divide-border">
        <Intent />
        <Lures />
      </div>
      <Decisions />
    </Card>
  );
}

// ------------------------------------------------------------------ headline numbers

function Headline() {
  const canary = useMJ((s) => s.view.canary);
  const diverted = useMJ((s) => s.view.diverted);
  const hasRun = useMJ((s) => !!s.view.run);
  const minted = useMJ((s) => s.view.honeytokensMinted.length);
  const touched = useMJ((s) => new Set(s.view.honeytokensTouched.map((t) => t.token_id)).size);
  const t0 = useRunStart();
  const f = useAttackerFacts();
  const leaked = canary.leaked > 0;

  return (
    <div data-demo="headline" className="grid shrink-0 grid-cols-2 border-b border-border lg:grid-cols-[repeat(4,auto)] [&>*]:px-4 [&>*]:py-3.5 [&>*+*]:border-l [&>*+*]:border-border">
      <Stat
        label={<span className="whitespace-nowrap">Protected records leaked</span>}
        tone={leaked ? "danger" : "neutral"}
        value={<>{canary.leaked}<span className="text-xl text-fg-subtle"> / {canary.total}</span></>}
        sub={leaked ? "Real patient data left the hospital" : "Ground truth"}
      />
      <Stat
        label={<span className="whitespace-nowrap">Session</span>}
        tone={diverted ? "shadow" : "neutral"}
        value={hasRun ? (diverted ? "Shadow" : "Real") : "—"}
        sub={f.divertedAt !== null ? `Diverted at ${clock(f.divertedAt, t0)}` : "Not diverted"}
      />
      <Stat
        label={<span className="whitespace-nowrap">Attacker requests</span>}
        value={f.requests.total}
        sub={<span className="whitespace-nowrap tabular-nums">
          real {f.requests.real} · <span className={f.requests.shadow ? "text-shadow" : undefined}>shadow {f.requests.shadow}</span> · denied {f.requests.denied}
        </span>}
      />
      <Stat
        label={<span className="whitespace-nowrap">Honeytokens touched</span>}
        tone={touched ? "shadow" : "neutral"}
        value={<>{touched}<span className="text-xl text-fg-subtle"> / {minted}</span></>}
        sub={minted ? "Minted this session" : "None minted yet"}
      />
    </div>
  );
}

// ------------------------------------------------------------------ intent

const GOALS: { id: Goal; label: string }[] = [
  { id: "benign", label: "Benign" },
  { id: "recon", label: "Recon" },
  { id: "exfil", label: "Exfiltrate" },
  { id: "tamper", label: "Tamper" },
  { id: "disrupt", label: "Disrupt" },
];
const STAGES: { id: Stage; label: string }[] = [
  { id: "recon", label: "Recon" },
  { id: "access", label: "Access" },
  { id: "collect", label: "Collect" },
  { id: "act", label: "Act" },
];

function Intent() {
  const posterior = useMJ((s) => s.view.posterior);
  const top = useMJ((s) => s.view.topGoal);
  const stage = useMJ((s) => s.view.stage);
  const evidence = useMJ((s) => s.view.intentEvidence);
  const stageIdx = STAGES.findIndex((s) => s.id === stage);

  return (
    <div className="px-4 py-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-medium text-fg">Intent</h3>
        <p className="text-[13px]">
          {STAGES.map((s, i) => (
            <span key={s.id}>
              {i > 0 && <span className="px-1 text-fg-subtle">→</span>}
              <span className={i === stageIdx ? "font-medium text-fg" : i < stageIdx ? "text-fg-muted" : "text-fg-subtle"}>
                {s.label}
              </span>
            </span>
          ))}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {GOALS.map((g) => {
          const p = posterior[g.id] ?? 0;
          const isTop = g.id === top;
          return (
            <li key={g.id} className="grid grid-cols-[72px_minmax(0,1fr)_36px] items-center gap-3 text-[13px]">
              <span className={isTop ? "font-medium text-fg" : "text-fg-muted"}>{g.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span
                  className={cn("block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
                    isTop ? "bg-fg" : "bg-border-strong")}
                  style={{ width: `${Math.round(p * 100)}%` }}
                />
              </span>
              <span className={cn("text-right tabular-nums", isTop ? "text-fg" : "text-fg-subtle")}>{Math.round(p * 100)}%</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 truncate text-xs text-fg-muted" title={evidence}>
        {evidence ? <>Evidence: {evidence}</> : "No evidence yet"}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ breadcrumbs + honeytokens

const CRUMB: Record<BreadcrumbKind, string> = {
  backup_share: "Backup share",
  admin_credential: "Admin credential",
  research_dataset: "Research dataset",
  lab_service_account: "Lab service account",
  vpn_config: "VPN config",
};

function Lures() {
  const crumbs = useMJ((s) => s.view.breadcrumbs);
  const minted = useMJ((s) => s.view.honeytokensMinted);
  const touched = useMJ((s) => s.view.honeytokensTouched);
  const hit = new Set(touched.map((t) => t.token_id));

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border px-4 py-3.5 md:border-t-0">
      <div>
        <h3 className="mb-2 text-[13px] font-medium text-fg">Breadcrumbs planted</h3>
        {crumbs.length === 0 ? <p className="text-[13px] text-fg-subtle">None yet</p> : (
          <ul className="flex flex-col gap-1">
            {crumbs.slice(-3).map((c, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="text-fg">{CRUMB[c.kind] ?? c.kind}</span>
                  <span className="ml-2 font-mono text-xs text-fg-subtle">{c.path}</span>
                </span>
                <span className="shrink-0 tabular-nums text-fg-muted">{c.info_gain.toFixed(2)} bits</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-medium text-fg">Honeytokens</h3>
        {minted.length === 0 ? <p className="text-[13px] text-fg-subtle">None yet</p> : (
          <ul className="flex flex-col gap-1">
            {minted.slice(-3).map((t) => (
              <li key={t.token_id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-fg-muted">{t.kind}</span>
                  <span className="ml-2 text-fg-muted">{t.placed_at}</span>
                </span>
                <span className={cn("shrink-0 text-xs", hit.has(t.token_id) ? "font-medium text-shadow" : "text-fg-subtle")}>
                  {hit.has(t.token_id) ? "Touched" : "Untouched"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ policy decisions

const ACTION: Record<PolicyAction, { label: string; cls: string }> = {
  allow_real: { label: "Allow → real", cls: "text-fg-muted" },
  divert_shadow: { label: "Divert → shadow", cls: "text-shadow font-medium" },
  deny: { label: "Deny", cls: "text-fg font-medium" },
  step_up: { label: "Step-up auth", cls: "text-fg font-medium" },
};
const LANE: Record<Lane, string> = {
  normal: "Normal", suspicious: "Suspicious", attacker: "Attacker", unauth: "Unauthenticated",
};

function Decisions() {
  const f = useAttackerFacts();
  const t0 = useRunStart();
  const reduce = useReducedMotion();
  const rows = f.decisions.slice(-30).reverse();

  return (
    <div data-demo="decisions" className="flex min-h-[132px] flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 px-4">
        <h3 className="text-[13px] font-medium text-fg">Policy decisions</h3>
        <span className="truncate text-xs text-fg-subtle">
          {f.clinicianAllowed > 0 && <>{f.clinicianAllowed} routine clinician reads allowed, not shown</>}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-fg-subtle">No decisions on the attacker session yet</p> : (
          <ul className="divide-y divide-border">
            {rows.map((d) => {
              const a = ACTION[d.data.action];
              return (
                <motion.li
                  key={d.id}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="grid grid-cols-[40px_88px_120px_minmax(0,1fr)] items-baseline gap-3 px-4 py-1.5 text-[13px]"
                >
                  <span className="font-mono text-xs tabular-nums text-fg-subtle">{clock(d.ts, t0)}</span>
                  <span className="text-fg-muted">{LANE[d.data.lane]}</span>
                  <span className={a.cls}>{a.label}</span>
                  <span className="truncate text-fg-muted" title={d.data.reason}>{d.data.reason}</span>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
