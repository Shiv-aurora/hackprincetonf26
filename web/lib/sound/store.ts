"use client";
// UI state for sound. OFF by default on every load; only the toggle turns it on.

import { create } from "zustand";
import { soundEngine } from "./engine";

interface SoundState {
  /** Audio is unlocked and audible. */
  enabled: boolean;
  /** Unlock in progress. */
  starting: boolean;
  /** Master volume 0..1. */
  volume: number;
}

export const useSound = create<SoundState>(() => ({ enabled: false, starting: false, volume: 0.8 }));

/** Kept for API compatibility; there is nothing to load. */
export function hydrateSound() {}

/** Turn sound on. Call from a user gesture. Never throws. */
export async function enableSound(): Promise<boolean> {
  useSound.setState({ starting: true });
  let ok = false;
  try {
    ok = await soundEngine.unlock();
  } catch {
    ok = false;
  }
  soundEngine.setEnabled(ok);
  useSound.setState({ enabled: ok, starting: false });
  return ok;
}

export function disableSound() {
  soundEngine.setEnabled(false);
  useSound.setState({ enabled: false });
}

export function toggleSound() {
  if (useSound.getState().enabled) disableSound();
  else void enableSound();
}

export function setMasterVolume(v: number) {
  const volume = Math.min(1, Math.max(0, v));
  soundEngine.setVolume(volume);
  useSound.setState({ volume });
}
