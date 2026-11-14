"use client";
// Instanced packet particles (heads + trails) and impact flashes. One draw call.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TONE, useFX } from "./fx";

const CAP = 2400;

export function Packets({ ambient = false }: { ambient?: boolean }) {
  const fx = useFX();
  const { geo, mat, mesh } = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, CAP);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return { geo, mat, mesh };
  }, []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); mesh.dispose(); }, [geo, mat, mesh]);

  const scratch = useMemo(() => ({
    m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(),
    c: new THREE.Color(),
  }), []);
  const nextAmbient = useRef(0);

  useFrame(() => {
    if (!mesh.instanceColor) return;
    if (ambient && fx.time > nextAmbient.current) {
      fx.ambient();
      nextAmbient.current = fx.time + 0.25 + Math.random() * 0.45;
    }
    const { m, p, q, s, c } = scratch;
    let n = 0;
    const put = (pos: THREE.Vector3, size: number, color: THREE.Color, k: number) => {
      if (n >= CAP) return;
      s.setScalar(size);
      m.compose(pos, q, s);
      mesh.setMatrixAt(n, m);
      c.copy(color).multiplyScalar(k);
      mesh.setColorAt(n, c);
      n++;
    };

    for (const pk of fx.packets) {
      const tone = TONE[pk.tone];
      const fadeK = pk.fade >= 0 ? Math.max(0, pk.fade / 0.45) : 1;
      const head = Math.min(pk.t, pk.stopAt);
      // head (hidden once arrived; the trail drains into the target)
      if (pk.fade < 0) {
        pk.curve.getPointAt(head, p);
        put(p, pk.size, p.y < 0 ? tone.below : tone.above, 1.6);
        put(p, pk.size * 2.6, p.y < 0 ? tone.below : tone.above, 0.12); // soft halo
      }
      for (let k = 1; k <= pk.trail; k++) {
        const f = k / pk.trail;
        const tk = head - f * pk.trailSpan * (pk.fade >= 0 ? fadeK : 1);
        if (tk < 0) break;
        pk.curve.getPointAt(tk, p);
        const fall = Math.pow(1 - f, 1.6);
        put(p, pk.size * (0.25 + 0.75 * fall), p.y < 0 ? tone.below : tone.above, fall * 0.9 * fadeK);
      }
    }
    for (const f of fx.flashes) {
      const a = f.age / f.dur;
      const k = Math.pow(1 - a, 2);
      put(f.pos, f.size * (0.4 + a * 1.4), f.color, k * 0.9);
      put(f.pos, f.size * 0.35, f.color, k * 2);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
