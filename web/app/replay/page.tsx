import type { Metadata } from "next";
import { Suspense } from "react";
import { ReplayPage } from "@/components/pages/replay";
import { SiteHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Replay · MayaJaal",
  description: "Scrub through any recorded attack run, event by event.",
};

export default function Page() {
  return (
    <Suspense fallback={<SiteHeader active="/replay" />}>
      <ReplayPage />
    </Suspense>
  );
}
