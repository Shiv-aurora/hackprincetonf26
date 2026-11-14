"use client";
// Short-lived animations for live events only (requests, reroutes). Driven by the Web Animations API
// so nothing re-renders per frame. Persistent state (statuses, diversion, keys) lives in index.tsx.
import { useEffect, useRef } from "react";
import { pointAt, trim, type Pt } from "./geometry";

export type Pulse =
  | { kind: "dot"; id: string; from: Pt; to: Pt; tone: "real" | "shadow" | "faint"; denied: boolean; rFrom: number }
  | { kind: "route"; id: string; d: string };

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const TRAVEL_MS = 600;

const DOT_FILL = { real: "var(--fg)", shadow: "var(--shadow)", faint: "var(--fg-subtle)" } as const;

export function Dot({ p, u, r, reduced, onDone }: {
  p: Extract<Pulse, { kind: "dot" }>; u: number; r: number; reduced: boolean; onDone: (id: string) => void;
}) {
  const dot = useRef<SVGCircleElement>(null);
  const tick = useRef<SVGGElement>(null);
  const [a, b] = trim(p.from, p.to, p.rFrom, r + 2 * u);
  const end = p.denied ? pointAt(a, b, 0.62) : b;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

  useEffect(() => {
    const el = dot.current, tk = tick.current;
    if (!el) return;
    const anims: Animation[] = [];
    const at = (q: Pt) => `translate(${q.x}px, ${q.y}px)`;
    const peak = p.tone === "faint" ? 0.55 : 1;
    const travel = reduced
      ? el.animate([{ transform: at(end), opacity: 0 }, { transform: at(end), opacity: peak }],
          { duration: 200, fill: "forwards" })
      : el.animate(
          [{ transform: at(a), opacity: 0 }, { opacity: peak, offset: 0.12 }, { transform: at(end), opacity: peak }],
          { duration: TRAVEL_MS, easing: EASE_OUT, fill: "forwards" });
    anims.push(travel);
    travel.onfinish = () => {
      const fade = el.animate([{ opacity: peak }, { opacity: 0 }], { duration: 220, fill: "forwards" });
      anims.push(fade);
      if (p.denied && tk) {
        const t = tk.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
          { duration: 1200, fill: "forwards" });
        anims.push(t);
        t.onfinish = () => onDone(p.id);
      } else {
        fade.onfinish = () => onDone(p.id);
      }
    };
    return () => anims.forEach((x) => x.cancel());
    // geometry is fixed for the life of a pulse
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <g>
      <circle ref={dot} cx={0} cy={0} r={(p.tone === "faint" ? 2 : 2.75) * u} style={{ fill: DOT_FILL[p.tone], opacity: 0 }} />
      {p.denied && (
        <g ref={tick} style={{ opacity: 0 }} transform={`translate(${end.x} ${end.y}) rotate(${ang})`}>
          <line x1={3 * u} y1={-5 * u} x2={3 * u} y2={5 * u} strokeWidth={1.5 * u} strokeLinecap="round"
            style={{ stroke: "var(--alert)" }} />
        </g>
      )}
    </g>
  );
}

export function Route({ p, u, reduced, onDone }: {
  p: Extract<Pulse, { kind: "route" }>; u: number; reduced: boolean; onDone: (id: string) => void;
}) {
  const ref = useRef<SVGPathElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0 }]
      : [{ opacity: 0, strokeDashoffset: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0.9, offset: 0.7 },
         { opacity: 0, strokeDashoffset: -24 }];
    const anim = el.animate(frames, { duration: 1600, easing: "ease-out", fill: "forwards" });
    anim.onfinish = () => onDone(p.id);
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <path ref={ref} d={p.d} fill="none" strokeWidth={1.5 * u} strokeDasharray={`${4 * u} ${4 * u}`}
      strokeLinecap="round" style={{ stroke: "var(--fg)", opacity: 0 }} />
  );
}
