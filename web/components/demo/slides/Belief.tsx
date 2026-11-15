"use client";
// "Belief, request by request": the intent filter's goal posterior from the recorded run (every intent.update in
// public/runs/mayajaal.jsonl), drawn per attacker request. P(benign) falls, the script's real goal rises, the lane
// thresholds are dashed, and the shaded part is where the session was already in the decoy. Lines draw in ~2 s.

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/ui";
import { EASE, SlideFrame } from "./Frame";
import { LANE } from "./research";
import { useRunEvents, type RunEvent } from "./run";

// ------------------------------------------------------------------ the recorded run

interface Req { n: number; label: string; shadow: boolean }
interface Point { n: number; p: Record<string, number>; top: string }
interface BeliefRun {
  runId: string;
  mission: string | null;
  requests: Req[];
  points: Point[];
  /** First attacker request served by the decoy (shadow tier). */
  divertedAt: number | null;
}

/** Short names for the attacker's requests, from the path. */
function label(path: string): string {
  const [p, q = ""] = path.split("?");
  if (p.startsWith("/auth/login")) return "login";
  if (p.startsWith("/portal/admin")) return "admin";
  if (p.startsWith("/portal/backups/download")) return "dump";
  if (p.startsWith("/portal/backups")) return "backups";
  if (p.startsWith("/portal/docs/view")) return "file";
  if (p.startsWith("/portal/docs")) return "docs";
  if (p.startsWith("/fhir/DocumentReference")) return "note";
  if (p.startsWith("/fhir/Patient")) return Number(new URLSearchParams(q).get("_count") ?? 0) >= 100 ? "export" : "ward list";
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** Attacker requests numbered from 1 (the login); each intent.update belongs to the request just before it. */
function parse(events: RunEvent[]): BeliefRun | null {
  const run: BeliefRun = { runId: "", mission: null, requests: [], points: [], divertedAt: null };
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === "run.started") { run.runId = e.run_id ?? ""; run.mission = typeof d.mission === "string" ? d.mission : null; }
    if (e.type === "request" && e.actor === "attacker") {
      const n = run.requests.length + 1;
      const shadow = e.tier === "shadow";
      run.requests.push({ n, label: label(String(d.path ?? "")), shadow });
      if (shadow && run.divertedAt === null) run.divertedAt = n;
    }
    if (e.type === "intent.update" && d.posterior && typeof d.posterior === "object") {
      run.points.push({ n: run.requests.length, p: d.posterior as Record<string, number>, top: String(d.top_goal ?? "") });
    }
  }
  return run.points.length && run.requests.length ? run : null;
}

// ------------------------------------------------------------------ chart geometry (design-canvas px)

const W = 1168;
const H = 404;
const M = { l: 168, r: 132, t: 44, b: 74 };
const PH = H - M.t - M.b;
const y = (p: number) => M.t + (1 - p) * PH;

const T = { lines: 0.55, draw: 1.9 };

type Series = { goal: string; stroke: string; width: number };

export function BeliefSlide({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const events = useRunEvents();
  const run = useMemo(() => (events ? parse(events) : events), [events]);
  const tr = (delay: number, duration = 0.45) => (reduce ? { duration: 0 } : { duration, delay, ease: EASE });

  const n = run?.requests.length ?? 14;
  const step = (W - M.l - M.r) / Math.max(1, n - 1);
  const x = (i: number) => M.l + (i - 1) * step;

  const mission = run?.mission ?? null;
  const final = run?.points[run.points.length - 1];
  const goal = mission && final && mission in final.p ? mission : final?.top ?? "exfil";
  const series: Series[] = [
    { goal: "benign", stroke: "stroke-ok", width: 3.5 },
    { goal, stroke: "stroke-alert", width: 3.5 },
    ...(goal !== "recon" ? [{ goal: "recon", stroke: "stroke-fg-subtle", width: 2 }] : []),
  ];

  // The lines are revealed by a clip that sweeps left to right at constant speed; a point pops in when the
  // sweep passes it, so every series is plotted request by request together.
  const clipId = `belief-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const first = run?.points[0]?.n ?? 1;
  const last = final?.n ?? n;
  const sweep = { from: x(first) - 8, to: x(last) + 12 };
  const reach = (i: number) => T.lines + (T.draw * (x(i) - sweep.from)) / (sweep.to - sweep.from);

  // "On top from request k": first point after which the final goal stays the top attack goal.
  let topFrom: number | null = null;
  if (run) for (let k = run.points.length - 1; k >= 0 && run.points[k].top === goal; k--) topFrom = run.points[k].n;
  const div = run?.divertedAt ?? null;

  const note = run && topFrom !== null && div !== null
    ? <>The script&apos;s real goal was {goal}. The filter had it on top from request {topFrom}, <span className="text-fg">{topFrom > div ? `${topFrom - div} ${topFrom - div === 1 ? "request" : "requests"} after the session was already in the decoy.` : "before the session reached the decoy."}</span></>
    : run === null ? "Recorded run not found." : " ";

  return (
    <SlideFrame kicker="Recorded run · the MIRAGE intent filter on the live gateway" title={title} note={note}
      source={<span className="text-[16px]">{run ? `Recorded run ${run.runId} · all ${run.points.length} intent.update events · scripted attacker · 3 of the 5 goals shown` : "Recorded run · /runs/mayajaal.jsonl"}</span>}>
      <div className="relative">
        <span className="absolute top-0 right-0 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[16px] text-fg-muted">
          <span className="size-2 rounded-full bg-fg" /> Recorded run
        </span>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block overflow-visible" role="img"
          aria-label="Goal belief per attacker request in the recorded run">
          {/* the decoy: everything from the first diverted request on */}
          {div !== null && (
            <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(reach(div) - 0.15, 0.35)}>
              <rect x={x(div) - step / 2} y={M.t} width={W - M.r - (x(div) - step / 2)} height={PH} className="fill-shadow-bg" opacity={0.7} />
              <line x1={x(div) - step / 2} x2={x(div) - step / 2} y1={M.t - 30} y2={M.t + PH} strokeWidth={2} className="stroke-shadow" />
              <text x={x(div) - step / 2 + 12} y={M.t - 12} className="fill-shadow text-[18px] font-medium">
                Moved into the decoy at request {div}
              </text>
            </motion.g>
          )}

          {/* axes: 0, the two lane thresholds, 0.5, 1 */}
          {[0, 0.5, 1].map((p) => (
            <g key={p}>
              <line x1={M.l} x2={W - M.r} y1={y(p)} y2={y(p)} strokeWidth={1} className="stroke-border" />
              <text x={M.l - 14} y={y(p) + 6} textAnchor="end" className="fill-fg-subtle text-[17px] tabular-nums">{p === 0 ? "0" : p.toFixed(1)}</text>
            </g>
          ))}
          {([[LANE.suspicious, "suspicious"], [LANE.attacker, "attacker"]] as const).map(([p, name]) => (
            <g key={name}>
              <line x1={M.l} x2={W - M.r} y1={y(p)} y2={y(p)} strokeWidth={1.5} strokeDasharray="6 6" className="stroke-alert" />
              <text x={M.l - 14} y={y(p) + 6} textAnchor="end" className="fill-alert text-[17px] tabular-nums">
                {p.toFixed(2)} {name}
              </text>
            </g>
          ))}
          <text x={M.l - 14} y={M.t - 18} textAnchor="end" className="fill-fg-muted text-[17px]">P(goal)</text>

          {/* x axis: request number and what it was */}
          {run?.requests.map((r) => (
            <g key={r.n}>
              <line x1={x(r.n)} x2={x(r.n)} y1={M.t + PH} y2={M.t + PH + 6} strokeWidth={1} className="stroke-border-strong" />
              <text x={x(r.n)} y={M.t + PH + 27} textAnchor="middle" className="fill-fg-subtle text-[16px] tabular-nums">{r.n}</text>
              <text x={x(r.n)} y={M.t + PH + 50} textAnchor="middle"
                className={cn("text-[16px]", r.n === div ? "fill-shadow" : "fill-fg-muted")}>{r.label}</text>
            </g>
          ))}
          <text x={M.l - 24} y={M.t + PH + 27} textAnchor="end" className="fill-fg-muted text-[17px]">Request</text>

          {/* the belief lines */}
          <clipPath id={clipId}>
            <motion.rect x={0} y={0} height={H} initial={{ width: sweep.from }} animate={{ width: sweep.to }}
              transition={reduce ? { duration: 0 } : { duration: T.draw, delay: T.lines, ease: "linear" }} />
          </clipPath>
          {run && series.map((s) => {
            const pts = run.points.map((pt) => [x(pt.n), y(pt.p[s.goal] ?? 0)] as const);
            const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
            return (
              <g key={s.goal}>
                <path d={d} fill="none" strokeWidth={s.width} strokeLinejoin="round" strokeLinecap="round" className={s.stroke}
                  clipPath={`url(#${clipId})`} />
                {run.points.map((pt, i) => (
                  <motion.circle key={i} cx={pts[i][0]} cy={pts[i][1]} r={s.width > 3 ? 5.5 : 4} strokeWidth={s.width > 3 ? 3 : 2}
                    className={cn("fill-background", s.stroke)}
                    initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={tr(reach(pt.n), 0.25)} />
                ))}
              </g>
            );
          })}

          {/* direct labels */}
          {run && final && (() => {
            const p0 = run.points[0];
            const peak = run.points.reduce((a, b) => ((b.p.recon ?? 0) > (a.p.recon ?? 0) ? b : a), p0);
            return (
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tr(T.lines + T.draw + 0.05, 0.4)}>
                <text x={x(p0.n) - 16} y={y(p0.p.benign ?? 0) + 7} textAnchor="end" className="fill-ok text-[19px] font-semibold">benign</text>
                <text x={x(final.n) + 16} y={y(final.p[goal] ?? 0) + 7} className="fill-alert text-[19px] font-semibold tabular-nums">
                  {goal} {(final.p[goal] ?? 0).toFixed(2)}
                </text>
                <text x={x(final.n) + 16} y={y(final.p.benign ?? 0) + 7} className="fill-ok text-[17px] tabular-nums">
                  {(final.p.benign ?? 0).toFixed(2)}
                </text>
                {goal !== "recon" && (
                  <text x={x(peak.n) + 12} y={y(peak.p.recon ?? 0) - 12} className="fill-fg-subtle text-[17px]">recon</text>
                )}
              </motion.g>
            );
          })()}
        </svg>
      </div>
    </SlideFrame>
  );
}
