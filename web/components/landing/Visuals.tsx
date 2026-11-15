// Landing illustrations. Flat, hairline, monochrome; purple only for the copy (shadow tier).
// Each draws once on load (no decorative loops).
import { cn } from "@/components/ui";
import brief from "../../public/runs/brief-mayajaal.json";

/** The signature line: the hospital's heartbeat keeps going while the attacker peels off into the copy. */
export function HeroLine({ className }: { className?: string }) {
  const beat = (x: number) => `H${x} l10 -30 l14 58 l12 -40 l8 12`;
  const real = `M0 70 ${beat(150)} ${beat(430)} ${beat(690)} ${beat(880)} H1200`;
  return (
    <svg viewBox="0 0 1200 170" className={cn("h-auto w-full overflow-visible", className)} role="img"
      aria-label="The hospital's heartbeat line continues while the attacker's path splits off into a fake copy.">
      <path d={real} pathLength={1} className="mj-draw stroke-fg" fill="none" strokeWidth={1.75}
        strokeLinejoin="round" strokeLinecap="round" />
      {/* attacker joins the network with a phished login, then is moved into the copy */}
      <path d="M250 14 C 330 14, 360 70, 420 70" pathLength={1} className="mj-draw mj-d1 stroke-alert" fill="none"
        strokeWidth={1.5} />
      <path d="M520 70 C 590 70, 600 140, 680 140 H1200" pathLength={1} className="mj-draw mj-d2 stroke-shadow"
        fill="none" strokeWidth={1.5} />
      <circle cx="250" cy="14" r="4" className="mj-fade mj-d1 fill-alert" />
      <circle cx="1200" cy="140" r="4" className="mj-fade mj-d3 fill-shadow" />
      <text x="262" y="10" className="mj-fade mj-d1 fill-fg-muted text-[13px]">Phished login</text>
      <text x="1200" y="56" textAnchor="end" className="mj-fade mj-d3 fill-fg-muted text-[13px]">
        Real hospital · care continues
      </text>
      <text x="1200" y="164" textAnchor="end" className="mj-fade mj-d3 fill-shadow text-[13px]">
        Attacker · inside the copy
      </text>
      <text x="610" y="112" className="mj-fade mj-d2 fill-shadow text-[12px]">moved, silently</text>
    </svg>
  );
}

const ROWS: { req: string; tag: string; tone: "real" | "deny" | "copy" }[] = [
  { req: "Ward list", tag: "real", tone: "real" },
  { req: "Patient chart", tag: "real", tone: "real" },
  { req: "Admin users", tag: "denied", tone: "deny" },
  { req: "Backups", tag: "→ decoy", tone: "copy" },
  { req: "Export 1,000 patients", tag: "→ decoy", tone: "copy" },
];

/** Card 1: every request goes through one gateway and gets a verdict. */
export function SpotVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-6">
      {ROWS.map((r) => (
        <div key={r.req} className={cn("flex h-7 items-center justify-between rounded-md border px-2.5 text-[12px]",
          r.tone === "copy" ? "border-shadow/30 bg-shadow-bg" : "border-border bg-background")}>
          <span className="font-mono text-fg-muted">GET {r.req}</span>
          <span className={cn("font-medium", r.tone === "real" && "text-fg-muted", r.tone === "deny" && "text-alert",
            r.tone === "copy" && "text-shadow")}>{r.tag}</span>
        </div>
      ))}
    </div>
  );
}

function Plan({ label, copy, children }: { label: string; copy?: boolean; children?: React.ReactNode }) {
  const cell = cn("rounded-[3px] border", copy ? "border-shadow/40 border-dashed" : "border-border-strong");
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn("relative grid size-[92px] grid-cols-2 grid-rows-2 gap-1 rounded-md border p-1",
        copy ? "border-shadow/50 border-dashed bg-shadow-bg" : "border-border-strong bg-background")}>
        <span className={cell} /><span className={cell} /><span className={cell} /><span className={cell} />
        {children}
      </div>
      <span className={cn("text-[12px]", copy ? "text-shadow" : "text-fg-muted")}>{label}</span>
    </div>
  );
}

/** Card 2: the session moves from the real hospital into a copy built for it. */
export function MoveVisual() {
  return (
    <div className="flex h-full items-center justify-center gap-5">
      <Plan label="Real hospital">
        <span className="absolute top-[30%] left-[28%] size-1.5 rounded-full bg-fg-subtle" />
        <span className="absolute top-[64%] left-[70%] size-1.5 rounded-full bg-fg-subtle" />
      </Plan>
      <svg width="56" height="20" viewBox="0 0 56 20" className="-mt-6 overflow-visible" aria-hidden>
        <path d="M2 10 H48" className="stroke-shadow" strokeWidth={1.5} strokeDasharray="3 3" />
        <path d="M44 5 L50 10 L44 15" className="stroke-shadow" strokeWidth={1.5} fill="none" />
        <circle cx="2" cy="10" r="3.5" className="fill-alert" />
      </svg>
      <Plan label="The decoy" copy>
        <span className="absolute top-[64%] left-[70%] size-2 rounded-full bg-alert" />
      </Plan>
    </div>
  );
}

/** Card 5: the shared lab goes down; urgent tests reroute to labs that still work. */
export function CareVisual() {
  return (
    <svg viewBox="0 0 260 140" className="h-full w-full" aria-hidden>
      <rect x="18" y="56" width="62" height="28" rx="6" className="fill-background stroke-border-strong" />
      <text x="49" y="74" textAnchor="middle" className="fill-fg text-[11px]">Ward</text>
      <path d="M80 70 C 120 70, 130 30, 170 30" className="stroke-alert" strokeWidth={1.25} strokeDasharray="3 4" fill="none" />
      <path d="M80 70 C 120 70, 130 110, 170 110" className="stroke-fg" strokeWidth={1.5} fill="none" />
      <rect x="170" y="16" width="74" height="28" rx="6" className="fill-alert-bg stroke-alert" strokeDasharray="3 3" />
      <text x="207" y="34" textAnchor="middle" className="fill-alert text-[11px]">Shared lab ✕</text>
      <rect x="170" y="96" width="74" height="28" rx="6" className="fill-background stroke-fg" />
      <text x="207" y="114" textAnchor="middle" className="fill-fg text-[11px]">Backup lab ✓</text>
    </svg>
  );
}

type BriefFacts = {
  client?: { software?: string; mean_gap_s?: number };
  likely_goal?: { goal?: string };
  trackers_taken?: unknown[];
};
const GOALS: Record<string, string> = { exfil: "Data theft" };

/** Card 3: what the decoy learned about the attacker. Values are read from the recorded run's brief. */
export function FingerprintVisual() {
  const f = (brief as { facts?: BriefFacts }).facts ?? {};
  const goal = f.likely_goal?.goal;
  const rows: { k: string; v: string; mono?: boolean }[] = [
    { k: "Tool", v: f.client?.software ?? "—", mono: true },
    { k: "Pace", v: f.client?.mean_gap_s == null ? "—" : `A request every ${f.client.mean_gap_s} s` },
    { k: "Goal", v: goal ? GOALS[goal] ?? goal : "—" },
    { k: "Lures taken", v: f.trackers_taken ? String(f.trackers_taken.length) : "—" },
  ];
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-[300px] rounded-md border border-shadow/30 bg-background">
        <div className="flex h-8 items-center justify-between border-b border-border px-3 text-[12px]">
          <span className="flex items-center gap-2 font-medium text-shadow">
            <span className="size-1.5 rounded-full bg-shadow" />Attacker profile
          </span>
          <span className="text-fg-subtle">Recorded run</span>
        </div>
        <dl className="px-3 py-1 text-[12px]">
          {rows.map((r) => (
            <div key={r.k} className="flex h-[26px] items-center justify-between gap-3">
              <dt className="text-fg-muted">{r.k}</dt>
              <dd className={cn("truncate text-fg tabular-nums", r.mono && "font-mono")}>{r.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Card 4: one encrypted copy, cut into six pieces, one piece per site. */
export function ScatterVisual() {
  const band = (i: number) => 45 + i * 10, tile = (i: number) => 8 + i * 17;
  return (
    <svg viewBox="0 0 260 140" className="h-full w-full" aria-hidden>
      <rect x="28" y="36" width="44" height="70" rx="5" className="fill-background stroke-fg" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <rect x="35" y={band(i)} width="30" height="5" rx="1.5" className="fill-fg" />
          <path d={`M72 ${band(i) + 2.5} C 132 ${band(i) + 2.5}, 132 ${tile(i) + 6.5}, 190 ${tile(i) + 6.5}`}
            className="stroke-border-strong" fill="none" />
          <rect x="190" y={tile(i)} width="50" height="13" rx="4" className="fill-background stroke-border-strong" />
          <rect x="196" y={tile(i) + 4} width="30" height="5" rx="1.5" className="fill-fg" />
        </g>
      ))}
      <text x="50" y="128" textAnchor="middle" className="fill-fg-muted text-[11px]">Encrypted copy</text>
      <text x="215" y="128" textAnchor="middle" className="fill-fg-muted text-[11px]">Six sites</text>
    </svg>
  );
}
