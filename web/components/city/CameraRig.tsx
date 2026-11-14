"use client";
// Cinematic camera: slow drift, smooth fly-to on cues, slow orbit for the landing page.
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { HOSPITAL, outwardAngle } from "./layout";
import { useFX } from "./fx";

interface Pose { target: THREE.Vector3; r: number; el: number; az: number }

export function CameraRig({ mode, focusHospital }: { mode: "live" | "landing"; focusHospital?: string | null }) {
  const fx = useFX();
  const camera = useThree((s) => s.camera);
  const cur = useRef<Pose>({ target: new THREE.Vector3(0, 6, 0), r: 92, el: 0.95, az: -0.5 });
  const want = useRef<Pose>({ target: new THREE.Vector3(), r: 50, el: 0.5, az: 0 });
  const orbitAz = useRef(0);
  const tmp = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = fx.time;
    const w = want.current;
    if (mode === "landing") orbitAz.current += dt * 0.035;

    const driftAz = mode === "landing" ? orbitAz.current : 0.55 + Math.sin(t * 0.045) * 0.22;
    // default pose
    if (mode === "landing") {
      w.target.set(0, 1.5, 0); w.r = 52 + Math.sin(t * 0.05) * 3; w.el = 0.34 + Math.sin(t * 0.04) * 0.04; w.az = driftAz;
    } else {
      w.target.set(0, 1.5, -1.5); w.r = 54 + Math.sin(t * 0.05) * 2.5; w.el = 0.4 + Math.sin(t * 0.031) * 0.05; w.az = driftAz;
    }

    let cue = fx.cue;
    if (cue && t > cue.until) { fx.cue = null; cue = null; }
    const focusId = focusHospital && HOSPITAL[focusHospital] ? focusHospital : cue?.kind === "focus" ? cue.id : null;
    if (focusId) {
      const l = HOSPITAL[focusId];
      const low = !focusHospital && cue?.kind === "focus" && cue.low;
      const central = l.pos.length() < 6;
      // park the camera outside the city looking in past the hospital (clear foreground)
      let az = (central ? driftAz : outwardAngle(focusId) + 0.4) + Math.sin(t * 0.08) * 0.06;
      az += Math.round((cur.current.az - az) / (Math.PI * 2)) * Math.PI * 2;
      w.target.set(l.pos.x, low ? 1.2 : l.height * 0.45, l.pos.z);
      w.r = central ? 30 : low ? 26 : 28;
      w.el = central ? 0.4 : low ? 0.22 : 0.33;
      w.az = az;
    } else if (cue?.kind === "wide") {
      w.target.set(0, -1, -1); w.r = 64; w.el = 0.42; w.az = driftAz * 0.5;
    }

    const c = cur.current;
    const lam = 1.1;
    c.target.x = THREE.MathUtils.damp(c.target.x, w.target.x, lam, dt);
    c.target.y = THREE.MathUtils.damp(c.target.y, w.target.y, lam, dt);
    c.target.z = THREE.MathUtils.damp(c.target.z, w.target.z, lam, dt);
    c.r = THREE.MathUtils.damp(c.r, w.r, lam * 0.8, dt);
    c.el = THREE.MathUtils.damp(c.el, w.el, lam, dt);
    c.az = THREE.MathUtils.damp(c.az, w.az, lam * 0.7, dt);

    const ce = Math.cos(c.el);
    const p = tmp.current.set(Math.sin(c.az) * ce * c.r, Math.sin(c.el) * c.r, Math.cos(c.az) * ce * c.r).add(c.target);
    if (fx.shake > 0) {
      const k = fx.shake * fx.shake * 0.5;
      p.x += (Math.random() - 0.5) * k; p.y += (Math.random() - 0.5) * k; p.z += (Math.random() - 0.5) * k;
    }
    camera.position.copy(p);
    camera.lookAt(c.target);
  });
  return null;
}
