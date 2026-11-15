import type { Metadata } from "next";
import { ButtonLink, FloatingNav } from "@/components/ui";
import { InvestigatorView, type Investigation } from "@/components/langchain/Investigator";
import recorded from "../../public/runs/investigation-mayajaal.json";

const GITHUB = "https://github.com/Shiv-aurora/hackprincetonf26";

export const metadata: Metadata = {
  title: "The Investigator — MayaJaal",
  description: "A LangChain Deep Agent that plans an incident investigation, delegates to sub-agents and writes a case file.",
};

export default function LangChainPage() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-background text-fg">
      <FloatingNav cta={<ButtonLink href="/demo" variant="primary" size="sm" className="rounded-full">Watch the demo</ButtonLink>} />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6">
        <InvestigatorView recorded={recorded as unknown as Investigation} />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 text-[13px] text-fg-muted sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="max-w-[640px]">
            <p className="font-semibold text-fg">MayaJaal</p>
            <p className="mt-2 leading-relaxed">
              The recorded investigation ran on claude-opus-5-5 through LangChain Deep Agents, over an attack recorded
              on the running system with a scripted attacker. The hospitals and patients are synthetic. Code:
              backend/mayajaal/investigator.py.
            </p>
          </div>
          <div className="flex gap-5">
            <a href="/mirage.pdf" className="hover:text-fg">Paper</a>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="hover:text-fg">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
