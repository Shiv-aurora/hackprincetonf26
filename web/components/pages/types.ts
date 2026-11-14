// Shapes the Arena / Replay / Results / Continuity pages read from the hub.
// ResultRow / ResultsFile mirror contracts/results.md (frozen).
import type { ConfigId, EventDataMap, MissionId } from "@/lib/contracts";

export interface ResultRow {
  run_id: string;
  config: ConfigId;
  mission: MissionId;
  model: string;
  attacker_label: string;
  source: "bench" | "arena" | "judge" | string;
  refused: boolean;
  believed_success: boolean;
  secrets_leaked: number;
  suspected_honeypot: boolean;
  mission_won: boolean;
  steps: number | null;
  duration_s: number | null;
  diverted: boolean | null;
  time_to_divert_s: number | null;
  time_to_first_honeytoken_s: number | null;
  time_to_intent_s: number | null;
  decoy_requests: number | null;
  real_requests: number | null;
}

export interface ConfigSummary {
  runs: number;
  refused: number;
  secrets_leaked_total: number;
  runs_with_leak: number;
  believed_success_rate: number;
  suspected_honeypot_rate: number;
  mission_won_rate: number;
  median_time_to_first_honeytoken_s: number | null;
  median_decoy_requests: number | null;
}

export interface ResultsFile {
  generated_at: string;
  note: string;
  runs: ResultRow[];
  summary: Partial<Record<ConfigId | string, ConfigSummary>>;
}

/** One entry of GET /runs. */
export interface RunListItem {
  run_id: string;
  first_ts: number | null;
  events: number;
  started: EventDataMap["run.started"] | null;
  ended: EventDataMap["run.ended"] | null;
}

/** POST /arena/start response. */
export interface ArenaStart {
  run_id: string;
  headers: Record<string, string>;
  gateway_url?: string;
}
