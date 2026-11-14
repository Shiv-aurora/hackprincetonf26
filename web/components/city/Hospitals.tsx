"use client";
// The six hospital towers (+ Lumen lab), their shadow twins, status rings, quarantine shields,
// orbiting key-share fragments and HUD labels.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { NodeState } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { COLORS, HOSPITALS, type HospitalLayout } from "./layout";
import {
  makeBeamMaterial, makeBuildingMaterial, makeRingMaterial, makeShieldMaterial, type Shared,
} from "./materials";
import { useFX, useLive } from "./fx";

interface Part { x: number; y: number; z: number; w: number; h: number; d: number }

function partsFor(l: HospitalLayout): Part[] {
  const H = l.height;
  if (l.isLab) {
    return [
      { x: 0, y: 0, z: 0, w: 5.2, h: 1.3, d: 3.4 },
      { x: -0.9, y: 1.3, z: -0.2, w: 2.6, h: 1.0, d: 2.2 },
      { x: 1.4, y: 1.3, z: 0.6, w: 0.7, h: 0.55, d: 0.7 },
      { x: 2.2, y: 1.3, z: 0.6, w: 0.7, h: 0.55, d: 0.7 },
      { x: 1.8, y: 1.3, z: -0.7, w: 1.4, h: 0.3, d: 0.9 },
    ];
  }
  const parts: Part[] = [
    { x: 0, y: 0, z: 0, w: 3.0, h: 0.95, d: 2.6 },
    { x: 0, y: 0.95, z: 0, w: 1.75, h: H - 0.95, d: 1.5 },
    { x: 0, y: H, z: 0, w: 1.25, h: Math.max(0.5, H * 0.13), d: 1.05 },
    { x: 0, y: H + Math.max(0.5, H * 0.13), z: 0, w: 0.09, h: 1.3, d: 0.09 },
  ];
  if (H > 6) parts.push({ x: 1.15, y: 0.95, z: 0.25, w: 0.9, h: H * 0.42, d: 0.95 });
  if (H > 4.5) parts.push({ x: -1.05, y: 0.95, z: -0.3, w: 0.75, h: H * 0.28, d: 0.85 });
  return parts;
}

const C_REAL = new THREE.Color(COLORS.real);
const C_ALERT = new THREE.Color(COLORS.alert);
const C_DOWN = new THREE.Color(COLORS.down);
const C_SHADOW = new THREE.Color(COLORS.shadow);
const C_HOT = new THREE.Color(COLORS.shadowHot);

function statusLook(s: NodeState) {
  switch (s) {
    case "healthy": return { color: C_REAL, edge: 1.5, level: 1, pulse: 0, shield: 0, beam: 0.3 };
    case "degraded": return { color: C_ALERT, edge: 1.1, level: 0.85, pulse: 0.2, shield: 0, beam: 0.35 };
    case "compromised": return { color: C_ALERT, edge: 2.0, level: 1, pulse: 1, shield: 0, beam: 0.9 };
    case "quarantined": return { color: C_ALERT, edge: 0.9, level: 0.7, pulse: 0.15, shield: 1, beam: 0.1 };
    case "down": return { color: C_DOWN, edge: 0.6, level: 0.35, pulse: 0, shield: 0, beam: 0 };
  }
}

const unitBox = (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; })();

function Hospital({ l, index, shared }: { l: HospitalLayout; index: number; shared: Shared }) {
  const fx = useFX();
  const live = useLive();
  const status = useMJ((s) => (live ? s.view.nodes[l.id] ?? "healthy" : "healthy"));
  const keyState = useMJ((s) => (live ? s.view.keyshares[l.id] ?? "safe" : "safe"));

  const parts = useMemo(() => partsFor(l), [l]);
  const mats = useMemo(() => {
    const delay = 0.2 + index * 0.12;
    return {
      real: makeBuildingMaterial(shared, { edge: C_REAL.clone().multiplyScalar(1.5), windows: 1.3, delay, base: "#08101f" }),
      shadow: makeBuildingMaterial(shared, { shadow: true, edge: C_SHADOW.clone().multiplyScalar(1.6), windows: 1.0, delay }),
      ring: makeRingMaterial(shared, l.ringRadius),
      shadowRing: makeRingMaterial(shared, l.ringRadius),
      shield: makeShieldMaterial(shared),
      beam: makeBeamMaterial(shared, COLORS.real),
      emblem: new THREE.MeshBasicMaterial({ color: C_REAL.clone().multiplyScalar(3), toneMapped: false }),
      key: new THREE.MeshBasicMaterial({ color: new THREE.Color("#d9fdff").multiplyScalar(3), toneMapped: false }),
    };
  }, [shared, index, l]);
  const geos = useMemo(() => ({
    ring: new THREE.PlaneGeometry((l.ringRadius + 1.6) * 2, (l.ringRadius + 1.6) * 2),
    shield: new THREE.CylinderGeometry(l.ringRadius - 0.2, l.ringRadius - 0.2, l.height + 3, 48, 1, true),
    beam: new THREE.CylinderGeometry(0.06, 0.06, 26, 10, 1, true),
    key: new THREE.OctahedronGeometry(0.2, 0),
  }), [l]);
  useEffect(() => () => {
    Object.values(mats).forEach((m) => m.dispose());
    Object.values(geos).forEach((g) => g.dispose());
  }, [mats, geos]);

  const keyRef = useRef<THREE.Mesh>(null);
  const keyAngle = useRef(index * 1.1);
  const cur = useRef({ color: C_REAL.clone(), edge: 1.5, level: 1, pulse: 0, shield: 0, beam: 0.55, keyAmber: 0 });
  const shadowRingCol = useMemo(() => new THREE.Color(), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((_, dt) => {
    const look = statusLook(status);
    const c = cur.current;
    const k = 1 - Math.exp(-dt * 2.2);
    c.color.lerp(look.color, k);
    c.edge = THREE.MathUtils.damp(c.edge, look.edge, 2.2, dt);
    c.level = THREE.MathUtils.damp(c.level, look.level, 2.2, dt);
    c.pulse = THREE.MathUtils.damp(c.pulse, look.pulse, 3, dt);
    c.shield = THREE.MathUtils.damp(c.shield, look.shield, 1.5, dt);
    c.beam = THREE.MathUtils.damp(c.beam, look.beam, 2, dt);
    const t = fx.time;
    const pulse = 1 + c.pulse * 0.55 * Math.sin(t * 5);

    const u = mats.real.uniforms;
    (u.uEdge.value as THREE.Color).copy(c.color).multiplyScalar(c.edge * pulse);
    u.uLevel.value = c.level;
    u.uWindows.value = c.level;
    (mats.ring.uniforms.uColor.value as THREE.Color).copy(c.color).multiplyScalar(1.2);
    mats.ring.uniforms.uLevel.value = c.level;
    mats.ring.uniforms.uPulse.value = c.pulse;
    mats.ring.uniforms.uSpin.value = status === "quarantined" || status === "down" ? 0 : 1;
    mats.shield.uniforms.uLevel.value = c.shield;
    (mats.beam.uniforms.uColor.value as THREE.Color).copy(c.color).multiplyScalar(1.4);
    mats.beam.uniforms.uLevel.value = c.beam;
    mats.emblem.color.copy(c.color).multiplyScalar(2.6 * c.level * pulse);

    // shadow twin glows when a session here was diverted
    const dAt = fx.divertedAt[l.id];
    const boost = dAt !== undefined ? 1.6 + Math.max(0, 2.5 - (t - dAt) * 0.8) : 1;
    const su = mats.shadow.uniforms;
    tmp.copy(C_SHADOW).lerp(C_HOT, Math.min(1, fx.flare * 1.2 + (dAt !== undefined ? 0.25 : 0)));
    (su.uEdge.value as THREE.Color).copy(tmp).multiplyScalar(1.5);
    su.uLevel.value = boost;
    shadowRingCol.copy(tmp);
    (mats.shadowRing.uniforms.uColor.value as THREE.Color).copy(shadowRingCol).multiplyScalar(0.9 * fx.shadow * boost);

    // key-share fragment
    const kc = keyState === "captured";
    c.keyAmber = THREE.MathUtils.damp(c.keyAmber, kc ? 1 : 0, 3, dt);
    if (!kc) keyAngle.current += dt * (0.6 + index * 0.05);
    const kr = l.isLab ? 3.3 : 1.9;
    const ky = l.isLab ? 2.2 : l.height * 0.58;
    if (keyRef.current) {
      const a = keyAngle.current;
      keyRef.current.position.set(Math.cos(a) * kr, ky + Math.sin(t * 1.3 + index) * (kc ? 0.04 : 0.15), Math.sin(a) * kr);
      keyRef.current.rotation.y += dt * (kc ? 0.2 : 1.6);
      keyRef.current.rotation.x = 0.4;
      const kcol = mats.key.color;
      kcol.set("#d9fdff").lerp(C_ALERT, c.keyAmber).multiplyScalar(kc ? 3.2 + Math.sin(t * 4) * 0.8 : 3);
      keyRef.current.getWorldPosition(fx.keyPos[l.id] ??= new THREE.Vector3());
    }
  });

  return (
    <group>
      <group position={l.pos}>
        {/* real tower */}
        {parts.map((p, i) => (
          <mesh key={i} geometry={unitBox} material={mats.real} position={[p.x, p.y, p.z]} scale={[p.w, p.h, p.d]} />
        ))}
        {/* shadow twin (mirrored in the vertex shader) */}
        {parts.map((p, i) => (
          <mesh key={`s${i}`} geometry={unitBox} material={mats.shadow} position={[p.x, p.y, p.z]} scale={[p.w, p.h, p.d]}
            renderOrder={-2} frustumCulled={false} />
        ))}
        {/* rooftop emblem: a plus for hospitals, a split ring for the lab */}
        {l.isLab ? (
          <mesh position={[-0.9, 2.33, -0.2]} rotation={[-Math.PI / 2, 0, 0]} material={mats.emblem}>
            <ringGeometry args={[0.45, 0.6, 32]} />
          </mesh>
        ) : (
          <group position={[0, l.height + Math.max(0.5, l.height * 0.13) + 0.02, 0]}>
            <mesh material={mats.emblem}><boxGeometry args={[0.7, 0.04, 0.2]} /></mesh>
            <mesh material={mats.emblem}><boxGeometry args={[0.2, 0.04, 0.7]} /></mesh>
          </group>
        )}
        {/* status ring on the water + its reflection */}
        <mesh geometry={geos.ring} material={mats.ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} />
        <mesh geometry={geos.ring} material={mats.shadowRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} renderOrder={-1} />
        {/* quarantine shield */}
        <mesh geometry={geos.shield} material={mats.shield} position={[0, (l.height + 3) / 2, 0]} />
        {/* beacon */}
        {!l.isLab && (
          <mesh geometry={geos.beam} material={mats.beam} position={[0, l.height + 1.6 + 13, 0]} />
        )}
        {/* key share */}
        <mesh ref={keyRef} geometry={geos.key} material={mats.key} />
      </group>
    </group>
  );
}

export function Hospitals({ shared }: { shared: Shared }) {
  return (
    <>
      {HOSPITALS.map((l, i) => <Hospital key={l.id} l={l} index={i} shared={shared} />)}
    </>
  );
}
