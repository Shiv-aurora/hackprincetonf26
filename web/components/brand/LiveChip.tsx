"use client";

import { useMJ } from "@/lib/events";

/** Is the current run a real live run, or scripted / replayed? (CLAUDE.md rule 5) */
export function useRunLabel() {
  const connected = useMJ((s) => s.connected);
  const run = useMJ((s) => s.view.run);
  const scripted = !run || run.model === "scripted" || !run.live;
  const label = !connected
    ? "Stream offline"
    : !run
      ? "Waiting for a run"
      : scripted
        ? run.model === "scripted" ? "Scripted demo" : "Replay"
        : `Live · ${run.model}`;
  return { connected, run, scripted, label };
}

/** Small status pill: hub connection + whether the stream is a live run or a scripted replay. */
export function LiveChip({ className = "" }: { className?: string }) {
  const { connected, scripted, label } = useRunLabel();
  const color = !connected ? "bg-white/30" : scripted ? "bg-[#ffb547]" : "bg-[#2de2d0]";
  return (
    <span
      className={`hidden h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 font-mono text-[10.5px] tracking-[0.16em] text-white/55 uppercase backdrop-blur-md sm:inline-flex ${className}`}
      title="Event stream from the MayaJaal hub"
    >
      <span className="relative flex h-1.5 w-1.5">
        {connected && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 [animation-duration:2.2s] ${color}`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${color}`} />
      </span>
      {label}
    </span>
  );
}
