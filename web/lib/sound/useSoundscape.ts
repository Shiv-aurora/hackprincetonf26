"use client";
// Maps the live MJEvent stream to the three quiet cues. Mount ONCE per page (via `useSoundscape()` or
// `<Soundscape />`); mounting it twice would double every cue. Silent until the user turns sound on.

import { useCallback } from "react";
import { useMJEvent } from "@/lib/events";
import type { Goal, MJEvent } from "@/lib/contracts";
import { soundEngine } from "./engine";

const NON_BENIGN: Goal[] = ["recon", "exfil", "tamper", "disrupt"];

/** Highest non-benign goal probability (kept for callers that used it). */
export function topThreat(posterior: Record<Goal, number> | undefined | null): number {
  if (!posterior) return 0;
  return Math.max(0, ...NON_BENIGN.map((g) => posterior[g] ?? 0));
}

/** Marker attribute on the toggle (kept for compatibility). */
export const SOUND_TOGGLE_ATTR = "data-sound-toggle";

/** Options kept for API compatibility. Sound never arms itself; only the toggle turns it on. */
export interface SoundscapeOptions {
  armOnInteraction?: boolean;
}

export function useSoundscape(_opts: SoundscapeOptions = {}) {
  void _opts;
  const onEvent = useCallback((ev: MJEvent) => {
    try {
      switch (ev.type) {
        case "run.started": soundEngine.reset(); break;
        case "request": if (ev.tier === "shadow") soundEngine.tick("shadow"); break;
        case "session.diverted": soundEngine.diverted(); break;
        case "reveal": soundEngine.reveal(); break;
      }
    } catch {}
  }, []);
  useMJEvent(onEvent);
}

/** Component form of `useSoundscape()`; renders nothing. */
export function Soundscape(props: SoundscapeOptions) {
  useSoundscape(props);
  return null;
}
