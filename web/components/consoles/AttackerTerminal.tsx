"use client";
// ATTACKER'S VIEW — only what the attacker believes. Never render tier / shadow information here.

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SquareTerminal } from "lucide-react";
import { WORLD } from "@/lib/contracts";
import { useMJ, type AttackerLine } from "@/lib/events";
import { GLIDE, Glass, RunBadge, cn, hospitalName, missionTitle } from "./ui";

const STALE_MS = 2500;      // lines older than this when we first see them render instantly (hub backlog)
const RESULT_MAX_LINES = 7;
const RESULT_MAX_COLS = 160;

export interface AttackerTerminalProps {
  className?: string;
  /** Typing speed multiplier (1 = cinematic default). */
  speed?: number;
}

export function AttackerTerminal({ className, speed = 1 }: AttackerTerminalProps) {
  const run = useMJ((s) => s.view.run);
  const runId = useMJ((s) => s.view.runId);
  const connected = useMJ((s) => s.connected);
  const ended = useMJ((s) => s.view.ended);

  return (
    <Glass className={cn("h-full", className)}>
      {/* header */}
      <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 pt-4 pb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SquareTerminal className="size-3.5 text-fg-dim" strokeWidth={1.75} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-fg">Attacker&apos;s view</h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-fg-dim">
            {run ? (
              <>
                <span className="text-fg">{run.attacker_label}</span>
                <span className="text-fg-faint">·</span>
                <span>{run.model}</span>
                <span className="text-fg-faint">·</span>
                <span>mission: {missionTitle(run.mission).toLowerCase()}</span>
              </>
            ) : (
              <span className="text-fg-faint">{connected ? "waiting for an attack run…" : "connecting to hub…"}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <RunBadge />
          {ended && <span className="font-mono text-[10px] tracking-wider text-fg-faint">session closed</span>}
        </div>
      </header>

      <TerminalBody key={runId ?? "none"} speed={speed} />

      <footer className="flex items-center justify-between gap-3 border-t border-line/60 px-5 py-2 font-mono text-[10.5px] text-fg-faint">
        <span className="truncate">
          foothold: {WORLD.entry_point.username} ({WORLD.entry_point.role}) @ {hospitalName(WORLD.entry_point.hospital_id)}
        </span>
        <span className="shrink-0">phished credential</span>
      </footer>
    </Glass>
  );
}

// ------------------------------------------------------------------ body

function TerminalBody({ speed }: { speed: number }) {
  const lines = useMJ((s) => s.view.attackerLog);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const [done, setDone] = useState(0);
  // Lines that were already old when we first saw them (hub backlog on connect) are shown instantly.
  useEffect(() => {
    const now = Date.now();
    let n = done;
    while (n < lines.length && now - lines[n].ts > STALE_MS) n++;
    if (n !== done) setDone(n); // eslint-disable-line react-hooks/set-state-in-effect
  }, [lines, done]);
  // If we fall far behind (burst of events) catch up by finishing lines instantly.
  const behind = lines.length - done;
  const visible = lines.slice(0, Math.min(lines.length, done + 1));

  const content = useRef<HTMLDivElement>(null);
  const scrollToEnd = () => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(scrollToEnd);
  // Follow the tail whenever content grows (typing happens inside child state).
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = scroller.current;
      if (s && stick.current) s.scrollTop = s.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={scroller}
      onWheel={(e) => { if (e.deltaY < 0) stick.current = false; }}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true;
      }}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 font-mono text-[13px] leading-[1.6] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div ref={content}>
      <div className="mb-3 text-[11.5px] text-fg-faint">
        <span className="text-fg-dim">#</span> agent session · tools: shell, http
      </div>
      <div className="flex flex-col gap-3">
        {visible.map((l, i) => (
          <Line
            key={l.id}
            line={l}
            animate={i === done}
            speed={speed * (behind > 3 ? 6 : behind > 1 ? 2 : 1)}
            onProgress={scrollToEnd}
            onDone={() => setDone((d) => (d === i ? d + 1 : d))}
          />
        ))}
        {done >= lines.length && <Cursor />}
      </div>
      </div>
    </div>
  );
}

function Cursor() {
  return (
    <div className="flex items-center gap-2 text-fg-faint">
      <span className="text-ok/70">❯</span>
      <motion.span
        className="inline-block h-[1.05em] w-[0.6em] bg-fg/70"
        animate={{ opacity: [1, 1, 0, 0] }}
        transition={{ duration: 1.1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ lines

interface LineProps {
  line: AttackerLine;
  animate: boolean;
  speed: number;
  onDone: () => void;
  onProgress: () => void;
}

const Line = memo(function Line({ line, animate, speed, onDone, onProgress }: LineProps) {
  switch (line.kind) {
    case "thought":
      return <Thought text={line.text} animate={animate} speed={speed} onDone={onDone} onProgress={onProgress} />;
    case "tool_call":
      return <ToolCall text={line.text} animate={animate} speed={speed} onDone={onDone} onProgress={onProgress} />;
    case "tool_result":
      return <ToolResult text={line.text} animate={animate} speed={speed} onDone={onDone} onProgress={onProgress} />;
    case "claim":
      return <Claim text={line.text} animate={animate} onDone={onDone} />;
  }
}, (a, b) => a.line === b.line && a.animate === b.animate && a.speed === b.speed);

/** Reveals `text` progressively at `cps` characters per second. */
function useTypewriter(text: string, active: boolean, cps: number, onDone: () => void, onProgress: () => void, delayMs = 0) {
  const [n, setN] = useState(active ? 0 : text.length);
  const doneRef = useRef(onDone);
  const progRef = useRef(onProgress);
  useEffect(() => { doneRef.current = onDone; progRef.current = onProgress; });
  useEffect(() => {
    if (!active) return;
    // setInterval (not rAF) so the queue keeps moving even when the tab is backgrounded.
    const start = performance.now() + delayMs;
    let finished = false;
    const tick = () => {
      const t = performance.now();
      const k = t < start ? 0 : Math.min(text.length, Math.floor(((t - start) / 1000) * cps) + 1);
      setN(k);
      progRef.current();
      if (k >= text.length && !finished) {
        finished = true;
        clearInterval(iv);
        doneRef.current();
      }
    };
    const iv = setInterval(tick, 24);
    return () => clearInterval(iv);
  }, [active, text, cps, delayMs]);
  return active ? n : text.length;
}

function Thought({ text, animate, speed, onDone, onProgress }: { text: string; animate: boolean; speed: number; onDone: () => void; onProgress: () => void }) {
  const n = useTypewriter(text, animate, 85 * speed, onDone, onProgress);
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: GLIDE }}
      className="border-l border-fg-faint/40 pl-3 font-sans text-[13.5px] italic leading-relaxed text-fg-dim"
    >
      <span className="mb-0.5 block font-mono text-[9.5px] not-italic uppercase tracking-[0.22em] text-fg-faint">reasoning</span>
      {text.slice(0, n)}
      {n < text.length && <span className="text-fg-faint">▍</span>}
    </motion.div>
  );
}

function ToolCall({ text, animate, speed, onDone, onProgress }: { text: string; animate: boolean; speed: number; onDone: () => void; onProgress: () => void }) {
  const shell = text.startsWith("$ ");
  const cmd = text.replace(/^(\$|→)\s/, "");
  const n = useTypewriter(cmd, animate, 42 * speed, onDone, onProgress, 220 / speed);
  const typed = cmd.slice(0, n);
  let body: React.ReactNode = typed;
  if (!shell) {
    const m = /^([A-Z]+)(\s.*)?$/.exec(typed);
    if (m) body = (<><span className="font-semibold text-alert/90">{m[1]}</span>{m[2] ?? ""}</>);
  }
  return (
    <div className="group flex items-start gap-2.5">
      <span className="mt-[3px] shrink-0 rounded border border-line px-1 text-[9.5px] uppercase leading-[1.5] tracking-wider text-fg-faint">
        {shell ? "sh" : "http"}
      </span>
      <div className="min-w-0 [overflow-wrap:anywhere] text-fg">
        <span className="mr-2 text-ok">❯</span>
        {body}
        {animate && n < cmd.length && <span className="ml-px inline-block h-[1.05em] w-[0.55em] translate-y-[2px] bg-fg/80" />}
      </div>
    </div>
  );
}

function ToolResult({ text, animate, speed, onDone, onProgress }: { text: string; animate: boolean; speed: number; onDone: () => void; onProgress: () => void }) {
  const all = text.replace(/\s+$/, "").split("\n");
  const shown = all.slice(0, RESULT_MAX_LINES);
  const hidden = all.length - shown.length;
  // reveal line by line
  const n = useTypewriter("\n".repeat(shown.length), animate, 22 * speed, onDone, onProgress, 120 / speed); // n = lines shown
  return (
    <div className="ml-[38px] overflow-hidden rounded-md border border-line/50 bg-ink/50 px-3 py-2 text-[12px] leading-[1.55] text-fg-dim">
      {shown.slice(0, n).map((l, i) => (
        <motion.div
          key={i}
          initial={animate ? { opacity: 0, x: -4 } : false}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease: GLIDE }}
          className="truncate whitespace-pre"
          title={l}
        >
          {l.length > RESULT_MAX_COLS ? l.slice(0, RESULT_MAX_COLS) + "…" : l || " "}
        </motion.div>
      ))}
      {hidden > 0 && n >= shown.length && (
        <div className="mt-1 text-[11px] text-fg-faint">… {hidden} more line{hidden === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

function Claim({ text, animate, onDone }: { text: string; animate: boolean; onDone: () => void }) {
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => doneRef.current(), 900);
    return () => clearTimeout(t);
  }, [animate]);
  return (
    <motion.div
      initial={animate ? { opacity: 0, scale: 0.98, filter: "blur(6px)" } : false}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.8, ease: GLIDE }}
      className="relative overflow-hidden rounded-lg border border-ok/40 bg-ok/[0.07] px-4 py-3 shadow-[0_0_40px_-10px_var(--ok)]"
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-ok">
        <span className="size-1.5 rounded-full bg-ok shadow-[0_0_10px_var(--ok)]" />
        mission claimed
      </div>
      <p className="font-sans text-[14.5px] font-medium leading-snug text-fg">&ldquo;{text}&rdquo;</p>
    </motion.div>
  );
}
