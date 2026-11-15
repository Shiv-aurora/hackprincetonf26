"use client";
// The MayaJaal eye: the red Sharingan of the logo. Same artwork as `LogoMark` in components/ui
// ("Mangekyou Sharingan Itachi.svg" by ShounenSuki, CC BY-SA 3.0, via Wikimedia Commons; credited in the
// landing footer). A local copy with its own gradient id per instance, so several eyes on one page never
// share (or lose, when another copy is hidden) a gradient.

import { useId } from "react";
import { cn } from "@/components/ui";

const SWIRL =
  "M 177.6,10.7 C 135,68.4 155.4,100.7 179.8,118.5 C 260.9,160.6 274.8,214.5 255.9,244.9 C 237.3,191.9 198,172.4 158.5,194.9 C 86.9,238.6 40.7,231.2 15.7,196.6 C 58.2,203.1 109.1,193.5 107.9,128.3 C 109.5,97.6 111.5,16.6 177.6,10.7 z";

export function Sharingan({ className }: { className?: string }) {
  const id = `mj-eye-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true" focusable="false" className={cn("block shrink-0", className)}>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor="#660000" />
          <stop offset="0.5" stopColor="#c30000" />
          <stop offset="1" stopColor="#a00000" />
        </radialGradient>
      </defs>
      <circle cx="150" cy="150" r="145" fill={`url(#${id})`} stroke="#000" strokeWidth={10} />
      <path fill="#000" d={SWIRL} />
      <circle cx="150" cy="150" r="20" fill="#a00000" />
    </svg>
  );
}
