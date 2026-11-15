"use client";
// "Your turn": the tour's last step, the call to action for the Arena (/arena, components/arena/ArenaView.tsx).
// Missions and defences come from WORLD (lib/world.json); the copy follows the Arena page: pick a mission and a
// defence, attack by hand or with your own AI agent over HTTP, get scored. Choreography ends by ~2 s.

import { useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { WORLD } from "@/lib/contracts";
import { ButtonLink, cn } from "@/components/ui";
import { Sharingan } from "../film/Sharingan";
import { EASE, SlideFrame } from "./Frame";

const PATH = "/arena";
const TAGLINE = "Protecting critical hospitals from AI cyberattacks.";

// The page's host, shown above the path when this runs somewhere people can reach (not on localhost).
const noSubscribe = () => () => {};
function usePublicHost(): string {
  const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "" : host;
}

const T = { tiles: 0.35, tileStep: 0.1, how: 0.95, url: 1.2, mark: 1.4 };

export function ArenaSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const tr = (delay: number, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });
  const host = usePublicHost();
  const defences = WORLD.configs;

  return (
    <SlideFrame kicker="The Challenge · Attack a synthetic hospital. Climb the board." title={title}
      source={<span className="text-[16px]">Synthetic hospitals and patients · missions and defences from lib/world.json · the board ranks secrets leaked, then missions won, then speed</span>}>
      {/* the missions */}
      <div className="grid grid-cols-4 gap-4">
        {WORLD.missions.map((m, i) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.tiles + i * T.tileStep)}
            className="flex flex-col rounded-xl border border-border bg-background p-5">
            <span className="text-[16px] text-fg-subtle tabular-nums">0{i + 1}</span>
            <span className="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.025em] text-fg">{m.title}</span>
            {/* three lines tall in every tile, so the win lines start level */}
            <span className="mt-1.5 min-h-[75px] text-[18px] leading-snug text-fg-muted">{m.goal}</span>
            <span className="mt-3 border-t border-border pt-3 text-[16px] leading-snug text-fg-subtle">
              <span className="text-fg-muted">You win when:</span> {m.win}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="mt-7 grid grid-cols-[1.25fr_0.95fr_0.8fr] items-center gap-10">
        {/* how it works */}
        <motion.ol initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.how)}
          className="flex flex-col gap-2.5 text-[19px] leading-snug text-fg">
          <li className="grid grid-cols-[26px_1fr]">
            <span className="text-fg-subtle tabular-nums">1</span>
            <span>Pick a mission and a defence:{" "}
              {defences.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && (i === defences.length - 1 ? " or " : ", ")}
                  <span className={cn(d.id === "mayajaal" && "text-shadow")}>{d.title}</span>
                </span>
              ))}.
            </span>
          </li>
          <li className="grid grid-cols-[26px_1fr]">
            <span className="text-fg-subtle tabular-nums">2</span>
            <span>Log in as the phished {WORLD.entry_point.role}. Attack by hand, or with your own AI agent over HTTP.</span>
          </li>
          <li className="grid grid-cols-[26px_1fr]">
            <span className="text-fg-subtle tabular-nums">3</span>
            <span>Get scored. Leaks are counted by the canary ledger, not by your claim.</span>
          </li>
        </motion.ol>

        {/* where */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={tr(T.url)} className="flex flex-col items-start">
          {host && <span className="font-mono text-[18px] text-fg-muted">{host}</span>}
          <span className="font-mono text-[60px] leading-none font-semibold tracking-[-0.04em] text-fg">{PATH}</span>
          <ButtonLink href={PATH} variant="primary" className="mt-5 rounded-full">Open the Arena →</ButtonLink>
        </motion.div>

        {/* the mark */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.mark, 0.5)}
          className="flex flex-col items-center text-center">
          <motion.div initial={{ rotate: -120, scale: 0.85 }} animate={{ rotate: 0, scale: 1 }} transition={tr(T.mark, 1.1)}>
            <Sharingan className="size-[64px]" />
          </motion.div>
          <span className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-fg">MayaJaal</span>
          <span className="mt-1 text-[16px] leading-snug text-balance text-fg-muted">{TAGLINE}</span>
        </motion.div>
      </div>
    </SlideFrame>
  );
}
