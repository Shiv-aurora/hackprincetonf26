"use client";
// "Who is this?" The attacker's fingerprint, built only from what their own requests told our gateway
// (address, client software, timing, the stolen login, techniques) and from the trackers they set off.
// Nothing runs on the attacker's machine.

import { useMemo, type ReactNode } from "react";
import type { MJEvent } from "@/lib/contracts";
import { WORLD } from "@/lib/contracts";
import { useMJ } from "@/lib/events";
import { cn } from "@/components/ui";
import { Flash } from "./Log";
import { hospitalName } from "@/components/consoles";

const TECHNIQUES: Record<string, string> = {
  T1078: "Valid accounts", T1087: "Account discovery", "T1087.002": "Domain account discovery",
  T1083: "File discovery", T1119: "Automated collection", T1005: "Data from local system",
  T1213: "Data from repositories", T1110: "Password guessing", T1552: "Credentials in files",
  "T1552.001": "Credentials in files", T1565: "Data manipulation", T1046: "Network discovery",
};

function tool(ua: string | null | undefined): string {
  if (!ua) return "Unknown";
  const u = ua.toLowerCase();
  const v = (re: RegExp) => ua.match(re)?.[1];
  if (u.includes("python-httpx")) return `Python script (httpx ${v(/python-httpx\/([\d.]+)/i) ?? ""})`.replace(" )", ")");
  if (u.includes("python-requests")) return "Python script (requests)";
  if (u.startsWith("curl/")) return `curl ${v(/curl\/([\d.]+)/i) ?? ""}`.trim();
  if (u.includes("go-http-client")) return "Go program";
  if (u.includes("node") || u.includes("undici") || u.includes("axios")) return "Node.js program";
  if (u.includes("firefox/")) return "Firefox browser";
  if (u.includes("edg/")) return "Edge browser";
  if (u.includes("chrome/")) return "Chrome browser";
  if (u.includes("safari/")) return "Safari browser";
  return ua.slice(0, 40);
}

function isLoopback(ip: string) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

interface Fp {
  ips: string[]; ua: string | null; requests: number; first: number; last: number;
  cv: number | null; meanGap: number | null; techniques: string[]; trackers: number; decoy: string | null;
  login: boolean;
}

function fingerprint(events: MJEvent[]): Fp | null {
  const reqs = events.filter((e): e is Extract<MJEvent, { type: "request" }> => e.type === "request" && e.actor === "attacker");
  if (!reqs.length) return null;
  const ips = [...new Set(reqs.map((r) => r.data.client_ip).filter((x): x is string => !!x))];
  const ua = reqs.map((r) => r.data.user_agent).find((x) => !!x) ?? null;
  const ts = reqs.map((r) => r.ts);
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 1000).filter((g) => g >= 0);
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const sd = gaps.length > 1 && mean ? Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) : null;
  const techniques = [...new Set(reqs.map((r) => r.data.technique).filter((t): t is string => !!t))];
  const decoy = reqs.find((r) => r.tier === "shadow")?.session_id ?? null;
  return {
    ips, ua, requests: reqs.length, first: ts[0], last: ts[ts.length - 1],
    cv: mean && sd !== null ? sd / mean : null, meanGap: mean, techniques,
    // counted per decoy file, like the trackers panel (one file can carry more than one token)
    trackers: new Set(events.flatMap((e) => (e.type === "honeytoken.touched" ? [e.data.where || e.data.token_id] : []))).size, decoy,
    login: reqs.some((r) => r.data.path === "/auth/login" && r.data.status === 200),
  };
}

function Cell({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 bg-background px-4 py-3">
      <p className="text-[14px] text-fg-muted">{label}</p>
      <Flash value={typeof value === "string" ? value : label} className="-mx-1.5 mt-0.5 rounded px-1.5">
        <p className={cn("truncate text-[19px] font-semibold tracking-[-0.015em] tabular-nums", tone)}>{value}</p>
      </Flash>
      {sub && <p className="truncate text-[13px] text-fg-subtle">{sub}</p>}
    </div>
  );
}

export function FingerprintPanel({ className }: { className?: string }) {
  const events = useMJ((s) => s.events);
  const fp = useMemo(() => fingerprint(events), [events]);
  const ep = WORLD.entry_point;

  const timing = !fp || fp.cv === null || fp.requests < 5 ? { v: "—", s: "needs a few requests" }
    : fp.cv < 0.35 ? { v: "Machine-regular", s: `every ${fp.meanGap!.toFixed(1)} s, little variation: likely automated` }
    : { v: "Irregular", s: `about every ${fp.meanGap!.toFixed(1)} s: human-like pauses` };

  return (
    <section data-demo="fingerprint" className={cn("rounded-xl border border-border bg-background", className)}>
      <header className="flex h-12 items-center justify-between gap-3 border-b border-border px-4">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em]">Who is this?</h3>
        <span className="hidden truncate text-[14px] text-fg-subtle sm:block">From their own requests only</span>
      </header>
      {!fp ? (
        <p className="px-4 py-4 text-[16px] text-fg-subtle">No attacker activity yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-border sm:grid-cols-3 xl:grid-cols-6">
          <Cell label="Seen from" value={fp.ips.length ? fp.ips.join(", ") : "Unknown"}
            sub={fp.ips.length && fp.ips.every(isLoopback) ? "this laptop: the demo runs locally" : `${fp.ips.length} address${fp.ips.length === 1 ? "" : "es"}`} />
          <Cell label="Using" value={tool(fp.ua)} sub={fp.ua ?? undefined} />
          <Cell label="Stolen login" value={fp.login ? ep.username : "—"}
            sub={fp.login ? `${ep.role} at ${hospitalName(ep.hospital_id)}` : undefined} tone={fp.login ? "text-alert" : undefined} />
          <Cell label="Timing" value={timing.v} sub={timing.s} />
          <Cell label="Techniques" value={`${fp.techniques.length} seen`}
            sub={fp.techniques.map((t) => TECHNIQUES[t] ?? t).join(" · ") || undefined} />
          <Cell label="Traceable decoy" value={fp.decoy ? `Session ${fp.decoy}` : "Not diverted"}
            sub={fp.decoy ? `${fp.trackers} tracker${fp.trackers === 1 ? "" : "s"} taken · every fake record is unique to them` : "nothing fake to trace"}
            tone={fp.decoy ? "text-shadow" : undefined} />
        </div>
      )}
    </section>
  );
}
