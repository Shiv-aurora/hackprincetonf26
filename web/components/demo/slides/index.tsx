"use client";
// The big explainer slides: the problem before the tour, the real incident behind scenario 2, the research behind
// it all, related work, and the Arena to close.

import type { SlideId } from "../steps";
import { QuestionSlide } from "./Question";
import { NewsSlide } from "./News";
import { DataSlide } from "./Data";
import { DowntimeSlide } from "./Downtime";
import { FirstSightSlide } from "./FirstSight";
import { PaperSlide } from "./Paper";
import { EquationsSlide } from "./Equations";
import { BeliefSlide } from "./Belief";
import { PlannerSlide } from "./Planner";
import { SynnovisSlide } from "./Synnovis";
import { RelatedSlide } from "./Related";
import { ArenaSlide } from "./Arena";

export function Slide({ id, title }: { id: SlideId; title: string }) {
  if (id === "question") return <QuestionSlide title={title} />;
  if (id === "news") return <NewsSlide title={title} />;
  if (id === "data") return <DataSlide title={title} />;
  if (id === "firstsight") return <FirstSightSlide title={title} />;
  if (id === "paper") return <PaperSlide title={title} />;
  if (id === "math") return <EquationsSlide title={title} />;
  if (id === "belief") return <BeliefSlide title={title} />;
  if (id === "planner") return <PlannerSlide title={title} />;
  if (id === "synnovis") return <SynnovisSlide title={title} />;
  if (id === "related") return <RelatedSlide title={title} />;
  if (id === "arena") return <ArenaSlide title={title} />;
  return <DowntimeSlide title={title} />;
}
