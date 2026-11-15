"use client";
// Full-screen host for the film during the guided demo. Mounted with one stable key across consecutive
// film steps, so the camera flies between shots instead of cutting. The caption pill (top) and the
// controls (bottom) sit above it.

import { Film, type Shot } from "./Film";

export function FilmLayer({ shot }: { shot: Shot }) {
  return (
    <div className="fixed inset-0 z-50 bg-background pt-[108px] pb-[64px]">
      <Film shot={shot} className="h-full w-full" />
    </div>
  );
}
