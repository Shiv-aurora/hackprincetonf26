"use client";
// The Jaal: glowing teal threads between hospitals, and their violet reflection.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useMJ } from "@/lib/events";
import type { NodeState } from "@/lib/contracts";
import { COLORS, LINKS, type LinkLayout } from "./layout";
import { makeLinkMaterial, type Shared } from "./materials";
import { useLive } from "./fx";

const cutState = (s: NodeState | undefined) => s === "quarantined" || s === "down";

function Link({ l, index, shared }: { l: LinkLayout; index: number; shared: Shared }) {
  const live = useLive();
  const a = useMJ((s) => (live ? s.view.nodes[l.a] : undefined));
  const b = useMJ((s) => (live ? s.view.nodes[l.b] : undefined));
  const { geo, haloGeo, real, halo, shadow } = useMemo(() => {
    const geo = new THREE.TubeGeometry(l.curve, 96, 0.035, 6, false);
    const haloGeo = new THREE.TubeGeometry(l.curve, 64, 0.16, 6, false);
    const real = makeLinkMaterial(shared, { color: new THREE.Color(COLORS.real).multiplyScalar(1.5), seed: l.seed });
    const halo = makeLinkMaterial(shared, { color: new THREE.Color(COLORS.real).multiplyScalar(0.12), seed: l.seed });
    const shadow = makeLinkMaterial(shared, { shadow: true, color: new THREE.Color(COLORS.shadow).multiplyScalar(1.4), seed: l.seed + 0.37 });
    return { geo, haloGeo, real, halo, shadow };
  }, [l, shared]);
  useEffect(() => () => { geo.dispose(); haloGeo.dispose(); real.dispose(); halo.dispose(); shadow.dispose(); }, [geo, haloGeo, real, halo, shadow]);

  useFrame((_, dt) => {
    const rise = shared.uRise.value;
    const draw = THREE.MathUtils.clamp((rise - 0.1 - index * 0.11) / 1.6, 0, 1);
    const eased = 1 - Math.pow(1 - draw, 3);
    const cut = cutState(a) || cutState(b);
    const alert = a === "compromised" || b === "compromised" || cut;
    for (const m of [real, halo, shadow]) {
      const u = m.uniforms;
      u.uDraw.value = eased;
      u.uCut.value = THREE.MathUtils.damp(u.uCut.value, cut ? 1 : 0, 1.2, dt);
      u.uAltMix.value = THREE.MathUtils.damp(u.uAltMix.value, alert ? 1 : 0, 2, dt);
      u.uLevel.value = THREE.MathUtils.damp(u.uLevel.value, cut ? 0.45 : 1, 1.5, dt);
    }
  });

  return (
    <>
      <mesh geometry={geo} material={real} />
      <mesh geometry={haloGeo} material={halo} />
      <mesh geometry={geo} material={shadow} renderOrder={-1} frustumCulled={false} />
    </>
  );
}

export function Links({ shared }: { shared: Shared }) {
  return <>{LINKS.map((l, i) => <Link key={l.key} l={l} index={i} shared={shared} />)}</>;
}
