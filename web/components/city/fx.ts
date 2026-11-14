// Imperative FX controller for the city: packets, ripples, flashes, flares, camera cues.
// Events write into it; render components read it every frame. No React state → no re-renders.
import * as THREE from "three";
import { createContext, useContext } from "react";
import type { MJEvent } from "@/lib/contracts";
import {
  COLORS, HOSPITAL, HOSPITALS, linkCurve, mirror, neighbours, netPath, outsidePoint,
} from "./layout";

export type PacketTone = "real" | "attackReal" | "shadow" | "attackShadow" | "lab" | "labStat" | "alert" | "ambient";

export const TONE: Record<PacketTone, { above: THREE.Color; below: THREE.Color }> = {
  real: { above: new THREE.Color(COLORS.real).multiplyScalar(1.6), below: new THREE.Color(COLORS.shadow).multiplyScalar(1.6) },
  ambient: { above: new THREE.Color(COLORS.real).multiplyScalar(0.9), below: new THREE.Color(COLORS.shadow).multiplyScalar(0.8) },
  attackReal: { above: new THREE.Color("#5ff6ff").multiplyScalar(3), below: new THREE.Color(COLORS.shadowHot).multiplyScalar(3) },
  shadow: { above: new THREE.Color(COLORS.real).multiplyScalar(1.6), below: new THREE.Color(COLORS.shadow).multiplyScalar(2.2) },
  attackShadow: { above: new THREE.Color("#5ff6ff").multiplyScalar(3), below: new THREE.Color(COLORS.shadowHot).multiplyScalar(3.4) },
  lab: { above: new THREE.Color("#bff8ff").multiplyScalar(1.5), below: new THREE.Color(COLORS.shadow) },
  labStat: { above: new THREE.Color("#e8feff").multiplyScalar(2.6), below: new THREE.Color(COLORS.shadow) },
  alert: { above: new THREE.Color(COLORS.alert).multiplyScalar(2.6), below: new THREE.Color(COLORS.alert).multiplyScalar(2) },
};

export interface Packet {
  curve: THREE.Curve<THREE.Vector3>;
  t: number; // 0..1 progress (arc length)
  dur: number; // seconds for the full curve
  stopAt: number; // fraction where the packet ends (deflected requests stop early)
  size: number;
  trail: number; // number of trail samples
  trailSpan: number; // fraction of curve covered by the trail
  tone: PacketTone;
  end: "flash" | "deflect" | "none";
  splashed: boolean;
  prevY: number;
  fade: number; // tail fade-out after arrival (seconds remaining, <0 = alive)
}

export interface Flash {
  pos: THREE.Vector3;
  age: number;
  dur: number;
  size: number;
  color: THREE.Color;
}

export interface Ripple {
  x: number; z: number; t0: number; strength: number; speed: number; color: THREE.Color;
}

export type CameraCue =
  | { kind: "focus"; id: string; until: number; low?: boolean }
  | { kind: "wide"; until: number };

export const MAX_PACKETS = 160;
export const MAX_RIPPLES = 12;
export const MAX_FLASHES = 48;

export class CityFX {
  time = 0;
  packets: Packet[] = [];
  flashes: Flash[] = [];
  ripples: Ripple[] = [];
  /** shadow-city brightness: base (from state) + transient flare */
  shadowBase = 0.22;
  shadow = 0.22;
  flare = 0; // 0..1 reveal flare, decays
  chroma = 0; // chromatic aberration pulse
  bloomBoost = 0;
  shake = 0;
  divertedAt: Record<string, number> = {}; // hospital id → time diverted (shadow mirror glows)
  cue: CameraCue | null = null;
  cueSerial = 0;
  blocked = new Set<string>(); // quarantined / down nodes
  /** world positions of each key-share fragment (written by Hospitals, read by Labels) */
  keyPos: Record<string, THREE.Vector3> = {};

  reset() {
    this.packets.length = 0;
    this.flashes.length = 0;
    this.divertedAt = {};
    this.flare = 0;
  }

  // ---------------------------------------------------------------- primitives
  addPacket(p: Omit<Packet, "t" | "splashed" | "prevY" | "fade">) {
    if (this.packets.length >= MAX_PACKETS) this.packets.shift();
    this.packets.push({ ...p, t: 0, splashed: false, prevY: 1, fade: -1 });
  }

  addFlash(pos: THREE.Vector3, color: THREE.Color, size = 0.6, dur = 0.8) {
    if (this.flashes.length >= MAX_FLASHES) this.flashes.shift();
    this.flashes.push({ pos: pos.clone(), age: 0, dur, size, color: color.clone() });
  }

  addRipple(x: number, z: number, color: string | THREE.Color, strength = 1, speed = 5) {
    const r: Ripple = { x, z, t0: this.time, strength, speed, color: new THREE.Color(color) };
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push(r);
  }

  setCue(cue: CameraCue) {
    this.cue = cue;
    this.cueSerial++;
  }

  // ---------------------------------------------------------------- paths
  private diveCurve(from: THREE.Vector3, hospitalId: string, steep = true): THREE.CurvePath<THREE.Vector3> {
    const l = HOSPITAL[hospitalId];
    const out = from.clone().setY(0).sub(l.pos).setY(0);
    if (out.lengthSq() < 0.01) out.set(1, 0, 0);
    out.normalize();
    const dive = l.pos.clone().add(out.clone().multiplyScalar(l.ringRadius + 0.6));
    const path = new THREE.CurvePath<THREE.Vector3>();
    const c1 = from.clone().lerp(dive, 0.35).add(new THREE.Vector3(0, steep ? 4 : 1.5, 0));
    const c2 = dive.clone().add(out.clone().multiplyScalar(1.2)).add(new THREE.Vector3(0, steep ? 3.5 : 1.8, 0));
    path.add(new THREE.CubicBezierCurve3(from.clone(), c1, c2, dive));
    const target = mirror(l.pos.clone().add(new THREE.Vector3(0, l.height * 0.55, 0)));
    const d1 = dive.clone().add(new THREE.Vector3(0, -2.2, 0)).sub(out.clone().multiplyScalar(0.4));
    const d2 = target.clone().add(out.clone().multiplyScalar(1.2));
    path.add(new THREE.CubicBezierCurve3(dive.clone(), d1, d2, target));
    return path;
  }

  private attackCurve(hospitalId: string): THREE.Curve<THREE.Vector3> {
    const l = HOSPITAL[hospitalId];
    const from = outsidePoint(hospitalId);
    const to = l.pos.clone().add(new THREE.Vector3(0, l.height * 0.62, 0));
    const c1 = from.clone().lerp(to, 0.3).add(new THREE.Vector3(0, 5, 0));
    const c2 = to.clone().add(from.clone().sub(to).setY(0).normalize().multiplyScalar(5)).add(new THREE.Vector3(0, 3, 0));
    return new THREE.CubicBezierCurve3(from, c1, c2, to);
  }

  private pickNeighbour(id: string): string | null {
    const ns = neighbours(id).filter((n) => !this.blocked.has(n));
    const pool = ns.length ? ns : neighbours(id);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  // ---------------------------------------------------------------- event handlers
  onRequest(ev: Extract<MJEvent, { type: "request" }>) {
    const id = ev.hospital_id;
    if (!id || !HOSPITAL[id]) return;
    const attacker = ev.actor === "attacker";
    const denied = ev.data.status === 401 || ev.data.status === 403;

    if (ev.tier === "shadow") {
      const from = attacker ? outsidePoint(id) : HOSPITAL[this.pickNeighbour(id) ?? id].anchor;
      this.addPacket({
        curve: this.diveCurve(from, id, attacker),
        dur: attacker ? 3.0 : 2.0,
        stopAt: 1,
        size: attacker ? 0.26 : 0.12,
        trail: attacker ? 22 : 6,
        trailSpan: attacker ? 0.22 : 0.08,
        tone: attacker ? "attackShadow" : "shadow",
        end: "flash",
      });
      return;
    }

    if (attacker) {
      this.addPacket({
        curve: this.attackCurve(id),
        dur: 2.6,
        stopAt: denied ? 0.9 : 1,
        size: 0.24,
        trail: 20,
        trailSpan: 0.2,
        tone: "attackReal",
        end: denied ? "deflect" : "flash",
      });
      return;
    }

    const n = this.pickNeighbour(id);
    const curve = n ? linkCurve(n, id) : null;
    if (!curve) return;
    this.addPacket({
      curve, dur: 1.7, stopAt: 1, size: 0.1, trail: 4, trailSpan: 0.06,
      tone: denied ? "alert" : "real", end: denied ? "deflect" : "flash",
    });
  }

  onLabOrder(ev: Extract<MJEvent, { type: "lab.order" }>) {
    const d = ev.data;
    const stat = d.urgency === "stat";
    if (d.status === "unservable") {
      const l = HOSPITAL[d.from_hospital];
      if (l) {
        this.addFlash(l.anchor.clone().add(new THREE.Vector3(0, 0.6, 0)), TONE.alert.above, 0.9, 1.4);
      }
      return;
    }
    if (d.status === "completed") {
      const l = d.to_hospital ? HOSPITAL[d.to_hospital] : null;
      if (l) this.addFlash(l.anchor.clone().add(new THREE.Vector3(0, 0.3, 0)), TONE.lab.above, stat ? 0.55 : 0.35, 0.7);
      return;
    }
    if (d.status !== "rerouted" || !d.to_hospital) return;
    const from = d.from_hospital, to = d.to_hospital;
    if (!HOSPITAL[from] || !HOSPITAL[to]) return;
    const tone: PacketTone = stat ? "labStat" : "lab";
    const size = stat ? 0.21 : d.urgency === "urgent" ? 0.16 : 0.12;
    if (from === to) {
      // processed in-house: a small hop over the tower
      const l = HOSPITAL[from];
      const a = l.anchor.clone().add(new THREE.Vector3(1.2, 0, 0.6));
      const b = l.anchor.clone().add(new THREE.Vector3(-0.6, 0, -1.2));
      const top = l.pos.clone().add(new THREE.Vector3(0, l.height + 1.2, 0));
      this.addPacket({
        curve: new THREE.CubicBezierCurve3(a, a.clone().lerp(top, 0.7), b.clone().lerp(top, 0.7), b),
        dur: 1.4, stopAt: 1, size, trail: 8, trailSpan: 0.18, tone, end: "flash",
      });
      return;
    }
    const path = netPath(from, to, this.blocked);
    if (!path || path.length < 2) return;
    const cp = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < path.length - 1; i++) {
      const c = linkCurve(path[i], path[i + 1]);
      if (c) cp.add(c);
    }
    // a little stream of 3 particles per rerouted order
    const n = stat ? 4 : 2;
    for (let i = 0; i < n; i++) {
      this.addPacket({
        curve: cp, dur: 2.2 * (path.length - 1) * 0.75 + i * 0.25, stopAt: 1, size: size * (1 - i * 0.18),
        trail: 14, trailSpan: 0.14, tone, end: i === 0 ? "flash" : "none",
      });
    }
  }

  onDiverted(ev: MJEvent) {
    const id = ev.hospital_id;
    if (!id || !HOSPITAL[id]) return;
    const l = HOSPITAL[id];
    this.divertedAt[id] = this.time;
    this.addRipple(l.pos.x, l.pos.z, COLORS.shadow, 1.6, 6);
    setTimeout(() => this.addRipple(l.pos.x, l.pos.z, COLORS.shadowHot, 0.9, 4.5), 450);
    this.flare = Math.max(this.flare, 0.45);
    this.chroma = Math.max(this.chroma, 0.35);
    this.setCue({ kind: "focus", id, until: this.time + 11, low: true });
  }

  onReveal(ev: MJEvent) {
    const id = ev.hospital_id && HOSPITAL[ev.hospital_id] ? ev.hospital_id : HOSPITALS[0].id;
    const l = HOSPITAL[id];
    this.flare = 1;
    this.chroma = 1;
    this.bloomBoost = 1;
    this.shake = 1;
    this.addRipple(l.pos.x, l.pos.z, COLORS.shadowHot, 3.2, 16);
    setTimeout(() => this.addRipple(l.pos.x, l.pos.z, COLORS.shadow, 2.0, 10), 260);
    setTimeout(() => this.addRipple(l.pos.x, l.pos.z, COLORS.shadowHot, 1.2, 6), 700);
    this.addFlash(mirror(l.pos.clone().add(new THREE.Vector3(0, l.height * 0.5, 0))), new THREE.Color(COLORS.shadowHot).multiplyScalar(4), 3.5, 1.6);
    this.setCue({ kind: "wide", until: this.time + 9 });
  }

  onNodeStatus(ev: Extract<MJEvent, { type: "node.status" }>) {
    const id = ev.hospital_id;
    if (!id || !HOSPITAL[id]) return;
    const s = ev.data.status;
    const l = HOSPITAL[id];
    if (s === "quarantined" || s === "down") this.blocked.add(id);
    else this.blocked.delete(id);
    if (s === "compromised") {
      this.addRipple(l.pos.x, l.pos.z, COLORS.alert, 1.2, 5);
      this.addFlash(l.top, TONE.alert.above, 1.6, 1.2);
      this.setCue({ kind: "focus", id, until: this.time + 9 });
    } else if (s === "quarantined") {
      this.addRipple(l.pos.x, l.pos.z, COLORS.alert, 0.8, 3.5);
    } else if (s === "down") {
      this.addFlash(l.top, new THREE.Color(COLORS.down).multiplyScalar(2), 1.2, 1.2);
    }
  }

  onKeyshare(ev: Extract<MJEvent, { type: "keyshare.status" }>) {
    const id = ev.hospital_id;
    if (!id || !HOSPITAL[id] || ev.data.state !== "captured") return;
    const l = HOSPITAL[id];
    this.addFlash(l.pos.clone().add(new THREE.Vector3(0, l.height * 0.55, 0)), TONE.alert.above, 0.9, 1.0);
  }

  /** Landing-mode ambience: gentle traffic along the net (not data — decorative only). */
  ambient() {
    const ids = HOSPITALS.map((h) => h.id);
    const to = ids[Math.floor(Math.random() * ids.length)];
    const from = this.pickNeighbour(to);
    const c = from ? linkCurve(from, to) : null;
    if (!c) return;
    this.addPacket({ curve: c, dur: 2.4 + Math.random(), stopAt: 1, size: 0.09, trail: 5, trailSpan: 0.06, tone: "ambient", end: "none" });
    if (Math.random() < 0.18) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      const nb = this.pickNeighbour(id);
      if (nb) {
        this.addPacket({
          curve: this.diveCurve(HOSPITAL[nb].anchor, id, false), dur: 2.6, stopAt: 1, size: 0.1,
          trail: 8, trailSpan: 0.1, tone: "shadow", end: "none",
        });
      }
    }
  }

  // ---------------------------------------------------------------- per-frame
  update(dt: number) {
    this.time += dt;
    // decay transients
    this.flare = Math.max(0, this.flare - dt * 0.22);
    this.chroma = Math.max(0, this.chroma - dt * 0.8);
    this.bloomBoost = Math.max(0, this.bloomBoost - dt * 0.35);
    this.shake = Math.max(0, this.shake - dt * 0.9);
    const target = this.shadowBase + this.flare * 2.2;
    this.shadow = THREE.MathUtils.damp(this.shadow, target, this.flare > 0.6 ? 6 : 1.4, dt);

    // packets
    const keep: Packet[] = [];
    const tmp = new THREE.Vector3();
    for (const p of this.packets) {
      if (p.fade >= 0) {
        p.fade -= dt;
        if (p.fade > 0) keep.push(p);
        continue;
      }
      p.t += dt / p.dur;
      p.curve.getPointAt(Math.min(p.t, 1), tmp);
      if (!p.splashed && p.prevY > 0 && tmp.y <= 0) {
        p.splashed = true;
        const strong = p.tone === "attackShadow";
        this.addRipple(tmp.x, tmp.z, strong ? COLORS.shadowHot : COLORS.shadow, strong ? 1.0 : 0.4, strong ? 4 : 3);
        this.addFlash(tmp, TONE[p.tone].below, strong ? 0.9 : 0.4, 0.6);
      }
      p.prevY = tmp.y;
      if (p.t >= p.stopAt) {
        p.t = p.stopAt;
        if (p.end === "flash") this.addFlash(tmp, tmp.y < 0 ? TONE[p.tone].below : TONE[p.tone].above, p.size * 3.2, 0.7);
        else if (p.end === "deflect") this.addFlash(tmp, TONE.alert.above, p.size * 4.5, 0.9);
        p.fade = 0.45; // let the trail catch up and fade
        keep.push(p);
        continue;
      }
      keep.push(p);
    }
    this.packets = keep;

    // flashes
    this.flashes = this.flashes.filter((f) => (f.age += dt) < f.dur);
  }
}

export const FXContext = createContext<CityFX | null>(null);
export function useFX(): CityFX {
  const fx = useContext(FXContext);
  if (!fx) throw new Error("useFX outside CityCanvas");
  return fx;
}

/** false in landing mode: the city ignores hub state and shows a calm, healthy net. */
export const LiveContext = createContext(true);
export const useLive = () => useContext(LiveContext);
