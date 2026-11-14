"use client";
// The only file in the consoles that touches @/lib/sound. If the soundscape is ever removed, replace the
// bodies here with no-ops and nothing else changes.

import { useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { SOUND_TOGGLE_ATTR, Soundscape, hydrateSound, soundEngine, toggleSound, useSound } from "@/lib/sound";
import { cn } from "@/components/ui";

/** Maps hub events to sound. Mount once per page. */
export function WarRoomSound() {
  return <Soundscape />;
}

/** Fire the reveal cue by hand (manual Reveal button). Never throws. */
export function playRevealCue() {
  try { soundEngine.reveal(); } catch { /* sound is optional */ }
}

export function SoundButton({ className }: { className?: string }) {
  const { enabled, starting } = useSound();
  useEffect(() => hydrateSound(), []);
  const label = enabled ? "Mute sound" : "Turn sound on";
  return (
    <button
      type="button"
      {...{ [SOUND_TOGGLE_ATTR]: "" }}
      onClick={toggleSound}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
        starting && "opacity-50",
        className,
      )}
    >
      {enabled ? <Volume2 className="size-4" strokeWidth={1.75} /> : <VolumeX className="size-4" strokeWidth={1.75} />}
    </button>
  );
}
