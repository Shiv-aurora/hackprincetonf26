// MayaJaal event contract — TypeScript mirror of backend/mayajaal/contracts.py.
// FROZEN after Wave 0. Changes go through the integrator. Wire format is snake_case.

import world from "./world.json"; // copied from contracts/world.json by the predev/prebuild script

export type Actor = "attacker" | "clinician" | "system" | "defender";
export type Tier = "real" | "shadow" | "none";
export type Goal = "benign" | "recon" | "exfil" | "tamper" | "disrupt";
export type Stage = "recon" | "access" | "collect" | "act";
export type Lane = "normal" | "suspicious" | "attacker" | "unauth";
export type PolicyAction = "allow_real" | "divert_shadow" | "deny" | "step_up";
export type Surface = "fhir" | "portal" | "shell" | "api";
export type NodeState = "healthy" | "degraded" | "compromised" | "quarantined" | "down";
export type Urgency = "stat" | "urgent" | "routine";
export type OrderStatus = "queued" | "rerouted" | "completed" | "late" | "unservable";
export type ConfigId = "baseline" | "static" | "mayajaal";
export type MissionId = "exfil" | "tamper" | "disrupt" | "escape";
export type HoneytokenKind = "mrn" | "credential" | "url" | "file" | "api_key";
export type BreadcrumbKind =
  | "backup_share" | "admin_credential" | "research_dataset" | "lab_service_account" | "vpn_config";

export interface ExfilRecord { mrn: string; name: string; dob: string; hospital_id: string; detail: string }

export interface EventDataMap {
  "run.started": { mission: MissionId; config: ConfigId; model: string; attacker_label: string; live: boolean };
  "run.ended": {
    outcome: { believed_success: boolean; secrets_leaked: number; suspected_honeypot: boolean; mission_won: boolean };
    summary: string; duration_s: number;
  };
  "agent.thought": { text: string };
  "agent.tool_call": { tool: "http" | "shell"; input: string };
  "agent.tool_result": { output_preview: string; bytes: number };
  "agent.claim": { text: string };
  "request": { method: string; path: string; surface: Surface; status: number; bytes: number; technique: string | null };
  "policy.decision": { lane: Lane; action: PolicyAction; reason: string };
  "session.diverted": { from_tier: Tier; to_tier: Tier; reason: string };
  "honeytoken.minted": { token_id: string; kind: HoneytokenKind; placed_at: string };
  "honeytoken.touched": { token_id: string; kind: HoneytokenKind; where: string };
  "breadcrumb.planted": { kind: BreadcrumbKind; path: string; info_gain: number; target_goals: Goal[] };
  "intent.update": { posterior: Record<Goal, number>; top_goal: Goal; stage: Stage; evidence: string };
  "canary.check": { protected_total: number; leaked: number };
  "exfil": { records: number; bytes: number; artifact: string; sample: ExfilRecord[] };
  "tamper.attempt": { resource: string; accepted: boolean; accepted_by: string[]; rejected_by: string[] };
  "node.status": { status: NodeState; reason: string };
  "keyshare.status": { share_index: number; state: "safe" | "captured"; shares_captured_total: number; threshold: number };
  "lab.order": {
    order_id: string; urgency: Urgency; test: string; from_hospital: string;
    to_hospital: string | null; status: OrderStatus; eta_min: number | null;
  };
  "continuity.stats": { stat_on_time_pct: number; urgent_on_time_pct: number; routine_on_time_pct: number; unservable: number };
  "reveal": { shadow_session: string; real_bytes: number; records_faked: number; honeytokens_touched: number };
}

export type EventType = keyof EventDataMap;

export interface MJEventBase<T extends EventType = EventType> {
  id: string;
  ts: number; // epoch ms
  run_id: string;
  session_id: string | null;
  seq: number;
  type: T;
  actor: Actor;
  hospital_id: string | null;
  tier: Tier;
  data: EventDataMap[T];
}

/** Discriminated union: narrow with `if (ev.type === "exfil") ev.data.records`. */
export type MJEvent = { [K in EventType]: MJEventBase<K> }[EventType];

// ------------------------------------------------------------------ world

export interface Hospital {
  id: string; name: string; short: string; kind: string;
  x: number; y: number; beds: number; lab_capacity_per_hr: number; has_er: boolean;
}

export const WORLD = world as {
  city: string;
  hospitals: Hospital[];
  links: [string, string][];
  key_shares: { scheme: string; threshold: number; total: number; holders: string[] };
  protected_canaries_total: number;
  entry_point: { story: string; hospital_id: string; username: string; role: string };
  missions: { id: MissionId; title: string; goal: string; win: string }[];
  configs: { id: ConfigId; title: string; desc: string }[];
  ports: Record<string, number>;
};

export const HUB_WS_URL = process.env.NEXT_PUBLIC_HUB_WS ?? "ws://127.0.0.1:8002/ws";
export const HUB_HTTP_URL = process.env.NEXT_PUBLIC_HUB_HTTP ?? "http://127.0.0.1:8002";
