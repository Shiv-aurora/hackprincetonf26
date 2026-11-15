"use client";
// Three acts, so people always know where we are in the story:
// 1 a normal shift · 2 detected · 3 contained. Each act is grounded in a real 2024 hospital attack.
import { useMemo } from "react";
import type { MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";

const ACTS = [
  { title: "A normal shift", line: "Staff read charts, the lab runs tests. Notes, SSNs and passwords are encrypted on disk; the key needs 3 of 6 hospitals." },
  { title: "Detected", line: "A stolen nurse login starts acting like an attacker. Change Healthcare (2024) began the same way: one stolen login, no MFA." },
  { title: "Contained", line: "Moved into a decoy built just for them, while care carries on. In the Synnovis attack (2024), London hospitals lost their pathology service." },
];

export function actOf(events: MJEvent[]): number {
  let act = 0;
  for (const e of events) {
    if (e.type === "run.started") act = 0;
    if (e.type === "policy.decision" && act < 1 && (e.data.lane !== "normal" || e.data.action === "deny")) act = 1;
    if (e.type === "session.diverted") act = 2;
  }
  return act;
}

export function ActsBar({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const act = useMemo(() => actOf(events), [events]);
  return (
    <div data-demo="acts" className={cn("grid grid-cols-3 gap-2", className)}>
      {ACTS.map((a, i) => (
        <div key={a.title} className={cn("rounded-lg border px-4 py-3 transition-colors duration-200",
          i === act ? (i === 2 ? "border-shadow/50 bg-shadow-bg" : i === 1 ? "border-alert/50 bg-alert-bg" : "border-fg/40 bg-surface")
            : "border-border")}>
          <p className={cn("flex items-center gap-2 text-[13px] font-semibold",
            i === act ? (i === 2 ? "text-shadow" : i === 1 ? "text-alert" : "text-fg") : i < act ? "text-fg-muted" : "text-fg-subtle")}>
            <span className="tabular-nums">{i + 1}</span>{a.title}{i < act && <span className="font-normal text-fg-subtle">· done</span>}
          </p>
          <p className={cn("mt-1 text-xs leading-relaxed", i === act ? "text-fg-muted" : "text-fg-subtle")}>{a.line}</p>
        </div>
      ))}
    </div>
  );
}
