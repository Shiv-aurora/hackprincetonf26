"use client";
// The tour's two floating pills: the caption (top centre) and the controls (bottom centre).

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { Button, Dot, cn } from "@/components/ui";

const FADE = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };

export function Caption({ stepKey, kicker, headline, sub }: { stepKey: number; kicker: string; headline: string; sub?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-4">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={stepKey}
          initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          transition={reduce ? { duration: 0 } : FADE}
          className="pointer-events-auto max-w-[min(1160px,100%)] rounded-xl border border-border bg-background px-7 py-2 text-center">
          {/* 8 + 8 + 20 + 38 + 26 + 8 = 108px: the film, dashboard and cards all start below that. */}
          <p className="text-[15px] leading-5 text-fg-muted tabular-nums">{kicker}</p>
          {headline && <h1 className="truncate text-[32px] leading-[38px] font-semibold tracking-[-0.03em] text-fg">{headline}</h1>}
          {sub && <p className="truncate text-[19px] leading-[26px] text-fg-muted">{sub}</p>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export interface ControlsProps {
  step: number;              // 0-based
  total: number;
  seconds: number[];         // per step, for the progress fill while autoplaying
  autoplay: boolean;
  ready: boolean;
  label: string;             // run honesty label, e.g. "Scripted"
  scripted: boolean;
  onGo: (i: number) => void;
  onToggleAutoplay: () => void;
}

export function Controls({ step, total, seconds, autoplay, ready, label, scripted, onGo, onToggleAutoplay }: ControlsProps) {
  const reduce = useReducedMotion();
  const last = step === total - 1;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-4">
      <nav aria-label="Demo steps"
        className="pointer-events-auto flex h-11 max-w-full items-center gap-3 rounded-full border border-border bg-background pr-1.5 pl-4">
        {label && (
          <span className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-fg-muted md:inline-flex">
            <Dot tone={scripted ? "alert" : "neutral"} />{label}
          </span>
        )}
        {label && <span className="hidden h-5 w-px bg-border md:block" />}

        <button type="button" onClick={() => onGo(step - 1)} disabled={step === 0} aria-label="Previous step"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40">
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>

        <div className="flex items-center gap-1" role="group" aria-label="Progress">
          {Array.from({ length: total }, (_, i) => (
            <button key={i} type="button" onClick={() => onGo(i)} aria-label={`Go to step ${i + 1}`}
              aria-current={i === step ? "step" : undefined}
              className="group flex h-6 items-center">
              <span className="relative block h-1 w-3 overflow-hidden rounded-full bg-border-strong transition-colors group-hover:bg-fg-subtle sm:w-4">
                {i < step && <span className="absolute inset-0 bg-fg" />}
                {i === step && (autoplay && ready && !last && !reduce
                  ? <motion.span key={`${step}-play`} className="absolute inset-y-0 left-0 bg-fg"
                      initial={{ width: "0%" }} animate={{ width: "100%" }}
                      transition={{ duration: seconds[i], ease: "linear" }} />
                  : <span className="absolute inset-0 bg-fg" />)}
              </span>
            </button>
          ))}
        </div>

        <span className="w-11 shrink-0 text-center text-xs text-fg-muted tabular-nums">{step + 1} / {total}</span>

        <button type="button" onClick={onToggleAutoplay} aria-pressed={autoplay}
          title={autoplay ? "Pause autoplay (A)" : "Autoplay (A)"}
          className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors hover:bg-surface-2",
            autoplay ? "text-fg" : "text-fg-muted hover:text-fg")}>
          {autoplay ? <Pause className="size-3.5" strokeWidth={2} /> : <Play className="size-3.5" strokeWidth={2} />}
          <span className="hidden sm:inline">Autoplay</span>
        </button>

        <Button variant="primary" size="sm" className="shrink-0 rounded-full" onClick={() => onGo(last ? 0 : step + 1)}>
          {last ? "Restart" : "Next →"}
        </Button>
      </nav>
    </div>
  );
}
