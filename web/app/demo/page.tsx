import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoTour } from "@/components/demo/DemoTour";

export const metadata: Metadata = {
  title: "Demo · MayaJaal",
  description: "A guided tour of the War Room over a recorded attack run.",
};

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <DemoTour />
    </Suspense>
  );
}
