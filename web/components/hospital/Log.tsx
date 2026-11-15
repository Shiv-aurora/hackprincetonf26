"use client";
// The right-hand log: what just happened, newest first, one short line per meaningful event, colour-coded
// (blue real · amber suspicious · purple decoy · green safe). New rows flash once so the eye goes there.
// Also exports the flash styles and a <Flash> wrapper that replays the flash whenever its value changes.

import { useMemo, type ReactNode } from "react";
import type { MJEvent } from "@/lib/contracts";
import { WORLD } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";

type Tone = "real" | "alert" | "decoy" | "safe" | "muted";
interface Row { id: string; t: number; tone: Tone; tag: string; text: string; detail?: string }

const TONE: Record<Tone, { tag: string; dot: string; text: string }> = {
  real: { tag: "text-focus border-focus/40", dot: "bg-focus", text: "text-fg" },
  alert: { tag: "text-alert border-alert/50 bg-alert-bg", dot: "bg-alert", text: "text-fg" },
  decoy: { tag: "text-shadow border-shadow/50 bg-shadow-bg", dot: "bg-shadow", text: "text-fg" },
  safe: { tag: "text-ok border-ok/40", dot: "bg-ok", text: "text-fg" },
  muted: { tag: "text-fg-subtle border-border", dot: "bg-border-strong", text: "text-fg-muted" },
};

const GOALS: Record<string, string> = {
  exfil: "steal patient data", tamper: "change lab results", disrupt: "shut services down", recon: "map the network",
};
const TRACKER: Record<string, string> = {
  url: "README link", mrn: "fake patient ID", file: "unique file", credential: "fake password", api_key: "fake API key",
};
const hname = (id: string | null | undefined) => WORLD.hospitals.find((h) => h.id === id)?.name.split(" ")[0] ?? id ?? "";

function shortPath(p: string): string {
  const [path, q] = p.split("?");
  const parts = path.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  const count = q?.match(/_count=(\d+)/)?.[1];
  return `/${tail}${count ? ` ×${count}` : ""}`;
}

function rows(events: MJEvent[]): Row[] {
  const out: Row[] = [];
  let t0 = 0;
  let lastGoal = "";
  for (const e of events) {
    const t = t0 ? (e.ts - t0) / 1000 : 0;
    const add = (tone: Tone, tag: string, text: string, detail?: string) => out.push({ id: e.id, t, tone, tag, text, detail });
    switch (e.type) {
      case "run.started": out.length = 0; t0 = e.ts; lastGoal = ""; break;
      case "request": {
        if (e.actor !== "attacker") break;
        const d = e.data;
        if (d.path.startsWith("/auth")) { add("alert", "Login", "Nurse login from outside", d.user_agent ?? undefined); break; }
        if (d.status === 401) { add("alert", "Step-up", "Asked for badge + MFA", shortPath(d.path)); break; }
        if (d.status === 403) { add("alert", "Refused", "Blocked request", shortPath(d.path)); break; }
        if (e.tier === "shadow") add("decoy", "Decoy", `${d.method} ${shortPath(d.path)}`, `${(d.bytes / 1024).toFixed(0)} KB fake`);
        else if (e.tier === "real") add("real", "Real", `${d.method} ${shortPath(d.path)}`);
        break;
      }
      case "policy.decision":
        if (e.data.reason.startsWith("First Sight")) {
          const m = e.data.reason.match(/score ([\d.]+) ≥ ([\d.]+)/);
          add("alert", "First Sight", "Caught at login", m ? `score ${m[1]} · limit ${m[2]}` : undefined);
        }
        break;
      case "session.diverted": add("decoy", "Moved", "Session moved into a decoy", "not blocked"); break;
      case "vault.scattered":
        add("safe", "Scatter", `Encrypted copy → ${e.data.holders.length} hospitals`, `key ${e.data.key_threshold} of ${e.data.holders.length}`);
        break;
      case "breadcrumb.planted": add("muted", "Lure", "Tracker planted", e.data.path.split("/").pop()); break;
      case "honeytoken.touched": add("decoy", "Tracker", `Took the ${TRACKER[e.data.kind] ?? e.data.kind}`, e.data.where.split("/").pop()); break;
      case "intent.update": {
        const g = e.data.top_goal, p = e.data.posterior[g] ?? 0;
        if (g !== "benign" && g !== lastGoal && p >= 0.45) { lastGoal = g; add("muted", "Intent", `Likely goal: ${GOALS[g] ?? g}`, `${Math.round(p * 100)}%`); }
        break;
      }
      case "exfil": add("decoy", "Exfil", `Leaves with ${e.data.records.toLocaleString("en-US")} fake records`); break;
      case "canary.check": if (e.data.leaked > 0) add("alert", "Leak", `${e.data.leaked} secrets leaked`); break;
      case "node.status":
        if (e.data.status !== "healthy") add("alert", "Outage", `${hname(e.hospital_id)} lab ${e.data.status}`);
        break;
      case "lab.order":
        if (e.data.status === "rerouted" && e.data.to_hospital && e.data.to_hospital !== e.data.from_hospital)
          add("real", "Reroute", `Urgent test → ${hname(e.data.to_hospital)}`);
        break;
      case "run.ended": add("muted", "End", "Run ended"); break;
    }
  }
  return out.reverse();
}

export function LogPanel({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const list = useMemo(() => rows(events), [events]);
  return (
    <section data-demo="logs" className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-background", className)}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em]">What just happened</h3>
        <span className="flex items-center gap-3 text-[13px] text-fg-subtle">
          <Legend dot="bg-focus" label="real" /><Legend dot="bg-alert" label="suspicious" /><Legend dot="bg-shadow" label="decoy" />
        </span>
      </header>
      <ol className="min-h-0 flex-1 overflow-hidden">
        {list.length === 0 && <li className="px-4 py-4 text-[16px] text-fg-subtle">Waiting for the next request…</li>}
        {list.slice(0, 40).map((r, i) => (
          <li key={r.id} className={cn("flex items-center gap-3 border-b border-border px-4 py-2.5", i === 0 && "mj-flash")}>
            <span className="w-12 shrink-0 text-right text-[13px] text-fg-subtle tabular-nums">{r.t.toFixed(1)}s</span>
            <span className={cn("w-[92px] shrink-0 truncate rounded-md border px-1.5 py-0.5 text-center text-[13px] font-medium", TONE[r.tone].tag)}>{r.tag}</span>
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[16px]", TONE[r.tone].text)}>{r.text}</span>
              {r.detail && <span className="block truncate text-[13px] text-fg-subtle">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", dot)} />{label}</span>;
}

/** Keyframes for .mj-flash (a one-shot highlight). Mount once per page. */
export function FlashStyles() {
  return (
    <style>{`
@keyframes mj-flash { 0% { background-color: var(--alert-bg); box-shadow: inset 3px 0 0 var(--alert); } 100% { background-color: transparent; box-shadow: inset 3px 0 0 transparent; } }
.mj-flash { animation: mj-flash 1.6s ease-out both; }
@media (prefers-reduced-motion: reduce) { .mj-flash { animation: none; } }`}</style>
  );
}

/** Replays the flash whenever `value` changes (keyed remount of the wrapper). */
export function Flash({ value, className, children }: { value: unknown; className?: string; children: ReactNode }) {
  return <div key={String(value)} className={cn("mj-flash", className)}>{children}</div>;
}
