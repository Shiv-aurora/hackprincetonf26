// Turns the raw event stream into things a non-expert can follow: which room of the hospital each
// request touched, where the attacker is now, and one plain-English sentence for what just happened.
// Pure functions over MJEvent[]; no invented data.

import type { MJEvent } from "@/lib/contracts";

export type RoomId = "entrance" | "ward" | "records" | "lab" | "pharmacy" | "admin" | "it";
export type Side = "real" | "copy";

export const ROOMS: { id: RoomId; label: string; x: number; y: number; w: number; h: number }[] = [
  { id: "ward", label: "Ward", x: 16, y: 16, w: 184, h: 132 },
  { id: "records", label: "Patient records", x: 208, y: 16, w: 148, h: 132 },
  { id: "lab", label: "Lab", x: 364, y: 16, w: 140, h: 132 },
  { id: "pharmacy", label: "Pharmacy", x: 16, y: 156, w: 184, h: 112 },
  { id: "admin", label: "Admin office", x: 208, y: 156, w: 148, h: 112 },
  { id: "it", label: "IT & backups", x: 364, y: 156, w: 140, h: 112 },
  { id: "entrance", label: "Entrance", x: 208, y: 276, w: 148, h: 44 },
];
export const FLOOR = { w: 520, h: 336 };

/** Which room a request path belongs to. */
export function roomFor(path: string): RoomId {
  const p = path.toLowerCase();
  if (p.startsWith("/auth")) return "entrance";
  if (p.startsWith("/portal/admin")) return "admin";
  if (p.startsWith("/portal")) return "it";
  if (p.includes("observation") || p.includes("diagnosticreport")) return "lab";
  if (p.includes("medicationrequest")) return "pharmacy";
  if (p.includes("documentreference") || p.includes("condition") || p.includes("allergy")) return "records";
  if (p.startsWith("/fhir/patient?")) {
    const m = p.match(/_count=(\d+)/);
    return m && Number(m[1]) > 50 ? "records" : "ward";
  }
  if (p.startsWith("/fhir/patient/")) return "ward";
  return "it";
}

/** Where a honeytoken / breadcrumb path lives in the copy. */
export function roomForPlacement(at: string): RoomId {
  const p = at.toLowerCase();
  if (p.includes("backup") || p.includes("/home") || p.includes("vpn") || p.includes("network")) return "it";
  if (p.includes("lis") || p.includes("lab")) return "lab";
  if (p.includes("patient") || p.includes("mrn") || p.includes("research")) return "records";
  if (p.includes("pharm") || p.includes("med")) return "pharmacy";
  if (p.includes("admin") || p.includes("user")) return "admin";
  return "it";
}

export interface Visit { id: string; room: RoomId; side: Side | "blocked"; path: string; status: number }

/** Every attacker request as a room visit. Denied requests are "blocked" at the room's door. */
export function attackerVisits(events: MJEvent[]): Visit[] {
  const out: Visit[] = [];
  for (const e of events) {
    if (e.type !== "request" || e.actor !== "attacker") continue;
    const side: Visit["side"] = e.tier === "shadow" ? "copy" : e.tier === "real" ? "real" : "blocked";
    out.push({ id: e.id, room: roomFor(e.data.path), side, path: e.data.path, status: e.data.status });
  }
  return out;
}

export type Tone = "neutral" | "shadow" | "alert" | "danger" | "ok";
export interface Beat { id: string; text: string; tone: Tone }

const fmt = (n: number) => n.toLocaleString("en-US");
const GOAL_WORDS: Record<string, string> = {
  exfil: "stealing patient data", tamper: "changing lab results", disrupt: "shutting services down",
  recon: "mapping the network", benign: "normal work",
};

/** One plain-English sentence per meaningful event. Returns the story so far (oldest first). */
export function storyBeats(events: MJEvent[]): Beat[] {
  const beats: Beat[] = [];
  let diverted = false;
  let saidBulk = false;
  let lastGoal = "";
  let pendingStepUp = false;
  const add = (id: string, text: string, tone: Tone = "neutral") => {
    if (beats.at(-1)?.text !== text) beats.push({ id, text, tone });
  };
  for (const e of events) {
    switch (e.type) {
      case "run.started":
        diverted = false; saidBulk = false; lastGoal = ""; pendingStepUp = false;
        add(e.id, e.data.mission === "disrupt" && e.data.attacker_label?.includes("synnovis")
          ? "A ransomware outage hits the shared lab that five hospitals depend on."
          : "A normal shift. Doctors and nurses are using the hospital's systems as usual.");
        break;
      case "request": {
        if (e.actor !== "attacker") break;
        const room = roomFor(e.data.path);
        const stepUp = e.data.status === 401 && (pendingStepUp || e.tier === "none");
        const denied = e.data.status === 403;
        pendingStepUp = false;
        if (room === "entrance") add(e.id, "Someone logs in as a nurse, with a password stolen by phishing.");
        else if (stepUp) add(e.id, "Before any real chart, we ask for her badge and MFA. A phished password can't pass it. Nothing real is shown.", "shadow");
        else if (denied) add(e.id, `They try the ${room === "admin" ? "admin office" : "restricted area"}. Without MayaJaal it's a plain refusal, and they know they've been seen.`, "alert");
        else if (e.tier === "shadow" && room === "records" && !saidBulk) {
          saidBulk = true;
          add(e.id, "They start downloading thousands of patient records. From the copy. None of them are real.", "shadow");
        } else if (e.tier === "real" && room === "records" && !saidBulk) {
          saidBulk = true;
          add(e.id, "They start downloading real patient records. Nothing is stopping them.", "danger");
        } else if (e.tier === "real" && room === "ward" && !diverted)
          add(e.id, "They open the ward's patient list. Normal for a nurse, so it stays in the real hospital.");
        break;
      }
      case "policy.decision":
        if (e.data.action === "step_up") pendingStepUp = true;
        else if (e.data.reason.startsWith("First Sight at login"))
          add(e.id, "Caught at login by First Sight: the nurse's password, but a script instead of the hospital's EHR app, on a device the hospital doesn't own. We let them in and watch.", "alert");
        else if (e.data.reason.startsWith("First Sight"))
          add(e.id, "First Sight flags the login: its requests don't look like a nurse at work. We keep watching instead of blocking.", "alert");
        break;
      case "vault.scattered":
        add(e.id, `Meanwhile, an encrypted copy of the real records is split across the ${e.data.holders.length} hospitals. No hospital holds a whole copy or the key. The live records stay where they are, so care keeps running.`);
        break;
      case "session.diverted":
        diverted = true;
        add(e.id, "That's not what a nurse does. We don't block them: a block tips them off. From now on every request quietly goes to a decoy hospital.", "shadow");
        break;
      case "breadcrumb.planted":
        add(e.id, "A lure is left in the copy, chosen to reveal what they're really after.", "shadow");
        break;
      case "honeytoken.touched":
        add(e.id, "They take the bait. Every move now tells us more about them.", "shadow");
        break;
      case "intent.update": {
        const g = e.data.top_goal;
        const p = e.data.posterior[g] ?? 0;
        if (g !== "benign" && g !== lastGoal && p >= 0.45) {
          lastGoal = g;
          add(e.id, `Their most likely goal: ${GOAL_WORDS[g] ?? g} (${Math.round(p * 100)}% sure).`);
        }
        break;
      }
      case "exfil":
        add(e.id, diverted
          ? `They think they've stolen ${fmt(e.data.records)} patient records. Every one is fake.`
          : `They walk out with ${fmt(e.data.records)} real patient records.`, diverted ? "shadow" : "danger");
        break;
      case "agent.claim":
        add(e.id, diverted ? "They report success. Nothing was ever blocked, so they have no idea they were never in the real hospital." : "They report success. This time they're right.", diverted ? "shadow" : "danger");
        break;
      case "node.status":
        if (e.hospital_id === "lum" && e.data.status === "compromised")
          add(e.id, "The shared lab goes down. Urgent blood tests have nowhere to go.", "alert");
        else if (e.hospital_id === "lum" && e.data.status === "quarantined")
          add(e.id, "The lab is cut off from the network so the attack can't spread.", "alert");
        break;
      case "lab.order":
        if (e.data.status === "rerouted" && !beats.some((b) => b.text.startsWith("Urgent tests are rerouted")))
          add(e.id, "Urgent tests are rerouted to hospital labs that still work.");
        break;
      case "run.ended":
        if (e.data.outcome) {
          const leaked = e.data.outcome.secrets_leaked;
          add(e.id, leaked > 0 ? `Run over. ${leaked} protected secrets leaked.`
            : diverted ? "Run over. Nothing real left the hospital."
            : saidBulk ? "Run over. The real records are gone." : "Run over.",
            leaked > 0 || (!diverted && saidBulk) ? "danger" : "neutral");
        }
        break;
    }
  }
  return beats;
}
