import { cn } from "@/components/ui";

// Static monochrome diagram: every session meets one gateway; normal use goes to the real hospital,
// attacker behaviour is moved into a session-seeded shadow hospital. Two layouts: wide (sm+) and tall.

type BoxProps = {
  x: number; y: number; w: number; h: number;
  title: string; sub: string; tag?: string; shadow?: boolean;
};

function Box({ x, y, w, h, title, sub, tag, shadow }: BoxProps) {
  const cx = x + w / 2;
  const lines = tag ? 3 : 2;
  const top = y + h / 2 - (lines === 3 ? 18 : 8);
  return (
    <g>
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={8}
        className={shadow ? "fill-shadow-bg stroke-shadow/40" : "fill-background stroke-border-strong"}
        strokeDasharray={shadow ? "4 3" : undefined} />
      {tag && (
        <text x={cx} y={top} textAnchor="middle" className="fill-fg-subtle text-[11px]">{tag}</text>
      )}
      <text x={cx} y={tag ? top + 19 : top} textAnchor="middle"
        className={cn("text-[13px] font-medium", shadow ? "fill-shadow" : "fill-fg")}>{title}</text>
      <text x={cx} y={tag ? top + 36 : top + 18} textAnchor="middle" className="fill-fg-muted text-[11.5px]">{sub}</text>
    </g>
  );
}

const line = "fill-none stroke-border-strong";
const dashed = "fill-none stroke-shadow/70";

function Wide() {
  return (
    <svg viewBox="0 0 760 232" className="hidden h-auto w-full sm:block" role="img"
      aria-label="Every session passes one gateway. Normal use reaches the real hospital; attacker behaviour is moved into a shadow hospital.">
      <Box x={0} y={86} w={160} h={60} title="Any session" sub="same login, same API" />
      <path d="M160 116 H220" className={line} strokeWidth={1} />
      <Box x={220} y={86} w={160} h={60} title="Gateway" sub="scores behaviour" />
      <path d="M380 116 H430 V46 H560" className={line} strokeWidth={1} />
      <path d="M430 116 V186 H560" className={dashed} strokeWidth={1} strokeDasharray="4 3" />
      <circle cx={430} cy={116} r={2.5} className="fill-fg-subtle" />
      <text x={495} y={38} textAnchor="middle" className="fill-fg-subtle text-[11px]">normal use</text>
      <text x={495} y={203} textAnchor="middle" className="fill-shadow text-[11px]">attacker behaviour</text>
      <Box x={560} y={16} w={200} h={60} title="Real hospital" sub="care keeps running" />
      <Box x={560} y={156} w={200} h={60} title="Shadow hospital" sub="seeded per session" shadow />
    </svg>
  );
}

function Tall() {
  return (
    <svg viewBox="0 0 340 332" className="h-auto w-full sm:hidden" role="img"
      aria-label="Every session passes one gateway. Normal use reaches the real hospital; attacker behaviour is moved into a shadow hospital.">
      <Box x={80} y={0} w={180} h={56} title="Any session" sub="same login, same API" />
      <path d="M170 56 V96" className={line} strokeWidth={1} />
      <Box x={80} y={96} w={180} h={56} title="Gateway" sub="scores behaviour" />
      <path d="M170 152 V188 H82 V232" className={line} strokeWidth={1} />
      <path d="M170 188 H258 V232" className={dashed} strokeWidth={1} strokeDasharray="4 3" />
      <circle cx={170} cy={188} r={2.5} className="fill-fg-subtle" />
      <Box x={0} y={232} w={164} h={84} tag="normal use" title="Real hospital" sub="care keeps running" />
      <Box x={176} y={232} w={164} h={84} tag="attacker behaviour" title="Shadow hospital" sub="seeded per session" shadow />
    </svg>
  );
}

export function FlowDiagram({ className }: { className?: string }) {
  return (
    <figure className={cn("w-full", className)}>
      <Wide />
      <Tall />
    </figure>
  );
}
