"use client";
// Lab continuity HUD: shared lab outage (Synnovis-style), on-time %, honest unservable count, reroutes.

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, FlaskConical } from "lucide-react";
import type { EventDataMap, Urgency } from "@/lib/contracts";
import { WORLD } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { AnimatedNumber, C, GLIDE, Glass, SectionLabel, cn, hospitalShort } from "./ui";

export interface ContinuityHUDProps {
  className?: string;
  /** Recent reroutes to list. */
  maxOrders?: number;
}

const URG: { key: Urgency; label: string; field: keyof EventDataMap["continuity.stats"] }[] = [
  { key: "stat", label: "STAT", field: "stat_on_time_pct" },
  { key: "urgent", label: "Urgent", field: "urgent_on_time_pct" },
  { key: "routine", label: "Routine", field: "routine_on_time_pct" },
];

function pctColor(p: number) {
  return p >= 90 ? C.real : p >= 60 ? C.alert : C.danger;
}

export function ContinuityHUD({ className, maxOrders = 4 }: ContinuityHUDProps) {
  const stats = useMJ((s) => s.view.continuity);
  const nodes = useMJ((s) => s.view.nodes);
  const events = useMJ((s) => s.events);

  const lab = WORLD.hospitals.find((h) => h.kind === "pathology");
  const labState = lab ? nodes[lab.id] : "healthy";
  const outage = labState && labState !== "healthy";

  const recent = useMemo(() => {
    const out: (EventDataMap["lab.order"] & { id: string })[] = [];
    const seen = new Set<string>();
    for (let i = events.length - 1; i >= 0 && out.length < maxOrders; i--) {
      const e = events[i];
      if (e.type !== "lab.order") continue;
      if (e.data.status !== "rerouted") continue;
      if (seen.has(e.data.order_id)) continue;
      seen.add(e.data.order_id);
      out.push({ ...e.data, id: e.id });
    }
    return out;
  }, [events, maxOrders]);

  const statusTone =
    labState === "compromised" || labState === "down" ? "text-danger" : outage ? "text-alert" : "text-real";

  return (
    <Glass className={cn("w-full", className)}>
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-3.5 text-fg-dim" strokeWidth={1.75} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fg">Lab continuity</span>
          </div>
          <span className={cn("flex items-center gap-1.5 text-[11px]", statusTone)}>
            <span className={cn("size-1.5 rounded-full bg-current", outage && "animate-pulse")} />
            {lab?.short ?? "Shared lab"} · {labState ?? "healthy"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {URG.map((u) => {
            const p = stats ? Number(stats[u.field]) : 100;
            const col = pctColor(p);
            return (
              <div key={u.key} className="rounded-lg border border-line/60 bg-ink/35 px-2.5 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-fg-faint">{u.label}</div>
                <div className="mt-0.5 flex items-baseline gap-0.5 font-sans tabular-nums">
                  <motion.span animate={{ color: col }} transition={{ duration: 0.8 }} className="text-[24px] leading-none font-light">
                    <AnimatedNumber value={p} duration={1.2} />
                  </motion.span>
                  <span className="text-[11px] text-fg-faint">%</span>
                </div>
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line/60">
                  <motion.div
                    className="h-full rounded-full"
                    initial={false}
                    animate={{ width: `${p}%`, backgroundColor: col }}
                    transition={{ duration: 1.2, ease: GLIDE }}
                  />
                </div>
                <div className="mt-1 text-[9.5px] uppercase tracking-wider text-fg-faint">on time</div>
              </div>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[11.5px]">
          <span className="text-fg-dim">Unservable at capacity</span>
          <span className={cn("font-mono", stats?.unservable ? "text-alert" : "text-fg-dim")}>
            <AnimatedNumber value={stats?.unservable ?? 0} /> orders
          </span>
        </div>
      </div>

      <div className="border-t border-line/60 px-4 pt-2.5 pb-3">
        <SectionLabel>Recent reroutes</SectionLabel>
        {recent.length === 0 ? (
          <p className="mt-2 text-[11.5px] text-fg-faint">{outage ? "Waiting for orders…" : "All labs nominal."}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            <AnimatePresence initial={false}>
              {recent.map((o) => (
                <motion.li
                  key={o.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: GLIDE }}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span
                    className={cn(
                      "w-[46px] shrink-0 rounded px-1 py-px text-center text-[9px] font-semibold tracking-[0.12em] uppercase ring-1",
                      o.urgency === "stat" ? "text-real ring-real/40" : o.urgency === "urgent" ? "text-fg ring-line" : "text-fg-faint ring-line",
                    )}
                  >
                    {o.urgency}
                  </span>
                  <span className="min-w-0 truncate text-fg">{o.test}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-fg-dim">
                    {o.to_hospital && o.to_hospital !== o.from_hospital ? (
                      <>
                        {hospitalShort(o.from_hospital)}
                        <ArrowRight className="size-3 text-real" strokeWidth={2} />
                        <span className="text-fg">{hospitalShort(o.to_hospital)}</span>
                      </>
                    ) : (
                      <>{hospitalShort(o.from_hospital)} <span className="text-fg-faint">in-house</span></>
                    )}
                  </span>
                  <span className="w-[48px] shrink-0 text-right font-mono text-[11px] text-fg-faint">
                    {o.eta_min != null ? `${Math.round(o.eta_min)} min` : "—"}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Glass>
  );
}
