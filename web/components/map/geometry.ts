// Static layout for the network map: projection of WORLD's 0–100 grid (y north) into the SVG viewBox,
// label placement, and the attacker's off-network origin. Pure data, no React.
import { WORLD, type Hospital } from "@/lib/contracts";

export const VB_W = 1000;
export const VB_H = 620;

// Grid window that is projected into the viewBox (leaves room for labels and the attacker origin).
const GX0 = 8, GX1 = 116, GY0 = 12, GY1 = 96;
const PAD_X = 40, PAD_Y = 36;

export interface Pt { x: number; y: number }

export function project(gx: number, gy: number): Pt {
  return {
    x: PAD_X + ((gx - GX0) / (GX1 - GX0)) * (VB_W - 2 * PAD_X),
    y: PAD_Y + ((GY1 - gy) / (GY1 - GY0)) * (VB_H - 2 * PAD_Y),
  };
}

/** Where the attacker comes from: outside the city, top-right. Not a hospital. */
export const ATTACKER_PT = project(100, 90);

/** Offset of the shadow copy of the network (a literal "shadow" of the real diagram). */
export const SHADOW_OFFSET: Pt = { x: 28, y: -22 };

export type Anchor = "start" | "middle" | "end";
/** Label placement per node, in px (scaled by units-per-px at render). Chosen to sit in free space. */
export const LABEL: Record<string, { dx: number; dy: number; anchor: Anchor }> = {
  aur: { dx: 0, dy: 24, anchor: "middle" },
  riv: { dx: 0, dy: 24, anchor: "middle" },
  nor: { dx: -16, dy: -4, anchor: "end" },
  eas: { dx: 0, dy: 24, anchor: "middle" },
  wes: { dx: 0, dy: 24, anchor: "middle" },
  lum: { dx: 0, dy: 24, anchor: "middle" },
};
export const DEFAULT_LABEL = { dx: 0, dy: 24, anchor: "middle" as Anchor };

export const HOSPITALS: (Hospital & Pt & { gx: number; gy: number })[] = WORLD.hospitals.map((h) => {
  const p = project(h.x, h.y);
  return { ...h, gx: h.x, gy: h.y, x: p.x, y: p.y };
});
export const BY_ID: Record<string, (typeof HOSPITALS)[number]> = Object.fromEntries(HOSPITALS.map((h) => [h.id, h]));

export const LINKS = WORLD.links.filter(([a, b]) => BY_ID[a] && BY_ID[b]);

export const NEIGHBORS: Record<string, string[]> = Object.fromEntries(
  HOSPITALS.map((h) => [h.id, LINKS.flatMap(([a, b]) => (a === h.id ? [b] : b === h.id ? [a] : []))]),
);

export const ENTRY_ID = WORLD.entry_point.hospital_id;

export function isLab(h: Hospital) {
  return h.kind === "pathology";
}

export function meta(h: Hospital) {
  return isLab(h) ? `${h.lab_capacity_per_hr} tests/hr` : `${h.beds} beds`;
}

export function pointAt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Shorten segment a→b by `ra` at a and `rb` at b (so lines meet node outlines, not centres). */
export function trim(a: Pt, b: Pt, ra: number, rb: number): [Pt, Pt] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return [{ x: a.x + ux * ra, y: a.y + uy * ra }, { x: b.x - ux * rb, y: b.y - uy * rb }];
}

/** A gentle quadratic arc from a to b bulging to the left of the direction of travel. */
export function arcPath(a: Pt, b: Pt, bulge: number): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bulge, cy = my + (dx / len) * bulge;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function shifted(p: Pt, o: Pt = SHADOW_OFFSET): Pt {
  return { x: p.x + o.x, y: p.y + o.y };
}

export interface Box { x: number; y: number; w: number; h: number }
export const FULL_BOX: Box = { x: 0, y: 0, w: VB_W, h: VB_H };

/** Tight box around every node, the attacker origin and the shadow copy — for the label-less compact variant. */
export const COMPACT_BOX: Box = (() => {
  const pts = [...HOSPITALS, ...HOSPITALS.map((h) => shifted(h)), ATTACKER_PT];
  const pad = 22;
  const x0 = Math.min(...pts.map((p) => p.x)) - pad, x1 = Math.max(...pts.map((p) => p.x)) + pad;
  const y0 = Math.min(...pts.map((p) => p.y)) - pad, y1 = Math.max(...pts.map((p) => p.y)) + pad;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
})();

/** Small stable hash for picking a neighbour deterministically from an event id. */
export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
