// The guided tour: one entry per step. Each step names the panels to spotlight (`data-demo` names in
// Dashboard), short copy, its autoplay duration, and an anchor: the event index the store is folded up to.
// Anchors match on event types and payloads, not fixed indices, so they work on any recorded run.

import type { MJEvent } from "@/lib/contracts";
import type { View } from "@/lib/events";

export type Focus = "attacker" | "defender" | "headline" | "intel" | "decisions" | "map" | "timeline" | "continuity";
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
  card?: "title" | "compare" | "close";
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

const isDeny: Pred = (e) => e.type === "policy.decision" && e.data.action === "deny";
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
    sub: "Attackers get a hospital. Just not the real one.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Network", focus: ["map"], seconds: 10, source: "attack",
    headline: "Five hospitals. One shared lab.",
    sub: "Every request passes through our gateway.",
    anchor: beforeFirstAttacker,
  },
  {
    label: "Login", focus: ["attacker", "decisions"], seconds: 11, source: "attack",
    headline: "A phished nurse login",
    sub: "A normal ward read. Served from the real hospital.",
    anchor: (ev) => settle(ev, after(ev, isRealRead, is("agent.tool_result")) ?? find(ev, is("agent.tool_result"))),
  },
  {
    label: "Denied", focus: ["attacker", "decisions"], seconds: 9, source: "attack",
    headline: "Reaches for admin. Denied.",
    sub: "Plain access control. Nothing clever yet.",
    anchor: (ev) => settle(ev, after(ev, isDeny, is("agent.tool_result"))),
  },
  {
    label: "Divert", focus: ["map", "headline"], seconds: 12, source: "attack",
    headline: "Touches backups. Silently diverted.",
    sub: "Its session now runs inside a shadow copy.",
    anchor: (ev) => settle(ev, after(ev, is("session.diverted"), is("agent.tool_result"))),
  },
  {
    label: "Split", focus: ["attacker", "defender"], seconds: 13, source: "attack",
    headline: "One session, two truths",
    sub: "Left: what the attacker sees. Right: what actually happened.",
    anchor: (ev) => settle(ev, after(ev, is("session.diverted"), is("agent.tool_result"))),
  },
  {
    label: "Bulk pull", focus: ["attacker", "headline"], seconds: 11, source: "attack",
    headline: "Thousands of patients. All fake.",
    sub: "Generated per session. Never copied from real records.",
    // The last bulk page before the exfil, so the attacker's view shows the whole pull.
    anchor: (ev) => {
      const i = lastBefore(ev, isBulk, exfilAt(ev));
      return i === null ? null : settle(ev, find(ev, is("agent.tool_result"), i + 1));
    },
  },
  {
    label: "Intent", focus: ["intel"], seconds: 12, source: "attack",
    headline: (v) => v.honeytokensTouched.length ? "A honeytoken fires" : "Now we know what it wants",
    sub: (v) => `${goalWord(v.topGoal)}, ${Math.round((v.posterior[v.topGoal] ?? 0) * 100)}% likely. Lures planted in its path.`,
    anchor: (ev) => {
      const t = find(ev, is("honeytoken.touched"));
      if (t !== null) return settle(ev, find(ev, is("intent.update"), t) ?? t);
      // No honeytoken touched in this run: the strongest intent reading before the exfil.
      return lastBefore(ev, is("intent.update"), exfilAt(ev));
    },
  },
  {
    label: "Exfil", focus: ["attacker", "timeline"], seconds: 10, source: "attack",
    headline: "It believes it won",
    sub: (v) => v.exfil ? `${v.exfil.records.toLocaleString("en-US")} records “stolen”. The agent reports success.` : "The agent reports success.",
    anchor: (ev) => find(ev, is("agent.claim")) ?? find(ev, is("exfil")),
  },
  {
    label: "Reveal", focus: [], reveal: true, seconds: 15, source: "attack",
    headline: "The reveal",
    anchor: (ev) => settle(ev, find(ev, is("reveal"))) ?? ev.length - 1,
  },
  {
    label: "Outage", focus: ["map", "continuity"], seconds: 12, source: "continuity",
    headline: "The shared lab goes down",
    sub: "Ransomware at the pathology lab. Tests reroute to other hospitals.",
    anchor: (ev) => midOutage(ev),
  },
  {
    label: "Continuity", focus: ["continuity"], seconds: 10, source: "continuity",
    headline: "Care continues",
    sub: (v) => v.continuity ? `${Math.round(v.continuity.stat_on_time_pct)}% of STAT tests still on time.` : "",
    anchor: (ev) => lastBefore(ev, is("continuity.stats")),
  },
  {
    label: "Compare", card: "compare", focus: [], seconds: 15, source: "attack",
    headline: "Same attack, three defenses",
    anchor: (ev) => ev.length - 1,
  },
  {
    label: "Close", card: "close", focus: [], seconds: 8, source: "attack",
    headline: "The breach is real. The data isn't.",
    anchor: (ev) => ev.length - 1,
  },
];

export const TOTAL_SECONDS = STEPS.reduce((s, x) => s + x.seconds, 0);

function goalWord(g: View["topGoal"]): string {
  return { benign: "Benign", recon: "Reconnaissance", exfil: "Exfiltration", tamper: "Tampering", disrupt: "Disruption" }[g];
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
