"use client";

import { useMJ } from "@/lib/events";
import { Badge, Dot } from "@/components/ui";

/** Is the current run a real live run, or scripted / replayed? (CLAUDE.md rule 5) */
export function useRunLabel() {
  const connected = useMJ((s) => s.connected);
  const run = useMJ((s) => s.view.run);
  const scripted = !run || run.model === "scripted" || !run.live;
  const label = !connected
    ? "Offline"
    : !run
      ? "Waiting for a run"
      : scripted
        ? run.model === "scripted" ? "Scripted demo" : "Replay"
        : `Live · ${run.model}`;
  return { connected, run, scripted, label };
}

/** Small status pill: hub connection + whether the stream is a live run or a scripted replay. */
export function LiveChip({ className }: { className?: string }) {
  const { connected, run, scripted, label } = useRunLabel();
  const live = connected && !!run && !scripted;
  return (
    <Badge tone={live ? "ok" : "neutral"} className={className}>
      <Dot tone={live ? "ok" : connected && run ? "alert" : "neutral"} />
      {label}
    </Badge>
  );
}
