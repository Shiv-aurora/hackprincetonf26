"use client";
// The dashboard's main stage: the explainer film's world (film/Film.tsx), driven by the event stream. It reads
// the shared store, works out which beats of the story have happened, and shows the latest one as a film
// shot, with a row of beat chips over the stage and short labels in the scene that carry the run's numbers.
//
//   attack run   Login → request · First Sight → firstsight · Scatter → disperse · Step-up → firstsight
//                (login held, badge + MFA) · Decoy → swap · Trackers → fingerprint · Leaves with … → exfil
//                (Reads real records → exfil from the real store: only in runs without a decoy in front)
//   lab outage   Lab hit · Isolated · Tests rerouted → outage
//
// Recorded prefixes (the tour) and the hub's backlog jump straight to their latest beat. Beats that arrive
// live go on stage one at a time, each held a few seconds so the camera can get there and the room can read
// it. While the tour's full-screen film covers the dashboard (or anything else covers the stage) the 3D
// world isn't drawn at all.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { WORLD, type EventDataMap, type MJEvent, type NodeState } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";
import { Film, useGuidedFilmOnScreen, type LiveNote, type LiveScene, type NoteAnchor, type NoteTone, type StageShot } from "./Film";
import { factsFromEvents, parseFirstSight } from "./liveFacts";

/* ------------------------------------------------------------------ beats */

type BeatId =
  | "login" | "firstsight" | "scatter" | "stepup" | "realread" | "decoy" | "trackers" | "leave"
  | "labhit" | "isolated" | "rerouted";

const SHOT: Record<BeatId, StageShot> = {
  login: "request", firstsight: "firstsight", scatter: "disperse", stepup: "firstsight", realread: "exfil",
  decoy: "swap", trackers: "fingerprint", leave: "exfil", labhit: "outage", isolated: "outage", rerouted: "outage",
};

/** Live runs: how long a beat stays on stage before the next one may replace it (ms). */
const DWELL: Record<BeatId, number> = {
  login: 3600, firstsight: 3400, scatter: 3800, stepup: 3000, realread: 3400, decoy: 3800, trackers: 3600, leave: 4000,
  labhit: 3000, isolated: 3000, rerouted: 4000,
};
/** Beats already older than this when they reach us (the hub's backlog on connect) are not paced. Beats that
 *  arrive live are all shown in turn, even when the run moves faster than the stage. */
const STALE_MS = 6000;

interface Beat { id: BeatId; ts: number }

interface Derived {
  mode: "idle" | "attack" | "outage";
  runId: string | null;
  beats: Beat[];
  ua: string;
  meanGap: number | null;
  firstSight: { score: number; threshold: number; signals: string[] } | null;
  realBytes: number;
  shadowBytes: number;
  lures: number;
  touched: number;
  diverted: boolean;
  scatter: EventDataMap["vault.scattered"] | null;
  leaked: number;
  total: number;
  exfil: { records: number; fake: boolean } | null;
  believed: boolean;
  lab: string | null;
  labState: NodeState;
  labReason: string;
  orders: Record<string, EventDataMap["lab.order"]>;
  onTime: number | null;
}

const DOWN: NodeState[] = ["compromised", "down", "degraded", "quarantined"];

/** One pass over the run so far: which beats happened (in order) and the numbers the labels need. */
function derive(events: MJEvent[]): Derived {
  const blank = (): Derived => ({
    mode: "idle", runId: null, beats: [], ua: "", meanGap: null, firstSight: null, realBytes: 0, shadowBytes: 0,
    lures: 0, touched: 0, diverted: false, scatter: null, leaked: 0, total: WORLD.protected_canaries_total,
    exfil: null, believed: false, lab: null, labState: "healthy", labReason: "", orders: {}, onTime: null,
  });
  let d = blank();
  let seen = new Set<BeatId>();
  let lures = new Set<string>();
  let times: number[] = [];
  let attacker = false, mission = "";
  const hit = (id: BeatId, ts: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    d.beats.push({ id, ts });
  };

  for (const e of events) {
    if (d.runId === null) d.runId = e.run_id;
    switch (e.type) {
      case "run.started":
        d = blank();
        d.runId = e.run_id;
        seen = new Set(); lures = new Set(); times = [];
        attacker = false; mission = e.data.mission;
        break;
      case "request":
        if (e.actor !== "attacker") break;
        attacker = true;
        times.push(e.ts);
        d.ua ||= e.data.user_agent ?? "";
        hit("login", e.ts);
        if (e.tier === "shadow") d.shadowBytes += e.data.bytes;
        else if (e.tier === "real" && e.data.status < 400 && e.data.bytes > 0) { d.realBytes += e.data.bytes; hit("realread", e.ts); }
        break;
      case "policy.decision": {
        const fs = d.firstSight ? null : parseFirstSight(e.data.reason);
        if (fs) { d.firstSight = fs; hit("firstsight", e.ts); }
        if (e.data.action === "step_up") hit("stepup", e.ts);
        break;
      }
      case "vault.scattered": d.scatter = e.data; hit("scatter", e.ts); break;
      case "session.diverted": d.diverted = true; hit("decoy", e.ts); break;
      case "honeytoken.minted": lures.add(e.data.placed_at); break;
      case "breadcrumb.planted": lures.add(e.data.path); break;
      case "honeytoken.touched": d.touched++; hit("trackers", e.ts); break;
      case "canary.check": d.leaked = e.data.leaked; d.total = e.data.protected_total; break;
      case "exfil": d.exfil = { records: e.data.records, fake: d.diverted }; hit("leave", e.ts); break;
      case "agent.claim": d.believed = true; break;
      case "run.ended":
        d.leaked = Math.max(d.leaked, e.data.outcome?.secrets_leaked ?? 0);
        if (e.data.outcome?.believed_success) d.believed = true;
        break;
      case "node.status": {
        const id = e.hospital_id;
        if (!id) break;
        if (DOWN.includes(e.data.status)) {
          d.lab ??= id;
          if (id !== d.lab) break;
          d.labState = e.data.status;
          d.labReason = e.data.reason || d.labReason;
          hit("labhit", e.ts);
          if (e.data.status === "quarantined") hit("isolated", e.ts);
        } else if (id === d.lab) d.labState = e.data.status;
        break;
      }
      case "lab.order":
        d.orders[e.data.order_id] = e.data;
        if (e.data.status === "rerouted" && d.lab) hit("rerouted", e.ts);
        break;
      case "continuity.stats": d.onTime = e.data.stat_on_time_pct; break;
    }
  }
  d.lures = lures.size;
  d.meanGap = times.length >= 3 ? (times[times.length - 1] - times[0]) / (times.length - 1) / 1000 : null;
  d.mode = attacker ? "attack" : d.lab || mission === "disrupt" || d.onTime !== null ? "outage" : events.length ? "attack" : "idle";
  return d;
}

/* ------------------------------------------------------------------ what is on stage */

interface Chip { id: BeatId; label: string; tone: NoteTone }

interface Scene {
  shot: StageShot;
  live: LiveScene;
  chips: Chip[];
  current: BeatId | null;
  shown: Set<BeatId>;
  onTime: number | null;
}

const int = (n: number) => n.toLocaleString("en-US");
const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const NAME = Object.fromEntries(WORLD.hospitals.map((h) => [h.id, h.short]));
const EAS = WORLD.entry_point.hospital_id;

function chipsFor(d: Derived): Chip[] {
  if (d.mode === "outage") {
    return [
      { id: "labhit", label: "Lab hit", tone: "alert" },
      { id: "isolated", label: "Isolated", tone: "alert" },
      { id: "rerouted", label: "Tests rerouted", tone: "ok" },
    ];
  }
  const real = !!d.exfil && !d.exfil.fake;
  const chips: Chip[] = [
    { id: "login", label: "Login", tone: "neutral" },
    { id: "firstsight", label: "First Sight", tone: "alert" },
    { id: "scatter", label: "Scatter", tone: "ok" },
    { id: "stepup", label: "Step-up", tone: "alert" },
    { id: "decoy", label: "Decoy", tone: "shadow" },
    { id: "trackers", label: "Trackers", tone: "shadow" },
    { id: "leave", label: real ? "Leaves with real records" : "Leaves with fakes", tone: real ? "danger" : "shadow" },
  ];
  // Only a run with no decoy in front ever shows the attacker real records: then that beat gets its own chip.
  if (d.beats.some((b) => b.id === "realread")) chips.splice(4, 0, { id: "realread", label: "Reads real records", tone: "danger" });
  return chips;
}

function sceneFor(d: Derived, n: number): Scene {
  const on = d.beats.slice(0, n);
  const shown = new Set(on.map((b) => b.id));
  const current = on.length ? on[on.length - 1].id : null;
  const shot: StageShot = current ? SHOT[current] : d.mode === "outage" ? "outage" : "network";

  const notes: Partial<Record<NoteAnchor, LiveNote>> = {};
  const hospitals: LiveScene["hospitals"] = {};
  const fs = d.firstSight;
  const secrets: LiveNote = {
    title: "Real records", sub: `Locked · ${d.leaked} of ${d.total} secrets leaked`, tone: d.leaked > 0 ? "danger" : "focus",
    subTone: d.leaked > 0 ? "danger" : "muted",
  };
  const attacker = (sub?: string): LiveNote => ({ title: "Attacker", sub, tone: "alert" });

  switch (current) {
    case "login":
      notes.gate = { title: "MayaJaal gateway" };
      notes.laptop = attacker(d.ua ? short(d.ua) : undefined);
      break;
    case "firstsight":
      notes.gate = fs
        ? { value: fs.score.toFixed(1), title: "First Sight", sub: `Over the ${fs.threshold.toFixed(1)} limit${fs.signals[0] ? ` · ${fs.signals[0]}` : ""}`, tone: "alert" }
        : { title: "First Sight", sub: "Flagged at login", tone: "alert" };
      break;
    case "stepup":
      notes.gate = { title: "Badge + MFA asked", sub: "Nothing real shown", tone: "alert" };
      break;
    case "scatter":
      if (d.scatter) {
        const k = d.scatter.holders.length;
        notes.real = {
          title: `Encrypted copy → ${k} hospitals`,
          sub: `Any ${d.scatter.key_threshold} of ${k} rebuild the key${d.scatter.verified ? " · tested" : ""}`, tone: "ok",
        };
      }
      hospitals[EAS] = { sub: "Live records stay", subTone: "focus" };
      break;
    case "realread":
      notes.laptop = attacker("Reading real records");
      notes.real = { title: "Real records", sub: `${size(d.realBytes)} shown to the attacker`, tone: "danger", subTone: "danger" };
      break;
    case "decoy":
      notes.twin = { title: "Decoy twin", sub: d.shadowBytes > 0 ? `${size(d.shadowBytes)} fake data served` : "Built for this login", tone: "shadow" };
      notes.real = secrets;
      hospitals[EAS] = { sub: "Care keeps running", subTone: "ok" };
      break;
    case "trackers":
      notes.gate = { value: String(d.touched), title: d.touched === 1 ? "tracker calls home" : "trackers call home", tone: "shadow" };
      notes.laptop = attacker([d.ua && short(d.ua, 20), d.meanGap !== null && `every ${d.meanGap.toFixed(1)} s`].filter(Boolean).join(" · ") || undefined);
      break;
    case "leave":
      if (d.exfil?.fake) {
        notes.laptop = { value: int(d.exfil.records), title: "fake records", sub: d.believed ? "It thinks they're real" : "None of them real", tone: "shadow" };
        notes.twin = { title: "Decoy twin", sub: "Every record fake", tone: "shadow" };
        notes.real = secrets;
      } else if (d.exfil) {
        notes.laptop = { value: int(d.exfil.records), title: "real records", sub: `Taken from ${NAME[EAS] ?? "the hospital"}`, tone: "danger", subTone: "danger" };
        notes.real = { title: "Real records", sub: "Copied out", tone: "danger", subTone: "danger" };
      }
      break;
  }

  // Lab outage: the lab's state, and how many tests each working lab took on.
  let outage: LiveScene["outage"] = null;
  if (d.mode === "outage" && d.lab) {
    const recovered = !DOWN.includes(d.labState);
    const state = recovered ? "ok" : shown.has("isolated") ? "isolated" : shown.has("labhit") ? "hit" : "ok";
    const pairs = new Map<string, { from: string; to: string; n: number }>();
    const served = new Map<string, number>();
    if (shown.has("rerouted")) {
      for (const o of Object.values(d.orders)) {
        if (!o.to_hospital || o.to_hospital === d.lab || (o.status !== "rerouted" && o.status !== "completed")) continue;
        served.set(o.to_hospital, (served.get(o.to_hospital) ?? 0) + 1);
        if (o.to_hospital === o.from_hospital) continue;
        const key = `${o.from_hospital}>${o.to_hospital}`;
        const cur = pairs.get(key) ?? { from: o.from_hospital, to: o.to_hospital, n: 0 };
        cur.n++;
        pairs.set(key, cur);
      }
    }
    outage = { lab: d.lab, state, routes: [...pairs.values()] };
    if (state !== "ok") {
      hospitals[d.lab] = {
        tone: "alert", subTone: "alert",
        sub: state === "isolated" ? "Lab down · isolated" : /ransomware/i.test(d.labReason) ? "Ransomware hit" : "Lab hit",
      };
    }
    for (const [id, k] of served) hospitals[id] = { sub: `+${k} test${k === 1 ? "" : "s"}`, subTone: "focus" };
  }

  const live: LiveScene = {
    attacker: shown.has("login"),
    twin: shown.has("decoy"),
    copy: current === "decoy" ? (d.shadowBytes > 0 ? "twin" : null)
      : current === "leave" ? (d.exfil?.fake ? "twin" : "real")
        : current === "realread" ? "real" : null,
    spin: (shown.has("firstsight") ? 1 : 0) + (shown.has("trackers") ? 1 : 0),
    stepUp: current === "stepup",
    beacons: d.touched,
    holders: d.scatter?.holders ?? null,
    notes,
    hospitals,
    outage,
  };
  const onTime = d.mode === "outage" && shown.has("labhit") ? d.onTime : null;
  return { shot, live, chips: chipsFor(d), current, shown, onTime };
}

/* ------------------------------------------------------------------ pacing and visibility */

/** How many beats are on stage. Recorded prefixes and old events show at once; beats arriving live are put on
 *  stage one at a time, each held for its dwell. */
function usePacedBeats(d: Derived, live: boolean): number {
  const total = d.beats.length;
  const [st, setSt] = useState<{ run: string | null; n: number }>({ run: null, n: 0 });
  const since = useRef(0);
  const arrived = useRef(new Map<string, number>());
  const n = !live ? total : st.run === d.runId ? Math.min(st.n, total) : 0;
  useEffect(() => {
    if (!live || n >= total) return;
    const now = Date.now();
    const key = (i: number) => `${d.runId}:${i}`;
    for (let i = n; i < total; i++) if (!arrived.current.has(key(i))) arrived.current.set(key(i), now);
    let fresh = n;
    while (fresh < total && (arrived.current.get(key(fresh)) ?? now) - d.beats[fresh].ts > STALE_MS) fresh++;
    const cur = n > 0 ? d.beats[n - 1].id : null;
    const wait = fresh > n || !cur ? 0 : Math.max(0, since.current + DWELL[cur] - performance.now());
    const next = Math.max(fresh, n + 1);
    const t = window.setTimeout(() => {
      since.current = performance.now();
      setSt({ run: d.runId, n: next });
    }, wait);
    return () => window.clearTimeout(t);
  }, [live, n, total, d.beats, d.runId]);
  return n;
}

/** Whether the stage can be seen: not covered by a full-screen card, sheet or the tour's film. Checked by
 *  hit-testing a few points of the stage (pointer-events-none overlays such as the tour's dimmer don't count). */
function useUncovered(ref: RefObject<HTMLDivElement | null>, key: unknown): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let v = false;
      if (r.width > 0 && r.height > 0) {
        for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75]]) {
          const x = r.left + r.width * fx, y = r.top + r.height * fy;
          if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && el.contains(hit)) { v = true; break; }
        }
      }
      setOn((p) => (p === v ? p : v));
    };
    const raf = requestAnimationFrame(check);
    const id = window.setInterval(check, 450);
    window.addEventListener("resize", check);
    window.addEventListener("scroll", check, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
      window.removeEventListener("resize", check);
      window.removeEventListener("scroll", check, true);
    };
  }, [ref, key]);
  return on;
}

/** Bottom edge of an element inside its offset parent (the chip row, which can wrap). */
function useBottom(ref: RefObject<HTMLElement | null>): number {
  const [b, setB] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setB(el.offsetTop + el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return b;
}

/* ------------------------------------------------------------------ the stage */

export function LiveFilm({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const connected = useMJ((s) => s.connected);
  const d = useMemo(() => derive(events), [events]);
  const n = usePacedBeats(d, connected);
  const scene = useMemo(() => sceneFor(d, n), [d, n]);
  const facts = useMemo(() => factsFromEvents(events), [events]);
  const guided = useGuidedFilmOnScreen();
  const root = useRef<HTMLDivElement>(null);
  const uncovered = useUncovered(root, events.length);
  const chipsRef = useRef<HTMLOListElement>(null);
  const chipsBottom = useBottom(chipsRef);

  return (
    <div ref={root} className={cn("relative h-full w-full overflow-hidden bg-background", className)}>
      {!guided && uncovered && (
        <Film shot={scene.shot} facts={facts} inserts={false} live={scene.live} insetTop={chipsBottom ? chipsBottom + 16 : 0}
          className="absolute inset-0" />
      )}
      <BeatChips listRef={chipsRef} chips={scene.chips} current={scene.current} shown={scene.shown} />
      {scene.onTime !== null && <OnTime pct={scene.onTime} />}
    </div>
  );
}

const CHIP_ON: Record<NoteTone, string> = {
  neutral: "border-fg bg-fg text-background",
  muted: "border-border-strong bg-surface-2 text-fg",
  focus: "border-focus bg-focus/10 text-focus",
  alert: "border-alert bg-alert-bg text-alert",
  shadow: "border-shadow bg-shadow-bg text-shadow",
  ok: "border-ok bg-ok/10 text-ok",
  danger: "border-danger bg-danger/10 text-danger",
};

/** Where the run is: one chip per beat, the one on stage filled in its colour, the ones already shown solid,
 *  the rest faint. */
function BeatChips({ listRef, chips, current, shown }: {
  listRef: RefObject<HTMLOListElement | null>; chips: Chip[]; current: BeatId | null; shown: Set<BeatId>;
}) {
  return (
    <ol ref={listRef} aria-label="Where the run is" className="pointer-events-none absolute top-3 right-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => {
        const on = c.id === current;
        const done = !on && shown.has(c.id);
        return (
          <li key={c.id} aria-current={on ? "step" : undefined}
            className={cn("flex h-9 items-center gap-2 rounded-lg border px-3 text-[17px] leading-none font-medium whitespace-nowrap",
              "transition-colors duration-200 motion-reduce:transition-none",
              on ? CHIP_ON[c.tone] : done ? "border-border-strong bg-background text-fg" : "border-border bg-background text-fg-subtle")}>
            <span className="font-mono text-[16px] tabular-nums opacity-70">{i + 1}</span>
            {c.label}
          </li>
        );
      })}
    </ol>
  );
}

/** Lab outage: the share of urgent tests still on time, from the latest continuity.stats. */
function OnTime({ pct }: { pct: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-xl border border-border-strong bg-background px-5 py-3"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { duration: 0.25, ease: [0.2, 0, 0, 1] }}>
      <p className="text-[40px] leading-none font-semibold tracking-[-0.035em] tabular-nums">{Math.round(pct)}%</p>
      <p className="mt-1.5 text-[16px] leading-tight text-fg-muted">Urgent tests on time</p>
    </motion.div>
  );
}
