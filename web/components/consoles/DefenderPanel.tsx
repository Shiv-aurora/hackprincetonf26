"use client";
// DEFENDER'S TRUTH — what is really happening: intent, diversion, canaries, lures, policy.

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, IdCard, Globe, KeyRound, Link2, ShieldCheck } from "lucide-react";
import type { EventDataMap, Goal, HoneytokenKind, PolicyAction, Stage } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { AnimatedNumber, C, GLIDE, Glass, SectionLabel, attackerSessionOf, cn } from "./ui";

export interface DefenderPanelProps {
  className?: string;
  /** How many recent policy decisions to list. */
  maxDecisions?: number;
}

export function DefenderPanel({ className, maxDecisions = 4 }: DefenderPanelProps) {
  const events = useMJ((s) => s.events);
  const session = useMemo(() => attackerSessionOf(events), [events]);

  return (
    <Glass className={cn("h-full", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 pt-4 pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-real" strokeWidth={1.75} />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] whitespace-nowrap text-fg">Defender&apos;s truth</h2>
          </div>
          <p className="mt-1.5 font-mono text-[11.5px] text-fg-dim">
            {session ? <>session <span className="text-fg">{session}</span></> : <span className="text-fg-faint">no attacker session yet</span>}
          </p>
        </div>
        <SessionBadge />
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <IntentSection />
        <HoneytokenSection />
        <BreadcrumbSection />
        <PolicySection max={maxDecisions} session={session} />
      </div>

      <CanaryLedger />
    </Glass>
  );
}

// ------------------------------------------------------------------ session status

export function SessionBadge({ className }: { className?: string }) {
  const diverted = useMJ((s) => s.view.diverted);
  return (
    <div className={cn("relative h-[46px] w-[146px] shrink-0 [perspective:600px]", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {diverted ? (
          <motion.div
            key="shadow"
            initial={{ rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 90, opacity: 0 }}
            transition={{ duration: 0.7, ease: GLIDE }}
            className="absolute inset-0 flex flex-col items-end justify-center rounded-xl border border-shadow/50 bg-gradient-to-br from-shadow/25 to-shadow-hot/15 px-3 shadow-[0_0_32px_-6px_var(--shadow)]"
          >
            <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[0.16em] text-[color-mix(in_srgb,var(--shadow)_55%,white)]">
              <span className="size-1.5 animate-pulse rounded-full bg-shadow-hot shadow-[0_0_10px_var(--shadow-hot)]" />
              IN SHADOW
            </span>
            <span className="whitespace-nowrap text-[9.5px] text-shadow/90">attacker sees no change</span>
          </motion.div>
        ) : (
          <motion.div
            key="real"
            initial={{ rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 90, opacity: 0 }}
            transition={{ duration: 0.7, ease: GLIDE }}
            className="absolute inset-0 flex flex-col items-end justify-center rounded-xl border border-real/35 bg-real/[0.07] px-3"
          >
            <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[0.16em] text-real">
              <span className="size-1.5 rounded-full bg-real" />
              REAL
            </span>
            <span className="text-[10px] text-real/70">real tier</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ intent

const GOALS: Goal[] = ["benign", "recon", "exfil", "tamper", "disrupt"];
const STAGES: Stage[] = ["recon", "access", "collect", "act"];

function IntentSection() {
  const posterior = useMJ((s) => s.view.posterior);
  const top = useMJ((s) => s.view.topGoal);
  const stage = useMJ((s) => s.view.stage);
  const evidence = useMJ((s) => s.view.intentEvidence);
  const topColor = top === "benign" ? C.real : C.alert;

  return (
    <div>
      <SectionLabel
        right={
          <span className="flex items-baseline gap-1.5">
            top goal
            <motion.span
              key={top}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: GLIDE }}
              className="font-semibold uppercase tracking-[0.14em]"
              style={{ color: topColor }}
            >
              {top}
            </motion.span>
          </span>
        }
      >
        Intent
      </SectionLabel>

      <div className="mt-3 space-y-2">
        {GOALS.map((g) => {
          const p = posterior[g] ?? 0;
          const isTop = g === top;
          const color = isTop ? topColor : C.faint;
          return (
            <div key={g} className="grid grid-cols-[64px_1fr_44px] items-center gap-3">
              <span className={cn("text-[12px] capitalize", isTop ? "font-medium text-fg" : "text-fg-dim")}>{g}</span>
              <div className="relative h-[7px] overflow-hidden rounded-full bg-line/70">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  initial={false}
                  animate={{ width: `${Math.max(1.5, p * 100)}%`, backgroundColor: color }}
                  transition={{ duration: 1.1, ease: GLIDE }}
                  style={{ boxShadow: isTop ? `0 0 14px ${topColor}` : "none" }}
                />
              </div>
              <span className={cn("text-right font-mono text-[12px]", isTop ? "text-fg" : "text-fg-faint")}>
                <AnimatedNumber value={p * 100} />%
              </span>
            </div>
          );
        })}
      </div>

      {/* stage track */}
      <div className="mt-4">
        <div className="relative grid grid-cols-4">
          <div className="absolute top-[5px] right-[12.5%] left-[12.5%] h-px bg-line" />
          <motion.div
            className="absolute top-[5px] left-[12.5%] h-px bg-alert/80"
            initial={false}
            animate={{ width: `${(STAGES.indexOf(stage) / (STAGES.length - 1)) * 75}%` }}
            transition={{ duration: 1, ease: GLIDE }}
          />
          {STAGES.map((st, i) => {
            const idx = STAGES.indexOf(stage);
            const reached = i <= idx;
            const current = i === idx;
            return (
              <div key={st} className="relative flex flex-col items-center gap-1.5">
                <span className="relative flex size-[11px] items-center justify-center">
                  {current && <span className="absolute inset-[-4px] animate-ping rounded-full bg-alert/30" />}
                  <span
                    className={cn(
                      "relative size-[11px] rounded-full border transition-colors duration-700",
                      reached ? "border-alert bg-alert" : "border-line bg-ink-2",
                      current && "shadow-[0_0_12px_var(--alert)]",
                    )}
                  />
                </span>
                <span className={cn("text-[10.5px] uppercase tracking-[0.14em] transition-colors duration-700", current ? "text-alert" : reached ? "text-fg-dim" : "text-fg-faint")}>
                  {st}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {evidence && (
        <motion.p
          key={evidence}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="mt-3.5 border-l border-line pl-3 text-[12px] leading-relaxed text-fg-dim"
        >
          {evidence}
        </motion.p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ honeytokens

const HT_ICON: Record<HoneytokenKind, typeof KeyRound> = {
  credential: KeyRound, file: FileText, mrn: IdCard, url: Link2, api_key: Globe,
};

function HoneytokenSection() {
  const minted = useMJ((s) => s.view.honeytokensMinted);
  const touched = useMJ((s) => s.view.honeytokensTouched);
  const touchedBy = useMemo(() => new Map(touched.map((t) => [t.token_id, t])), [touched]);

  return (
    <div>
      <SectionLabel
        right={<><span className="text-fg">{minted.length}</span> minted · <span className={touched.length ? "text-shadow-hot" : "text-fg"}>{touched.length}</span> touched</>}
      >
        Honeytokens
      </SectionLabel>
      {minted.length === 0 ? (
        <Empty>None minted yet. Canaries are minted per session once it is diverted.</Empty>
      ) : (
        <ul className="mt-3 space-y-1.5">
          <AnimatePresence initial={false}>
            {minted.map((m) => {
              const t = touchedBy.get(m.token_id);
              const Icon = HT_ICON[m.kind] ?? KeyRound;
              return (
                <motion.li
                  key={m.token_id}
                  layout
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, ease: GLIDE }}
                  className={cn(
                    "relative flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 transition-colors duration-700",
                    t ? "border-shadow-hot/50 bg-shadow-hot/[0.09]" : "border-line/70 bg-ink/30",
                  )}
                >
                  {t && (
                    <motion.span
                      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-shadow-hot/30 via-shadow/10 to-transparent"
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 2.2, ease: "easeOut" }}
                    />
                  )}
                  <Icon className={cn("size-3.5 shrink-0", t ? "text-shadow-hot" : "text-shadow/70")} strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11.5px] text-fg">{m.token_id}</span>
                      <span className="text-[10px] uppercase tracking-wider text-fg-faint">{m.kind.replace("_", " ")}</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-fg-dim" title={t ? t.where : m.placed_at}>
                      {t ? <>touched in {t.where}</> : m.placed_at}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold tracking-[0.16em]",
                      t ? "bg-shadow-hot/20 text-shadow-hot shadow-[0_0_12px_-2px_var(--shadow-hot)]" : "text-fg-faint ring-1 ring-line",
                    )}
                  >
                    {t ? "TOUCHED" : "ARMED"}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ breadcrumbs

function BreadcrumbSection() {
  const crumbs = useMJ((s) => s.view.breadcrumbs);
  return (
    <div>
      <SectionLabel right={crumbs.length ? <>{crumbs.length} planted</> : null}>Breadcrumbs</SectionLabel>
      {crumbs.length === 0 ? (
        <Empty>The planner places lures that best separate the top two goals.</Empty>
      ) : (
        <ul className="mt-3 space-y-2">
          {crumbs.map((c, i) => (
            <motion.li
              key={`${c.path}-${i}`}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: GLIDE }}
              className="rounded-lg border border-line/70 bg-ink/30 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-fg">{humanize(c.kind)}</span>
                <span className="font-mono text-[11.5px] text-shadow">
                  {c.info_gain.toFixed(2)} <span className="text-fg-faint">bits</span>
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-fg-dim">{c.path}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-faint">{c.target_goals.join(" vs ")}</span>
              </div>
              <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line/60">
                <motion.div
                  className="h-full rounded-full bg-shadow"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, c.info_gain * 100)}%` }}
                  transition={{ duration: 1.2, ease: GLIDE, delay: 0.2 }}
                />
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ policy

const ACTION_STYLE: Record<PolicyAction, { label: string; cls: string }> = {
  allow_real: { label: "ALLOW · REAL", cls: "text-real ring-real/40 bg-real/[0.06]" },
  divert_shadow: { label: "DIVERT · SHADOW", cls: "text-shadow ring-shadow/50 bg-shadow/10" },
  deny: { label: "DENY", cls: "text-alert ring-alert/40 bg-alert/[0.07]" },
  step_up: { label: "STEP-UP", cls: "text-alert ring-alert/40 bg-alert/[0.07]" },
};

function PolicySection({ max, session }: { max: number; session: string | null }) {
  const events = useMJ((s) => s.events);
  const { mine, clinical } = useMemo(() => {
    const mine: (EventDataMap["policy.decision"] & { id: string })[] = [];
    let clinical = 0;
    for (const e of events) {
      if (e.type !== "policy.decision") continue;
      if (session && e.session_id === session) mine.push({ ...e.data, id: e.id });
      else if (e.data.action === "allow_real") clinical++;
    }
    return { mine: mine.slice(-max).reverse(), clinical };
  }, [events, session, max]);

  return (
    <div>
      <SectionLabel right={clinical ? <>{clinical} clinical reads allowed</> : null}>Policy decisions</SectionLabel>
      {mine.length === 0 ? (
        <Empty>Every attacker request gets a lane and an action.</Empty>
      ) : (
        <ul className="mt-3 space-y-1">
          <AnimatePresence initial={false}>
            {mine.map((d, i) => {
              const st = ACTION_STYLE[d.action];
              return (
                <motion.li
                  key={d.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: i === 0 ? 1 : 0.62, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: GLIDE }}
                  className="py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded px-1.5 py-px text-[9.5px] font-semibold tracking-[0.14em] ring-1", st.cls)}>{st.label}</span>
                    <span className="text-[10.5px] uppercase tracking-wider text-fg-faint">lane: {d.lane}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-fg-dim">{d.reason}</p>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ canary ledger

export function CanaryLedger({ className }: { className?: string }) {
  const { leaked, total } = useMJ((s) => s.view.canary);
  const bad = leaked > 0;
  return (
    <div
      className={cn(
        "relative border-t px-5 py-4",
        bad ? "border-danger/40 bg-danger/[0.06]" : "border-line/70 bg-gradient-to-b from-real/[0.03] to-real/[0.07]",
        className,
      )}
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-fg-dim">Protected secrets leaked</div>
          <div className="mt-1 text-[10.5px] text-fg-faint">canary ledger · ground truth from the real tier</div>
        </div>
        <div className="flex items-baseline gap-1.5 font-sans tabular-nums">
          <AnimatedNumber
            value={leaked}
            className={cn("text-[44px] font-light leading-none tracking-tight", bad ? "text-danger" : "text-real drop-shadow-[0_0_18px_rgba(45,226,230,0.45)]")}
          />
          <span className="text-[20px] font-light text-fg-faint">/ {total}</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 text-[12px] leading-relaxed text-fg-faint">{children}</p>;
}

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
