"use client";
// Procedural low-poly filler city (instanced), plus its mirrored shadow twin under the water.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { COLORS, HOSPITALS, LINKS } from "./layout";
import { makeBuildingMaterial, type Shared } from "./materials";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Box { x: number; z: number; w: number; d: number; h: number; delay: number }

function generate(): Box[] {
  const r = rng(7);
  const boxes: Box[] = [];
  const BLOCK = 3.2;
  const span = 34;
  // sample points along the net threads so streets of buildings hug the Jaal
  const linkPts: THREE.Vector2[] = [];
  for (const l of LINKS) for (let i = 1; i < 12; i++) {
    const p = l.curve.getPoint(i / 12);
    linkPts.push(new THREE.Vector2(p.x, p.z));
  }
  for (let gx = -span; gx < span; gx += BLOCK) {
    for (let gz = -span; gz < span; gz += BLOCK) {
      const cx = gx + BLOCK / 2, cz = gz + BLOCK / 2;
      const dist = Math.hypot(cx, cz * 1.1);
      const edgeNoise = (r() - 0.5) * 8;
      if (dist > 29 + edgeNoise) continue;
      // keep plazas around hospitals clear
      let near = Infinity, nearH = 0;
      for (const h of HOSPITALS) {
        const dd = Math.hypot(cx - h.pos.x, cz - h.pos.z);
        if (dd < near) { near = dd; nearH = h.height; }
      }
      let nearLink = Infinity;
      for (const p of linkPts) nearLink = Math.min(nearLink, Math.hypot(cx - p.x, cz - p.y));
      const downtown = Math.exp(-near * near / 70) * (nearH / 10);
      const density = 0.3 + downtown * 0.4 + (nearLink < 4 ? 0.12 : 0);
      const n = 1 + Math.floor(r() * 3.2);
      for (let i = 0; i < n; i++) {
        if (r() > density) continue;
        const w = 0.6 + r() * 1.1, d = 0.6 + r() * 1.1;
        const x = gx + 0.45 + w / 2 + r() * (BLOCK - 0.9 - w);
        const z = gz + 0.45 + d / 2 + r() * (BLOCK - 0.9 - d);
        let clear = true;
        for (const h of HOSPITALS) {
          if (Math.hypot(x - h.pos.x, z - h.pos.z) < h.ringRadius + 1.4) { clear = false; break; }
        }
        if (!clear) continue;
        const base = 0.3 + r() * r() * 1.7;
        const h = base + downtown * (1 + r() * 3.4) + (r() < 0.04 ? 1.5 + r() * 2.5 : 0);
        const delay = 0.6 + Math.hypot(x, z) * 0.035 + r() * 0.5;
        boxes.push({ x, z, w, d, h: Math.min(h, 6), delay });
      }
    }
  }
  return boxes;
}

export function Buildings({ shared }: { shared: Shared }) {
  const boxes = useMemo(generate, []);
  const { geo, real, shadow } = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const delays = new Float32Array(boxes.map((b) => b.delay));
    geo.setAttribute("aDelay", new THREE.InstancedBufferAttribute(delays, 1));
    const real = makeBuildingMaterial(shared, { edge: new THREE.Color(COLORS.real).multiplyScalar(0.24), windows: 0.55, intensity: 1 });
    const shadow = makeBuildingMaterial(shared, {
      shadow: true, edge: new THREE.Color(COLORS.shadow).multiplyScalar(0.8), windows: 0.5, intensity: 1,
    });
    return { geo, real, shadow };
  }, [boxes, shared]);

  const matrices = useMemo(() => {
    const m = new THREE.Matrix4();
    const out: THREE.Matrix4[] = [];
    for (const b of boxes) out.push(m.clone().compose(
      new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d),
    ));
    return out;
  }, [boxes]);

  useEffect(() => () => { geo.dispose(); real.dispose(); shadow.dispose(); }, [geo, real, shadow]);

  const setup = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  return (
    <>
      <instancedMesh ref={setup} args={[geo, real, boxes.length]} frustumCulled={false} />
      <instancedMesh ref={setup} args={[geo, shadow, boxes.length]} frustumCulled={false} renderOrder={-2} />
    </>
  );
}
