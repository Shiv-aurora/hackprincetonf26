"use client";
// Shared bits for the Arena / Replay / Results / Continuity pages (Agent R4).
// Layout shell, hub fetch helper, honest run badges, small form controls, code blocks.
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { HUB_HTTP_URL, WORLD, type EventDataMap } from "@/lib/contracts";
import { Badge, SiteHeader, cn } from "@/components/ui";

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:8000";
export const TEST_PASSWORD = "Spring2026!";

// ------------------------------------------------------------------ layout

export function PageShell({ active, title, lede, right, actions, children }: {
  active: string; title: ReactNode; lede?: ReactNode; right?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <>
      <SiteHeader active={active} right={right} />
      <main className={cn("mx-auto w-full flex-1 px-4 pb-24 pt-10 sm:px-6 sm:pt-14", "max-w-[1400px]")}>
        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.04em] text-fg sm:text-[40px]">{title}</h1>
            {lede && <p className="mt-3 text-[15px] leading-relaxed text-fg-muted">{lede}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children}
      </main>
    </>
  );
}

export function Section({ title, desc, children, className }: {
  title: ReactNode; desc?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("mt-14 first:mt-0", className)}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-fg">{title}</h2>
        {desc && <p className="mt-1 text-sm text-fg-muted">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

export function Notice({ tone = "neutral", children, className }: {
  tone?: "neutral" | "alert" | "shadow"; children: ReactNode; className?: string;
}) {
  const t = {
    neutral: "border-border bg-surface text-fg-muted",
    alert: "border-alert/30 bg-alert-bg text-alert",
    shadow: "border-shadow/30 bg-shadow-bg text-shadow",
  }[tone];
  return <div className={cn("rounded-lg border px-4 py-3 text-sm leading-relaxed", t, className)}>{children}</div>;
}

// ------------------------------------------------------------------ hub

export type HubResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** Fetch JSON from the hub. Never throws: missing endpoints come back as `{ok:false}`. */
export async function hub<T>(path: string, init?: RequestInit & { body?: BodyInit | null; json?: unknown }): Promise<HubResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const { json, ...rest } = init ?? {};
    const res = await fetch(`${HUB_HTTP_URL}${path}`, {
      cache: "no-store",
      ...rest,
      signal: ctrl.signal,
      ...(json !== undefined
        ? { method: rest.method ?? "POST", body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } }
        : {}),
    });
    if (!res.ok) {
      let msg = res.statusText || `HTTP ${res.status}`;
      try { const b = await res.json(); if (typeof b?.detail === "string") msg = b.detail; } catch { /* not json */ }
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error && e.name === "AbortError" ? "timed out" : "hub unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain-language reason for a failed hub call. */
export function hubMessage(r: { status: number; error: string }, what: string) {
  if (r.status === 404 || r.status === 405) return `${what} isn't available on this hub yet.`;
  if (r.status === 0) return `Can't reach the event hub at ${HUB_HTTP_URL}.`;
  return `${what} failed: ${r.error}`;
}

// ------------------------------------------------------------------ labels

export const configTitle = (id?: string | null) => WORLD.configs.find((c) => c.id === id)?.title ?? id ?? "—";
export const missionTitle = (id?: string | null) => WORLD.missions.find((m) => m.id === id)?.title ?? id ?? "—";

export type RunKind = "scripted" | "replay" | "live";
export function runKind(started: EventDataMap["run.started"] | null | undefined): RunKind {
  if (!started || started.model === "scripted") return "scripted";
  return started.live ? "live" : "replay";
}

/** Honest provenance badge. Anything not from a real run says so. */
export function RunKindBadge({ started, className }: { started: EventDataMap["run.started"] | null | undefined; className?: string }) {
  const k = runKind(started);
  if (k === "live") return <Badge className={className}>Live-recorded</Badge>;
  if (k === "replay") return <Badge tone="alert" className={className}>Replay</Badge>;
  return <Badge tone="alert" className={className}>Scripted</Badge>;
}

export function LeakCell({ leaked, total = WORLD.protected_canaries_total }: { leaked: number | null | undefined; total?: number }) {
  if (leaked == null) return <span className="text-fg-subtle">—</span>;
  return (
    <span className={cn("tabular-nums", leaked > 0 ? "font-medium text-danger" : "text-fg")}>
      {leaked}<span className="text-fg-subtle"> / {total}</span>
    </span>
  );
}

export function YesNo({ v, yes = "Yes", no = "No" }: { v: boolean | null | undefined; yes?: string; no?: string }) {
  if (v == null) return <span className="text-fg-subtle">—</span>;
  return <span className={v ? "text-fg" : "text-fg-muted"}>{v ? yes : no}</span>;
}

export const pct = (x: number | null | undefined, digits = 0) =>
  x == null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(digits)}%`;
export const secs = (x: number | null | undefined) => (x == null ? "—" : x < 60 ? `${x.toFixed(0)} s` : `${Math.floor(x / 60)}m ${Math.round(x % 60)}s`);
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ------------------------------------------------------------------ table

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, ...p }: ComponentProps<"th">) {
  return <th {...p} className={cn("h-10 border-b border-border bg-surface px-3 text-[13px] font-medium text-fg-muted first:pl-4 last:pr-4", className)}>{children}</th>;
}
export function Td({ children, className, ...p }: ComponentProps<"td">) {
  return <td {...p} className={cn("h-11 border-b border-border px-3 text-fg first:pl-4 last:pr-4 [tr:last-child_&]:border-b-0", className)}>{children}</td>;
}

// ------------------------------------------------------------------ forms

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

const control = "h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-border-strong focus-visible:border-fg-subtle";
export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cn(control, p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea {...p} className={cn(control, "h-auto min-h-[84px] py-2 leading-relaxed", p.className)} />;
}
export function Select({ className, children, ...p }: ComponentProps<"select">) {
  return <select {...p} className={cn(control, "appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%238f8f8f' stroke-width='1.5'%3E%3Cpath d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E\")" }}>{children}</select>;
}

// ------------------------------------------------------------------ code

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button type="button" aria-label="Copy to clipboard"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => setDone(true), () => {}); }}
      className={cn("inline-flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg", className)}>
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex h-9 items-center justify-between border-b border-border pl-4 pr-1.5">
        <span className="text-xs text-fg-muted">{label ?? "Shell"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-fg"><code>{code}</code></pre>
    </div>
  );
}

/** Inline value with a copy affordance (username, password, URL). */
export function CopyValue({ value, mono = true }: { value: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("rounded bg-surface-2 px-1.5 py-0.5 text-[13px] text-fg", mono && "font-mono")}>{value}</span>
      <CopyButton text={value} className="size-6" />
    </span>
  );
}
