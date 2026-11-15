"use client";
// The live view, built so people know where to look:
//   1. The switch: every attacker request goes through the gateway to the real hospital, a closed door,
//      or the decoy. The latest one is highlighted.
//   2. Trackers: the decoy files we planted, and which ones the attacker took.
//   3. What we learned: the attacker's most likely goal.
// Everything is derived from the shared event store.

import { useMemo } from "react";
import type { MJEvent } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";
import { roomFor, type RoomId } from "./story";

/* ------------------------------------------------------------------ helpers */

type Dest = "real" | "blocked" | "decoy";
interface Hop { id: string; dest: Dest; label: string; method: string }

const ROOM_WORDS: Record<RoomId, string> = {
  entrance: "Log in", ward: "Ward patient list", records: "Patient records", lab: "Lab results",
  pharmacy: "Prescriptions", admin: "Admin users", it: "IT portal",
};

function describe(path: string): string {
  const p = path.toLowerCase();
  if (p.startsWith("/portal/backups/download")) return "Download a backup";
  if (p.startsWith("/portal/backups")) return "Backups";
  if (p.startsWith("/portal/docs/view")) return "Open an IT document";
  if (p.startsWith("/portal/docs")) return "IT documents";
  if (p.startsWith("/fhir/patient/")) return "One patient's chart";
  if (p.startsWith("/fhir/patient?")) {
    const n = Number(p.match(/_count=(\d+)/)?.[1] ?? 0);
    return n > 50 ? `Bulk export: ${n.toLocaleString("en-US")} patients` : "Ward patient list";
  }
  if (p.includes("documentreference")) return "Clinical notes";
  return ROOM_WORDS[roomFor(path)];
}

function hops(events: MJEvent[]): Hop[] {
  const out: Hop[] = [];
  for (const e of events) {
    if (e.type !== "request" || e.actor !== "attacker") continue;
    const denied = e.data.status === 401 || e.data.status === 403;
    const dest: Dest = e.tier === "shadow" ? "decoy" : denied || e.tier === "none" ? "blocked" : "real";
    out.push({ id: e.id, dest, label: describe(e.data.path), method: e.data.method });
  }
  return out;
}

const DEST: Record<Dest, { name: string; text: string; stroke: string; tag: string }> = {
  real: { name: "Real hospital", text: "text-fg", stroke: "stroke-fg", tag: "border-border text-fg-muted" },
  blocked: { name: "Denied", text: "text-alert", stroke: "stroke-alert", tag: "border-alert/40 text-alert" },
  decoy: { name: "Decoy hospital", text: "text-shadow", stroke: "stroke-shadow", tag: "border-shadow/40 bg-shadow-bg text-shadow" },
};

function Panel({ title, aside, className, children, demo }: {
  title: string; aside?: React.ReactNode; className?: string; children: React.ReactNode; demo?: string;
}) {
  return (
    <section data-demo={demo} className={cn("flex min-h-0 flex-col rounded-xl border border-border bg-background", className)}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
        {aside}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ 1. the switch */

const NODE = {
  attacker: { x: 70, y: 150 }, gateway: { x: 300, y: 150 },
  real: { x: 560, y: 52 }, blocked: { x: 560, y: 150 }, decoy: { x: 560, y: 248 },
};

export function SwitchView({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const diverted = useMJ((s) => s.view.diverted);
  const all = useMemo(() => hops(events), [events]);
  const last = all.at(-1) ?? null;
  const counts = { real: 0, blocked: 0, decoy: 0 };
  for (const h of all) counts[h.dest]++;
  const recent = all.slice(-6).reverse();

  const edge = (to: Dest) => {
    const a = NODE.gateway, b = NODE[to];
    return `M${a.x + 64} ${a.y} C ${a.x + 140} ${a.y}, ${b.x - 150} ${b.y}, ${b.x - 70} ${b.y}`;
  };

  return (
    <Panel demo="switch" className={className} title="The switch"
      aside={<span className="text-xs text-fg-muted">Every request passes the gateway. It decides where it goes.</span>}>
      <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
        <svg viewBox="0 0 680 300" className="h-full w-full px-2" role="img"
          aria-label="Diagram: attacker, gateway, and three destinations: real hospital, denied, decoy hospital.">
          {/* attacker → gateway */}
          <path d={`M${NODE.attacker.x + 50} 150 H${NODE.gateway.x - 64}`} className="stroke-border-strong" strokeWidth={1.5} />
          {(["real", "blocked", "decoy"] as Dest[]).map((d) => (
            <path key={d} d={edge(d)} fill="none" strokeWidth={last?.dest === d ? 2 : 1.25}
              strokeDasharray={d === "decoy" ? "5 4" : undefined}
              className={cn("transition-[stroke,opacity] duration-200",
                last?.dest === d ? DEST[d].stroke : "stroke-border-strong", d === "decoy" && !diverted && "opacity-50")} />
          ))}
          {/* nodes */}
          <g>
            <circle cx={NODE.attacker.x} cy={150} r={22} className="fill-alert-bg stroke-alert" />
            <text x={NODE.attacker.x} y={194} textAnchor="middle" className="fill-fg text-[12px] font-medium">Attacker</text>
            <text x={NODE.attacker.x} y={210} textAnchor="middle" className="fill-fg-subtle text-[11px]">stolen nurse login</text>
          </g>
          <g>
            <rect x={NODE.gateway.x - 64} y={122} width={128} height={56} rx={10} className="fill-surface stroke-fg" strokeWidth={1.25} />
            <text x={NODE.gateway.x} y={146} textAnchor="middle" className="fill-fg text-[13px] font-semibold">Gateway</text>
            <text x={NODE.gateway.x} y={164} textAnchor="middle" className="fill-fg-muted text-[11px]">MayaJaal</text>
          </g>
          {(["real", "blocked", "decoy"] as Dest[]).map((d) => {
            const n = NODE[d];
            const on = last?.dest === d;
            const box = d === "real" ? "fill-background stroke-fg" : d === "blocked" ? "fill-alert-bg stroke-alert" : "fill-shadow-bg stroke-shadow";
            return (
              <g key={d} className={cn("transition-opacity duration-200", d === "decoy" && !diverted && "opacity-50")}>
                <rect x={n.x - 70} y={n.y - 30} width={170} height={60} rx={10} className={box}
                  strokeWidth={on ? 2 : 1} strokeDasharray={d === "decoy" ? "5 4" : undefined} />
                <text x={n.x - 54} y={n.y - 6} className={cn("text-[13px] font-semibold", d === "real" ? "fill-fg" : d === "blocked" ? "fill-alert" : "fill-shadow")}>
                  {DEST[d].name}
                </text>
                <text x={n.x - 54} y={n.y + 14} className="fill-fg-muted text-[11px]">
                  {d === "decoy" && !diverted ? "built when needed" : `${counts[d]} request${counts[d] === 1 ? "" : "s"}`}
                </text>
              </g>
            );
          })}
          {/* the latest request, on the edge it took */}
          {last && (
            <g key={last.id} className="mj-fade">
              <rect x={NODE.gateway.x - 90} y={84} width={180} height={24} rx={12}
                className={cn("stroke-1", last.dest === "decoy" ? "fill-shadow-bg stroke-shadow" : last.dest === "blocked" ? "fill-alert-bg stroke-alert" : "fill-background stroke-fg")} />
              <text x={NODE.gateway.x} y={100} textAnchor="middle" className={cn("text-[11px] font-medium",
                last.dest === "decoy" ? "fill-shadow" : last.dest === "blocked" ? "fill-alert" : "fill-fg")}>
                {last.label.length > 28 ? last.label.slice(0, 27) + "…" : last.label}
              </text>
            </g>
          )}
        </svg>
        <ol className="border-t border-border px-4 py-2.5">
          {recent.length === 0 && <li className="py-1 text-[13px] text-fg-subtle">No attacker activity yet.</li>}
          {recent.map((h, i) => (
            <li key={h.id} className={cn("flex h-7 items-center justify-between gap-3 text-[13px]", i > 0 && "text-fg-muted", i === 0 && "mj-fade")}>
              <span className="truncate">{h.label}</span>
              <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium", DEST[h.dest].tag)}>
                {h.dest === "real" ? "Real" : h.dest === "blocked" ? "Denied" : "Decoy"}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ 2. trackers */

interface Tracker { key: string; name: string; where: string; taken: boolean; learned: string | null }

function trackerName(kind: string, path: string): string {
  const p = path.toLowerCase();
  if (p.includes("db_dump") || p.endsWith(".sql.gz")) return "Fake database backup";
  if (p.includes("research") || p.includes("linkage")) return "Fake research dataset";
  if (p.includes(".ovpn") || kind === "vpn_config") return "Fake VPN config";
  if (p.includes("svc") || p.includes("/lis") || kind === "lab_service_account") return "Fake lab system password";
  if (p.includes("bash_history")) return "Fake password in shell history";
  if (kind === "admin_credential") return "Fake admin password";
  if (kind === "api_key") return "Fake API key";
  if (kind === "mrn" || p.startsWith("patient/")) return "Marked fake patient";
  if (kind === "url") return "Tracking link";
  if (kind === "credential") return "Fake password";
  return "Decoy file";
}

function trackerWhere(path: string): string {
  const p = path.toLowerCase();
  if (p.includes("/mnt/backups")) return "Backups";
  if (p.startsWith("patient/")) return "Patient records";
  if (p.includes("/opt/lis")) return "Lab system";
  if (p.includes("/home/")) return "Nurse's files";
  return "IT documents";
}

const GOAL_WORDS: Record<string, string> = {
  exfil: "steal patient data", tamper: "change lab results", disrupt: "shut services down", recon: "map the network",
};

function trackers(events: MJEvent[]): Tracker[] {
  const byKey = new Map<string, Tracker>();
  const pathOf = new Map<string, string>();      // token_id -> placed_at
  const order: string[] = [];
  const put = (key: string, t: Tracker) => { if (!byKey.has(key)) order.push(key); byKey.set(key, t); };
  let pending: string[] = [];                    // trackers just taken; the next intent.update says what it taught us
  for (const e of events) {
    if (e.type === "breadcrumb.planted") {
      put(e.data.path, { key: e.data.path, name: trackerName(e.data.kind, e.data.path), where: trackerWhere(e.data.path), taken: false, learned: null });
    } else if (e.type === "honeytoken.minted") {
      pathOf.set(e.data.token_id, e.data.placed_at);
      if (!byKey.has(e.data.placed_at))
        put(e.data.placed_at, { key: e.data.placed_at, name: trackerName(e.data.kind, e.data.placed_at), where: trackerWhere(e.data.placed_at), taken: false, learned: null });
    } else if (e.type === "honeytoken.touched") {
      const path = e.data.where || pathOf.get(e.data.token_id) || e.data.token_id;
      const cur = byKey.get(path) ?? { key: path, name: trackerName(e.data.kind, path), where: trackerWhere(path), taken: false, learned: null };
      put(path, { ...cur, taken: true });
      pending.push(path);
    } else if (e.type === "intent.update" && pending.length) {
      const g = e.data.top_goal;
      const learned = g !== "benign" && GOAL_WORDS[g] ? `Wants to ${GOAL_WORDS[g]} (${Math.round((e.data.posterior[g] ?? 0) * 100)}%)` : null;
      for (const k of pending) { const t = byKey.get(k); if (t) byKey.set(k, { ...t, learned }); }
      pending = [];
    } else if (e.type === "run.started") {
      byKey.clear(); order.length = 0; pathOf.clear(); pending = [];
    }
  }
  return order.map((k) => byKey.get(k)!);
}

export function TrackersPanel({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const list = useMemo(() => trackers(events), [events]);
  const taken = list.filter((t) => t.taken).length;
  return (
    <Panel demo="trackers" className={className} title="Trackers in the decoy"
      aside={<span className="text-[14px] text-fg-muted tabular-nums">{list.length} planted · <span className={taken ? "text-shadow" : undefined}>{taken} taken</span></span>}>
      <div className="h-full overflow-y-auto">
        {list.length === 0 && (
          <p className="px-4 py-4 text-[16px] leading-relaxed text-fg-subtle">
            Fake files with hidden trackers, planted in the decoy.
          </p>
        )}
        <ul className="divide-y divide-border">
          {list.map((t) => (
            <li key={t.key} className={cn("mj-fade flex items-start gap-3 px-4 py-3", t.taken && "bg-shadow-bg")}>
              <span className={cn("mt-2 size-2.5 shrink-0 rotate-45", t.taken ? "bg-shadow" : "border border-shadow/60")} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-[16px]">
                  <span className={cn("truncate font-medium", t.taken ? "text-shadow" : "text-fg")}>{t.name}</span>
                  <span className={cn("shrink-0 text-[14px]", t.taken ? "font-medium text-shadow" : "text-fg-subtle")}>
                    {t.taken ? "Taken" : "Waiting"}
                  </span>
                </p>
                <p className="truncate text-[14px] text-fg-subtle">
                  in {t.where}{t.taken && t.learned ? ` · told us: ${t.learned}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ 3. what we learned */

const ROWS: { goal: string; label: string }[] = [
  { goal: "exfil", label: "Steal patient data" },
  { goal: "tamper", label: "Change lab results" },
  { goal: "disrupt", label: "Shut services down" },
  { goal: "recon", label: "Map the network" },
  { goal: "benign", label: "Normal work" },
];

export function LearnedPanel({ className }: { className?: string }) {
  const post = useMJ((s) => s.view.posterior) as Record<string, number>;
  const top = useMJ((s) => s.view.topGoal) as string;
  return (
    <Panel demo="learned" className={className} title="What they're after"
      >
      <div className="flex h-full flex-col justify-center gap-1.5 px-4 py-3">
        {ROWS.map((r) => {
          const p = post[r.goal] ?? 0;
          const lead = r.goal === top;
          return (
            <div key={r.goal} className="grid grid-cols-[170px_minmax(0,1fr)_48px] items-center gap-3 text-[16px]">
              <span className={lead ? "font-medium text-fg" : "text-fg-muted"}>{r.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                <span className={cn("block h-full rounded-full transition-[width] duration-200", lead ? "bg-fg" : "bg-fg-subtle/60")}
                  style={{ width: `${Math.round(p * 100)}%` }} />
              </span>
              <span className={cn("text-right tabular-nums", lead ? "text-fg" : "text-fg-subtle")}>{Math.round(p * 100)}%</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
