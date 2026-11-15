"use client";
// War Room — the main demo screen, fed live from the hub. The layout lives in components/demo/Dashboard
// so the guided tour (/demo) renders exactly the same panels over a recorded run. The incident brief and
// the forensic report download sit inside it, right under the headline numbers.

import { useEffect } from "react";
import { connectHub } from "@/lib/events";
import { Dashboard } from "@/components/demo/Dashboard";

export default function WarRoom() {
  useEffect(() => { connectHub(); }, []);
  return <Dashboard mode="live" />;
}
