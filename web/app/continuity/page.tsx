import type { Metadata } from "next";
import { ContinuityPage } from "@/components/pages/continuity";

export const metadata: Metadata = {
  title: "Continuity · MayaJaal",
  description: "A simulated shared-lab outage: how lab orders reroute, and what can't be saved.",
};

export default function Page() {
  return <ContinuityPage />;
}
