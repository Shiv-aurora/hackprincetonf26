"use client";
// "How First Sight works": the detector behind the login alarm (backend/mayajaal/real/firstsight.py). The CUSUM
// test as typeset math, the nine weighted signals with the ones this run tripped highlighted (read from the recorded
// run's First Sight decision), and the simulation of who it catches at login, including the two it misses.
// Choreography finishes by ~4.6 s, then holds.

import { Fragment, useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";
import { CUSUM, FS_EVAL, FS_SIGNALS, type FsSignal } from "./research";
import { useRunEvents, type RunEvent } from "./run";
import { P, Tex } from "./tex";

const NB = " ";

const UPDATE = (
  <Tex>
    <msub><mi>S</mi><mi>t</mi></msub><mo>=</mo><mi>max</mi>
    <P><mn>0</mn><mo>,</mo><msub><mi>S</mi><mrow><mi>t</mi><mo>−</mo><mn>1</mn></mrow></msub><mo>+</mo><msub><mi>x</mi><mi>t</mi></msub></P>
  </Tex>
);

const EVIDENCE = (
  <Tex>
    <msub><mi>x</mi><mi>t</mi></msub><mo>=</mo>
    <munder><mo largeop="false" movablelimits="true">∑</mo><mi>i</mi></munder>
    <msub><mi>w</mi><mi>i</mi></msub><mspace width="0.12em" />
    <mo stretchy="false">[</mo><mtext>signal{NB}</mtext><mi>i</mi><mtext>{NB}fired on request{NB}</mtext><mi>t</mi><mo stretchy="false">]</mo>
  </Tex>
);

interface Alarm { score: number; threshold: number; atLogin: boolean; fired: Set<string> }

/** The recorded run's First Sight decision: its score, and which signals its reason text names. */
function alarmOf(events: RunEvent[]): Alarm | null {
  for (const e of events) {
    const reason = e.type === "policy.decision" ? e.data?.reason : undefined;
    if (typeof reason !== "string" || !reason.startsWith("First Sight")) continue;
    const m = reason.match(/score ([\d.]+) ≥ ([\d.]+)/);
    return {
      score: m ? Number(m[1]) : NaN,
      threshold: m ? Number(m[2]) : CUSUM.h,
      atLogin: reason.startsWith("First Sight at login"),
      fired: new Set(FS_SIGNALS.filter((s) => reason.includes(s.why)).map((s) => s.id)),
    };
  }
  return null;
}

const T = { eq: 0.45, signals: 1.15, fire: 2.0, sum: 2.35, chart: 2.8, misses: 3.6, fa: 4.0 };

type Tr = (delay: number, duration?: number) => object;

export function FirstSightSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr: Tr = (delay, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  const events = useRunEvents();
  const alarm = useMemo(() => (events ? alarmOf(events) : null), [events]);
  const fired = FS_SIGNALS.filter((s) => alarm?.fired.has(s.id));
  const sum = fired.reduce((a, s) => a + s.weight, 0);
  const sumMatches = !!alarm && fired.length > 0 && Math.abs(sum - alarm.score) < 0.05;

  return (
    <SlideFrame kicker="First Sight · a quickest-detection test (CUSUM, Page 1954) on every login and request" title={title}
      source={<span className="text-[16px]">backend/mayajaal/real/firstsight.py and firstsight_eval.json · weights are log-likelihood ratios in nats, set by hand, not fitted</span>}>
      {/* the test */}
      <motion.div className="flex items-end gap-16"
        initial={{ clipPath: "inset(-30% 100% -30% 0)" }} animate={{ clipPath: "inset(-30% 0% -30% 0)" }}
        transition={reduce ? { duration: 0 } : { duration: 0.8, delay: T.eq, ease: [0.33, 1, 0.68, 1] }}>
        {UPDATE}
        {EVIDENCE}
      </motion.div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.eq + 0.5, 0.35)}
        className="mt-2.5 flex items-center gap-3 text-[21px] whitespace-nowrap text-fg-muted">
        Nine signals, each weighted in nats; a quiet request takes {CUSUM.drift.toFixed(1)} off.
        <span className="inline-flex items-center gap-2 rounded-full border border-alert/45 bg-alert-bg py-0.5 pr-3.5 pl-3 text-[18px] text-alert">
          alarm at <Tex className="text-[23px] text-alert"><msub><mi>S</mi><mi>t</mi></msub><mo>≥</mo><mn>{CUSUM.h.toFixed(1)}</mn></Tex>
        </span>
      </motion.p>

      <div className="mt-4 grid grid-cols-[548px_1fr] gap-14 border-t border-border pt-4">
        {/* nine signals */}
        <div>
          <div className="grid grid-cols-2 gap-x-6">
            <SignalList head="At login" list={FS_SIGNALS.filter((s) => s.when === "login")} fired={alarm?.fired} tr={tr} />
            <SignalList head="On each request" list={FS_SIGNALS.filter((s) => s.when === "request")} fired={alarm?.fired} tr={tr} />
          </div>
          {alarm && (
            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.sum)}
              className="mt-4 flex items-baseline gap-3 text-[19px] whitespace-nowrap text-fg">
              <span className="text-fg-muted">This run</span>
              <Tex className="text-[27px] text-alert">
                {sumMatches && <>
                  {fired.map((s, i) => <Fragment key={s.id}>{i > 0 && <mo>+</mo>}<mn>{s.weight.toFixed(1)}</mn></Fragment>)}
                  <mo>=</mo>
                </>}
                <mn>{alarm.score.toFixed(1)}</mn><mo>≥</mo><mn>{alarm.threshold.toFixed(1)}</mn>
              </Tex>
              <span>→ {alarm.atLogin ? "alarm at login" : "alarm"}</span>
            </motion.p>
          )}
        </div>

        {/* who it catches */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[21px] font-semibold tracking-[-0.015em] text-fg">Caught at login</h3>
            <span className="rounded-full border border-alert/45 bg-alert-bg px-2.5 py-px text-[16px] font-medium text-alert">Simulation</span>
          </div>
          <p className="text-[16px] text-fg-muted">{FS_EVAL.label} · {FS_EVAL.perProfile} sessions per attacker</p>
          <Group head="Stolen password, used from outside" delay={T.chart - 0.1} tr={tr}>
            {FS_EVAL.profiles.filter((p) => p.outside).map((p, i) => (
              <Row key={p.id} name={p.name} note={p.note} pct={p.atLogin} delay={T.chart + i * 0.12} tr={tr} reduce={!!reduce} />
            ))}
          </Group>
          <Group head="On the nurse's own PC" delay={T.misses - 0.1} tr={tr}>
            {FS_EVAL.profiles.filter((p) => !p.outside).map((p, i) => (
              <Row key={p.id} name={p.name} pct={p.atLogin} delay={T.misses + i * 0.12} tr={tr} reduce={!!reduce}
                miss={`rules catch it at request ${FS_EVAL.ruleAt}`} />
            ))}
          </Group>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.fa, 0.35)} className="mt-3">
            <p className="text-[18px] text-fg">
              False alarms <span className="font-semibold tabular-nums">{FS_EVAL.falseAlarmPct.toFixed(1)}%</span>
              <span className="text-fg-muted"> of {FS_EVAL.benign} clinician sessions</span>
            </p>
            <p className="text-[16px] text-fg-muted">Each costs one badge + MFA prompt; the nurse still gets real data.</p>
          </motion.div>
        </div>
      </div>
    </SlideFrame>
  );
}

function SignalList({ head, list, fired, tr }: { head: string; list: FsSignal[]; fired?: Set<string>; tr: Tr }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-[16px] text-fg-subtle">{head}</span>
      {list.map((s, i) => {
        const on = !!fired?.has(s.id);
        return (
          <motion.div key={s.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={tr(T.signals + i * 0.07, 0.35)}
            className="relative -mx-2.5 px-2.5 py-[4px]">
            {on && (
              <motion.span aria-hidden className="absolute inset-0 rounded-md border border-alert/50 bg-alert-bg"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.fire, 0.3)} />
            )}
            <div className="relative flex items-baseline justify-between gap-3">
              <span className={cn("text-[18px] leading-snug whitespace-nowrap", on ? "font-medium text-alert" : "text-fg")}>{s.name}</span>
              <span className={cn("text-[18px] whitespace-nowrap tabular-nums", on ? "font-semibold text-alert" : "text-fg-muted")}>
                {s.weight.toFixed(1)}{s.per && <span className="ml-1 text-[16px] font-normal text-fg-subtle">{s.per}</span>}
              </span>
            </div>
            {s.detail && <span className="relative block text-[16px] leading-snug text-fg-subtle">{s.detail}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}

function Group({ head, delay, tr, children }: { head: string; delay: number; tr: Tr; children: ReactNode }) {
  return (
    <div className="mt-2">
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(delay, 0.3)} className="mb-0.5 text-[16px] text-fg-subtle">{head}</motion.p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({ name, note, pct, miss, delay, tr, reduce }: {
  name: string; note?: string; pct: number; miss?: string; delay: number; tr: Tr; reduce: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(delay, 0.3)}
      className="grid grid-cols-[226px_1fr_52px] items-center gap-3">
      <span className="truncate text-[17px] text-fg">
        {name}{note && <span className="ml-2 text-[16px] text-fg-subtle">{note}</span>}
      </span>
      <span className="relative h-[24px] overflow-hidden rounded-[4px] border border-border-strong">
        {pct > 0 && (
          <motion.span className="absolute inset-y-0 left-0 bg-alert" style={{ width: `${pct}%`, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.55, delay: delay + 0.1, ease: EASE }} />
        )}
        {miss && <span className="absolute inset-0 flex items-center px-2.5 text-[16px] whitespace-nowrap text-fg-muted">{miss}</span>}
      </span>
      <span className={cn("text-right text-[18px] font-semibold tabular-nums", pct > 0 ? "text-fg" : "text-fg-muted")}>{pct}%</span>
    </motion.div>
  );
}
