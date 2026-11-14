"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { VolumeX } from "lucide-react";
import { hydrateSound, setMasterVolume, toggleSound, useSound } from "./store";
import { SOUND_TOGGLE_ATTR } from "./useSoundscape";

export interface SoundToggleProps {
  className?: string;
  /** Pin to the top-right corner of the viewport. */
  fixed?: boolean;
  /** Show the master-volume slider on hover / focus. Default true. */
  showVolume?: boolean;
}

/** Mute / unmute button with a hover master-volume slider. Remembers the choice. */
export function SoundToggle({ className = "", fixed = false, showVolume = true }: SoundToggleProps) {
  const { enabled, starting, volume, pref } = useSound();
  useEffect(() => hydrateSound(), []);

  const label = enabled ? "Mute sound" : "Turn sound on";
  const hint = !enabled && pref !== "off";

  return (
    <div
      {...{ [SOUND_TOGGLE_ATTR]: "" }}
      className={`group flex items-center gap-2 ${fixed ? "fixed top-4 right-4 z-50" : ""} ${className}`}
    >
      {showVolume && (
        <label
          className="pointer-events-none flex h-9 w-0 items-center overflow-hidden rounded-full border border-white/0 bg-black/40 opacity-0 backdrop-blur-md transition-all duration-500 ease-out group-focus-within:pointer-events-auto group-focus-within:w-28 group-focus-within:border-white/10 group-focus-within:px-3 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:w-28 group-hover:border-white/10 group-hover:px-3 group-hover:opacity-100"
        >
          <span className="sr-only">Master volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            className="h-1 w-full cursor-pointer accent-[#2de2d0]"
          />
        </label>
      )}
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={enabled}
        aria-label={label}
        title={label}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-white/70 backdrop-blur-md transition-colors duration-300 hover:border-white/25 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2de2d0]"
      >
        {hint && (
          <span className="absolute inset-0 animate-ping rounded-full border border-[#2de2d0]/40 [animation-duration:2.6s]" />
        )}
        {enabled ? <Bars /> : <VolumeX size={16} strokeWidth={1.6} className={starting ? "opacity-40" : ""} />}
      </button>
    </div>
  );
}

function Bars() {
  const hs = [0.55, 1, 0.7, 0.85];
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {hs.map((h, i) => (
        <motion.span
          key={i}
          className="w-[2px] origin-bottom rounded-full bg-[#2de2d0]"
          style={{ height: 16 }}
          initial={{ scaleY: 0.2 }}
          animate={{ scaleY: [0.25, h, 0.35, h * 0.8, 0.25] }}
          transition={{ duration: 1.6 + i * 0.37, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }}
        />
      ))}
    </span>
  );
}
