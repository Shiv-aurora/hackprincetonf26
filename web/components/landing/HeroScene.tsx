// Hero scene: an isometric hospital under a wireframe dome. Attacks land on the dome and are carried across
// it to a dashed copy of the same hospital. Hairlines and flat fills only; purple for the dome and the copy,
// amber for the attacker. Everything is computed here at render time and draws once on load.
import { cn } from "@/components/ui";

type V3 = readonly [number, number, number];
type Block = { x0: number; x1: number; y0: number; y1: number; h: number; door?: boolean };

const S = 2, OX = 270, OY = 330, W = 840, H = 714;
const K = Math.cos(Math.PI / 6);
const R = 100;
const DEG = Math.PI / 180;

const f = (n: number) => n.toFixed(1);
const px = (v: V3) => OX + S * (v[0] - v[1]) * K;
const py = (v: V3) => OY + S * ((v[0] + v[1]) / 2 - v[2]);
const xy = (v: V3) => `${f(px(v))} ${f(py(v))}`;
const line = (ps: V3[], close = false) => `M${ps.map(xy).join(" L")}${close ? " Z" : ""}`;
/** A point given directly in screen units (same scale as the scene, origin at the dome centre). */
const u = (x: number, y: number) => `${f(OX + S * x)} ${f(OY + S * y)}`;

// ---- buildings -------------------------------------------------------------------------------------------
// Listed back to front, so later blocks paint over earlier ones.
const CAMPUS: Block[] = [
  { x0: -58, x1: -22, y0: -22, y1: 22, h: 38 },
  { x0: -22, x1: 22, y0: -30, y1: 14, h: 78 },
  { x0: 22, x1: 56, y0: -26, y1: 14, h: 46 },
  { x0: -14, x1: 26, y0: 14, y1: 44, h: 22, door: true },
];
const DECOY: V3 = [228, -5, 0];

function spans(a0: number, a1: number, w: number, gap: number, margin: number) {
  const n = Math.max(0, Math.floor((a1 - a0 - 2 * margin + gap) / (w + gap)));
  const start = a0 + (a1 - a0 - (n * w + (n - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, i) => start + i * (w + gap));
}

function Building({ b, o, ghost, seed }: { b: Block; o: V3; ghost?: boolean; seed: number }) {
  const P = (x: number, y: number, z: number): V3 => [o[0] + x, o[1] + y, z];
  const { x0, x1, y0, y1, h } = b;
  const top = line([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], true);
  const left = line([P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, h), P(x0, y1, h)], true);
  const right = line([P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, h), P(x1, y0, h)], true);

  const rows = spans(0, h, 6, 5, 4);
  let panes = "", lit = "";
  const pane = (q: V3[], r: number, c: number) => {
    const d = line(q, true);
    if (!ghost && (r * 3 + c * 5 + seed) % 7 < 2) lit += d; else panes += d;
  };
  rows.forEach((z, r) => {
    if (!b.door) spans(x0, x1, 5, 4, 4).forEach((x, c) =>
      pane([P(x, y1, z), P(x + 5, y1, z), P(x + 5, y1, z + 6), P(x, y1, z + 6)], r, c));
    spans(y0, y1, 5, 4, 4).forEach((y, c) =>
      pane([P(x1, y, z), P(x1, y + 5, z), P(x1, y + 5, z + 6), P(x1, y, z + 6)], r, c + 3));
  });
  const mx = (x0 + x1) / 2;
  const door = b.door
    ? line([P(mx - 5, y1, 0), P(mx - 5, y1, 13), P(mx + 5, y1, 13), P(mx + 5, y1, 0)]) + line([P(mx, y1, 0), P(mx, y1, 13)])
    : "";

  return (
    <g>
      <path d={top} className="fill-background" />
      <path d={left} className={ghost ? "fill-shadow-bg" : "fill-surface"} />
      <path d={right} className={ghost ? "fill-shadow-bg" : "fill-surface-2"} />
      {lit && <path d={lit} className="fill-fg-subtle" stroke="none" opacity={0.45} />}
      <path d={panes + door} fill="none" strokeWidth={0.75} strokeDasharray="none" opacity={ghost ? 0.45 : 0.6} />
    </g>
  );
}

function Campus({ o, ghost }: { o: V3; ghost?: boolean }) {
  const P = (x: number, y: number, z: number): V3 => [o[0] + x, o[1] + y, z];
  const pad = Array.from({ length: 37 }, (_, i) => P(13 * Math.cos(i * 10 * DEG), -8 + 13 * Math.sin(i * 10 * DEG), 78));
  const cross = line([P(-7, -8, 78), P(7, -8, 78)]) + line([P(0, -15, 78), P(0, -1, 78)]);
  return (
    <>
      {CAMPUS.map((b, i) => <Building key={i} b={b} o={o} ghost={ghost} seed={i * 2 + 1} />)}
      <path d={line(pad, true)} fill="none" strokeWidth={1} strokeDasharray="none" />
      <path d={cross} fill="none" strokeWidth={1.75} strokeLinecap="round" strokeDasharray="none"
        className={ghost ? undefined : "stroke-fg"} />
    </>
  );
}

// ---- dome ------------------------------------------------------------------------------------------------
const sph = (az: number, el: number): V3 =>
  [R * Math.cos(el) * Math.cos(az), R * Math.cos(el) * Math.sin(az), R * Math.sin(el)];
const facing = (v: V3) => v[0] + v[1] + v[2] > 0; // the viewer looks down the (1, 1, 1) diagonal

/** Split a curve on the sphere into the parts on the near side and the parts behind. */
function sides(ps: V3[]) {
  let near = "", far = "", run: V3[] = [];
  const flush = (isNear: boolean) => {
    if (run.length > 1) { if (isNear) near += line(run); else far += line(run); }
  };
  ps.forEach((p, i) => {
    if (i > 0 && facing(p) !== facing(ps[i - 1])) { run.push(p); flush(facing(ps[i - 1])); run = []; }
    run.push(p);
  });
  if (ps.length) flush(facing(ps[ps.length - 1]));
  return { near, far };
}

const WIRES = (() => {
  let near = "", far = "";
  const take = (ps: V3[]) => { const s = sides(ps); near += s.near; far += s.far; };
  for (const el of [18, 36, 54, 72]) take(Array.from({ length: 61 }, (_, i) => sph(i * 6 * DEG, el * DEG)));
  for (let az = 0; az < 360; az += 30) take(Array.from({ length: 13 }, (_, i) => sph(az * DEG, i * 6 * DEG)));
  const base = sides(Array.from({ length: 61 }, (_, i) => sph((i * 6 - 45) * DEG, 0)));
  return { near, far: far + base.far };
})();

const RS = S * R * Math.sqrt(1.5); // the sphere's outline is a circle this wide on screen
const SHELL = `M${f(OX - RS)} ${OY} A${f(RS)} ${f(RS)} 0 0 1 ${f(OX + RS)} ${OY} `
  + `A${f(RS)} ${f(S * R * Math.SQRT1_2)} 0 0 1 ${f(OX - RS)} ${OY} Z`;

const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const scale = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
function arc(a: V3, b: V3, n = 24): V3[] {
  const w = Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]), s = Math.sin(w);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
    return scale([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb], R);
  });
}
/** A small ring on the dome around the point where an attack lands. */
function ring(n: V3, deg: number) {
  const a = unit([-n[1], n[0], 0]);
  const b: V3 = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return line(Array.from({ length: 37 }, (_, i) => {
    const t = i * 10 * DEG, ct = Math.cos(t) * s, st = Math.sin(t) * s;
    return scale([n[0] * c + a[0] * ct + b[0] * st, n[1] * c + a[1] * ct + b[1] * st, n[2] * c + a[2] * ct + b[2] * st], R);
  }), true);
}

// Where the two attacks land, where each leaves the dome, and where both end up: the copy's roof.
const HIT_A = unit([-0.2, 0.555, 0.807]), CROWN = unit([-0.16, -0.16, 0.97]), OUT_A = unit([0.75, -0.45, 0.5]);
const HIT_B = unit([0.6, -0.15, 0.78]), OUT_B = unit([0.9, -0.3, 0.3]);
const LAND: V3 = [DECOY[0], DECOY[1] - 8, 78];

/** Along the dome from where it landed to where it leaves, then through the air onto the copy. */
function carried(stops: V3[], lift: number) {
  const ps = stops.slice(1).flatMap((b, i) => arc(stops[i], b).slice(i ? 1 : 0));
  const a = ps[ps.length - 2], b = ps[ps.length - 1];
  const dx = px(b) - px(a), dy = py(b) - py(a), l = Math.hypot(dx, dy) || 1;
  const c1 = `${f(px(b) + (dx / l) * 70)} ${f(py(b) + (dy / l) * 70)}`;
  const c2 = `${f(px(LAND) - 50)} ${f(py(LAND) - lift)}`;
  return `${line(ps)} C${c1} ${c2} ${xy(LAND)}`;
}

const GRID = (() => {
  let d = "";
  for (let i = -300; i <= 520; i += 20) d += line([[i, -340, 0], [i, 340, 0]]) + line([[-300, i - 100, 0], [520, i - 100, 0]]);
  return d;
})();

export function HeroScene({ className }: { className?: string }) {
  const plate = line([[DECOY[0] - 70, DECOY[1] - 44, 0], [DECOY[0] + 68, DECOY[1] - 44, 0],
    [DECOY[0] + 68, DECOY[1] + 56, 0], [DECOY[0] - 70, DECOY[1] + 56, 0]], true);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full overflow-visible", className)} role="img"
      aria-label="A hospital under a dome. Two attacks land on the dome and are carried across it into a dashed copy of the same hospital, while the real one keeps running.">
      <defs>
        <radialGradient id="mj-scene-fade" gradientUnits="userSpaceOnUse" cx={OX + 150} cy={OY + 70} r={620}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="#fff" stopOpacity={0.55} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <mask id="mj-scene-mask" maskUnits="userSpaceOnUse" x={-600} y={-400} width={2200} height={1700}>
          <rect x={-600} y={-400} width={2200} height={1700} fill="url(#mj-scene-fade)" />
        </mask>
      </defs>

      {/* floor */}
      <g mask="url(#mj-scene-mask)">
        <path d={GRID} className="mj-fade stroke-border-strong" fill="none" strokeWidth={1} opacity={0.6} />
      </g>

      {/* dome, far side */}
      <path d={SHELL} className="mj-fade mj-d1 fill-shadow-bg" opacity={0.55} />
      <path d={WIRES.far} className="mj-fade mj-d1 stroke-shadow" fill="none" strokeWidth={0.75} opacity={0.2} />

      {/* the real hospital */}
      <g className="mj-fade stroke-fg-muted" strokeWidth={1} strokeLinejoin="round">
        <Campus o={[0, 0, 0]} />
      </g>

      {/* dome, near side */}
      <path d={WIRES.near} className="mj-fade mj-d1 stroke-shadow" fill="none" strokeWidth={0.75} opacity={0.38} />
      <path d={SHELL} pathLength={1} className="mj-draw stroke-shadow" fill="none" strokeWidth={1.5} strokeLinejoin="round" />

      {/* the copy */}
      {/* inline delay: the mj-rise shorthand in globals.css resets the mj-d* delay classes */}
      <g className="mj-rise" style={{ animationDelay: "1600ms" }}>
        <path d={plate} className="fill-shadow-bg stroke-shadow" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        <g className="stroke-shadow" strokeWidth={1} strokeLinejoin="round" strokeDasharray="4 3">
          <Campus o={DECOY} ghost />
        </g>
      </g>

      {/* attacks land on the dome */}
      <g className="mj-fade mj-d2 stroke-alert" fill="none" strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round">
        <path d={`M${u(-40, -172)} Q${u(-70, -120)} ${xy(scale(HIT_A, R))}`} />
        <path d={`M${u(152, -160)} Q${u(118, -100)} ${xy(scale(HIT_B, R))}`} />
      </g>
      <g className="mj-fade mj-d2 stroke-shadow" fill="none" strokeWidth={1}>
        <path d={ring(HIT_A, 7) + ring(HIT_B, 7)} opacity={0.9} />
        <path d={ring(HIT_A, 13) + ring(HIT_B, 13)} opacity={0.45} />
      </g>
      <circle cx={f(px(scale(HIT_A, R)))} cy={f(py(scale(HIT_A, R)))} r={4} className="mj-fade mj-d2 fill-alert" />
      <circle cx={f(px(scale(HIT_B, R)))} cy={f(py(scale(HIT_B, R)))} r={4} className="mj-fade mj-d2 fill-alert" />

      {/* ...and are carried into the copy */}
      <g className="stroke-shadow" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d={carried([HIT_A, CROWN, OUT_A], 70)} pathLength={1} className="mj-draw mj-d2" />
        <path d={carried([HIT_B, OUT_B], 40)} pathLength={1} className="mj-draw mj-d2" />
      </g>
      <g className="mj-fade mj-d3">
        <circle cx={f(px(LAND))} cy={f(py(LAND))} r={8} className="fill-background stroke-shadow" strokeWidth={1.5} />
        <circle cx={f(px(LAND))} cy={f(py(LAND))} r={3.5} className="fill-alert" />
      </g>

      {/* labels */}
      <g className="hidden sm:block">
        <text x={f(OX + S * 160)} y={f(OY + S * -150)} className="mj-fade mj-d2 fill-alert text-[18px] font-medium">AI attacker</text>
        <text x={f(OX + S * 136)} y={f(OY + S * -22)} className="mj-fade mj-d3 fill-shadow text-[18px] font-medium">Not blocked. Moved.</text>
        <g className="mj-fade mj-d1" textAnchor="middle">
          <text x={OX} y={f(OY + S * 94)} className="fill-fg text-[19px] font-medium">Real hospital</text>
          <text x={OX} y={f(OY + S * 94 + 24)} className="fill-fg-subtle text-[16px]">Care keeps running</text>
        </g>
        <g className="mj-fade mj-d3" textAnchor="middle">
          <text x={f(OX + S * 196)} y={f(OY + S * 178)} className="fill-shadow text-[19px] font-medium">Decoy copy</text>
          <text x={f(OX + S * 196)} y={f(OY + S * 178 + 24)} className="fill-fg-subtle text-[16px]">Built fresh for this attacker</text>
        </g>
      </g>
    </svg>
  );
}
