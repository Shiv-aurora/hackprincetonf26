"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMJ } from "@/lib/events";
import { WORLD, type NodeState } from "@/lib/contracts";
import { useRunLabel } from "./LiveChip";
import { PrimaryCTA, SecondaryCTA } from "./Hero";
import { Mark } from "./Mark";

const GLIDE = [0.16, 1, 0.3, 1] as const;

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 1.2, ease: GLIDE, delay }}
    >
      {children}
    </motion.div>
  );
}

function Chapter({
  n, accent, title, children, card,
}: { n: string; accent: string; title: ReactNode; children: ReactNode; card: ReactNode }) {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-24 sm:px-10 md:grid-cols-[1.05fr_0.95fr] md:gap-20 md:py-36">
      <Reveal className="min-w-0">
        <div className="mb-6 flex items-center gap-4 font-mono text-[11px] tracking-[0.3em] uppercase" style={{ color: accent }}>
          <span>{n}</span>
          <span className="h-px w-12" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
        </div>
        <h2 className="text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.04] font-medium tracking-[-0.03em] text-white">
          {title}
        </h2>
        <div className="mt-6 max-w-[34rem] space-y-4 text-[17px] leading-relaxed text-white/58">{children}</div>
      </Reveal>
      <Reveal delay={0.15} className="min-w-0">{card}</Reveal>
    </section>
  );
}

function Card({ title, children, tint = "teal" }: { title: string; children: ReactNode; tint?: "teal" | "violet" | "amber" }) {
  const { scripted, connected, label } = useRunLabel();
  const glow = tint === "teal" ? "rgba(45,226,208,0.10)" : tint === "violet" ? "rgba(139,92,246,0.13)" : "rgba(255,181,71,0.08)";
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-sm sm:p-6"
      style={{ backgroundImage: `radial-gradient(120% 80% at 100% 0%, ${glow}, transparent 60%)` }}
    >
      <div className="mb-5 flex items-center justify-between gap-3 font-mono text-[10.5px] tracking-[0.2em] uppercase">
        <span className="text-white/45">{title}</span>
        <span className={connected ? (scripted ? "text-[#ffb547]/80" : "text-[#2de2d0]") : "text-white/30"}>{label}</span>
      </div>
      {children}
    </div>
  );
}

// -------------------------------------------------------------- 01

function AttackerCard() {
  const log = useMJ((s) => s.view.attackerLog);
  const lines = log.slice(-5);
  return (
    <Card title="Attacker's view" tint="amber">
      <div className="min-h-[188px] space-y-2.5 font-mono text-[12.5px] leading-relaxed">
        {lines.length === 0 && <p className="text-white/30">Waiting for the attacker…</p>}
        {lines.map((l, i) => (
          <motion.p
            key={l.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: i === lines.length - 1 ? 1 : 0.4 + i * 0.12, x: 0 }}
            transition={{ duration: 0.6, ease: GLIDE }}
            className={`line-clamp-2 [overflow-wrap:anywhere] ${
              l.kind === "thought" ? "text-white/60 italic"
                : l.kind === "claim" ? "text-[#ffb547]"
                : l.tier === "shadow" ? "text-[#c4b5fd]"
                : "text-[#99f6e4]"
            }`}
          >
            {l.kind === "thought" ? "› " : ""}{l.text}
          </motion.p>
        ))}
      </div>
      <p className="mt-5 border-t border-white/[0.06] pt-4 text-[13px] text-white/40">
        Starting point: a phished night-shift nurse login.
      </p>
    </Card>
  );
}

// -------------------------------------------------------------- 02

function ShadowCard() {
  const counts = useMJ((s) => s.view.counts);
  const canary = useMJ((s) => s.view.canary);
  const reveal = useMJ((s) => s.view.reveal);
  const diverted = useMJ((s) => s.view.diverted);
  const total = Math.max(1, counts.real + counts.shadow);
  const bars = [
    { k: "Real hospital", v: counts.real, c: "#2de2d0" },
    { k: "Shadow hospital", v: counts.shadow, c: "#a78bfa" },
  ];
  return (
    <Card title="Where requests landed" tint="violet">
      <div className="space-y-4">
        {bars.map((b) => (
          <div key={b.k}>
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="text-white/60">{b.k}</span>
              <span className="font-mono tabular-nums" style={{ color: b.c }}>{b.v}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full rounded-full"
                style={{ background: b.c, boxShadow: `0 0 12px ${b.c}` }}
                animate={{ width: `${(b.v / total) * 100}%` }}
                transition={{ duration: 0.9, ease: GLIDE }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-7 flex items-end justify-between border-t border-white/[0.06] pt-5">
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.2em] text-white/40 uppercase">Protected secrets leaked</div>
          <div className="mt-1 text-[44px] leading-none font-light tracking-tight text-white tabular-nums">
            {canary.leaked}
            <span className="text-white/30"> / {canary.total}</span>
          </div>
        </div>
        <div className="max-w-[48%] text-right font-mono text-[11.5px] leading-relaxed text-[#c4b5fd]/80">
          {reveal
            ? <>shadow session {reveal.shadow_session}<br />{reveal.real_bytes} bytes from the real hospital</>
            : diverted ? <>session diverted<br />to the shadow tier</> : <span className="text-white/30">no diversion yet</span>}
        </div>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------- 03

const NODE_COLOR: Record<NodeState, string> = {
  healthy: "#2de2d0", degraded: "#ffb547", quarantined: "#ffb547", compromised: "#f87171", down: "#f87171",
};

function ContinuityCard() {
  const c = useMJ((s) => s.view.continuity);
  const nodes = useMJ((s) => s.view.nodes);
  const stats = [
    { k: "STAT on time", v: c ? `${Math.round(c.stat_on_time_pct)}%` : "—" },
    { k: "Urgent on time", v: c ? `${Math.round(c.urgent_on_time_pct)}%` : "—" },
    { k: "Can't be saved", v: c ? String(c.unservable) : "—" },
  ];
  return (
    <Card title="Lab continuity" tint="teal">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.k}>
            <div className="text-[34px] leading-none font-light tracking-tight text-white tabular-nums">{s.v}</div>
            <div className="mt-2 text-[12px] text-white/45">{s.k}</div>
          </div>
        ))}
      </div>
      <div className="mt-7 grid grid-cols-3 gap-x-3 gap-y-3 border-t border-white/[0.06] pt-5 sm:grid-cols-6">
        {WORLD.hospitals.map((h) => {
          const st = nodes[h.id] ?? "healthy";
          return (
            <div key={h.id} className="flex flex-col items-start gap-1.5" title={`${h.name}: ${st}`}>
              <span
                className="h-2 w-2 rounded-full transition-colors duration-700"
                style={{ background: NODE_COLOR[st], boxShadow: `0 0 10px ${NODE_COLOR[st]}` }}
              />
              <span className="text-[11px] leading-tight text-white/50">{h.short}</span>
              <span className="font-mono text-[9.5px] tracking-wider text-white/30 uppercase">{st}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// -------------------------------------------------------------- page body

export function Story() {
  return (
    <div id="story" className="relative bg-[#05070c]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_30%,rgba(139,92,246,0.06),transparent),radial-gradient(50%_30%_at_10%_70%,rgba(45,226,208,0.05),transparent)]" />

      <Chapter n="01" accent="#ffb547" title={<>Hospitals will be&nbsp;breached.</>} card={<AttackerCard />}>
        <p>
          A phished password, a reused credential, a vendor with too much access. Someone gets in. In June 2024,
          ransomware at the pathology provider Synnovis disrupted blood testing across London hospitals for weeks.
        </p>
        <p className="text-white/80">MayaJaal starts from the assumption that the attacker is already inside.</p>
      </Chapter>

      <Chapter
        n="02"
        accent="#a78bfa"
        title={<>Attackers get a world that <span className="bg-gradient-to-r from-[#a78bfa] to-[#e879f9] bg-clip-text text-transparent">isn&apos;t there.</span></>}
        card={<ShadowCard />}
      >
        <p>
          When a session starts acting like an attacker, it is quietly moved into a shadow hospital. Each one is
          seeded from a session key and public templates, never from patient data, and it answers like the real thing.
        </p>
        <p>
          Protected records sit behind independent controls. Capture one hospital and you hold one key share. You need three.
        </p>
      </Chapter>

      <Chapter
        n="03"
        accent="#2de2d0"
        title={<>Care keeps <span className="text-[#5eead4]">running.</span></>}
        card={<ContinuityCard />}
      >
        <p>
          When a shared lab goes dark, lab orders reroute to healthy hospitals, STAT tests first.
        </p>
        <p>
          We show the on-time rate and the orders that can&apos;t be saved, because capacity is finite and we&apos;d
          rather say so.
        </p>
      </Chapter>

      <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-24 pb-28 text-center sm:pt-36 sm:pb-36">
        <Reveal className="flex flex-col items-center">
          <Mark className="mb-10 h-14 w-14 [filter:drop-shadow(0_0_18px_rgba(124,243,255,0.35))]" />
          <h2 className="text-[clamp(2.2rem,5.4vw,4.2rem)] leading-[1.02] font-medium tracking-[-0.035em] text-white">
            Don&apos;t trust us.
            <br />
            <span className="bg-gradient-to-r from-[#5eead4] via-[#a5b4fc] to-[#e879f9] bg-clip-text text-transparent">
              Bring your own agent.
            </span>
          </h2>
          <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-white/55">
            Point your own AI attacker at the Arena. Every run is logged, replayable, and scored on what actually leaked.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <SecondaryCTA href="/arena">Try to break it</SecondaryCTA>
            <PrimaryCTA href="/war-room">Watch a live attack</PrimaryCTA>
          </div>
        </Reveal>
      </section>

      <footer className="relative mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-8 font-mono text-[11px] tracking-[0.12em] text-white/30 sm:flex-row sm:px-10">
        <span>MAYAJAAL · HACKPRINCETON F26</span>
        <span className="text-center sm:text-right">Cards show the hub&apos;s event stream. Scripted runs are labelled as such.</span>
      </footer>
    </div>
  );
}
