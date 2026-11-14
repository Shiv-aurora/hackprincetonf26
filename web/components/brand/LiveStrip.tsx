"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { connectHub, useMJ } from "@/lib/events";
import { cn } from "@/components/ui";
import { LiveChip } from "./LiveChip";

/** Three live numbers from the shared store, with an honest live / scripted label. */
export function LiveStrip({ className }: { className?: string }) {
  useEffect(() => connectHub(), []);
  const leaked = useMJ((s) => s.view.canary.leaked);
  const total = useMJ((s) => s.view.canary.total);
  const shadow = useMJ((s) => s.view.counts.shadow);
  const diverted = useMJ((s) => s.view.diverted);

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-background", className)}>
      <div className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
        <LiveChip />
        <Link href="/war-room"
          className="group inline-flex items-center gap-1 text-[13px] text-fg-muted transition-colors hover:text-fg">
          Open War Room
          <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
      <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Cell label="Protected records leaked">
          <span className={leaked > 0 ? "text-danger" : "text-fg"}>{leaked}</span>
          <span className="text-fg-subtle"> / {total}</span>
        </Cell>
        <Cell label="Requests to the shadow">
          <span className={shadow > 0 ? "text-shadow" : "text-fg"}>{shadow}</span>
        </Cell>
        <Cell label="Session">
          <span className={diverted ? "text-shadow" : "text-fg"}>{diverted ? "Shadow" : "Real"}</span>
        </Cell>
      </dl>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-4 sm:flex-col sm:items-start sm:justify-start sm:gap-1.5 sm:px-5 sm:py-5">
      <dt className="text-[13px] text-fg-muted">{label}</dt>
      <dd className="text-2xl font-semibold tracking-[-0.03em] tabular-nums sm:text-[28px]">{children}</dd>
    </div>
  );
}
