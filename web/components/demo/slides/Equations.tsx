"use client";
// "How MIRAGE decides": four equations from the draft paper (public/mirage.pdf), typeset as native MathML and
// revealed one by one, each with a one-line gloss. Simplified only by dropping the lure-outcome bracket from the
// belief update (eq. 3); nothing is added. Choreography finishes by ~4.6 s, then holds.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";
import { LANE } from "./research";
import { P, Pb, Tex } from "./tex";

const BELIEF = (
  <Tex>
    <msub><mi>b</mi><mi>t</mi></msub><P><mi>g</mi><mo>,</mo><mi>s</mi></P>
    <mo>∝</mo>
    <mover accent="true"><mi>b</mi><mo>¯</mo></mover><P><mi>g</mi><mo>,</mo><mi>s</mi></P>
    <mspace width="0.25em" />
    <mi>P</mi>
    <msup>
      <P><msub><mi>c</mi><mi>t</mi></msub><mo>∣</mo><mi>g</mi><mo>,</mo><mi>s</mi></P>
      <mrow><mi>γ</mi><mo>/</mo><msqrt><msub><mi>k</mi><mi>t</mi></msub></msqrt></mrow>
    </msup>
    <mspace width="0.2em" />
    <munder><mo largeop="false" movablelimits="true">∏</mo><mrow><mi>f</mi><mo>∈</mo><msub><mi>F</mi><mi>t</mi></msub></mrow></munder>
    <mi>P</mi>
    <msup><P><mi>f</mi><mo>∣</mo><mi>g</mi></P><mi>γ</mi></msup>
  </Tex>
);

const LANES = (
  <Tex>
    <mi>ℓ</mi><mo>←</mo><mi>max</mi><P><mi>ℓ</mi><mo>,</mo><mi>λ</mi><P><Pb /></P></P>
  </Tex>
);

const LURE = (
  <Tex>
    <msub><mi>Q</mi><mi>d</mi></msub><P><mi>κ</mi><mo>∣</mo><mi>b</mi><mo>,</mo><mi>s</mi></P>
    <mo>=</mo>
    <P><mn>1</mn><mo>−</mo><mi>q</mi></P>
    <mrow>
      <mo stretchy="false">[</mo>
      <mi>I</mi><P><mi>κ</mi><mo>;</mo><mi>b</mi></P>
      <mo>+</mo>
      <mi>γ</mi><mspace width="0.17em" />
      <msub><mi>𝔼</mi><mi>o</mi></msub><mspace width="0.1em" />
      <msub><mi>V</mi><mrow><mi>d</mi><mo>−</mo><mn>1</mn></mrow></msub>
      <P><msub><mi>b</mi><mi>o</mi></msub><mo>,</mo><msup><mi>s</mi><mo>′</mo></msup></P>
      <mo stretchy="false">]</mo>
    </mrow>
    <mo>−</mo>
    <mi>q</mi>
    <mrow><mo stretchy="false">[</mo><mi>H</mi><P><mi>b</mi></P><mo>+</mo><mi>β</mi><mo stretchy="false">]</mo></mrow>
  </Tex>
);

const SEED = (
  <Tex>
    <mi>seed</mi><P><mi>σ</mi><mo>,</mo><mi>e</mi></P>
    <mo>=</mo>
    <mi>HMAC-SHA256</mi><P><mi>K</mi><mo>,</mo><mi>σ</mi><mo lspace="0.15em" rspace="0.15em" stretchy="false">‖</mo><mi>e</mi></P>
  </Tex>
);

interface Row { n: number; name: string; ref: string; eq: ReactNode; aside?: ReactNode; gloss: string }

const ROWS: Row[] = [
  { n: 1, name: "Belief update", ref: "eq. 3", eq: BELIEF,
    gloss: "Every request updates our belief about the attacker's goal and stage." },
  { n: 2, name: "Lane rule", ref: "§III-C", eq: LANES,
    aside: (
      <span className="flex items-center gap-2.5">
        <Chip at={LANE.suspicious} lane="suspicious" />
        <Chip at={LANE.attacker} lane="attacker" />
      </span>
    ),
    gloss: "The model can only make us stricter, never grant access." },
  { n: 3, name: "Lure value", ref: "eq. 6", eq: LURE,
    gloss: "Plant a lure only if what we learn beats the chance the attacker gets suspicious and leaves." },
  { n: 4, name: "Decoy seed", ref: "§III-F", eq: SEED,
    gloss: "Each attacker gets their own decoy hospital." },
];

/** "p_b < 0.35 → suspicious": one of the lane thresholds, in the alert colour like the lanes themselves. */
function Chip({ at, lane }: { at: number; lane: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-alert/45 bg-alert-bg py-1 pr-3.5 pl-3 text-[18px] text-alert">
      <Tex className="text-[23px] text-alert"><Pb /><mo>&lt;</mo><mn>{at.toFixed(2)}</mn></Tex>
      <span>→ {lane}</span>
    </span>
  );
}

export function EquationsSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr = (delay: number, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  return (
    <SlideFrame kicker="From the paper · MIRAGE, in four lines" title={title}
      source={<span className="text-[16px]">Equations as in the draft (/mirage.pdf, §III); the belief update omits the lure-outcome term. Weights are judgement calls, not fitted.</span>}>
      <div className="flex flex-col">
        {ROWS.map((r, i) => {
          const at = 0.5 + i * 1.15;
          return (
            <motion.div key={r.n} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={tr(at)}
              className={cn("grid grid-cols-[176px_1fr] items-center gap-x-9 py-[15px]", i > 0 && "border-t border-border")}>
              <div className="flex items-baseline gap-3">
                <span className="w-5 shrink-0 text-[17px] text-fg-subtle tabular-nums">{r.n}</span>
                <div className="flex flex-col">
                  <span className="text-[21px] leading-tight font-semibold tracking-[-0.015em] text-fg">{r.name}</span>
                  <span className="mt-1 font-mono text-[16px] text-fg-subtle">{r.ref}</span>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <motion.div className="flex items-center gap-8"
                  initial={{ clipPath: "inset(-20% 100% -20% 0)" }} animate={{ clipPath: "inset(-20% 0% -20% 0)" }}
                  transition={reduce ? { duration: 0 } : { duration: 0.7, delay: at + 0.05, ease: [0.33, 1, 0.68, 1] }}>
                  {r.eq}
                  {r.aside}
                </motion.div>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(at + 0.45, 0.35)}
                  className="text-[21px] leading-snug text-fg-muted">
                  {r.gloss}
                </motion.p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </SlideFrame>
  );
}
