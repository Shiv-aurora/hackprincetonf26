"use client";
// PLACEHOLDER — Agent R1 replaces this folder with the real flat network map.
// API (frozen): <NetworkMap className? focusHospital?={id|null} variant?="full"|"compact" />
// It fills its parent, reads the shared store (useMJ / useMJEvent), never calls connectHub().
import { WORLD } from "@/lib/contracts";

export interface NetworkMapProps {
  className?: string;
  focusHospital?: string | null;
  variant?: "full" | "compact";
}

export function NetworkMap({ className }: NetworkMapProps) {
  return (
    <div className={`relative h-full w-full rounded-lg border border-border ${className ?? ""}`}>
      {WORLD.hospitals.map((h) => (
        <span key={h.id} className="absolute size-2 rounded-full bg-fg"
          style={{ left: `${h.x}%`, top: `${100 - h.y}%` }} title={h.name} />
      ))}
    </div>
  );
}
