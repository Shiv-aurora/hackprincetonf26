import type { Metadata } from "next";
import { ButtonLink, FloatingNav } from "@/components/ui";
import { InvestigatorView, type Investigation } from "@/components/langchain/Investigator";
import recorded from "../../public/runs/investigation-mayajaal.json";

export const metadata: Metadata = {
  title: "The Investigator — MayaJaal",
  description: "A LangChain Deep Agent that plans an incident investigation, delegates to sub-agents and writes a case file.",
};

export default function LangChainPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-fg">
      <FloatingNav cta={<ButtonLink href="/demo" variant="primary" size="sm" className="rounded-full">Watch the demo</ButtonLink>} />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pb-24 sm:px-6">
        <InvestigatorView recorded={recorded as unknown as Investigation} />
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-[1100px] px-4 py-8 text-[13px] leading-relaxed text-fg-muted sm:px-6">
          Recorded on the running system against a scripted attacker, with claude-opus-5-5 through LangChain Deep
          Agents. The hospital and patients are synthetic. Code: backend/mayajaal/investigator.py.
        </p>
      </footer>
    </div>
  );
}
