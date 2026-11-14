import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, FlaskConical, Ghost, ShieldAlert } from "lucide-react";
import { ButtonLink, Logo, SiteHeader } from "@/components/ui";
import { FlowDiagram, LiveStrip } from "@/components/brand";
import { Soundscape, SoundToggle } from "@/lib/sound";

const GITHUB = "https://github.com/Shiv-aurora/hackprincetonf26";

export const metadata: Metadata = {
  title: "MayaJaal — The breach is real. The data isn't.",
  description:
    "MayaJaal assumes hospitals will be breached. Attackers are moved, unaware, into a shadow hospital built from nothing real, while care keeps running.",
  icons: { icon: "/brand/mayajaal-icon.svg", apple: "/brand/apple-touch-icon.png" },
  openGraph: {
    title: "MayaJaal",
    description: "The breach is real. The data isn't.",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "MayaJaal — The breach is real. The data isn't." }],
  },
  twitter: { card: "summary_large_image", images: ["/brand/og.png"] },
};

export default function Home() {
  return (
    <>
      <Soundscape />
      <SiteHeader
        right={
          <>
            <a href={GITHUB} target="_blank" rel="noreferrer"
              className="hidden rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:text-fg sm:inline-flex">
              GitHub
            </a>
            <SoundToggle />
            <ButtonLink href="/war-room" variant="primary" size="sm">Watch an attack</ButtonLink>
          </>
        }
      />

      <main className="flex-1">
        <div className="mx-auto max-w-[1080px] sm:border-x sm:border-border">
          {/* Hero */}
          <section className="px-4 pt-16 pb-14 text-center sm:px-10 sm:pt-28 sm:pb-20">
            <p className="mx-auto mb-6 inline-flex h-7 items-center rounded-full border border-border px-3 text-[13px] text-fg-muted">
              Cyber-deception for hospitals
            </p>
            <h1 className="mx-auto max-w-[880px] text-[42px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-fg sm:text-[64px] md:text-[76px]">
              The breach is real.
              <br />
              The data isn&rsquo;t.
            </h1>
            <p className="mx-auto mt-6 max-w-[620px] text-[17px] leading-[1.6] text-pretty text-fg-muted sm:text-lg">
              MayaJaal assumes hospitals will be breached. Attackers who drift into attacker behaviour are moved,
              unaware, into a shadow hospital built from nothing real — while care keeps running.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <ButtonLink href="/war-room" variant="primary" className="h-11 px-5">
                Watch an attack <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/arena" variant="secondary" className="h-11 px-5">
                Try to break it
              </ButtonLink>
            </div>
          </section>

          {/* Live strip */}
          <section className="px-4 pb-16 sm:px-10 sm:pb-24">
            <LiveStrip className="mx-auto max-w-[840px]" />
          </section>

          {/* How it works */}
          <section className="border-t border-border px-4 py-14 sm:px-10 sm:py-20">
            <div>
              <p className="text-[13px] font-medium text-fg-muted">How it works</p>
              <h2 className="mt-2 max-w-[560px] text-[28px] leading-[1.15] font-semibold tracking-[-0.035em] text-balance sm:text-[32px]">
                One front door. Two hospitals behind it.
              </h2>
              <p className="mt-3 max-w-[560px] text-[15px] leading-[1.6] text-fg-muted">
                Every session meets the same gateway. Normal use reaches the real hospital. When behaviour turns
                hostile, the session is quietly moved somewhere that only looks the same.
              </p>
              <div className="mt-10 rounded-lg border border-border bg-surface px-4 py-6 sm:px-8 sm:py-10">
                <FlowDiagram className="mx-auto max-w-[800px]" />
              </div>
            </div>
          </section>

          {/* Feature grid */}
          <section className="grid border-t border-border md:grid-cols-3">
            <Feature icon={<ShieldAlert className="size-4" aria-hidden />} title="Assume breach">
              In June 2024 a ransomware attack on Synnovis disrupted pathology for London hospitals for weeks.
              MayaJaal starts from the day after someone gets in.
            </Feature>
            <Feature icon={<Ghost className="size-4" aria-hidden />} title="A hospital that isn’t there">
              Each diverted session gets its own shadow world, seeded from a session key and public templates.
              Protected records sit behind independent controls it never touches.
            </Feature>
            <Feature icon={<FlaskConical className="size-4" aria-hidden />} title="Care keeps running">
              When a lab is quarantined, its orders reroute to other hospitals&rsquo; labs, so urgent blood tests
              still come back.
            </Feature>
          </section>

          {/* Arena CTA */}
          <section className="border-t border-border px-4 py-16 sm:px-10 sm:py-24">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.035em] text-balance sm:text-[36px]">
                  Don&rsquo;t trust us. Bring your own agent.
                </h2>
                <p className="mt-3 max-w-[520px] text-[15px] leading-[1.6] text-fg-muted">
                  Point any attacker at the same FHIR API and IT portal, then read the forensic replay of what it
                  actually reached.
                </p>
              </div>
              <ButtonLink href="/arena" variant="primary" className="h-11 shrink-0 px-5">
                Open the Arena <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-3 px-4 py-8 text-[13px] text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <div className="flex items-center gap-3">
            <Logo label={false} />
            <span>HackPrinceton Fall 2026</span>
          </div>
          <a href={GITHUB} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-fg">
            GitHub <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </footer>
    </>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-10 last:border-b-0 sm:px-10 md:border-r md:border-b-0 md:last:border-r-0">
      <div className="flex size-8 items-center justify-center rounded-md border border-border text-fg">{icon}</div>
      <h3 className="mt-5 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">{children}</p>
    </div>
  );
}
