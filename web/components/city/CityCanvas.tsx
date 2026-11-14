"use client";
// The WebGL canvas. Loaded client-only by CityScene (never rendered during SSR).
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import type { BloomEffect } from "postprocessing";
import * as THREE from "three";
import type { MJEvent } from "@/lib/contracts";
import { useMJ, useMJEvent } from "@/lib/events";
import { CityFX, FXContext, LiveContext, useFX } from "./fx";
import { COLORS } from "./layout";
import { makeShared, type Shared } from "./materials";
import { Buildings } from "./Buildings";
import { Hospitals } from "./Hospitals";
import { Links } from "./Links";
import { Motes, Sky, Water } from "./Water";
import { Packets } from "./Packets";
import { CameraRig } from "./CameraRig";
import { LabelLayer, LabelProjector, makeLabelRegistry } from "./Labels";

export interface CityCanvasProps {
  mode: "live" | "landing";
  focusHospital?: string | null;
  hud: boolean;
}

/** Advances the FX clock and shared uniforms before anything else renders. */
function Driver({ shared }: { shared: Shared }) {
  const fx = useFX();
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    fx.update(dt);
    shared.uTime.value = fx.time;
    shared.uRise.value += dt;
    shared.uShadow.value = fx.shadow;
    shared.uFlare.value = fx.flare;
  }, -1);
  return null;
}

/** Bridges hub events and folded state into the FX controller. */
function EventBridge() {
  const fx = useFX();
  const diverted = useMJ((s) => s.view.diverted);
  const revealed = useMJ((s) => s.view.reveal !== null);
  const nodes = useMJ((s) => s.view.nodes);

  useEffect(() => {
    fx.shadowBase = revealed ? 1.15 : diverted ? 0.8 : 0.22;
  }, [fx, diverted, revealed]);
  useEffect(() => {
    fx.blocked = new Set(Object.entries(nodes).filter(([, s]) => s === "quarantined" || s === "down").map(([id]) => id));
  }, [fx, nodes]);
  useEffect(() => () => { fx.shadowBase = 0.22; fx.blocked = new Set(); fx.reset(); }, [fx]);

  const onEvent = useCallback((ev: MJEvent) => {
    if (ev.type === "run.started") { fx.reset(); return; }
    // backlog sent on (re)connect: state comes from the store fold, skip transient FX
    if (Date.now() - ev.ts > 4000) return;
    switch (ev.type) {
      case "request": fx.onRequest(ev); break;
      case "session.diverted": fx.onDiverted(ev); break;
      case "reveal": fx.onReveal(ev); break;
      case "node.status": fx.onNodeStatus(ev); break;
      case "keyshare.status": fx.onKeyshare(ev); break;
      case "lab.order": fx.onLabOrder(ev); break;
      default: break;
    }
  }, [fx]);
  useMJEvent(onEvent);
  return null;
}

function Effects() {
  const fx = useFX();
  const bloom = useRef<BloomEffect>(null);
  const ca = useMemo(() => new THREE.Vector2(0.0004, 0.0004), []);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = 1.05 + fx.bloomBoost * 1.4 + fx.flare * 0.4;
    const k = 0.0004 + fx.chroma * 0.006;
    ca.set(k, k * 0.6);
  });
  return (
    <EffectComposer multisampling={4}>
      <Bloom ref={bloom} mipmapBlur intensity={1.05} luminanceThreshold={0.16} luminanceSmoothing={0.3} radius={0.78} levels={8} />
      <ChromaticAberration offset={ca} radialModulation modulationOffset={0.2} />
      <Noise premultiply opacity={0.5} />
      <Vignette darkness={0.82} offset={0.2} />
    </EffectComposer>
  );
}

export default function CityCanvas({ mode, focusHospital, hud }: CityCanvasProps) {
  const fx = useMemo(() => new CityFX(), []);
  const shared = useMemo(() => makeShared(), []);
  const reg = useMemo(() => makeLabelRegistry(), []);
  const live = mode === "live";
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __cityFxState?: CityFX }).__cityFxState = fx;
  }, [fx]);
  return (
    <FXContext.Provider value={fx}>
      <LiveContext.Provider value={live}>
        <div style={{ position: "absolute", inset: 0 }}>
          <Canvas
            dpr={[1, 1.75]}
            gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
            camera={{ fov: 38, near: 0.1, far: 700, position: [0, 40, 80] }}
            onCreated={({ gl, scene }) => {
              gl.setClearColor(COLORS.ink, 1);
              scene.background = new THREE.Color(COLORS.ink);
            }}
          >
            <FXContext.Provider value={fx}>
              <LiveContext.Provider value={live}>
                <Driver shared={shared} />
                {live && <EventBridge />}
                <Sky shared={shared} />
                <Buildings shared={shared} />
                <Hospitals shared={shared} />
                <Links shared={shared} />
                <Water shared={shared} />
                <Motes />
                <Packets ambient={!live} />
                <CameraRig mode={mode} focusHospital={focusHospital} />
                {hud && <LabelProjector reg={reg} />}
                <Effects />
              </LiveContext.Provider>
            </FXContext.Provider>
          </Canvas>
          {hud && <LabelLayer reg={reg} />}
        </div>
      </LiveContext.Provider>
    </FXContext.Provider>
  );
}
