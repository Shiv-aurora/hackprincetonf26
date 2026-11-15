// The guided tour: one entry per step. Each step names the panels to spotlight (`data-demo` names in
// Dashboard), short copy, its autoplay duration, and an anchor: the event index the store is folded up to.
// Anchors match on event types and payloads, not fixed indices, so they work on any recorded run.

import type { MJEvent } from "@/lib/contracts";
import type { View } from "@/lib/events";

export type Focus = "acts" | "narrator" | "scene" | "trackers" | "learned" | "numbers" | "fingerprint" | "logs";
export type Source = "attack" | "continuity";
export type SlideId = "question" | "news" | "downtime" | "data" | "firstsight" | "paper" | "math" | "belief" | "planner";
export type FilmShot = "network" | "hospital" | "request" | "firstsight" | "transfer" | "swap" | "tracker" | "fingerprint" | "disperse";

export interface Step {
  /** One or two words, shown as "Step 3 · Divert". */
  label: string;
  /** ≤ 7 words. May read from the folded view so numbers come from the run. */
  headline: string | ((v: View) => string);
  /** ≤ 12 words, optional. */
  sub?: string | ((v: View) => string);
  /** Spotlit panels. Empty = everything dimmed. */
  focus: Focus[];
  /** Autoplay duration, seconds. */
  seconds: number;
  /** Which run the step reads: the attack run, or the lab-outage scenario (its own file). */
  source: Source;
  /** Index of the last event to fold in; null = not found (falls back to the previous step's index). */
  anchor: (events: MJEvent[]) => number | null;
  /** Full-screen content instead of the plain caption. */
  card?: "title" | "compare" | "close" | "why" | "slide" | "film" | "leak" | "investigator";
  /** Which film shot, when card = "film" (see film/Film.tsx). Consecutive film steps share one camera. */
  film?: FilmShot;
  /** Which explainer slide, when card = "slide". */
  slide?: SlideId;
  /** Names the real incident this scenario replays, shown where the scenario first appears. */
  scenario?: string;
  /** Open the Reveal sheet. */
  reveal?: boolean;
}

// ------------------------------------------------------------------ anchor helpers

type Pred = (e: MJEvent) => boolean;
const is = (type: MJEvent["type"]): Pred => (e) => e.type === type;
const attacker: Pred = (e) => e.actor === "attacker";

function find(events: MJEvent[], pred: Pred, from = 0): number | null {
  for (let i = Math.max(0, from); i < events.length; i++) if (pred(events[i])) return i;
  return null;
}

/** Last match before index `end` (exclusive). */
function lastBefore(events: MJEvent[], pred: Pred, end = events.length): number | null {
  for (let i = Math.min(end, events.length) - 1; i >= 0; i--) if (pred(events[i])) return i;
  return null;
}

/** First `b` after the first `a`. */
function after(events: MJEvent[], a: Pred, b: Pred): number | null {
  const i = find(events, a);
  return i === null ? null : find(events, b, i + 1);
}

/** Extend an index over the defender's immediate bookkeeping (intent / canary updates) for that beat. */
function settle(events: MJEvent[], i: number | null): number | null {
  if (i === null) return null;
  let j = i;
  while (j + 1 < events.length && (events[j + 1].type === "intent.update" || events[j + 1].type === "canary.check")) j++;
  return j;
}

const isRealRead: Pred = (e) =>
  e.type === "request" && e.actor === "attacker" && e.tier === "real" && e.data.surface === "fhir" && e.data.status < 400;
const isFirstSight: Pred = (e) => e.type === "policy.decision" && e.data.reason.startsWith("First Sight");
const isOutage: Pred = (e) => e.type === "node.status" && e.data.status !== "healthy";
const beforeFirstAttacker = (ev: MJEvent[]) => { const i = find(ev, attacker); return i === null ? null : Math.max(0, i - 1); };

/** Mid-outage: the first continuity.stats with at least half the run's peak reroute routes on the map
 *  (lab down, rerouting well under way, on-time numbers still recovering). */
function midOutage(events: MJEvent[]): number | null {
  const start = find(events, isOutage);
  if (start === null) return null;
  const orders: Record<string, { from: string; to: string | null; status: string }> = {};
  const samples: { i: number; routes: number }[] = [];
  for (let i = start; i < events.length; i++) {
    const e = events[i];
    if (e.type === "lab.order") orders[e.data.order_id] = { from: e.data.from_hospital, to: e.data.to_hospital, status: e.data.status };
    if (e.type === "continuity.stats") {
      const routes = new Set(Object.values(orders)
        .filter((o) => o.status === "rerouted" && o.to && o.to !== o.from).map((o) => `${o.from}>${o.to}`)).size;
      samples.push({ i, routes });
    }
  }
  if (!samples.length) return null;
  const peak = Math.max(...samples.map((s) => s.routes));
  return (samples.find((s) => s.routes >= Math.ceil(peak / 2)) ?? samples[samples.length - 1]).i;
}

// ------------------------------------------------------------------ the story

export const STEPS: Step[] = [
  {
    label: "MayaJaal", card: "title", focus: [], seconds: 6, source: "attack",
    headline: "MayaJaal",
    sub: "Protecting critical hospitals from AI cyberattacks.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "The problem", card: "slide", slide: "question", focus: [], seconds: 6, source: "attack",
    headline: "What's the biggest problem in tech right now?",
    anchor: beforeFirstAttacker,
  },
  {
    label: "In the news", card: "slide", slide: "news", focus: [], seconds: 11, source: "attack",
    headline: "Attacks on software, every few days",
    anchor: beforeFirstAttacker,
  },
  {
    label: "No off switch", card: "slide", slide: "downtime", focus: [], seconds: 12, source: "attack",
    headline: "What we can't shut down: healthcare.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Your data", card: "slide", slide: "data", focus: [], seconds: 11, source: "attack",
    headline: "A hospital's most valuable asset: your data",
    anchor: beforeFirstAttacker,
  },

  {
    label: "Hospitals", card: "film", film: "network", focus: [], seconds: 6, source: "attack",
    headline: "Six hospitals. One network.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "The vault", card: "film", film: "hospital", focus: [], seconds: 6, source: "attack",
    headline: "Each one holds a vault of patient records",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Unknown request", scenario: "Scenario 1 · Stolen login, modelled on Change Healthcare (2024)", card: "film", film: "request", focus: [], seconds: 6, source: "attack",
    headline: "An unknown request, with a nurse's password",
    anchor: beforeFirstAttacker,
  },
  {
    label: "First Sight", card: "film", film: "firstsight", focus: [], seconds: 9, source: "attack",
    headline: "First Sight catches it at login",
    sub: "A script, not the EHR app, on a device we don't own. We let it in.",
    anchor: beforeFirstAttacker,
  },
  {
    // Same anchor as the film around it: anchors are monotonic, so a later one here would drag the film steps along.
    label: "How it works", card: "slide", slide: "firstsight", focus: [], seconds: 10, source: "attack",
    headline: "How First Sight works",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Copying", card: "film", film: "transfer", focus: [], seconds: 8, source: "attack",
    headline: "It starts copying patient files",
    anchor: beforeFirstAttacker,
  },
  {
    label: "The switch", card: "film", film: "swap", focus: [], seconds: 9, source: "attack",
    headline: "It's copying from a decoy",
    sub: "Built for this attacker. The real records never left.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Trackers", card: "film", film: "tracker", focus: [], seconds: 9, source: "attack",
    headline: "Every fake file carries trackers",
    sub: "Values that exist only in this attacker's copy.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Who is this?", card: "film", film: "fingerprint", focus: [], seconds: 9, source: "attack",
    headline: "The trackers tell us who it is",
    sub: "We don't block it. Blocked, it tries another door.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Scatter", card: "film", film: "disperse", focus: [], seconds: 9, source: "attack",
    headline: "Meanwhile, the real data spreads out",
    sub: "An encrypted copy across six hospitals. Any 3 rebuild the key.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Real system", focus: ["scene", "logs"], seconds: 8, source: "attack",
    headline: "Now the real system, same attack",
    sub: "A recorded run. Every line on the right happened.",
    anchor: (ev) => settle(ev, find(ev, isFirstSight) ?? after(ev, isRealRead, is("agent.tool_result")) ?? find(ev, is("agent.tool_result"))),
  },


  {
    label: "Decoy", focus: ["scene"], seconds: 8, source: "attack",
    headline: "It reaches for admin. We don't block it.",
    sub: "It's moved into a decoy. Every request works. None of it is real.",
    anchor: (ev) => settle(ev, after(ev, is("session.diverted"), is("agent.tool_result"))),
  },






  {
    label: "No leaks", card: "leak", focus: [], seconds: 10, source: "attack",
    headline: "Nothing real leaks",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Investigator", card: "investigator", focus: [], seconds: 10, source: "attack",
    headline: "Our LangChain agent writes the case file",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Outage", scenario: "Scenario 2 · Shared lab goes down, modelled on Synnovis, London (2024)", focus: ["scene", "logs"], seconds: 8, source: "continuity",
    headline: "The shared lab goes down",
    sub: "Like Synnovis, 2024. Urgent tests reroute to labs that still work.",
    anchor: (ev) => midOutage(ev),
  },
  {
    label: "Care", focus: ["numbers"], seconds: 6, source: "continuity",
    headline: "Care continues",
    sub: (v) => v.continuity ? `${Math.round(v.continuity.stat_on_time_pct)}% of urgent tests still on time.` : "",
    anchor: (ev) => lastBefore(ev, is("continuity.stats")),
  },

  // The research behind it: the MIRAGE draft paper, its equations, the recorded run's belief and the simulation.
  {
    label: "Research", card: "slide", slide: "paper", focus: [], seconds: 10, source: "attack",
    headline: "Backed by research: MIRAGE",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "The math", card: "slide", slide: "math", focus: [], seconds: 11, source: "attack",
    headline: "How MIRAGE decides",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Belief", card: "slide", slide: "belief", focus: [], seconds: 10, source: "attack",
    headline: "Belief, request by request",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Simulation", card: "slide", slide: "planner", focus: [], seconds: 10, source: "attack",
    headline: "Against a cautious attacker",
    anchor: (ev) => ev.length - 1,
  },

  {
    label: "Compare", card: "compare", focus: [], seconds: 10, source: "attack",
    headline: "Same attack, three defenses",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Close", card: "close", focus: [], seconds: 5, source: "attack",
    headline: "Protecting critical hospitals from AI cyberattacks.",
    anchor: (ev) => ev.length - 1,
  },
];

export const TOTAL_SECONDS = STEPS.reduce((s, x) => s + x.seconds, 0);


export function text(t: Step["headline"] | undefined, v: View): string {
  if (!t) return "";
  return typeof t === "function" ? t(v) : t;
}

/** Resolve every step's anchor for one run; missing anchors fall back to the previous step (monotonic). */
export function resolveAnchors(events: MJEvent[], source: Source): (number | null)[] {
  let prev = 0;
  return STEPS.map((s) => {
    if (s.source !== source) return null;
    const a = s.anchor(events);
    const i = a === null ? prev : Math.max(prev, Math.min(a, events.length - 1));
    prev = i;
    return i;
  });
}
