"use client";
// UI state for sound (on/off, master volume), persisted in localStorage. The audio graph itself lives
// in engine.ts; this store only mirrors what the UI needs to render.

import { create } from "zustand";
import { soundEngine } from "./engine";

const PREF_KEY = "mayajaal.sound";   // "on" | "off"
const VOL_KEY = "mayajaal.volume";   // "0".."1"

export type SoundPref = "on" | "off" | null;

interface SoundState {
  /** Audio is unlocked and audible. */
  enabled: boolean;
  /** Unlock in progress (first click). */
  starting: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** What the user last chose. null = never chose (sound arms on first interaction). */
  pref: SoundPref;
  hydrated: boolean;
}

export const useSound = create<SoundState>(() => ({
  enabled: false,
  starting: false,
  volume: 0.8,
  pref: null,
  hydrated: false,
}));

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

/** Load saved preferences once on the client. */
export function hydrateSound() {
  if (useSound.getState().hydrated || typeof window === "undefined") return;
  const p = read(PREF_KEY);
  const v = Number.parseFloat(read(VOL_KEY) ?? "");
  const volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  soundEngine.setVolume(volume);
  useSound.setState({ hydrated: true, pref: p === "on" || p === "off" ? p : null, volume });
}

/** Turn sound on. Call from a user gesture. Never throws. */
export function enableSound(remember = true): Promise<boolean> {
  if (remember) {
    write(PREF_KEY, "on");
    useSound.setState({ pref: "on" });
  }
  useSound.setState({ starting: true });
  return soundEngine
    .unlock()
    .then((ok) => {
      if (ok && useSound.getState().pref !== "off") soundEngine.setEnabled(true);
      useSound.setState({ enabled: ok && useSound.getState().pref !== "off", starting: false });
      return ok;
    })
    .catch(() => {
      useSound.setState({ enabled: false, starting: false });
      return false;
    });
}

/** Mute (remembered). */
export function disableSound() {
  write(PREF_KEY, "off");
  soundEngine.setEnabled(false);
  useSound.setState({ enabled: false, pref: "off" });
}

export function toggleSound() {
  if (useSound.getState().enabled) disableSound();
  else void enableSound();
}

/** Global master volume 0..1 (remembered). */
export function setMasterVolume(v: number) {
  const volume = Math.min(1, Math.max(0, v));
  soundEngine.setVolume(volume);
  write(VOL_KEY, String(volume));
  useSound.setState({ volume });
}
