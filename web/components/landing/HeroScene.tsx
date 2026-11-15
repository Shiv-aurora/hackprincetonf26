// Hero scene: the whole system in one isometric picture. A hospital under a wireframe dome sits in a small
// network of hospitals and a shared lab. Attacks land on the dome (1), are carried into a dashed decoy
// hospital (2) where lures fingerprint them (3); an encrypted copy of the records is held in pieces across
// the network (4); and when the shared lab is down, urgent tests take another route (5).
// Hairlines and flat fills only: neutral for what is real, purple for the dome and the decoy, amber for the
// attacker and the outage. Everything is computed at render time and draws once on load.
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

type V3 = readonly [number, number, number];
type Block = { x0: number; x1: number; y0: number; y1: number; h: number; door?: boolean };
type Mode = "real" | "ghost" | "down";

const S = 2, OX = 270, OY = 370, W = 1080, H = 940;
const K = Math.cos(Math.PI / 6);
const R = 100;
const DEG = Math.PI / 180;

const f = (n: number) => n.toFixed(1);
const px = (v: V3) => OX + S * (v[0] - v[1]) * K;
const py = (v: V3) => OY + S * ((v[0] + v[1]) / 2 - v[2]);
const xy = (v: V3) => `${f(px(v))} ${f(py(v))}`;
const line = (ps: V3[], close = false) => `M${ps.map(xy).join(" L")}${close ? " Z" : ""}`;
/** Screen units: same scale as the scene, origin at the dome centre, y down. */
const ux = (x: number) => OX + S * x;
const uy = (y: number) => OY + S * y;
const u = (x: number, y: number) => `${f(ux(x))} ${f(uy(y))}`;
/** The floor point that appears at a given screen position. */
const at = (x: number, y: number): V3 => [y + x / (2 * K), y - x / (2 * K), 0];

// ---- buildings -------------------------------------------------------------------------------------------
// Blocks are listed back to front, so later ones paint over earlier ones.
const MAIN: Block[] = [
  { x0: -58, x1: -22, y0: -22, y1: 22, h: 38 },
  { x0: -22, x1: 22, y0: -30, y1: 14, h: 78 },
  { x0: 22, x1: 56, y0: -26, y1: 14, h: 46 },
  { x0: -14, x1: 26, y0: 14, y1: 44, h: 22, door: true },
];
const SMALL_A: Block[] = [{ x0: -26, x1: 6, y0: -18, y1: 18, h: 34 }, { x0: 6, x1: 28, y0: -12, y1: 16, h: 20 }];
const SMALL_B: Block[] = [{ x0: -24, x1: 0, y0: -20, y1: 10, h: 24 }, { x0: 0, x1: 24, y0: -14, y1: 20, h: 46 }];
const LAB: Block[] = [{ x0: -24, x1: 24, y0: -16, y1: 16, h: 18 }];

// Where things stand, in screen units.
const SITE = {
  decoy: [214, 112], north: [235, -115], east: [372, -18], south: [404, 162], west: [40, 255], lab: [-32, 160],
} as const;
const DECOY = at(...SITE.decoy);

function spans(a0: number, a1: number, w: number, gap: number, margin: number) {
  const n = Math.max(0, Math.floor((a1 - a0 - 2 * margin + gap) / (w + gap)));
  const start = a0 + (a1 - a0 - (n * w + (n - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, i) => start + i * (w + gap));
}

function Building({ b, o, mode, seed }: { b: Block; o: V3; mode: Mode; seed: number }) {
  const P = (x: number, y: number, z: number): V3 => [o[0] + x, o[1] + y, z];
  const { x0, x1, y0, y1, h } = b;
  const top = line([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], true);
  const left = line([P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, h), P(x0, y1, h)], true);
  const right = line([P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, h), P(x1, y0, h)], true);

  const rows = spans(0, h, 6, 5, 4);
  let panes = "", lit = "";
  const pane = (q: V3[], r: number, c: number) => {
    const d = line(q, true);
    if (mode === "real" && (r * 3 + c * 5 + seed) % 7 < 2) lit += d; else panes += d;
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
      <path d={left} className={mode === "ghost" ? "fill-shadow-bg" : mode === "down" ? "fill-background" : "fill-surface"} />
      <path d={right} className={mode === "ghost" ? "fill-shadow-bg" : mode === "down" ? "fill-background" : "fill-surface-2"} />
      {lit && <path d={lit} className="fill-fg-subtle" stroke="none" opacity={0.45} />}
      <path d={panes + door} fill="none" strokeWidth={0.75} strokeDasharray="none" opacity={mode === "real" ? 0.6 : 0.45} />
    </g>
  );
}

/** One of three pieces of the encrypted copy, held above a site. */
function Piece({ on, k }: { on: V3; k: number }) {
  const x = px(on), y = py(on);
  return (
    <g strokeDasharray="none">
      <path d={`M${f(x)} ${f(y - 8)} V${f(y - 26)}`} className="stroke-fg-subtle" strokeWidth={1} />
      <rect x={f(x - 18)} y={f(y - 38)} width={36} height={12} rx={2.5} className="fill-background stroke-fg-muted" strokeWidth={1} />
      <rect x={f(x - 18 + k * 12)} y={f(y - 38)} width={12} height={12} rx={k === 1 ? 0 : 2.5} className="fill-fg stroke-fg" strokeWidth={1} />
    </g>
  );
}

/** A group of blocks at a floor position. `mark` is the roof point that carries the cross; `piece` the roof
 *  point that carries this site's piece of the encrypted copy. */
function Site({ o, blocks, mode = "real", mark, pad, piece, k = 0, seed = 1 }:
  { o: V3; blocks: Block[]; mode?: Mode; mark?: V3; pad?: boolean; piece?: V3; k?: number; seed?: number }) {
  const P = (v: V3): V3 => [o[0] + v[0], o[1] + v[1], v[2]];
  const c = mark && P(mark), r = pad ? 7 : 5;
  return (
    <>
      {blocks.map((b, i) => <Building key={i} b={b} o={o} mode={mode} seed={seed + i * 2} />)}
      {c && pad && (
        <path fill="none" strokeWidth={1} strokeDasharray="none" d={line(Array.from({ length: 37 }, (_, i) =>
          [c[0] + 13 * Math.cos(i * 10 * DEG), c[1] + 13 * Math.sin(i * 10 * DEG), c[2]] as V3), true)} />
      )}
      {c && (
        <path d={line([[c[0] - r, c[1], c[2]], [c[0] + r, c[1], c[2]]]) + line([[c[0], c[1] - r, c[2]], [c[0], c[1] + r, c[2]]])}
          fill="none" strokeWidth={pad ? 1.75 : 1.5} strokeLinecap="round" strokeDasharray="none"
          className={mode === "real" ? "stroke-fg" : undefined} />
      )}
      {piece && <Piece on={P(piece)} k={k} />}
    </>
  );
}

/** A lure left in the decoy. */
function Flag({ on }: { on: V3 }) {
  const x = px(on), y = py(on);
  return (
    <g strokeDasharray="none">
      <path d={`M${f(x)} ${f(y)} V${f(y - 26)}`} className="stroke-shadow" strokeWidth={1.25} />
      <path d={`M${f(x)} ${f(y - 26)} l13 5 l-13 5 Z`} className="fill-shadow stroke-shadow" strokeWidth={1} strokeLinejoin="round" />
    </g>
  );
}

/** A numbered marker with a short label; the numbers match the strip under the hero. */
function Pin({ n, x, y, tone, children }: { n: number; x: number; y: number; tone?: string; children: ReactNode }) {
  return (
    <g>
      <circle cx={f(ux(x))} cy={f(uy(y))} r={15} className="fill-fg" />
      <text x={f(ux(x))} y={f(uy(y) + 5.5)} textAnchor="middle" className="fill-background text-[16px] font-semibold tabular-nums">{n}</text>
      <text x={f(ux(x) + 25)} y={f(uy(y) + 8)} strokeWidth={7} strokeLinejoin="round"
        className={cn("stroke-background text-[23px] font-medium [paint-order:stroke]", tone ?? "fill-fg")}>{children}</text>
    </g>
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
  for (let i = -300; i <= 560; i += 20) d += line([[i, -460, 0], [i, 400, 0]]);
  for (let j = -460; j <= 400; j += 20) d += line([[-300, j, 0], [560, j, 0]]);
  return d;
})();

const link = (a: readonly [number, number], b: readonly [number, number]) => `M${u(a[0], a[1])} L${u(b[0], b[1])}`;
const HOME = [0, 0] as const;
// The web the hospitals sit in; the two amber links are the ones that depend on the shared lab.
const WEB = link(HOME, SITE.north) + link(HOME, SITE.east) + link(SITE.north, SITE.east) + link(SITE.east, SITE.south)
  + link(SITE.south, SITE.west);
const LAB_LINKS = link(SITE.lab, HOME) + link(SITE.lab, SITE.west);
const REROUTE = link(HOME, SITE.west);
const along = (t: number) => [SITE.west[0] * t, SITE.west[1] * t] as const;

export function HeroScene({ className }: { className?: string }) {
  const plate = line([[DECOY[0] - 70, DECOY[1] - 44, 0], [DECOY[0] + 68, DECOY[1] - 44, 0],
    [DECOY[0] + 68, DECOY[1] + 56, 0], [DECOY[0] - 70, DECOY[1] + 56, 0]], true);
  const hitA = scale(HIT_A, R), hitB = scale(HIT_B, R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full overflow-visible", className)} role="img"
      aria-label="A hospital under a dome, in a network of hospitals and a shared lab. Attacks land on the dome and are carried into a dashed decoy hospital with lures inside. Pieces of an encrypted copy of the records sit above each site. The shared lab is down and urgent tests take another route.">
      <defs>
        <radialGradient id="mj-scene-fade" gradientUnits="userSpaceOnUse" cx={ux(150)} cy={uy(40)} r={900}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0.6} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <mask id="mj-scene-mask" maskUnits="userSpaceOnUse" x={-800} y={-600} width={2800} height={2200}>
          <rect x={-800} y={-600} width={2800} height={2200} fill="url(#mj-scene-fade)" />
        </mask>
      </defs>

      {/* floor and the web between sites */}
      <g mask="url(#mj-scene-mask)">
        <path d={GRID} className="mj-fade stroke-border-strong" fill="none" strokeWidth={1} opacity={0.6} />
        <path d={WEB} className="mj-fade stroke-fg-subtle" fill="none" strokeWidth={1.25} opacity={0.7} />
        <path d={LAB_LINKS} className="mj-fade mj-d1 stroke-alert" fill="none" strokeWidth={1.25} strokeDasharray="2 7" strokeLinecap="round" />
        <path d={REROUTE} pathLength={1} className="mj-draw mj-d3 stroke-fg" fill="none" strokeWidth={1.75} />
      </g>
      {[0.4, 0.74, 0.86].map((t) => (
        <circle key={t} cx={f(ux(along(t)[0]))} cy={f(uy(along(t)[1]))} r={4.5} className="mj-fade mj-d3 fill-fg stroke-background" strokeWidth={2} />
      ))}

      {/* the hospitals behind */}
      <g className="mj-fade stroke-fg-muted" strokeWidth={1} strokeLinejoin="round" opacity={0.85}>
        <Site o={at(...SITE.north)} blocks={SMALL_A} mark={[-10, 0, 34]} piece={[-10, 0, 34]} k={1} seed={2} />
        <Site o={at(...SITE.east)} blocks={SMALL_B} mark={[12, 3, 46]} piece={[12, 3, 46]} k={2} seed={4} />
      </g>

      {/* dome, far side */}
      <path d={SHELL} className="mj-fade mj-d1 fill-shadow-bg" opacity={0.55} />
      <path d={WIRES.far} className="mj-fade mj-d1 stroke-shadow" fill="none" strokeWidth={0.75} opacity={0.2} />

      {/* the hospital under attack */}
      <g className="mj-fade stroke-fg-muted" strokeWidth={1} strokeLinejoin="round">
        <Site o={[0, 0, 0]} blocks={MAIN} mark={[0, -8, 78]} pad piece={[6, 29, 22]} k={0} />
      </g>

      {/* dome, near side */}
      <path d={WIRES.near} className="mj-fade mj-d1 stroke-shadow" fill="none" strokeWidth={0.75} opacity={0.38} />
      <path d={SHELL} pathLength={1} className="mj-draw stroke-shadow" fill="none" strokeWidth={1.5} strokeLinejoin="round" />

      {/* the shared lab, down, and the hospitals in front */}
      <g className="mj-fade mj-d1 stroke-alert" strokeWidth={1.25} strokeLinejoin="round" strokeDasharray="4 3">
        <Site o={at(...SITE.lab)} blocks={LAB} mode="down" piece={[0, 0, 18]} k={2} />
      </g>
      <g className="mj-fade stroke-fg-muted" strokeWidth={1} strokeLinejoin="round" opacity={0.85}>
        <Site o={at(...SITE.south)} blocks={SMALL_A} mark={[-10, 0, 34]} piece={[-10, 0, 34]} k={0} seed={3} />
        <Site o={at(...SITE.west)} blocks={SMALL_B} mark={[12, 3, 46]} piece={[12, 3, 46]} k={1} seed={5} />
      </g>

      {/* the decoy. Inline delay: the mj-rise shorthand in globals.css resets the mj-d* delay classes */}
      <g className="mj-rise" style={{ animationDelay: "1600ms" }}>
        <path d={plate} className="fill-shadow-bg stroke-shadow" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        <g className="stroke-shadow" strokeWidth={1} strokeLinejoin="round" strokeDasharray="4 3">
          <Site o={DECOY} blocks={MAIN} mode="ghost" mark={[0, -8, 78]} pad />
        </g>
        <Flag on={[DECOY[0] - 40, DECOY[1], 38]} />
        <Flag on={[DECOY[0] + 39, DECOY[1] - 6, 46]} />
        <Flag on={[DECOY[0] + 6, DECOY[1] + 29, 22]} />
      </g>

      {/* attacks land on the dome */}
      <g className="mj-fade mj-d2 stroke-alert" fill="none" strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round">
        <path d={`M${u(-40, -182)} Q${u(-70, -120)} ${xy(hitA)}`} />
        <path d={`M${u(96, -182)} Q${u(98, -110)} ${xy(hitB)}`} />
      </g>
      <g className="mj-fade mj-d2 stroke-shadow" fill="none" strokeWidth={1}>
        <path d={ring(HIT_A, 7) + ring(HIT_B, 7)} opacity={0.9} />
        <path d={ring(HIT_A, 13) + ring(HIT_B, 13)} opacity={0.45} />
      </g>
      <circle cx={f(px(hitA))} cy={f(py(hitA))} r={4} className="mj-fade mj-d2 fill-alert" />
      <circle cx={f(px(hitB))} cy={f(py(hitB))} r={4} className="mj-fade mj-d2 fill-alert" />

      {/* ...and are carried into the decoy */}
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
        <text x={f(ux(106))} y={f(uy(-172))} strokeWidth={7} strokeLinejoin="round"
          className="mj-fade mj-d2 fill-alert stroke-background text-[21px] font-medium [paint-order:stroke]">AI attacker</text>
        <g className="mj-fade mj-d2">
          <path d={`M${f(px(hitB) + 16)} ${f(py(hitB) - 6)} L${u(110, -72)}`} className="stroke-fg-subtle" strokeWidth={1} />
          <Pin n={1} x={120} y={-74}>Caught at login</Pin>
        </g>
        <g className="mj-fade mj-d3">
          <Pin n={2} x={140} y={-28} tone="fill-shadow">Moved, not blocked</Pin>
          <Pin n={3} x={292} y={58} tone="fill-shadow">Fingerprinted</Pin>
          <Pin n={4} x={258} y={-171}>Records scattered</Pin>
          <Pin n={5} x={42} y={150}>Care keeps running</Pin>
        </g>
        <g className="mj-fade mj-d1" textAnchor="middle" strokeWidth={7} strokeLinejoin="round">
          <text x={f(ux(-80))} y={f(uy(100))} className="fill-fg stroke-background text-[22px] font-medium [paint-order:stroke]">Real hospital</text>
          <text x={f(ux(-80))} y={f(uy(100) + 27)} className="fill-fg-subtle stroke-background text-[19px] [paint-order:stroke]">Never switched off</text>
          <text x={f(ux(-76))} y={f(uy(168))} textAnchor="end" className="fill-alert stroke-background text-[19px] [paint-order:stroke]">Shared lab, down</text>
        </g>
        <g className="mj-fade mj-d3" textAnchor="middle" strokeWidth={7} strokeLinejoin="round">
          <text x={f(ux(226))} y={f(uy(184))} className="fill-shadow stroke-background text-[22px] font-medium [paint-order:stroke]">Decoy hospital</text>
          <text x={f(ux(226))} y={f(uy(184) + 27)} className="fill-fg-subtle stroke-background text-[19px] [paint-order:stroke]">Built fresh for this attacker</text>
        </g>
      </g>
    </svg>
  );
}
