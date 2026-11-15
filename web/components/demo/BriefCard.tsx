"use client";
// Demo step: the incident brief MayaJaal wrote for the recorded run (web/public/runs/brief-mayajaal.json).
// Same panel as the live view; the brief is rule-based (no model) unless the file says otherwise.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BriefPanel, type Brief } from "@/components/hospital/Brief";

export function BriefCard({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/runs/brief-mayajaal.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: Brief) => { if (alive) setBrief(b); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4 pt-[72px] pb-[68px]">
      <motion.div className="pointer-events-auto w-full max-w-[1040px]"
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
        <h2 className="mb-4 text-center text-[30px] leading-tight font-semibold tracking-[-0.035em] text-fg sm:text-[36px]">{title}</h2>
        {brief
          ? <BriefPanel brief={brief} reportHref="/runs/report-mayajaal.md" />
          : <p className="text-center text-sm text-fg-muted">{failed ? "No brief recorded for this run." : "Loading brief…"}</p>}
      </motion.div>
    </div>
  );
}
