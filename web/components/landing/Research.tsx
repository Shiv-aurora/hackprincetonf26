// "The research behind it": how First Sight decides, and the draft paper on the adaptive deception layer.
// First Sight facts mirror backend/mayajaal/real/firstsight.py (threshold 2.0, drift 0.3, hand-set weights).
// The score shown is parsed from the recorded run's brief. The paper covers Mirage, not First Sight.
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/components/ui";
import brief from "../../public/runs/brief-mayajaal.json";

// The two clues that fired at login in the recorded run, with their weights.
const FIRED = [
  { label: "Scripted client, not the EHR app or a browser", w: 2.2, bar: "bg-fg" },
  { label: "Not one of the hospital’s own devices", w: 1.2, bar: "bg-fg-subtle" },
];
const SCALE = 4;

function ScoreBar() {
  const by = (brief as { facts?: { detected?: { by?: string } } }).facts?.detected?.by ?? "";
  const m = /score ([\d.]+) ≥ ([\d.]+)/.exec(by);
  const score = m ? Number(m[1]) : null, limit = m ? Number(m[2]) : 2;
  const sum = FIRED.reduce((a, p) => a + p.w, 0);
  // Show the breakdown only while it still adds up to the recorded score.
  const parts = score != null && Math.abs(sum - score) < 0.05 ? FIRED : [];
  const pct = (v: number) => `${Math.min(100, (v / SCALE) * 100)}%`;
  return (
    <div className="px-5 py-5 sm:px-6">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-fg">Score at login</span>
        <span className="text-fg-subtle">Recorded run</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative h-6 flex-1 rounded-md border border-border-strong bg-background">
          <div className="flex h-full gap-px overflow-hidden rounded-[5px]">
            {parts.length
              ? parts.map((p) => <span key={p.label} className={cn("h-full", p.bar)} style={{ width: pct(p.w) }} />)
              : score != null && <span className="h-full bg-fg" style={{ width: pct(score) }} />}
          </div>
          <span className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded-full bg-alert" style={{ left: pct(limit) }} />
        </div>
        <span className="w-9 text-right text-[15px] font-semibold tabular-nums">{score == null ? "—" : score.toFixed(1)}</span>
      </div>
      <div className="relative mt-1.5 mr-12 h-4 text-[12px] text-alert">
        <span className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: pct(limit) }}>
          Flag at {limit.toFixed(1)}
        </span>
      </div>
      {parts.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[12px] text-fg-muted">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-[2px]", p.bar)} />
              <span className="flex-1">{p.label}</span>
              <span className="text-fg tabular-nums">+{p.w.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CLUES: { when: string; items: string[] }[] = [
  { when: "At login", items: ["scripted client", "no client identity", "new address", "failed passwords just before", "unmanaged device"] },
  { when: "After login", items: ["machine-regular pace", "bursts faster than a click", "probing for missing pages", "more charts than a ward has"] },
];

const PAPER = [
  "A Bayesian filter that estimates the attacker’s goal and how far along they are.",
  "A lane adjuster that can only make a session’s treatment stricter, never looser.",
  "A lure planner that weighs what a lure reveals against how suspicious it makes the attacker, two lures ahead.",
];

export function Research({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-5", className)}>
      <article className="flex flex-col rounded-xl border border-border bg-background p-2 lg:col-span-3">
        <div className="rounded-lg border border-border bg-surface"><ScoreBar /></div>
        <div className="px-3 pt-5 pb-4">
          <p className="text-[13px] font-medium text-fg-muted">The algorithm</p>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em]">First Sight: flag a stolen login before it does anything</h3>
          <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
            No single clue is enough to accuse a nurse, so First Sight adds up weak ones. It uses CUSUM, the standard
            quickest-detection test (Page, 1954): every clue raises a running score, every ordinary request lowers
            it, and the session is flagged when the score reaches 2.0.
          </p>
          <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12.5px] text-fg">
            S = max(0, S + x)
            <span className="ml-3 text-fg-muted">x = the clues on this request, or &minus;0.3 if there are none</span>
          </p>
          <dl className="mt-4 space-y-2 text-[13px]">
            {CLUES.map((c) => (
              <div key={c.when} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                <dt className="w-[84px] shrink-0 pt-0.5 text-fg-muted">{c.when}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {c.items.map((it) => (
                    <span key={it} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-fg-muted">{it}</span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] leading-relaxed text-fg-muted">
            A false alarm is cheap: a flagged nurse still gets real charts after a badge and MFA. The weights are
            set by hand, not fitted to hospital data.
          </p>
        </div>
      </article>

      <article className="flex flex-col rounded-xl border border-border bg-background p-2 lg:col-span-2">
        <div className="rounded-lg border border-border bg-surface px-5 py-5 sm:px-6">
          <p className="text-[12px] text-fg-subtle">Draft paper</p>
          <p className="mt-2 text-[19px] leading-snug font-semibold tracking-[-0.02em]">
            Mirage: Adaptive Session-Seeded Deception for Hospital APIs
          </p>
          <p className="mt-2 text-[12px] text-fg-muted">MayaJaal, HackPrinceton Fall 2026</p>
        </div>
        <div className="flex flex-1 flex-col px-3 pt-5 pb-4">
          <p className="text-[13px] font-medium text-fg-muted">The paper</p>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em]">How the decoy adapts to each attacker</h3>
          <ul className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-fg-muted">
            {PAPER.map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-subtle" />{t}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-relaxed text-fg-muted">
            Planner results are from simulation. The paper reports no human red-team data.
          </p>
          <div className="mt-auto pt-5">
            <a href="/mirage.pdf" target="_blank" rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-fg px-4 text-sm font-medium text-background transition-opacity hover:opacity-90">
              Read the draft paper <ArrowUpRight className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      </article>
    </div>
  );
}
