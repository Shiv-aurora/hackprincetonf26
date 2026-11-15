// The guided tour: one entry per step. Each step names the panels to spotlight (`data-demo` names in
// Dashboard), short copy, its autoplay duration, and an anchor: the event index the store is folded up to.
// Anchors match on event types and payloads, not fixed indices, so they work on any recorded run.

import type { MJEvent } from "@/lib/contracts";
import type { View } from "@/lib/events";

export type Focus = "acts" | "narrator" | "scene" | "trackers" | "learned" | "numbers" | "fingerprint";
export type Source = "attack" | "continuity";

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
  card?: "title" | "compare" | "close" | "why";
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
const isBulk: Pred = (e) =>
  e.type === "request" && e.actor === "attacker" && e.tier === "shadow" &&
  (/_count=\d{3,}/.test(e.data.path) || e.data.bytes > 500_000);
const isOutage: Pred = (e) => e.type === "node.status" && e.data.status !== "healthy";
const exfilAt = (ev: MJEvent[]) => find(ev, is("exfil")) ?? ev.length;
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
    label: "MayaJaal", card: "title", focus: [], seconds: 8, source: "attack",
    headline: "MayaJaal",
    sub: "Protecting critical hospitals from AI cyberattacks.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Normal shift", focus: ["acts", "scene"], seconds: 9, source: "attack",
    headline: "A normal shift",
    sub: "Staff at work. Sensitive records encrypted on disk.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Login", focus: ["narrator", "scene"], seconds: 11, source: "attack",
    headline: "A stolen nurse login",
    sub: "How Change Healthcare was breached in 2024.",
    anchor: (ev) => settle(ev, after(ev, isRealRead, is("agent.tool_result")) ?? find(ev, is("agent.tool_result"))),
  },
  {
    label: "No block", focus: ["narrator", "scene"], seconds: 9, source: "attack",
    headline: "Reaches for admin. We don't block it.",
    sub: "A block tells an attacker they were seen.",
    anchor: (ev) => { const i = find(ev, (e) => e.type === "session.diverted"); return i === null ? null : Math.max(0, i - 1); },
  },
  {
    label: "Detected", focus: ["acts", "scene"], seconds: 13, source: "attack",
    headline: "Moved into a decoy instead",
    sub: "Every request still works. None of it is real.",
    anchor: (ev) => settle(ev, after(ev, is("session.diverted"), is("agent.tool_result"))),
  },
  {
    label: "Why", card: "why", focus: [], seconds: 13, source: "attack",
    headline: "Why we don't stop the attack",
    anchor: (ev) => settle(ev, after(ev, is("session.diverted"), is("agent.tool_result"))),
  },
  {
    label: "Bulk pull", focus: ["scene", "numbers"], seconds: 10, source: "attack",
    headline: "Thousands of patients. All fake.",
    sub: "Generated per session. Never copied from real records.",
    anchor: (ev) => {
      const i = lastBefore(ev, isBulk, exfilAt(ev));
      return i === null ? null : settle(ev, find(ev, is("agent.tool_result"), i + 1));
    },
  },
  {
    label: "Trackers", focus: ["trackers", "scene"], seconds: 11, source: "attack",
    headline: "Decoy files with trackers",
    sub: "Planted where this attacker is looking.",
    anchor: (ev) => {
      const t = find(ev, is("honeytoken.touched"));
      return t === null ? lastBefore(ev, is("breadcrumb.planted"), exfilAt(ev)) : Math.max(0, t - 1);
    },
  },
  {
    label: "Bait taken", focus: ["trackers", "learned"], seconds: 12, source: "attack",
    headline: (v) => v.honeytokensTouched.length ? "It took the bait" : "Now we know what it wants",
    sub: (v) => `It wants to ${goalWord(v.topGoal).toLowerCase()} (${Math.round((v.posterior[v.topGoal] ?? 0) * 100)}% sure).`,
    anchor: (ev) => {
      const t = lastBefore(ev, is("honeytoken.touched"));
      if (t !== null) return settle(ev, find(ev, is("intent.update"), t) ?? t);
      return lastBefore(ev, is("intent.update"), exfilAt(ev));
    },
  },
  {
    label: "Who is this?", focus: ["fingerprint"], seconds: 10, source: "attack",
    headline: "Who is this?",
    sub: "Address, tools, timing, stolen login. And a decoy only they hold.",
    anchor: (ev) => {
      const t = lastBefore(ev, is("honeytoken.touched"));
      return t === null ? lastBefore(ev, is("intent.update"), exfilAt(ev)) : settle(ev, find(ev, is("intent.update"), t) ?? t);
    },
  },
  {
    label: "Exfil", focus: ["narrator", "numbers"], seconds: 10, source: "attack",
    headline: "It believes it won",
    sub: (v) => v.exfil ? `${v.exfil.records.toLocaleString("en-US")} records “stolen”. Every one fake.` : "It reports success.",
    anchor: (ev) => find(ev, is("agent.claim")) ?? find(ev, is("exfil")),
  },
  {
    label: "Reveal", focus: [], reveal: true, seconds: 14, source: "attack",
    headline: "The reveal",
    anchor: (ev) => settle(ev, find(ev, is("reveal"))) ?? ev.length - 1,
  },
  {
    label: "Outage", focus: ["scene", "narrator"], seconds: 11, source: "continuity",
    headline: "The shared lab goes down",
    sub: "Like Synnovis, 2024. Urgent tests reroute to labs that still work.",
    anchor: (ev) => midOutage(ev),
  },
  {
    label: "Care", focus: ["numbers"], seconds: 9, source: "continuity",
    headline: "Care continues",
    sub: (v) => v.continuity ? `${Math.round(v.continuity.stat_on_time_pct)}% of urgent tests still on time.` : "",
    anchor: (ev) => lastBefore(ev, is("continuity.stats")),
  },
  {
    label: "Compare", card: "compare", focus: [], seconds: 15, source: "attack",
    headline: "Same attack, three defenses",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Close", card: "close", focus: [], seconds: 7, source: "attack",
    headline: "Protecting critical hospitals from AI cyberattacks.",
    anchor: (ev) => ev.length - 1,
  },
];

export const TOTAL_SECONDS = STEPS.reduce((s, x) => s + x.seconds, 0);

function goalWord(g: View["topGoal"]): string {
  return { benign: "Do normal work", recon: "Map the network", exfil: "Steal patient data", tamper: "Change lab results", disrupt: "Shut services down" }[g];
}

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
