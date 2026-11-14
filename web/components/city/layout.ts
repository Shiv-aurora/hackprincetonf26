// World → 3D layout for the MayaJaal city. Pure data/maths, no React.
import * as THREE from "three";
import { WORLD, type Hospital } from "@/lib/contracts";

// ------------------------------------------------------------------ palette (mirrors DESIGN tokens)
export const COLORS = {
  ink: "#05070d",
  real: "#2de2e6",
  shadow: "#b26bff",
  shadowHot: "#ff4fd8",
  alert: "#ffb02e",
  down: "#39424f",
  window: "#9fe9ff",
  windowWarm: "#ffd9a8",
} as const;

export const col = (hex: string) => new THREE.Color(hex);

/** grid units (0–100) → world units */
const S = 0.5;

export interface HospitalLayout {
  h: Hospital;
  id: string;
  pos: THREE.Vector3; // ground centre
  height: number; // main body height
  isLab: boolean;
  /** where net threads attach */
  anchor: THREE.Vector3;
  /** top of the tallest part */
  top: THREE.Vector3;
  ringRadius: number;
}

function layoutHospital(h: Hospital): HospitalLayout {
  const isLab = h.kind === "pathology" || h.beds === 0;
  const pos = new THREE.Vector3((h.x - 50) * S, 0, -(h.y - 50) * S);
  const height = isLab ? 2.3 : 4.6 + (h.beds / 620) * 9;
  return {
    h,
    id: h.id,
    pos,
    height,
    isLab,
    anchor: pos.clone().add(new THREE.Vector3(0, isLab ? 1.4 : 1.15, 0)),
    top: pos.clone().add(new THREE.Vector3(0, height + (isLab ? 0.8 : 1.6), 0)),
    ringRadius: isLab ? 3.6 : 2.6,
  };
}

export const HOSPITALS: HospitalLayout[] = WORLD.hospitals.map(layoutHospital);
export const HOSPITAL: Record<string, HospitalLayout> = Object.fromEntries(HOSPITALS.map((l) => [l.id, l]));

export interface LinkLayout {
  key: string;
  a: string;
  b: string;
  curve: THREE.CubicBezierCurve3;
  seed: number;
}

function arc(from: THREE.Vector3, to: THREE.Vector3): THREE.CubicBezierCurve3 {
  const d = from.distanceTo(to);
  const lift = 1.4 + d * 0.2;
  const c1 = from.clone().lerp(to, 0.28).add(new THREE.Vector3(0, lift, 0));
  const c2 = from.clone().lerp(to, 0.72).add(new THREE.Vector3(0, lift, 0));
  return new THREE.CubicBezierCurve3(from.clone(), c1, c2, to.clone());
}

export const LINKS: LinkLayout[] = WORLD.links
  .filter(([a, b]) => HOSPITAL[a] && HOSPITAL[b])
  .map(([a, b], i) => ({
    key: `${a}-${b}`,
    a,
    b,
    curve: arc(HOSPITAL[a].anchor, HOSPITAL[b].anchor),
    seed: (i * 0.618) % 1,
  }));

export function linkKey(a: string, b: string): string | null {
  for (const l of LINKS) if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) return l.key;
  return null;
}

export function neighbours(id: string): string[] {
  const out: string[] = [];
  for (const l of LINKS) {
    if (l.a === id) out.push(l.b);
    else if (l.b === id) out.push(l.a);
  }
  return out;
}

/** Curve following the link from `from` to `to` (reversed if needed). */
export function linkCurve(from: string, to: string): THREE.Curve<THREE.Vector3> | null {
  for (const l of LINKS) {
    if (l.a === from && l.b === to) return l.curve;
    if (l.a === to && l.b === from) {
      const c = l.curve;
      return new THREE.CubicBezierCurve3(c.v3.clone(), c.v2.clone(), c.v1.clone(), c.v0.clone());
    }
  }
  return null;
}

/** BFS shortest path over the net, avoiding `blocked` nodes (except endpoints). */
export function netPath(from: string, to: string, blocked: Set<string>): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of neighbours(cur)) {
      if (prev.has(n)) continue;
      if (blocked.has(n) && n !== to) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let p = prev.get(to);
        while (p) { path.unshift(p); p = prev.get(p) ?? null; }
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

/** Point outside the city where attacker traffic enters (beyond the target, high in the sky). */
export function outsidePoint(id: string): THREE.Vector3 {
  // High in the sky, ~75° around from the hospital's outward direction, so the approach crosses
  // the frame instead of flying straight at a camera parked outside the city.
  const a = outwardAngle(id) + 1.3;
  return new THREE.Vector3(Math.sin(a) * 44, 24, Math.cos(a) * 44);
}

/** Azimuth (atan2(x, z)) pointing from the city centre out through this hospital. */
export function outwardAngle(id: string): number {
  const p = HOSPITAL[id].pos;
  return p.lengthSq() < 30 ? 0.55 : Math.atan2(p.x, p.z);
}

/** Mirror a point into the shadow city. */
export const mirror = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.y, v.z);

export const CITY_RADIUS = 30;
