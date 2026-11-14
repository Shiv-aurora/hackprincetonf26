import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Hero } from "@/components/brand/Hero";
import { Story } from "@/components/brand/Story";
import { Soundscape } from "@/lib/sound";

export const metadata: Metadata = {
  title: "MayaJaal — The breach is real. The data isn't.",
  description:
    "MayaJaal assumes the breach. Attackers are moved into a shadow hospital built from a session key, never from patient data, while care keeps running.",
  icons: { icon: "/brand/mayajaal-icon.svg", apple: "/brand/apple-touch-icon.png" },
  openGraph: {
    title: "MayaJaal",
    description: "The breach is real. The data isn't.",
    images: ["/brand/og.png"],
  },
};

// ── HERO BACKGROUND SLOT ────────────────────────────────────────────────────────────────────────────
// Drop the 3D city here (a full-bleed client component). While null, the woven-net canvas is shown.
// Pass `keepNet` to <Hero> to layer the net over the city instead of replacing it.
const HERO_BACKGROUND: ReactNode = null;

export default function Home() {
  return (
    <main className="min-h-screen w-full overflow-x-clip bg-[#05070c] font-sans text-white selection:bg-[#2de2d0]/30">
      <Soundscape />
      <Hero background={HERO_BACKGROUND} />
      <Story />
    </main>
  );
}
