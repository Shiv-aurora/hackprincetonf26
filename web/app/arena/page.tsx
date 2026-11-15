import type { Metadata } from "next";
import { ButtonLink, FloatingNav } from "@/components/ui";
import { ArenaView } from "@/components/arena/ArenaView";

export const metadata: Metadata = {
  title: "Arena — MayaJaal",
  description: "Attack the synthetic hospital yourself, by hand or with your own agent, and get a scored run.",
};

export default function ArenaPage() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-background text-fg">
      <FloatingNav cta={<ButtonLink href="/war-room" variant="primary" size="sm" className="rounded-full">Open the war room</ButtonLink>} />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-28 pb-20 sm:px-6">
        <ArenaView />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-4 py-8 text-[13px] leading-relaxed text-fg-muted sm:px-6">
          Synthetic hospitals and patients. Leaks are counted by the canary ledger, not by your claim.
        </div>
      </footer>
    </div>
  );
}
