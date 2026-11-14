"use client";
// Left column: what the attacker sees. A plain monospace transcript of the agent's own log.
// Deliberately shows NO tier information — the agent cannot tell real from shadow, so neither can this view.

import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { WORLD } from "@/lib/contracts";
import { useMJ, type AttackerLine } from "@/lib/events";
import { Card, cn } from "@/components/ui";
import { clock, hospitalName, missionTitle, useRunStart } from "./ui";

export interface AttackerTerminalProps {
  className?: string;
}

export function AttackerTerminal({ className }: AttackerTerminalProps) {
  const log = useMJ((s) => s.view.attackerLog);
  const run = useMJ((s) => s.view.run);
  const connected = useMJ((s) => s.connected);
  const t0 = useRunStart();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const ep = WORLD.entry_point;
  return (
    <Card className={cn("overflow-hidden", className)} bodyClassName="flex min-h-0 flex-col p-0">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4 font-mono text-xs text-fg-subtle">
        <span className="truncate">
          {ep.username}@{hospitalName(ep.hospital_id).toLowerCase().replace(/\s+/g, "-")}
        </span>
        <span className="truncate">
          {run ? `${run.attacker_label} · mission: ${missionTitle(run.mission).toLowerCase()}` : "no run"}
        </span>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6]"
      >
        {log.length === 0 ? (
          <p className="text-fg-subtle">{connected ? "Waiting for the attacker…" : "Waiting for the event stream…"}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {log.map((l) => <Line key={l.id} line={l} t0={t0} />)}
          </ol>
        )}
      </div>
    </Card>
  );
}

function Line({ line, t0 }: { line: AttackerLine; t0: number | null }) {
  const reduce = useReducedMotion();
  const time = <span className="w-10 shrink-0 select-none text-fg-subtle tabular-nums">{clock(line.ts, t0)}</span>;
  const wrap = (cls: string, children: ReactNode) => (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex gap-3", cls)}
    >
      {children}
    </motion.li>
  );

  switch (line.kind) {
    case "thought":
      return wrap("pt-2 first:pt-0", <>{time}<p className="min-w-0 text-fg-muted">{line.text}</p></>);
    case "tool_call": {
      const text = line.text.replace(/^(→|\$)\s*/, "");
      const m = text.match(/^([A-Z]+)\s+(.*)$/);
      return wrap("", <>
        {time}
        <p className="min-w-0 break-all text-fg">
          {m ? <><span className="font-semibold">{m[1]}</span> {m[2]}</> : text}
        </p>
      </>);
    }
    case "tool_result": {
      const lines = line.text.split("\n");
      const shown = lines.slice(0, 3);
      return wrap("", <>
        <span className="w-10 shrink-0" />
        <div className="min-w-0 border-l border-border pl-3 text-fg-subtle">
          {shown.map((t, i) => <p key={i} className="truncate">{t || " "}</p>)}
          {lines.length > 3 && <p className="text-fg-subtle/70">… {lines.length - 3} more lines</p>}
        </div>
      </>);
    }
    case "claim":
      return wrap("pt-2", <>
        {time}
        <div className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-3 py-2">
          <p className="mb-0.5 font-sans text-xs font-medium text-fg-muted">Agent reports success</p>
          <p className="font-medium text-fg">{line.text}</p>
        </div>
      </>);
  }
}
