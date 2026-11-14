import type { Metadata } from "next";
import { ResultsPage } from "@/components/pages/results";

export const metadata: Metadata = {
  title: "Results · MayaJaal",
  description: "Plain API vs. static honeypot vs. MayaJaal: what the attacker believed, and what actually leaked.",
};

export default function Page() {
  return <ResultsPage />;
}
