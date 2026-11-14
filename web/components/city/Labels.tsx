"use client";
// HUD labels: plain DOM over the canvas, positioned each frame by projecting 3D anchors.
// (Cheaper than drei <Html> and avoids React-root churn.)
import { useMemo, type CSSProperties } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD, type NodeState } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { COLORS, HOSPITALS, type HospitalLayout } from "./layout";
import { useFX, useLive } from "./fx";

export interface LabelRegistry {
  labels: Record<string, HTMLDivElement | null>;
  keys: Record<string, HTMLDivElement | null>;
}
export const makeLabelRegistry = (): LabelRegistry => ({ labels: {}, keys: {} });

const anchorOf = (l: HospitalLayout) =>
  l.pos.clone().add(new THREE.Vector3(0, l.isLab ? 3.4 : l.top.y + 0.6, 0));

/** Inside <Canvas>: moves the DOM labels to their projected positions. */
export function LabelProjector({ reg }: { reg: LabelRegistry }) {
  const fx = useFX();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const anchors = useMemo(() => Object.fromEntries(HOSPITALS.map((l) => [l.id, anchorOf(l)])), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const lift = useMemo<Record<string, number>>(() => ({}), []); // smoothed declutter offsets (px)
  useFrame((_, dt) => {
    // project, then push farther labels up while they overlap nearer ones
    const pts: { id: string; x: number; y: number; z: number; ok: boolean }[] = [];
    for (const l of HOSPITALS) {
      v.copy(anchors[l.id]).project(camera);
      const ok = v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3;
      pts.push({ id: l.id, x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, z: v.z, ok });
    }
    pts.sort((a, b) => a.z - b.z);
    const placed: { x: number; y: number }[] = [];
    for (const p of pts) {
      let off = 0;
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.some((q) => Math.abs(q.x - p.x) < 120 && Math.abs(q.y - (p.y - off)) < 34);
        if (!hit) break;
        off += 34;
      }
      lift[p.id] = THREE.MathUtils.damp(lift[p.id] ?? off, off, 6, dt);
      if (p.ok) placed.push({ x: p.x, y: p.y - off });
      const el = reg.labels[p.id];
      if (!el) continue;
      el.style.opacity = p.ok ? "1" : "0";
      if (p.ok) {
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - lift[p.id]).toFixed(1)}px, 0) translate(-50%, -100%)`;
        el.style.setProperty("--lift", `${lift[p.id].toFixed(1)}px`);
      }
    }
    for (const l of HOSPITALS) {
      const kel = reg.keys[l.id];
      const kp = fx.keyPos[l.id];
      if (!kel || !kp) continue;
      v.copy(kp).project(camera);
      const ok = v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3;
      kel.style.opacity = ok ? "1" : "0";
      if (ok) {
        const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
        kel.style.transform = `translate3d(${(x + 12).toFixed(1)}px, ${(y - 10).toFixed(1)}px, 0) translate(0, -50%)`;
      }
    }
  });
  return null;
}

const STATUS_TEXT: Record<NodeState, string> = {
  healthy: "online", degraded: "degraded", compromised: "compromised", quarantined: "quarantined", down: "offline",
};

const base: CSSProperties = {
  position: "absolute", left: 0, top: 0, pointerEvents: "none", willChange: "transform",
  opacity: 0, transition: "opacity 400ms ease",
};

function HospitalLabel({ l, reg }: { l: HospitalLayout; reg: LabelRegistry }) {
  const live = useLive();
  const status = useMJ((s) => (live ? s.view.nodes[l.id] ?? "healthy" : "healthy"));
  const key = useMJ((s) => (live ? s.view.keyshares[l.id] ?? "safe" : "safe"));
  const captured = useMJ((s) => s.view.sharesCaptured);
  const tone = status === "healthy" ? COLORS.real : status === "down" ? "#6b7685" : COLORS.alert;
  return (
    <>
      <div ref={(el) => { reg.labels[l.id] = el; }} style={base}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, whiteSpace: "nowrap", userSelect: "none" }}>
          <div style={{
            font: "600 11px/1 var(--font-geist-sans), ui-sans-serif, system-ui",
            letterSpacing: "0.24em", textTransform: "uppercase", color: "#e9fcff",
            textShadow: `0 0 14px ${tone}99, 0 1px 2px #000`, display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: 5, background: tone, boxShadow: `0 0 8px ${tone}`,
              animation: status === "compromised" ? "mjcity-pulse 0.9s ease-in-out infinite" : undefined,
            }} />
            {l.h.short}
          </div>
          <div style={{
            font: "500 9px/1 var(--font-geist-mono), ui-monospace, monospace",
            letterSpacing: "0.14em", textTransform: "uppercase", color: tone, opacity: 0.8,
          }}>
            {l.isLab ? `lab · ${l.h.lab_capacity_per_hr}/hr` : `${l.h.beds} beds`} · {STATUS_TEXT[status]}
          </div>
          <div style={{ width: 1, height: "calc(16px + var(--lift, 0px))", background: `linear-gradient(${tone}aa, transparent)` }} />
        </div>
      </div>
      <div ref={(el) => { reg.keys[l.id] = el; }} style={{ ...base, display: key === "captured" ? "block" : "none" }}>
        <div style={{
          font: "500 10px/1 var(--font-geist-mono), ui-monospace, monospace", color: COLORS.alert,
          padding: "3px 6px", border: `1px solid ${COLORS.alert}55`, background: "rgba(5,7,13,0.72)",
          borderRadius: 3, whiteSpace: "nowrap", letterSpacing: "0.06em", textShadow: `0 0 8px ${COLORS.alert}88`,
        }}>
          <span style={{ opacity: 0.65 }}>key share</span> {captured}/{WORLD.key_shares.threshold}
        </div>
      </div>
    </>
  );
}

/** Outside <Canvas>: the DOM nodes for the labels. */
export function LabelLayer({ reg }: { reg: LabelRegistry }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 1 }}>
      {HOSPITALS.map((l) => <HospitalLabel key={l.id} l={l} reg={reg} />)}
    </div>
  );
}
