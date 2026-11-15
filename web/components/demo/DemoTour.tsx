"use client";
// /demo — a guided tour of the real War Room dashboard over a recorded run. Each step folds the run up to
// its anchor event (so back/forward is deterministic), spotlights one or two panels, and captions them.
// URL: /demo?step=N (1-based). Keys: → / Space / PageDown next, ← / PageUp back, Home, End, A autoplay.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { disconnectHub, useMJ } from "@/lib/events";
import { Dashboard } from "./Dashboard";
import { Spotlight } from "./Spotlight";
import { Caption, Controls } from "./Pills";
import { CloseCard, CompareCard, TitleCard, WhyCard } from "./Cards";
import { STEPS, resolveAnchors, text } from "./steps";
import { runLabel, useDemoData } from "./data";

const N = STEPS.length;
const SECONDS = STEPS.map((s) => s.seconds);

const clamp = (i: number) => Math.min(N - 1, Math.max(0, i));

function parseStep(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(N, Math.max(1, n)) - 1 : 0;
}

export function DemoTour() {
  const params = useSearchParams();
  // Local state is the source of truth (rapid key presses stay in order); the URL mirrors it.
  const [step, setStep] = useState(() => parseStep(params.get("step")));
  const forceScripted = params.get("run") === "scripted";
  const data = useDemoData(forceScripted);
  const [autoplay, setAutoplay] = useState(() => params.get("autoplay") === "1");

  const go = useCallback((i: number) => setStep(clamp(i)), []);
  const goBy = useCallback((d: number) => setStep((s) => clamp(s + d)), []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("step") === String(step + 1)) return;
    q.set("step", String(step + 1));
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }, [step]);

  // The tour owns the store while mounted: no live hub events mixed in.
  useEffect(() => {
    disconnectHub();
    useMJ.getState().reset();
    return () => { useMJ.getState().reset(); };
  }, []);

  const anchors = useMemo(() => ({
    attack: data.attack ? resolveAnchors(data.attack.events, "attack") : [],
    continuity: data.continuity ? resolveAnchors(data.continuity.events, "continuity") : [],
  }), [data.attack, data.continuity]);

  const cur = STEPS[step];
  const run = cur.source === "continuity" ? (data.continuity ?? data.attack) : data.attack;
  const srcKey = cur.source === "continuity" && data.continuity ? "continuity" : "attack";

  // Fold the run up to this step's anchor. `ready` once the store holds exactly that prefix.
  const idx = run ? anchors[srcKey][step] ?? run.events.length - 1 : -1;
  const anchorEvent = run ? run.events[idx] : undefined;
  useEffect(() => {
    if (run && idx >= 0) useMJ.getState().load(run.events.slice(0, idx + 1));
  }, [run, idx]);
  const lastLoaded = useMJ((s) => s.events[s.events.length - 1]);
  const ready = data.status === "ready" && !!anchorEvent && lastLoaded === anchorEvent;

  // Autoplay: advance after this step's duration; it simply stops on the last step.
  const playing = autoplay && step < N - 1;
  useEffect(() => {
    if (!playing || data.status !== "ready") return;
    const t = setTimeout(() => goBy(1), cur.seconds * 1000);
    return () => clearTimeout(t);
  }, [playing, data.status, step, cur.seconds, goBy]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const onControl = !!t?.closest("button, a, input, textarea, select");
      switch (e.key) {
        case "ArrowRight": case "PageDown": e.preventDefault(); goBy(1); break;
        case "ArrowLeft": case "PageUp": e.preventDefault(); goBy(-1); break;
        case " ": if (onControl) return; e.preventDefault(); goBy(e.shiftKey ? -1 : 1); break;
        case "Home": e.preventDefault(); go(0); break;
        case "End": e.preventDefault(); go(N - 1); break;
        case "a": case "A": if (!e.repeat) setAutoplay(!playing); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goBy, playing]);

  const view = useMJ((s) => s.view);
  const headline = text(cur.headline, view);
  const sub = text(cur.sub, view);
  const label = runLabel(run, srcKey);

  const kicker = data.status === "error" ? "No recorded run found"
    : data.status === "loading" ? "Loading run…"
    : `Step ${step + 1} · ${cur.label}`;

  return (
    <>
      <Dashboard mode="demo" revealOpen={!!cur.reveal && ready} />

      <Spotlight targets={ready ? cur.focus : []} dim={cur.card ? 0.9 : 0.65} />

      {cur.card === "title" && <TitleCard title={headline} sub={sub} />}
      {cur.card === "compare" && ready && <CompareCard title={headline} results={data.results} />}
      {cur.card === "close" && <CloseCard title={headline} />}
      {cur.card === "why" && <WhyCard title={headline} />}
      {cur.card !== "title" && cur.card !== "close" && cur.card !== "why" && (
        <Caption stepKey={step} kicker={kicker} headline={cur.card === "compare" ? "" : headline} sub={cur.card ? undefined : sub} />
      )}

      <Controls step={step} total={N} seconds={SECONDS} autoplay={playing} ready={data.status === "ready"}
        label={cur.card === "compare" ? (data.results ? "Recorded runs · scripted attacker" : "") : label}
        scripted={run?.kind === "scripted"}
        onGo={go} onToggleAutoplay={() => setAutoplay(!playing)} />
    </>
  );
}
