"use client";
// The water surface between the real city and its shadow. Carries ripples and shockwaves.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useFX, MAX_RIPPLES } from "./fx";
import { makeSkyMaterial, makeWaterMaterial, type Shared } from "./materials";

export function Water({ shared }: { shared: Shared }) {
  const fx = useFX();
  const { mat, geo } = useMemo(() => ({
    mat: makeWaterMaterial(shared),
    geo: new THREE.PlaneGeometry(900, 900, 1, 1),
  }), [shared]);
  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);

  useFrame(() => {
    const A = mat.uniforms.uRipA.value as THREE.Vector4[];
    const B = mat.uniforms.uRipB.value as THREE.Vector4[];
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = fx.ripples[i];
      if (!r) { A[i].set(0, 0, -100, 0); continue; }
      A[i].set(r.x, r.z, r.t0, r.strength);
      B[i].set(r.color.r, r.color.g, r.color.b, r.speed);
    }
  });

  return <mesh geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0} />;
}

export function Sky({ shared }: { shared: Shared }) {
  const { mat, geo } = useMemo(() => ({
    mat: makeSkyMaterial(shared),
    geo: new THREE.SphereGeometry(300, 48, 24),
  }), [shared]);
  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);
  return <mesh geometry={geo} material={mat} renderOrder={-10} frustumCulled={false} />;
}

/** Slow drifting motes above and below the surface, for depth. */
export function Motes({ count = 420 }: { count?: number }) {
  const { geo, mat } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const teal = new THREE.Color("#2de2e6"), violet = new THREE.Color("#b26bff");
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 40, a = Math.random() * Math.PI * 2;
      const below = Math.random() < 0.4;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = below ? -(0.5 + Math.random() * 10) : 0.5 + Math.random() * 16;
      pos[i * 3 + 2] = Math.sin(a) * r;
      const c = (below ? violet : teal).clone().multiplyScalar(0.25 + Math.random() * 0.35);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    });
    return { geo, mat };
  }, [count]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((state, dt) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += Math.sin(t * 0.3 + i) * dt * 0.05;
      arr[i * 3] += Math.cos(t * 0.2 + i * 1.7) * dt * 0.04;
    }
    p.needsUpdate = true;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
