"use client";
// Maps the live MJEvent stream to sound cues (DESIGN.md §3). Mount ONCE per page (via
// `useSoundscape()` or `<Soundscape />`); mounting it twice would double every cue.

import { useCallback, useEffect, useRef } from "react";
import { useMJ, useMJEvent } from "@/lib/events";
import type { Goal, MJEvent, OrderStatus } from "@/lib/contracts";
import { soundEngine } from "./engine";
import { enableSound, hydrateSound, useSound } from "./store";

const NON_BENIGN: Goal[] = ["recon", "exfil", "tamper", "disrupt"];

export function topThreat(posterior: Record<Goal, number> | undefined | null): number {
  if (!posterior) return 0;
  return Math.max(0, ...NON_BENIGN.map((g) => posterior[g] ?? 0));
}

/** Elements with this attribute handle sound themselves; the first-click unlock ignores them. */
export const SOUND_TOGGLE_ATTR = "data-sound-toggle";

export interface SoundscapeOptions {
  /** Unlock audio on the first click / key anywhere on the page (unless the user muted). Default true. */
  armOnInteraction?: boolean;
}

export function useSoundscape({ armOnInteraction = true }: SoundscapeOptions = {}) {
  const labStatus = useRef(new Map<string, OrderStatus>());
  const lastStat = useRef<number | null>(null);

  // Load saved pref/volume, then arm "sound starts on first interaction".
  useEffect(() => {
    hydrateSound();
    if (!armOnInteraction) return;
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const onFirst = (e: Event) => {
      const target = e.target as Element | null;
      if (target?.closest?.(`[${SOUND_TOGGLE_ATTR}]`)) return; // the toggle decides on its own
      remove();
      const { pref, enabled } = useSound.getState();
      if (pref === "off" || enabled) return;
      void enableSound(false);
    };
    const remove = () => events.forEach((t) => window.removeEventListener(t, onFirst, true));
    events.forEach((t) => window.addEventListener(t, onFirst, { capture: true, passive: true }));
    return remove;
  }, [armOnInteraction]);

  // Keep the tension swell in sync with the current posterior (also after unlock / reload).
  const enabled = useSound((s) => s.enabled);
  useEffect(() => {
    if (enabled) soundEngine.intent(topThreat(useMJ.getState().view.posterior));
  }, [enabled]);

  const onEvent = useCallback((ev: MJEvent) => {
    switch (ev.type) {
      case "run.started":
        labStatus.current.clear();
        lastStat.current = null;
        soundEngine.reset();
        break;
      case "request":
        if (ev.tier === "real" || ev.tier === "shadow") {
          soundEngine.tick(ev.tier, ev.actor === "clinician" ? "clinician" : "attacker");
        }
        break;
      case "intent.update":
        soundEngine.intent(topThreat(ev.data.posterior));
        break;
      case "honeytoken.touched":
        soundEngine.glass();
        break;
      case "node.status":
        if (ev.data.status === "compromised" || ev.data.status === "down") soundEngine.alarm();
        break;
      case "reveal":
        soundEngine.reveal();
        break;
      case "lab.order": {
        const prev = labStatus.current.get(ev.data.order_id);
        labStatus.current.set(ev.data.order_id, ev.data.status);
        if (ev.data.status === "completed" && prev === "rerouted") soundEngine.chime();
        break;
      }
      case "continuity.stats": {
        const prev = lastStat.current;
        lastStat.current = ev.data.stat_on_time_pct;
        if (prev !== null && ev.data.stat_on_time_pct > prev + 0.5) soundEngine.chime();
        break;
      }
      case "run.ended":
        soundEngine.intent(0);
        break;
    }
  }, []);
  useMJEvent(onEvent);
}

/** Component form of `useSoundscape()`; renders nothing. */
export function Soundscape(props: SoundscapeOptions) {
  useSoundscape(props);
  return null;
}
