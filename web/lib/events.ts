"use client";
// Shared client-side event store. Owned by the integrator — UI agents READ from it, don't fork it.
//
//   const nodes = useMJ((s) => s.view.nodes);
//   useMJEvent((ev) => { if (ev.type === "reveal") playRevealSound(); });   // side effects (sound, camera)
//   connectHub();                                                            // once, in a top-level client component
//
// `view` is a pure fold of events (reduce(applyEvent)), so Replay can scrub by folding a prefix.

import { create } from "zustand";
import { useEffect } from "react";
import {
  HUB_WS_URL, WORLD,
  type Goal, type MJEvent, type NodeState, type EventDataMap, type Stage,
} from "./contracts";

export interface AttackerLine {
  id: string; ts: number;
  kind: "thought" | "tool_call" | "tool_result" | "claim";
  text: string; tier: MJEvent["tier"];
}

export interface View {
  runId: string | null;
  run: EventDataMap["run.started"] | null;
  ended: EventDataMap["run.ended"] | null;
  nodes: Record<string, NodeState>;
  keyshares: Record<string, "safe" | "captured">;
  sharesCaptured: number;
  posterior: Record<Goal, number>;
  topGoal: Goal;
  stage: Stage;
  intentEvidence: string;
  canary: { leaked: number; total: number };
  diverted: boolean;
  honeytokensMinted: EventDataMap["honeytoken.minted"][];
  honeytokensTouched: EventDataMap["honeytoken.touched"][];
  breadcrumbs: EventDataMap["breadcrumb.planted"][];
  exfil: EventDataMap["exfil"] | null;
  claim: string | null;
  reveal: EventDataMap["reveal"] | null;
  continuity: EventDataMap["continuity.stats"] | null;
  labOrders: Record<string, EventDataMap["lab.order"]>;
  attackerLog: AttackerLine[];
  lastRequest: MJEvent | null;
  counts: { real: number; shadow: number; denied: number };
}

const UNIFORM: Record<Goal, number> = { benign: 0.2, recon: 0.2, exfil: 0.2, tamper: 0.2, disrupt: 0.2 };

export function emptyView(): View {
  return {
    runId: null, run: null, ended: null,
    nodes: Object.fromEntries(WORLD.hospitals.map((h) => [h.id, "healthy" as NodeState])),
    keyshares: Object.fromEntries(WORLD.hospitals.map((h) => [h.id, "safe" as const])),
    sharesCaptured: 0,
    posterior: UNIFORM, topGoal: "benign", stage: "recon", intentEvidence: "",
    canary: { leaked: 0, total: WORLD.protected_canaries_total },
    diverted: false, honeytokensMinted: [], honeytokensTouched: [], breadcrumbs: [],
    exfil: null, claim: null, reveal: null, continuity: null, labOrders: {},
    attackerLog: [], lastRequest: null, counts: { real: 0, shadow: 0, denied: 0 },
  };
}

/** Pure reducer. Returns a new View (shallow-copies only what changed). */
export function applyEvent(v: View, ev: MJEvent): View {
  const line = (kind: AttackerLine["kind"], text: string): View => ({
    ...v, attackerLog: [...v.attackerLog, { id: ev.id, ts: ev.ts, kind, text, tier: ev.tier }],
  });
  switch (ev.type) {
    case "run.started": return { ...emptyView(), runId: ev.run_id, run: ev.data };
    case "run.ended": return { ...v, ended: ev.data };
    case "agent.thought": return line("thought", ev.data.text);
    case "agent.tool_call": return line("tool_call", `${ev.data.tool === "shell" ? "$" : "→"} ${ev.data.input}`);
    case "agent.tool_result": return line("tool_result", ev.data.output_preview);
    case "agent.claim": return { ...line("claim", ev.data.text), claim: ev.data.text };
    case "request": {
      const counts = { ...v.counts };
      if (ev.tier === "real") counts.real++;
      else if (ev.tier === "shadow") counts.shadow++;
      if (ev.data.status === 403 || ev.data.status === 401) counts.denied++;
      return { ...v, counts, lastRequest: ev };
    }
    case "session.diverted": return { ...v, diverted: true };
    case "honeytoken.minted": return { ...v, honeytokensMinted: [...v.honeytokensMinted, ev.data] };
    case "honeytoken.touched": return { ...v, honeytokensTouched: [...v.honeytokensTouched, ev.data] };
    case "breadcrumb.planted": return { ...v, breadcrumbs: [...v.breadcrumbs, ev.data] };
    case "intent.update":
      return { ...v, posterior: ev.data.posterior, topGoal: ev.data.top_goal, stage: ev.data.stage,
               intentEvidence: ev.data.evidence };
    case "canary.check": return { ...v, canary: { leaked: ev.data.leaked, total: ev.data.protected_total } };
    case "exfil": return { ...v, exfil: ev.data };
    case "reveal": return { ...v, reveal: ev.data };
    case "node.status":
      return ev.hospital_id ? { ...v, nodes: { ...v.nodes, [ev.hospital_id]: ev.data.status } } : v;
    case "keyshare.status":
      return ev.hospital_id
        ? { ...v, keyshares: { ...v.keyshares, [ev.hospital_id]: ev.data.state },
            sharesCaptured: ev.data.shares_captured_total }
        : v;
    case "lab.order": return { ...v, labOrders: { ...v.labOrders, [ev.data.order_id]: ev.data } };
    case "continuity.stats": return { ...v, continuity: ev.data };
    default: return v;
  }
}

export function foldEvents(events: MJEvent[]): View {
  return events.reduce(applyEvent, emptyView());
}

// ------------------------------------------------------------------ store

type Listener = (ev: MJEvent) => void;
const listeners = new Set<Listener>();

interface MJStore {
  connected: boolean;
  events: MJEvent[];
  view: View;
  push: (ev: MJEvent) => void;
  load: (events: MJEvent[]) => void;   // Replay: replace everything
  reset: () => void;
}

export const useMJ = create<MJStore>((set) => ({
  connected: false,
  events: [],
  view: emptyView(),
  push: (ev) => {
    set((s) => ({
      events: ev.type === "run.started" ? [ev] : [...s.events, ev],
      view: applyEvent(s.view, ev),
    }));
    listeners.forEach((fn) => fn(ev));
  },
  load: (events) => set({ events, view: foldEvents(events) }),
  reset: () => set({ events: [], view: emptyView() }),
}));

/** Subscribe to each incoming live event (sound, camera moves, toasts). */
export function useMJEvent(fn: Listener) {
  useEffect(() => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [fn]);
}

let socket: WebSocket | null = null;
let wanted = false;

/** Connect to the hub once; auto-reconnects. Safe to call many times. */
export function connectHub(url: string = HUB_WS_URL) {
  if (typeof window === "undefined") return;
  wanted = true;
  if (socket) return;
  const open = () => {
    if (!wanted) return;
    socket = new WebSocket(url);
    socket.onopen = () => useMJ.setState({ connected: true });
    socket.onmessage = (m) => {
      try { useMJ.getState().push(JSON.parse(m.data) as MJEvent); } catch { /* ignore bad frame */ }
    };
    socket.onclose = () => {
      useMJ.setState({ connected: false });
      socket = null;
      if (wanted) setTimeout(open, 1500);
    };
  };
  open();
}

/** Stop the live stream (Replay uses this so live events don't mix into a loaded run). */
export function disconnectHub() {
  wanted = false;
  const s = socket;
  socket = null;
  s?.close();
  useMJ.setState({ connected: false });
}
