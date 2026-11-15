// Hero backdrop: a hairline hospital under a quiet shield. Attack paths reach the shield and are carried,
// unseen, to a dashed decoy copy outside it. Monochrome; purple only for the shield and the copy.
// Draws once on load (mj-draw / mj-fade), nothing loops.
import { cn } from "@/components/ui";

// Shield dome: half-ellipse centred (230, 360), rx 190, ry 280.
const DOME = "M40 360 A190 280 0 0 1 420 360";

function Windows({ x, y, cols, rows }: { x: number; y: number; cols: number; rows: number }) {
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push(<rect key={`${r}-${c}`} x={x + c * 26} y={y + r * 28} width={12} height={14} rx={1.5} />);
  return <>{cells}</>;
}

export function HeroShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 400" className={cn("h-auto w-full overflow-visible", className)} role="img"
      aria-label="A hospital under a shield. Attacks that reach the shield are quietly carried to a decoy copy outside it.">
      <defs>
        <pattern id="mj-hero-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="0.8" className="fill-shadow" opacity={0.35} />
        </pattern>
        <clipPath id="mj-hero-dome"><path d={`${DOME} Z`} /></clipPath>
      </defs>

      {/* ground */}
      <path d="M0 360 H560" className="mj-fade stroke-border" strokeWidth={1} />

      {/* shield */}
      <g className="mj-fade">
        <path d={`${DOME} Z`} className="fill-shadow-bg" opacity={0.6} />
        <rect x="40" y="80" width="380" height="280" fill="url(#mj-hero-dots)" clipPath="url(#mj-hero-dome)" />
      </g>
      <path d={DOME} pathLength={1} className="mj-draw stroke-shadow" fill="none" strokeWidth={1.5} />

      {/* real hospital */}
      <g className="mj-fade mj-d1 fill-none stroke-fg-muted" strokeWidth={1.25} strokeLinejoin="round">
        <rect x="160" y="200" width="140" height="160" rx={2} />
        <rect x="110" y="262" width="50" height="98" rx={2} />
        <rect x="300" y="262" width="50" height="98" rx={2} />
        <rect x="215" y="160" width="30" height="30" rx={3} />
        <path d="M230 167 V183 M222 175 H238" strokeLinecap="round" />
        <rect x="216" y="322" width="28" height="38" rx={1.5} />
        <g className="stroke-fg-subtle" strokeWidth={1}>
          <Windows x={176} y={218} cols={5} rows={3} />
          <Windows x={123} y={280} cols={1} rows={2} />
          <Windows x={313} y={280} cols={1} rows={2} />
        </g>
      </g>

      {/* attacks reach the shield... */}
      <g className="mj-fade mj-d2 stroke-alert" fill="none" strokeWidth={1.25} strokeDasharray="3 4" strokeLinecap="round">
        <path d="M10 30 C 60 60, 90 100, 110 143" />
        <path d="M300 0 C 292 30, 278 58, 270 86" />
      </g>
      <circle cx="110" cy="143" r="3" className="mj-fade mj-d2 fill-alert" />
      <circle cx="270" cy="86" r="3" className="mj-fade mj-d2 fill-alert" />

      {/* ...and are carried, unseen, to the copy */}
      <g className="stroke-shadow" fill="none" strokeWidth={1.25}>
        <path d="M110 143 C 130 20, 380 10, 452 118" pathLength={1} className="mj-draw mj-d2" />
        <path d="M270 86 C 300 48, 400 66, 452 132" pathLength={1} className="mj-draw mj-d2" />
      </g>

      {/* decoy copy */}
      <g className="mj-fade mj-d3 fill-none stroke-shadow" strokeWidth={1.25} strokeDasharray="3 3" strokeLinejoin="round">
        <rect x="470" y="96" width="50" height="64" rx={2} />
        <rect x="452" y="120" width="18" height="40" rx={2} />
        <rect x="520" y="120" width="18" height="40" rx={2} />
        <path d="M495 104 V116 M489 110 H501" strokeLinecap="round" strokeDasharray="none" />
      </g>

      <text x="230" y="384" textAnchor="middle" className="mj-fade mj-d1 fill-fg-subtle text-[12px]">
        Real hospital · care continues
      </text>
      <text x="495" y="182" textAnchor="middle" className="mj-fade mj-d3 fill-shadow text-[12px]">
        Decoy copy
      </text>
    </svg>
  );
}
