// "Why we don't stop the attack": the argument in three beats, shared by the landing page and the demo.
// Claims stay within what the system does: diversion, per-session decoys, field encryption with a
// key split 3-of-6 across the hospitals (the records themselves are not sharded).
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

function BlockGlyph() {
  return (
    <svg viewBox="0 0 160 64" className="h-16 w-full" aria-hidden>
      <rect x="62" y="12" width="36" height="40" rx="4" className="fill-alert-bg stroke-alert" />
      <path d="M72 24 L88 40 M88 24 L72 40" className="stroke-alert" strokeWidth={2} strokeLinecap="round" />
      {[[14, 14], [14, 40], [128, 14], [128, 40]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="18" height="12" rx="2" className="fill-background stroke-border-strong" />
      ))}
      <path d="M60 32 C 44 32, 40 20, 34 20 M60 32 C 44 32, 40 46, 34 46 M100 32 C 116 32, 120 20, 126 20 M100 32 C 116 32, 120 46, 126 46"
        className="stroke-alert" fill="none" strokeDasharray="3 3" />
    </svg>
  );
}

function DecoyGlyph() {
  return (
    <svg viewBox="0 0 160 64" className="h-16 w-full" aria-hidden>
      <rect x="14" y="14" width="40" height="36" rx="4" className="fill-background stroke-border-strong" />
      <text x="34" y="36" textAnchor="middle" className="fill-fg-muted text-[9px]">real</text>
      <rect x="106" y="14" width="40" height="36" rx="4" className="fill-shadow-bg stroke-shadow" strokeDasharray="4 3" />
      <text x="126" y="36" textAnchor="middle" className="fill-shadow text-[9px]">decoy</text>
      <path d="M64 32 H98" className="stroke-shadow" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d="M94 27 L100 32 L94 37" className="stroke-shadow" fill="none" strokeWidth={1.5} />
      <circle cx="64" cy="32" r="4" className="fill-alert" />
    </svg>
  );
}

function KeyGlyph() {
  const pts = [[20, 12], [20, 52], [80, 6], [80, 58], [140, 12], [140, 52]];
  return (
    <svg viewBox="0 0 160 64" className="h-16 w-full" aria-hidden>
      {pts.map(([x, y], i) => (
        <g key={i}>
          <line x1={80} y1={32} x2={x} y2={y} className="stroke-border-strong" />
          <circle cx={x} cy={y} r={5} className={i < 3 ? "fill-fg" : "fill-background stroke-border-strong"} />
        </g>
      ))}
      <rect x="70" y="24" width="20" height="16" rx="3" className="fill-fg" />
      <path d="M74 24 V20 a6 6 0 0 1 12 0 V24" fill="none" className="stroke-fg" strokeWidth={1.75} />
    </svg>
  );
}

const BEATS: { kicker: string; title: string; body: string; glyph: ReactNode; tone: string }[] = [
  {
    kicker: "If you block it", title: "They try another door.", glyph: <BlockGlyph />, tone: "text-alert",
    body: "A refusal tells an attacker they were seen. They switch to another login, another weakness, another hospital, and next time you might not notice.",
  },
  {
    kicker: "So we let it run", title: "They steal fake data.", glyph: <DecoyGlyph />, tone: "text-shadow",
    body: "Every request still works, but inside a decoy. They spend their time on records that don't exist and show us what they're after.",
  },
  {
    kicker: "Meanwhile", title: "The real data stays locked.", glyph: <KeyGlyph />, tone: "text-fg",
    body: "Sensitive fields are encrypted on disk. The key is split across six sites and any three are needed to rebuild it, so one break-in can't open it.",
  },
];

export function WhyNotBlock({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-3", className)}>
      {BEATS.map((b) => (
        <article key={b.title} className="flex flex-col rounded-xl border border-border bg-background p-2">
          <div className="flex items-center rounded-lg border border-border bg-surface px-4 py-3">{b.glyph}</div>
          <div className={cn("px-3 pb-3", compact ? "pt-3" : "pt-5")}>
            <p className={cn("text-[13px] font-medium", b.tone)}>{b.kicker}</p>
            <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{b.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{b.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
