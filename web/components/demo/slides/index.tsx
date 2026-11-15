"use client";
// The big explainer slides that set up the problem before the dashboard tour starts.

import type { SlideId } from "../steps";
import { ThreatSlide } from "./Threat";
import { DataSlide } from "./Data";
import { DowntimeSlide } from "./Downtime";

export function Slide({ id, title }: { id: SlideId; title: string }) {
  if (id === "threat") return <ThreatSlide title={title} />;
  if (id === "data") return <DataSlide title={title} />;
  return <DowntimeSlide title={title} />;
}
