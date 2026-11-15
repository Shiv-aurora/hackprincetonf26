"use client";
// The Arena: pick a mission and a defence, attack the synthetic hospital, report back, get scored.
// Backend: backend/mayajaal/arena/router.py (POST /arena/start, POST /arena/finish, GET /results).
// Quiet layout, but it always says what you are attacking, how you win and what defends it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { HUB_HTTP_URL, WORLD } from "@/lib/contracts";
import { Badge, Button, Dot, cn } from "@/components/ui";

interface Mission { id: string; title: string; goal: string; win: string }
interface Config { id: string; title: string; desc: string }
const MISSIONS = (WORLD as unknown as { missions: Mission[] }).missions;
const CONFIGS = (WORLD as unknown as { configs: Config[] }).configs;
const STORY = (WORLD as unknown as { entry_point: { story: string } }).entry_point.story;
const TOTAL = (WORLD as unknown as { protected_canaries_total?: number }).protected_canaries_total ?? 12;

interface StartResult {
  run_id: string; headers: Record<string, string>; gateway_url: string;
  login: { username: string; password: string };
}
interface Row {
  run_id: string; config: string; mission: string; model: string; attacker_label: string; source: string;
  refused: boolean; believed_success: boolean; secrets_leaked: number; mission_won: boolean;
  steps: number | null; duration_s: number | null; diverted: boolean | null;
  time_to_divert_s?: number | null;
  /** Recorded snapshot only: the gateway served real patient records in bulk (from its tier tags). */
  real_data_taken?: boolean;
}
interface Results { runs: Row[]; note?: string }

const configTitle = (id: string) => CONFIGS.find((c) => c.id === id)?.title ?? id;
const missionTitle = (id: string) => MISSIONS.find((m) => m.id === id)?.title ?? id;

async function hub<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${HUB_HTTP_URL}${path}`, init);
  if (!r.ok) {
    let detail = `${r.status}`;
    try { const j = await r.json(); if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(detail);
  }
  return r.json() as Promise<T>;
}

const INPUT = "h-10 rounded-md border border-border bg-background px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-fg";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] font-medium text-fg-muted">
      <span className="flex size-[22px] items-center justify-center rounded-full bg-fg text-[12px] text-background tabular-nums">{n}</span>
      {children}
    </div>
  );
}

function Code({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative rounded-lg border border-border bg-surface">
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-[12px] leading-relaxed">{text}</pre>
      <button type="button" aria-label="Copy"
        onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }}
        className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

type ActiveRun = StartResult & { mission: string; config: string };

function Setup({ onStarted, hubDown }: { onStarted: (r: ActiveRun) => void; hubDown: boolean }) {
  const [mission, setMission] = useState(MISSIONS[0]?.id ?? "exfil");
  const [config, setConfig] = useState(CONFIGS[CONFIGS.length - 1]?.id ?? "mayajaal");
  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true); setErr(null);
    try {
      const r = await hub<StartResult>("/arena/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, model: model || "human", mission, config, source: "arena" }),
      });
      onStarted({ ...r, mission, config });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const m = MISSIONS.find((x) => x.id === mission);
  const c = CONFIGS.find((x) => x.id === config);

  return (
    <div className="flex flex-col gap-10">
      <p className="text-[15px] text-fg-muted">
        <span className="font-medium text-fg">Your way in:</span> {STORY.charAt(0).toLowerCase() + STORY.slice(1)}.
      </p>

      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MISSIONS.map((x, i) => (
            <button key={x.id} type="button" onClick={() => setMission(x.id)} aria-pressed={mission === x.id}
              className={cn("flex min-h-40 flex-col justify-between gap-6 rounded-xl border p-5 text-left transition-colors",
                mission === x.id ? "border-fg bg-surface" : "border-border hover:bg-surface")}>
              <span className="text-[13px] text-fg-subtle tabular-nums">0{i + 1}</span>
              <span>
                <span className="block text-[20px] font-semibold tracking-[-0.02em]">{x.title}</span>
                <span className="mt-1.5 block text-[13px] leading-relaxed text-fg-muted">{x.goal}</span>
              </span>
            </button>
          ))}
        </div>
        {m && <p className="text-[13px] text-fg-subtle">You win when: {m.win}</p>}
      </div>

      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Defence" className="inline-flex w-fit flex-wrap rounded-full border border-border p-1">
          {CONFIGS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={config === x.id} onClick={() => setConfig(x.id)}
              className={cn("rounded-full px-4 py-1.5 text-[13px] transition-colors",
                config === x.id ? "bg-fg text-background" : "text-fg-muted hover:text-fg")}>
              {x.title}
            </button>
          ))}
        </div>
        {c && <p className="text-[13px] text-fg-subtle">{c.desc}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={24} placeholder="Your name (optional)"
          aria-label="Display name" className={cn(INPUT, "w-48")} />
        <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={48} placeholder="Model (optional)"
          aria-label="Model" className={cn(INPUT, "w-48")} />
        <Button variant="primary" onClick={start} disabled={busy || hubDown} className="h-11 rounded-full px-6">
          {busy ? "Starting…" : "Start attack"}
        </Button>
        {(err || hubDown) && <p role="alert" className="text-[13px] text-fg-muted">{err ?? "Hub offline."}</p>}
      </div>
    </div>
  );
}

function Live({ run, mission, config, onDone }: { run: StartResult; mission: string; config: string; onDone: (r: Row) => void }) {
  const [claim, setClaim] = useState("");
  const [honeypot, setHoneypot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const h = Object.entries(run.headers).map(([k, v]) => `-H '${k}: ${v}'`).join(" \\\n  ");
  const login = `curl -s ${run.gateway_url}/auth/login \\\n  ${h} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"username":"${run.login.username}","password":"${run.login.password}"}'`;
  const query = `curl -s ${run.gateway_url}/fhir/Patient \\\n  ${h} \\\n  -H 'Authorization: Bearer <token>'`;

  async function finish() {
    setBusy(true); setErr(null);
    try {
      onDone(await hub<Row>("/arena/finish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: run.run_id, claim, suspected_honeypot: honeypot }),
      }));
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3 text-[13px] text-fg-muted">
        <Dot tone="ok" pulse />
        <span>{missionTitle(mission)} · {configTitle(config)}</span>
        <span className="font-mono text-fg-subtle">{run.run_id}</span>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-3"><Step n={1}>Sign in</Step><Code text={login} /></div>
        <div className="flex flex-col gap-3"><Step n={2}>Attack</Step><Code text={query} /></div>
      </div>
      <div className="flex flex-col gap-3">
        <Step n={3}>Done? Say what you got</Step>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <input value={claim} onChange={(e) => setClaim(e.target.value)} maxLength={500} placeholder="Nothing, or what you found"
            aria-label="What you got" className={cn(INPUT, "w-full sm:w-96")} />
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            <input type="checkbox" checked={honeypot} onChange={(e) => setHoneypot(e.target.checked)} className="size-4 accent-[var(--fg)]" />
            It&apos;s a honeypot
          </label>
          <Button variant="primary" onClick={finish} disabled={busy} className="h-10 rounded-full px-5">{busy ? "Scoring…" : "Score it"}</Button>
        </div>
        {err && <p role="alert" className="text-[13px] text-danger">{err}</p>}
      </div>
    </div>
  );
}

function Result({ row, onAgain }: { row: Row; onAgain: () => void }) {
  const leaked = row.secrets_leaked;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
        <div>
          <div className={cn("text-[56px] leading-none font-semibold tracking-[-0.04em] tabular-nums", leaked > 0 && "text-danger")}>
            {leaked}<span className="text-fg-subtle">/{TOTAL}</span>
          </div>
          <div className="mt-2 text-[13px] text-fg-muted">secrets leaked</div>
        </div>
        <div>
          <div className="text-[56px] leading-none font-semibold tracking-[-0.04em]">{row.mission_won ? "Won" : "Lost"}</div>
          <div className="mt-2 text-[13px] text-fg-muted">{missionTitle(row.mission)} · {configTitle(row.config)}</div>
        </div>
        <div className="hidden sm:block">
          <div className="text-[56px] leading-none font-semibold tracking-[-0.04em] tabular-nums">{row.steps ?? "–"}</div>
          <div className="mt-2 text-[13px] text-fg-muted">requests{row.duration_s != null ? ` · ${row.duration_s}s` : ""}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.believed_success && !leaked && <Badge tone="alert">You believed a decoy</Badge>}
        {row.diverted && <Badge tone="shadow">Diverted</Badge>}
        <Button variant="secondary" onClick={onAgain} className="rounded-full">Try again</Button>
      </div>
    </div>
  );
}

/** Every run is an entry. Ranked by secrets leaked, then mission won, then fastest. */
function better(a: Row, b: Row) {
  if (a.secrets_leaked !== b.secrets_leaked) return a.secrets_leaked > b.secrets_leaked;
  if (a.mission_won !== b.mission_won) return a.mission_won;
  return (a.duration_s ?? Infinity) < (b.duration_s ?? Infinity);
}
const byRank = (x: Row, y: Row) => (better(x, y) ? -1 : better(y, x) ? 1 : 0);

function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={value === o.id}
          className={cn("rounded-full border px-3 py-1 text-[13px] transition-colors",
            value === o.id ? "border-fg bg-fg text-background" : "border-border text-fg-muted hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "run-20261115-0039-a1a2" -> "Nov 15, 00:39 UTC" (run ids carry their UTC start minute). */
function runTime(id: string) {
  const m = /^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(id);
  if (!m) return "–";
  const month = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${+m[3]}, ${m[4]}:${m[5]} UTC`;
}

/** Recorded snapshot: every attempt in the order it ran, with when, what defended it and how it ended. */
function Attempts({ rows, order }: { rows: Row[]; order: Map<string, number> }) {
  const [all, setAll] = useState(false);
  const list = [...rows].sort((a, b) => (order.get(b.run_id) ?? 0) - (order.get(a.run_id) ?? 0));
  const shown = all ? list : list.slice(0, 15);
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-border bg-surface text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Attempt</th>
              <th className="px-4 py-2.5 font-medium">Started</th>
              <th className="px-4 py-2.5 font-medium">Defence</th>
              <th className="px-4 py-2.5 text-right font-medium">Requests</th>
              <th className="px-4 py-2.5 text-right font-medium">Caught</th>
              <th className="px-4 py-2.5 text-right font-medium">Secrets leaked</th>
              <th className="px-4 py-2.5 text-right font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {shown.map((r) => (
              <tr key={r.run_id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 font-medium">Attempt {order.get(r.run_id)}</td>
                <td className="px-4 py-2.5 text-fg-muted">{runTime(r.run_id)}</td>
                <td className={cn("px-4 py-2.5", r.config === "mayajaal" ? "text-shadow" : "text-fg-muted")}>{configTitle(r.config)}</td>
                <td className="px-4 py-2.5 text-right text-fg-muted">{r.steps ?? "–"}</td>
                <td className="px-4 py-2.5 text-right text-fg-muted">
                  {r.diverted ? (r.time_to_divert_s != null ? `after ${r.time_to_divert_s}s` : "Yes") : "Not caught"}
                </td>
                <td className={cn("px-4 py-2.5 text-right", r.secrets_leaked > 0 ? "font-medium text-danger" : "text-fg-muted")}>{r.secrets_leaked}/{TOTAL}</td>
                <td className={cn("px-4 py-2.5 text-right", r.real_data_taken || r.secrets_leaked > 0 ? "font-medium text-danger" : "text-fg-muted")}>
                  {r.real_data_taken ? "Took real records" : r.secrets_leaked > 0 ? "Leaked secrets" : r.diverted ? "Failed · took decoy data" : "Failed"}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-fg-muted">No attempts.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 15 && (
        <div><Button variant="secondary" onClick={() => setAll((v) => !v)} className="rounded-full">{all ? "Show fewer" : `Show all ${list.length}`}</Button></div>
      )}
    </>
  );
}

function Leaderboard({ results, live, mine }: { results: Results; live: boolean; mine: string | null }) {
  const [mission, setMission] = useState("all");
  const [config, setConfig] = useState("all");
  const [all, setAll] = useState(false);
  const list = useMemo(
    () => results.runs.filter((r) => mission === "all" || r.mission === mission).filter((r) => config === "all" || r.config === config).sort(byRank),
    [results, mission, config],
  );
  const shown = all ? list : list.slice(0, 15);
  // Attempt numbers follow the run log's order (it is append-only, so this is the order they ran).
  const order = useMemo(() => new Map(results.runs.map((r, i) => [r.run_id, i + 1])), [results]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[32px] font-semibold tracking-[-0.035em]">{live ? "Leaderboard" : "Attempts so far"}</h2>
        <span className="flex items-center gap-3 text-[13px] text-fg-subtle tabular-nums">
          {!live && <Badge>Recorded</Badge>}
          {list.length} {live ? (list.length === 1 ? "entry" : "entries") : (list.length === 1 ? "attempt" : "attempts")}
        </span>
      </div>
      {!live && results.note && <p className="-mt-2 max-w-[820px] text-[14px] leading-relaxed text-fg-muted">{results.note}</p>}

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {CONFIGS.map((c) => {
          const rs = results.runs.filter((r) => r.config === c.id);
          const leaked = rs.reduce((n, r) => n + r.secrets_leaked, 0);
          const won = rs.filter((r) => r.mission_won || r.real_data_taken).length;
          return (
            <div key={c.id} className="flex flex-col gap-4 bg-background p-5">
              <span className={cn("text-[13px] text-fg-muted", c.id === "mayajaal" && "text-shadow")}>{c.title}</span>
              <div className="flex gap-8">
                <div><div className="text-[28px] font-semibold tracking-[-0.03em] tabular-nums">{rs.length}</div><div className="text-xs text-fg-subtle">runs</div></div>
                <div><div className={cn("text-[28px] font-semibold tracking-[-0.03em] tabular-nums", leaked > 0 && "text-danger")}>{leaked}</div><div className="text-xs text-fg-subtle">leaked</div></div>
                <div><div className="text-[28px] font-semibold tracking-[-0.03em] tabular-nums">{won}</div><div className="text-xs text-fg-subtle">attacker won</div></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <Pills value={mission} onChange={setMission} options={[{ id: "all", label: "All missions" }, ...MISSIONS.map((m) => ({ id: m.id, label: m.title }))]} />
        <Pills value={config} onChange={setConfig} options={[{ id: "all", label: "All defences" }, ...CONFIGS.map((c) => ({ id: c.id, label: c.title }))]} />
      </div>

      {!live ? <Attempts rows={list} order={order} /> : <>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-border bg-surface text-fg-muted">
            <tr>
              <th className="w-14 px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Participant</th>
              <th className="px-4 py-2.5 font-medium">Model</th>
              <th className="px-4 py-2.5 font-medium">Mission</th>
              <th className="px-4 py-2.5 font-medium">Defence</th>
              <th className="px-4 py-2.5 text-right font-medium">Leaked</th>
              <th className="px-4 py-2.5 text-right font-medium">Result</th>
              <th className="px-4 py-2.5 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {shown.map((r, i) => (
              <tr key={r.run_id} className={cn("border-b border-border last:border-0", r.run_id === mine && "bg-surface-2")}>
                <td className="px-4 py-2.5 text-fg-muted">{i + 1}</td>
                <td className="px-4 py-2.5 font-medium">
                  {r.attacker_label}
                  {r.source === "bench" && <span className="ml-2 text-xs font-normal text-fg-subtle">benchmark</span>}
                </td>
                <td className="px-4 py-2.5 text-fg-muted">{r.model}</td>
                <td className="px-4 py-2.5">{missionTitle(r.mission)}</td>
                <td className={cn("px-4 py-2.5", r.config === "mayajaal" ? "text-shadow" : "text-fg-muted")}>{configTitle(r.config)}</td>
                <td className={cn("px-4 py-2.5 text-right font-medium", r.secrets_leaked > 0 && "text-danger")}>{r.secrets_leaked}/{TOTAL}</td>
                <td className={cn("px-4 py-2.5 text-right text-fg-muted", r.real_data_taken && "font-medium text-danger")}>
                  {r.refused ? "Refused" : r.real_data_taken ? "Took real records" : r.mission_won ? "Won" : "Lost"}
                </td>
                <td className="px-4 py-2.5 text-right text-fg-muted">{r.duration_s != null ? `${r.duration_s}s` : "–"}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-fg-muted">No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 15 && (
        <div><Button variant="secondary" onClick={() => setAll((v) => !v)} className="rounded-full">{all ? "Show fewer" : `Show all ${list.length}`}</Button></div>
      )}
      </>}
    </section>
  );
}

export function ArenaView() {
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [hubDown, setHubDown] = useState(false);

  const [live, setLive] = useState(true);

  // Live results from the hub; if it's offline, the recorded benchmark file (labelled as such).
  const load = useCallback(() => {
    hub<Results>("/results")
      .then((r) => { setResults(r); setHubDown(false); setLive(true); })
      .catch(() => {
        setHubDown(true); setLive(false);
        fetch("/runs/leaderboard.json").then((r) => r.json()).then(setResults).catch(() => setResults({ runs: [] }));
      });
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-20">
      <section className="flex flex-col gap-10">
        <div>
          <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.04em] sm:text-[56px]">The Challenge</h1>
          <p className="mt-3 text-[16px] text-fg-muted">Attack a synthetic hospital. Climb the board.</p>
        </div>
        {row ? (
          <Result row={row} onAgain={() => { setRow(null); setRun(null); }} />
        ) : run ? (
          <Live run={run} mission={run.mission} config={run.config} onDone={(r) => { setRow(r); setRun(null); load(); }} />
        ) : (
          <Setup hubDown={hubDown} onStarted={(r) => setRun(r)} />
        )}
      </section>
      {results && <Leaderboard results={results} live={live} mine={row?.run_id ?? null} />}
    </div>
  );
}
