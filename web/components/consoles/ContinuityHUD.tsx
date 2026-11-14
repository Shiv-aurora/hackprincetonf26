"use client";
// Lab continuity card: on-time % by urgency while VitalSwitch reroutes lab orders. Renders nothing until
// the run has continuity data.

import { useMemo } from "react";
import { useMJ } from "@/lib/events";
import { Badge, Card, cn } from "@/components/ui";
import { hospitalShort } from "./ui";

export interface ContinuityHUDProps {
  className?: string;
}

/** True once the current run has emitted continuity data. */
export function useHasContinuity() {
  return useMJ((s) => !!s.view.continuity);
}

export function ContinuityHUD({ className }: ContinuityHUDProps) {
  const c = useMJ((s) => s.view.continuity);
  const orders = useMJ((s) => s.view.labOrders);
  const nodes = useMJ((s) => s.view.nodes);
  const rerouted = useMemo(
    () => Object.values(orders).filter((o) => o.status === "rerouted" || (o.to_hospital && o.to_hospital !== o.from_hospital)).length,
    [orders],
  );
  if (!c) return null;

  const down = Object.entries(nodes).find(([, s]) => s !== "healthy");
  const cells = [
    { label: "STAT", v: c.stat_on_time_pct },
    { label: "Urgent", v: c.urgent_on_time_pct },
    { label: "Routine", v: c.routine_on_time_pct },
  ];

  return (
    <Card title="Lab continuity" className={className} bodyClassName="flex flex-col justify-between gap-3"
      action={down
        ? <Badge tone="alert">{hospitalShort(down[0])} {down[1]}</Badge>
        : <span className="text-xs text-fg-subtle">All labs up</span>}>
      <div className="grid grid-cols-3 gap-3">
        {cells.map((x) => (
          <div key={x.label} className="flex flex-col gap-0.5">
            <span className="text-[13px] text-fg-muted">{x.label}</span>
            <span className={cn("text-2xl font-semibold tracking-[-0.03em] tabular-nums",
              x.label === "STAT" && x.v < 80 ? "text-alert" : "text-fg")}>
              {Math.round(x.v)}<span className="text-base text-fg-subtle">%</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        On time · <span className="tabular-nums">{rerouted}</span> rerouted ·{" "}
        <span className={cn("tabular-nums", c.unservable > 0 && "text-fg")}>{c.unservable}</span> unservable
      </p>
    </Card>
  );
}
