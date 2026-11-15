"use client";
// The big explainer slides that set up the problem before the dashboard tour starts.

import type { SlideId } from "../steps";
import { QuestionSlide } from "./Question";
import { NewsSlide } from "./News";
import { DataSlide } from "./Data";
import { DowntimeSlide } from "./Downtime";

export function Slide({ id, title }: { id: SlideId; title: string }) {
  if (id === "question") return <QuestionSlide title={title} />;
  if (id === "news") return <NewsSlide title={title} />;
  if (id === "data") return <DataSlide title={title} />;
  return <DowntimeSlide title={title} />;
}
