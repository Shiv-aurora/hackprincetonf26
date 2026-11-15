// "The research behind it": how First Sight decides, and the draft paper on the adaptive deception layer.
// First Sight facts mirror backend/mayajaal/real/firstsight.py (threshold 2.0, drift 0.3, hand-set weights).
// The score shown is parsed from the recorded run's brief. The paper covers Mirage, not First Sight.
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/components/ui";
import brief from "../../public/runs/brief-mayajaal.json";

// The two clues that fired at login in the recorded run, with their weights.
const FIRED = [
  { label: "Scripted client", w: 2.2, bar: "bg-fg" },
  { label: "Not a hospital device", w: 1.2, bar: "bg-fg-subtle" },
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
    <div className="flex h-full flex-col justify-center px-6 sm:px-8">
      <div className="flex items-end justify-between">
        <p className="text-[13px] text-fg-muted">Score at login</p>
        <p className="text-[44px] leading-none font-semibold tracking-[-0.04em] tabular-nums">
          {score == null ? "—" : score.toFixed(1)}
        </p>
      </div>
      <div className="relative mt-4 h-7 rounded-md border border-border-strong bg-background">
        <div className="flex h-full gap-px overflow-hidden rounded-[5px]">
          {parts.length
            ? parts.map((p) => <span key={p.label} className={cn("h-full", p.bar)} style={{ width: pct(p.w) }} />)
            : score != null && <span className="h-full bg-fg" style={{ width: pct(score) }} />}
        </div>
        <span className="absolute -top-2 -bottom-2 w-0.5 rounded-full bg-alert" style={{ left: pct(limit) }} />
      </div>
      <div className="relative mt-2.5 h-5 text-[13px] font-medium text-alert">
        <span className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: pct(limit) }}>
          Flag at {limit.toFixed(1)}
        </span>
      </div>
      {parts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-fg-muted">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-[2px]", p.bar)} />
              {p.label} <span className="text-fg tabular-nums">+{p.w.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CARD = "flex flex-col rounded-xl border border-border bg-background p-2";
const PANEL = "h-[230px] rounded-lg border border-border bg-surface";
const TITLE = "mt-1.5 text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance";

export function Research({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", className)}>
      <article className={CARD}>
        <div className={PANEL}><ScoreBar /></div>
        <div className="flex flex-1 flex-col px-3 pt-6 pb-4">
          <p className="text-[13px] font-medium text-fg-muted">The algorithm</p>
          <h3 className={TITLE}>First Sight flags a stolen login on the first request.</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            Nine weak clues add up to one score. Weights are set by hand.
          </p>
          <p className="mt-auto pt-5">
            <span className="inline-flex h-10 items-center rounded-md border border-border bg-surface px-3.5 font-mono text-[13px] text-fg">
              S = max(0, S + x)
            </span>
            <span className="ml-3 text-[13px] text-fg-muted">CUSUM, Page 1954</span>
          </p>
        </div>
      </article>

      <article className={CARD}>
        <div className={cn(PANEL, "flex flex-col justify-center px-6 sm:px-8")}>
          <p className="text-[13px] text-fg-muted">Draft paper</p>
          <p className="mt-3 text-[28px] leading-[1.12] font-semibold tracking-[-0.035em] text-balance sm:text-[32px]">
            Mirage: Adaptive Session-Seeded Deception for Hospital APIs
          </p>
        </div>
        <div className="flex flex-1 flex-col px-3 pt-6 pb-4">
          <p className="text-[13px] font-medium text-fg-muted">The paper</p>
          <h3 className={TITLE}>A decoy that adapts to each attacker.</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">
            It works out what the attacker wants, then picks the lures that reveal the most. Results are simulated.
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
