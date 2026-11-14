"use client";

import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/components/ui";
import { toggleSound, useSound } from "./store";
import { SOUND_TOGGLE_ATTR } from "./useSoundscape";

export interface SoundToggleProps {
  className?: string;
  /** Pin to the top-right corner of the viewport. */
  fixed?: boolean;
  /** Ignored; kept for API compatibility. */
  showVolume?: boolean;
}

/** Plain icon button that turns the quiet sound cues on or off. Off by default. */
export function SoundToggle({ className, fixed = false }: SoundToggleProps) {
  const enabled = useSound((s) => s.enabled);
  const starting = useSound((s) => s.starting);
  const label = enabled ? "Turn sound off" : "Turn sound on";
  const Icon = enabled ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      {...{ [SOUND_TOGGLE_ATTR]: "" }}
      onClick={toggleSound}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      disabled={starting}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50",
        enabled && "text-fg",
        fixed && "fixed top-3 right-3 z-50",
        className,
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
