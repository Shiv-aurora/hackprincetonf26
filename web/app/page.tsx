import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { ButtonLink, FloatingNav, cn } from "@/components/ui";
import { CareVisual, FingerprintVisual, MoveVisual, ScatterVisual, SpotVisual } from "@/components/landing/Visuals";
import { WhyNotBlock } from "@/components/landing/Why";
import { HeroScene } from "@/components/landing/HeroScene";
import { Research } from "@/components/landing/Research";
import results from "../public/runs/results.json";
import outage from "../public/runs/continuity-compare.json";

const GITHUB = "https://github.com/Shiv-aurora/hackprincetonf26";

export const metadata: Metadata = {
  title: "MayaJaal — Protecting critical hospitals from AI cyberattacks",
  description:
    "When an attacker gets in, MayaJaal quietly moves them into a fake copy of the hospital. Real records stay safe and care keeps running.",
  openGraph: { title: "MayaJaal", description: "Protecting critical hospitals from AI cyberattacks." },
};

type Row = { config: string; real_records_taken?: number; decoy_overlap_between_sessions?: number | null };
const rows = (results as { runs: Row[] }).runs;
const by = (c: string) => rows.find((r) => r.config === c);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US"));

// The five things the hero picture shows, numbered the same way. Three cards on the first row, two on the second.
const STEPS: { title: string; body: string; visual: ReactNode; span: string }[] = [
  {
    title: "Caught at login", span: "lg:col-span-2", visual: <SpotVisual />,
    body: "Every request passes one gateway. First Sight notices a stolen password driven by a script on a device the hospital doesn’t own, or a ward login that starts opening admin pages and backups.",
  },
  {
    title: "Moved, not blocked", span: "lg:col-span-2", visual: <MoveVisual />,
    body: "The session is moved, silently, into a decoy hospital built fresh for that attacker. Real charts ask for a badge and MFA.",
  },
  {
    title: "Fingerprinted", span: "lg:col-span-2", visual: <FingerprintVisual />,
    body: "Lures in the decoy show the tool, the timing and the goal. A forensic report is ready to download.",
  },
  {
    title: "Records scattered", span: "lg:col-span-3", visual: <ScatterVisual />,
    body: "An encrypted copy of the records is split across six sites. No site holds a whole copy.",
  },
  {
    title: "Care keeps running", span: "md:col-span-2 lg:col-span-3", visual: <CareVisual />,
    body: "Clinical reads are never faked. If a shared lab goes down, urgent tests are rerouted to labs that still work.",
  },
];

export default function Home() {
  const base = by("baseline"), stat = by("static"), mj = by("mayajaal");
  const p = outage.policies;
  const stats = [
    { value: <>{num(base?.real_records_taken)} <Arrow /> {num(mj?.real_records_taken)}</>,
      label: "real patient records taken by the same attack, without and with MayaJaal" },
    { value: <>{pct(stat?.decoy_overlap_between_sessions)} <Arrow /> {pct(mj?.decoy_overlap_between_sessions)}</>,
      label: "of the fake hospital repeated between two attackers, static honeypot vs MayaJaal" },
    { value: <>{p.no_reroute.stat_on_time} <Arrow /> {p.vitalswitch.stat_on_time}</>,
      label: `of ${p.vitalswitch.stat_total} urgent lab tests on time while the shared lab is down` },
  ];

  return (
    <div id="top" className="flex min-h-dvh flex-col overflow-x-clip bg-background text-fg">
      <FloatingNav cta={<ButtonLink href="/demo" variant="primary" size="sm" className="rounded-full">Watch the demo</ButtonLink>} />

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 sm:px-6">
        <section className="grid grid-cols-1 items-center gap-10 pt-32 pb-12 sm:pt-40 lg:grid-cols-2 lg:gap-4 lg:pt-28 xl:grid-cols-[560px_minmax(0,1fr)]">
          <div className="relative z-10">
            <a href="#research"
              className="mb-6 inline-flex h-8 items-center gap-2 rounded-full border border-border bg-background pr-3 pl-3.5 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2">
              Backed by research <span className="text-fg-subtle">Read the draft paper</span>
              <ArrowRight className="size-3.5 text-fg-subtle" aria-hidden />
            </a>
            <h1 className="text-[44px] leading-[1.03] font-semibold tracking-[-0.045em] text-balance sm:text-[60px] lg:text-[50px] xl:text-[62px]">
              Protecting critical hospitals from AI cyberattacks.
            </h1>
            <p className="mt-3 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-danger sm:text-[34px] lg:text-[30px] xl:text-[34px]">
              Without stopping the attacks.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/demo" variant="primary" className="h-11 px-5">
                Watch the 3-minute demo <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="#how" className="h-11 px-5">How it works</ButtonLink>
            </div>
          </div>
          <HeroScene className="pointer-events-none lg:-mr-10 lg:w-[calc(100%+2.5rem)] xl:-mr-28 xl:w-[calc(100%+7rem)]" />
        </section>

        <section id="how" className="scroll-mt-24 border-t border-border pt-14 pb-16">
          <h2 className="text-[36px] font-semibold tracking-[-0.035em] sm:text-[40px]">How it works</h2>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
            {STEPS.map((s, i) => (
              <article key={s.title} className={cn("flex flex-col rounded-xl border border-border bg-background p-2", s.span)}>
                <div className="h-[180px] rounded-lg border border-border bg-surface">{s.visual}</div>
                <div className="px-3 pt-5 pb-4">
                  <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.02em]">
                    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-fg text-[12px] text-background tabular-nums">{i + 1}</span>
                    {s.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{s.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-10 border-t border-border py-12 sm:grid-cols-3 sm:gap-8">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="flex items-center gap-2 text-[34px] font-semibold tracking-[-0.03em] tabular-nums">{s.value}</p>
              <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-fg-muted">{s.label}</p>
            </div>
          ))}
        </section>

        <section id="why" className="scroll-mt-24 py-20">
          <h2 className="text-[36px] font-semibold tracking-[-0.035em] sm:text-[40px]">Why we don&rsquo;t stop the attack</h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-fg-muted">
            Stopping an attacker doesn&rsquo;t make them leave. It makes them look for another way in.
          </p>
          <WhyNotBlock className="mt-10" />
        </section>

        <section id="research" className="scroll-mt-24 pb-20">
          <h2 className="text-[36px] font-semibold tracking-[-0.035em] sm:text-[40px]">Backed by research</h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-fg-muted">
            Two algorithms of our own, both built during HackPrinceton Fall 2026.
          </p>
          <Research className="mt-10" />
        </section>

        <section className="mb-24 flex flex-col items-start justify-between gap-6 rounded-xl border border-border px-6 py-10 sm:flex-row sm:items-center sm:px-10">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.03em]">See an attack, start to finish.</h2>
            <p className="mt-2 text-[15px] text-fg-muted">Three minutes, on top of the real dashboard.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/demo" variant="primary" className="h-11 px-5">
              Watch the demo <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/war-room" className="h-11 px-5">Open the live dashboard</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 text-[13px] text-fg-muted sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="max-w-[640px]">
            <p className="font-semibold text-fg">MayaJaal</p>
            <p className="mt-2 leading-relaxed">
              A HackPrinceton Fall 2026 prototype. The hospitals, patients and staff are synthetic. Attack numbers come
              from runs recorded on the running system with a scripted attacker; lab numbers come from a simulated
              outage. None of it is a clinical or real-world claim.
            </p>
            <p className="mt-2 text-[12px]">
              Logo eye:{" "}
              <a href="https://commons.wikimedia.org/wiki/File:Mangekyou_Sharingan_Itachi.svg" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">ShounenSuki</a>,{" "}
              <a href="https://creativecommons.org/licenses/by-sa/3.0" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">CC BY-SA 3.0</a>, via Wikimedia Commons.
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

function Arrow() {
  return <ArrowRight className="size-5 shrink-0 text-fg-subtle" aria-hidden />;
}
