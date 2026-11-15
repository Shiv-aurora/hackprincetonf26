import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { ButtonLink, SiteHeader } from "@/components/ui";
import results from "../public/runs/results.json";

const GITHUB = "https://github.com/Shiv-aurora/hackprincetonf26";

export const metadata: Metadata = {
  title: "MayaJaal — The breach is real. The data isn't.",
  description:
    "Attackers inside a hospital network are moved, unaware, into a fake copy of it. Real records stay put. Care keeps running.",
  openGraph: { title: "MayaJaal", description: "The breach is real. The data isn't." },
};

type Row = { config: string; real_records_taken?: number; secrets_leaked: number; believed_success: boolean;
  decoy_overlap_between_sessions?: number | null };
const rows = (results as { runs: Row[] }).runs;
const by = (c: string) => rows.find((r) => r.config === c);

const fmt = (n: number | undefined | null) => (n == null ? "—" : n.toLocaleString("en-US"));

export default function Home() {
  const base = by("baseline");
  const stat = by("static");
  const mj = by("mayajaal");
  const proof = [
    { label: "Real records taken", before: fmt(base?.real_records_taken), after: fmt(mj?.real_records_taken),
      note: "Without deception vs with MayaJaal" },
    { label: "Attacker believed it won", before: null,
      after: `${rows.filter((r) => r.believed_success).length} of ${rows.length}`,
      note: "Under every defense. Nothing tipped it off." },
    { label: "Same fake hospital twice", before: stat?.decoy_overlap_between_sessions == null ? "—"
        : `${Math.round(stat.decoy_overlap_between_sessions * 100)}%`,
      after: mj?.decoy_overlap_between_sessions == null ? "—" : `${Math.round(mj.decoy_overlap_between_sessions * 100)}%`,
      note: "Static honeypot vs MayaJaal, two separate attackers" },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background text-fg">
      <SiteHeader right={<ButtonLink href="/demo" variant="primary" size="sm">Watch the demo</ButtonLink>} />

      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col justify-center px-4 py-20 sm:px-6">
        <h1 className="text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[72px]">
          The breach is real.
          <br />
          <span className="text-fg-muted">The data isn&rsquo;t.</span>
        </h1>
        <p className="mt-6 max-w-[560px] text-lg leading-relaxed text-pretty text-fg-muted">
          When someone inside a hospital network starts acting like an attacker, MayaJaal quietly moves them
          into a fake copy of it. Real records stay put. Care keeps running.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <ButtonLink href="/demo" variant="primary" className="h-11 px-5">
            Watch the 3-minute demo <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href="/war-room" className="h-11 px-5">Open the live dashboard</ButtonLink>
        </div>

        <section className="mt-20 grid grid-cols-1 border-t border-border sm:grid-cols-3">
          {proof.map((p) => (
            <div key={p.label} className="border-b border-border py-6 sm:border-b-0 sm:pr-6 sm:[&+&]:border-l sm:[&+&]:pl-6">
              <p className="text-[13px] text-fg-muted">{p.label}</p>
              <p className="mt-2 flex items-baseline gap-2 text-3xl font-semibold tracking-[-0.03em] tabular-nums">
                {p.before != null && <>
                  <span className="text-fg-subtle line-through decoration-1">{p.before}</span>
                  <ArrowRight className="size-4 self-center text-fg-subtle" aria-hidden />
                </>}
                <span>{p.after}</span>
              </p>
              <p className="mt-2 text-xs text-fg-subtle">{p.note}</p>
            </div>
          ))}
        </section>
        <p className="mt-4 text-xs text-fg-subtle">
          Recorded from the running stack. The attacker is a fixed script sending the same requests under each defense.
        </p>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 text-[13px] text-fg-muted sm:px-6">
          <span>HackPrinceton Fall 2026</span>
          <a href={GITHUB} target="_blank" rel="noreferrer" className="hover:text-fg">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
