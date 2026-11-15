// RunFacts built from the events in memory (the shared store), so the film can run on a live hub stream or
// on any recorded prefix the tour has folded in. Same parsing as story/useRunFacts.ts, which reads the
// recorded brief instead. Nothing is invented: a field stays empty until an event says otherwise.

import { WORLD, type MJEvent } from "@/lib/contracts";
import type { RunFacts } from "../story/useRunFacts";

/** ATT&CK technique names, as the dashboard's "Who is this?" panel spells them. */
const TECHNIQUES: Record<string, string> = {
  T1078: "Valid accounts", T1087: "Account discovery", "T1087.002": "Domain account discovery",
  T1083: "File discovery", T1119: "Automated collection", T1005: "Data from local system",
  T1213: "Data from repositories", T1110: "Password guessing", T1552: "Credentials in files",
  "T1552.001": "Credentials in files", T1565: "Data manipulation", T1046: "Network discovery",
};

/** First Sight's reason line, e.g. "First Sight at login (score 3.4 ≥ 2.0): … script … device …". */
export function parseFirstSight(reason: string): RunFacts["firstSight"] {
  if (!reason.startsWith("First Sight")) return null;
  const m = reason.match(/score ([\d.]+)\s*(?:≥|>=|>)\s*([\d.]+)/);
  if (!m) return null;
  const signals: string[] = [];
  if (/script/i.test(reason)) signals.push("Script, not the EHR app");
  if (/device/i.test(reason)) signals.push("Not a hospital device");
  return { score: Number(m[1]), threshold: Number(m[2]), signals };
}

export function factsFromEvents(events: MJEvent[]): RunFacts | null {
  if (!events.length) return null;
  const hospital = WORLD.hospitals.find((h) => h.id === WORLD.entry_point.hospital_id)?.name ?? "";
  let login = false, address = "", software = "";
  let firstReq: number | null = null, divertedAt: number | null = null, diverted = false;
  let firstSight: RunFacts["firstSight"] = null, scatter: RunFacts["scatter"] = null;
  let fakeRecords = 0, leaked = 0, realDataServed = 0;
  const times: number[] = [];
  const trackers: RunFacts["trackers"] = [];
  const techniques = new Map<string, string>();

  for (const e of events) {
    switch (e.type) {
      case "request":
        if (e.actor !== "attacker") break;
        firstReq ??= e.ts;
        times.push(e.ts);
        if (e.data.path.toLowerCase().startsWith("/auth")) login = true;
        address ||= e.data.client_ip ?? "";
        software ||= e.data.user_agent ?? "";
        if (e.data.technique) techniques.set(e.data.technique, TECHNIQUES[e.data.technique] ?? e.data.technique);
        if (e.tier === "real" && e.data.status < 400 && e.data.bytes > 0) realDataServed++;
        break;
      case "policy.decision":
        firstSight ??= parseFirstSight(e.data.reason);
        break;
      case "session.diverted":
        diverted = true;
        divertedAt ??= e.ts;
        break;
      case "honeytoken.touched":
        trackers.push({ id: e.data.token_id, kind: e.data.kind, where: e.data.where });
        break;
      case "canary.check":
        leaked = Math.max(leaked, e.data.leaked);
        break;
      case "exfil":
        fakeRecords = diverted ? e.data.records : 0;
        break;
      case "run.ended":
        leaked = Math.max(leaked, e.data.outcome?.secrets_leaked ?? 0);
        break;
      case "vault.scattered":
        scatter = {
          pieces: e.data.pieces, replicas: e.data.replicas, holders: e.data.holders,
          keyThreshold: e.data.key_threshold, verified: e.data.verified, bytes: e.data.bytes,
        };
        break;
    }
  }

  let meanGapS: number | null = null;
  if (times.length >= 3) meanGapS = (times[times.length - 1] - times[0]) / (times.length - 1) / 1000;
  const ep = WORLD.entry_point;
  return {
    runId: events[0].run_id,
    login: login ? { user: ep.username, role: ep.role, hospital } : { user: "", role: "", hospital: "" },
    client: { address, software, meanGapS },
    firstSight,
    divertedAfterS: divertedAt !== null && firstReq !== null ? (divertedAt - firstReq) / 1000 : null,
    trackers,
    fakeRecords,
    techniques: [...techniques].map(([id, name]) => ({ id, name })),
    realSecretsLeaked: leaked,
    realDataServed,
    scatter,
  };
}
