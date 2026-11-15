"use client";
// War Room — the main demo screen, fed live from the hub. The layout lives in components/demo/Dashboard
// so the guided tour (/demo) renders exactly the same panels over a recorded run. The incident brief sits
// below it: quiet until a run ends, then the hub's facts and response steps.

import { useEffect } from "react";
import { connectHub } from "@/lib/events";
import { Dashboard } from "@/components/demo/Dashboard";
import { LiveBrief } from "@/components/hospital/Brief";

export default function WarRoom() {
  useEffect(() => { connectHub(); }, []);
  return (
    // The Dashboard fills the viewport on its own; drop that here so the brief follows the panels directly.
    <div className="min-h-dvh bg-background [&>div:first-child]:min-h-0">
      <Dashboard mode="live" />
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6">
        <LiveBrief />
      </div>
    </div>
  );
}
