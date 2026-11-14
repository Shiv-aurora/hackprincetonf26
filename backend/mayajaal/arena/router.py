"""Arena router: turns each hand/tool-driven test of the sandbox into a labelled, scored run.

    POST /arena/start   {label, model, mission, config, source?}
        -> {run_id, headers: {X-MJ-Run, X-MJ-Config}, gateway_url, login: {username, password}}
    POST /arena/finish  {run_id, claim, suspected_honeypot, refused?}
        -> the result row (contracts/results.md); 404 unknown run, 409 already finished
    GET  /arena/runs    finished rows (oldest first)
    GET  /results       backend/data/results.json (empty structure if none)

Ground truth: `secrets_leaked` comes from the gateway's canary ledger (GET /_mj/ledger?run=<id>,
header X-MJ-Admin). If the gateway is unreachable we fall back to the gateway's own canary.check
events for the run (same ledger, as seen by the hub). Everything else is derived from the run's
events, read through `events_provider(run_id)` (the hub's in-memory store).

Wiring on the hub:

    from mayajaal.arena import build_router, default_admin_key
    app.include_router(build_router(
        lambda ev: publish(ev.model_dump()),          # sink: async (Event) -> None
        gateway_url="http://127.0.0.1:8000",
        admin_key_provider=default_admin_key,
        events_provider=lambda rid: list(_runs.get(rid, [])),
    ))
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mayajaal.arena import scoring
from mayajaal.contracts import Event, load_world, make_event

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
ADMIN_KEY_PATH = DATA_DIR / "real" / "admin.key"

TEST_PASSWORD = "Spring2026!"          # documented test credential of the sandbox's entry point
SOURCES = ("arena", "judge", "bench")

Sink = Callable[..., Awaitable[None]]
EventsProvider = Callable[[str], "list[dict[str, Any]] | Awaitable[list[dict[str, Any]]]"]
AdminKeyProvider = Callable[[], "str | None | Awaitable[str | None]"]
LedgerProvider = Callable[[str], Awaitable["int | None"]]


def default_admin_key() -> str | None:
    """Gateway admin key: env MJ_ADMIN_KEY, else backend/data/real/admin.key (never created here)."""
    env = os.environ.get("MJ_ADMIN_KEY")
    if env:
        return env
    try:
        return ADMIN_KEY_PATH.read_text().strip() or None
    except OSError:
        return None


async def _maybe_await(v: Any) -> Any:
    return await v if inspect.isawaitable(v) else v


class StartBody(BaseModel):
    label: str = ""
    model: str = "human"
    mission: str
    config: str
    source: str | None = None


class FinishBody(BaseModel):
    run_id: str
    claim: str | None = ""
    suspected_honeypot: bool = False
    refused: bool = False


class _Store:
    """results.jsonl (append-only, source of truth) + results.json (rebuilt on every finish)."""

    def __init__(self, data_dir: Path) -> None:
        self.dir = Path(data_dir)
        self.jsonl = self.dir / "results.jsonl"
        self.json = self.dir / "results.json"

    def rows(self) -> list[dict[str, Any]]:
        if not self.jsonl.exists():
            return []
        out = []
        for line in self.jsonl.read_text().splitlines():
            if line.strip():
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out

    def append(self, row: dict[str, Any]) -> dict[str, Any]:
        self.dir.mkdir(parents=True, exist_ok=True)
        with self.jsonl.open("a") as f:
            f.write(json.dumps(row) + "\n")
        results = scoring.build_results(self.rows())
        tmp = self.json.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(results, indent=2) + "\n")
        tmp.replace(self.json)
        return results

    def results(self) -> dict[str, Any]:
        if self.json.exists():
            try:
                return json.loads(self.json.read_text())
            except json.JSONDecodeError:
                pass
        rows = self.rows()
        return scoring.build_results(rows) if rows else scoring.empty_results()


def build_router(
    sink: Sink,
    *,
    gateway_url: str,
    admin_key_provider: AdminKeyProvider = default_admin_key,
    events_provider: EventsProvider | None = None,
    ledger_provider: LedgerProvider | None = None,
    http_transport: httpx.AsyncBaseTransport | None = None,
    data_dir: Path | str = DATA_DIR,
    world: dict[str, Any] | None = None,
) -> APIRouter:
    """Arena endpoints. `sink` is async and takes one Event (hub.client.emit fits).

    events_provider(run_id) -> list of event dicts for that run (sync or async). Without it, only
    the ledger is consulted and all event-derived fields are empty.
    ledger_provider / http_transport exist for tests; by default the ledger is fetched over HTTP.
    """
    world = world or load_world()
    missions = {m["id"] for m in world["missions"]}
    configs = {c["id"] for c in world["configs"]}
    username = world["entry_point"]["username"]
    total_canaries = int(world.get("protected_canaries_total", 12))
    gateway_url = gateway_url.rstrip("/")
    store = _Store(Path(data_dir))
    active: dict[str, dict[str, Any]] = {}
    finished: set[str] = {r["run_id"] for r in store.rows() if "run_id" in r}
    lock = asyncio.Lock()
    router = APIRouter(tags=["arena"])

    async def events_for(run_id: str) -> list[dict[str, Any]]:
        if events_provider is None:
            return []
        evs = await _maybe_await(events_provider(run_id))
        return [e for e in (evs or []) if e.get("run_id", run_id) == run_id]

    async def ledger_leaked(run_id: str) -> int | None:
        if ledger_provider is not None:
            return await ledger_provider(run_id)
        key = await _maybe_await(admin_key_provider())
        if not key:
            return None
        try:
            async with httpx.AsyncClient(transport=http_transport, timeout=3.0) as client:
                r = await client.get(f"{gateway_url}/_mj/ledger", params={"run": run_id},
                                     headers={"X-MJ-Admin": key})
            if r.status_code != 200:
                return None
            return int(r.json().get("leaked", 0))
        except (httpx.HTTPError, ValueError, TypeError):
            return None

    async def emit(ev: Event) -> None:
        try:
            await sink(ev)
        except Exception as exc:  # the hub must never 500 because the sink hiccuped
            print(f"[arena] sink failed: {exc}")

    @router.post("/arena/start")
    async def start(body: StartBody) -> dict[str, Any]:
        if body.mission not in missions:
            raise HTTPException(422, f"unknown mission {body.mission!r}; one of {sorted(missions)}")
        if body.config not in configs:
            raise HTTPException(422, f"unknown config {body.config!r}; one of {sorted(configs)}")
        source = body.source or "arena"
        if source not in SOURCES:
            raise HTTPException(422, f"unknown source {source!r}; one of {list(SOURCES)}")
        label = scoring.sanitize_label(body.label)
        model = scoring.sanitize_model(body.model)
        run_id = scoring.new_run_id()
        while run_id in active or run_id in finished:
            run_id = scoring.new_run_id()
        t0 = int(time.time() * 1000)
        active[run_id] = {"run_id": run_id, "mission": body.mission, "config": body.config, "model": model,
                          "attacker_label": label, "source": source, "t0_ms": t0}
        await emit(make_event("run.started", {"mission": body.mission, "config": body.config, "model": model,
                                              "attacker_label": label, "live": True},
                              run_id=run_id, actor="system", ts=t0))
        return {
            "run_id": run_id,
            "attacker_label": label,
            "model": model,
            "mission": body.mission,
            "config": body.config,
            "headers": {"X-MJ-Run": run_id, "X-MJ-Config": body.config},
            "gateway_url": gateway_url,
            "login": {"username": username, "password": TEST_PASSWORD},
        }

    async def recover(run_id: str, events: list[dict[str, Any]]) -> dict[str, Any] | None:
        """A run started before a hub restart: rebuild its metadata from its run.started event."""
        ev = next((e for e in events if e.get("type") == "run.started"), None)
        if ev is None:
            return None
        d = ev.get("data", {})
        return {"run_id": run_id, "mission": d.get("mission"), "config": d.get("config"),
                "model": d.get("model", "human"), "attacker_label": d.get("attacker_label", "visitor"),
                "source": "arena", "t0_ms": int(ev.get("ts", time.time() * 1000))}

    @router.post("/arena/finish")
    async def finish(body: FinishBody) -> dict[str, Any]:
        run_id = body.run_id.strip()
        async with lock:
            if run_id in finished:
                raise HTTPException(409, f"run {run_id} already finished")
            events = await events_for(run_id)
            meta = active.get(run_id) or await recover(run_id, events)
            if meta is None:
                raise HTTPException(404, f"unknown run {run_id}")
            end_ms = int(time.time() * 1000)

            leaked = await ledger_leaked(run_id)
            if leaked is None:
                leaked = scoring.leaked_from_events(events)
            leaked = max(0, min(int(leaked), total_canaries))
            claim = (body.claim or "").strip()[:500]
            believed = scoring.believed(claim)
            metrics = scoring.run_metrics(events, mission=meta["mission"], t0_ms=meta["t0_ms"], end_ms=end_ms)
            won = scoring.mission_won(meta["mission"], leaked, events, suspected_honeypot=body.suspected_honeypot,
                                      claim=claim, metrics=metrics)
            row = scoring.make_row(meta, metrics, secrets_leaked=leaked, believed_success=believed,
                                   suspected_honeypot=body.suspected_honeypot, won=won, refused=body.refused)
            finished.add(run_id)
            active.pop(run_id, None)
            store.append(row)

        if believed:
            await emit(make_event("agent.claim", {"text": claim}, run_id=run_id, actor="attacker"))
        summary = (f"{meta['mission']} vs {meta['config']}: {leaked}/{total_canaries} secrets leaked; "
                   f"tester {'claimed success' if believed else 'made no claim'}; "
                   f"mission {'won' if won else 'not won'}.")
        await emit(make_event("run.ended", {"outcome": {"believed_success": believed, "secrets_leaked": leaked,
                                                        "suspected_honeypot": body.suspected_honeypot,
                                                        "mission_won": won},
                                            "summary": summary, "duration_s": metrics["duration_s"]},
                              run_id=run_id, actor="system", ts=end_ms))
        return row

    @router.get("/arena/runs")
    async def runs() -> list[dict[str, Any]]:
        return store.rows()

    @router.get("/results")
    async def results() -> dict[str, Any]:
        return store.results()

    return router
