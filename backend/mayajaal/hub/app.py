"""Event hub (:8002). Owned by the integrator.

- POST /events          ingest one event or a list (validated against contracts)
- WS   /ws              live stream; on connect sends the backlog of the current run, then live events
- GET  /runs            list runs seen (id, first ts, event count)
- GET  /runs/{run_id}   all events of one run (for Replay)
- GET  /health

Every event is appended to data/events.jsonl (the source of truth for replays and results).

Replay mode (UI development without a backend):
    uv run python -m mayajaal.hub.app --replay ../fixtures/demo-run.jsonl --loop --speed 1
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from mayajaal.contracts import Event

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
LOG_PATH = DATA_DIR / "events.jsonl"

app = FastAPI(title="MayaJaal hub")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_runs: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
_subscribers: set[asyncio.Queue] = set()
_current_run: str | None = None


def _load_log() -> None:
    if not LOG_PATH.exists():
        return
    for line in LOG_PATH.read_text().splitlines():
        if line.strip():
            ev = json.loads(line)
            _runs.setdefault(ev["run_id"], []).append(ev)


async def publish(ev: dict[str, Any], persist: bool = True) -> None:
    global _current_run
    if ev["type"] == "run.started":
        _current_run = ev["run_id"]
        _runs[ev["run_id"]] = []
    _runs.setdefault(ev["run_id"], []).append(ev)
    if _current_run is None:
        _current_run = ev["run_id"]
    if persist:
        DATA_DIR.mkdir(exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(ev) + "\n")
    for q in list(_subscribers):
        q.put_nowait(ev)


@app.post("/events")
async def ingest(payload: dict[str, Any] | list[dict[str, Any]]):
    items = payload if isinstance(payload, list) else [payload]
    for item in items:
        ev = Event.model_validate(item).validated()
        await publish(ev.model_dump())
    return {"ok": True, "count": len(items)}


@app.get("/health")
async def health():
    return {"ok": True, "runs": len(_runs), "current_run": _current_run, "subscribers": len(_subscribers)}


@app.get("/runs")
async def runs():
    return [
        {"run_id": rid, "first_ts": evs[0]["ts"] if evs else None, "events": len(evs),
         "started": next((e["data"] for e in evs if e["type"] == "run.started"), None),
         "ended": next((e["data"] for e in evs if e["type"] == "run.ended"), None)}
        for rid, evs in reversed(_runs.items())
    ]


@app.get("/runs/{run_id}")
async def run_events(run_id: str):
    if run_id not in _runs:
        raise HTTPException(404, "unknown run")
    return _runs[run_id]


@app.websocket("/ws")
async def ws(socket: WebSocket):
    await socket.accept()
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.add(q)
    try:
        if _current_run and _current_run in _runs:
            for ev in list(_runs[_current_run]):
                await socket.send_text(json.dumps(ev))
        while True:
            ev = await q.get()
            await socket.send_text(json.dumps(ev))
    except WebSocketDisconnect:
        pass
    finally:
        _subscribers.discard(q)


async def _replay(path: Path, loop: bool, speed: float) -> None:
    """Re-emit a recorded run with its original timing (ts rewritten to now)."""
    events = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    while True:
        t0_file = events[0]["ts"]
        t0_wall = time.time() * 1000
        suffix = f"-{int(t0_wall)}"
        for ev in events:
            due = t0_wall + (ev["ts"] - t0_file) / speed
            delay = (due - time.time() * 1000) / 1000
            if delay > 0:
                await asyncio.sleep(delay)
            out = dict(ev, ts=int(time.time() * 1000), run_id=ev["run_id"] + suffix)
            await publish(out, persist=False)
        if not loop:
            return
        await asyncio.sleep(4)


async def _publish_event(ev: Event) -> None:
    await publish(ev.model_dump())


def _mount_plugins() -> None:
    """Routers other components contribute to the hub. Each is optional."""
    import os

    try:
        from mayajaal.arena import build_router as build_arena_router, default_admin_key
        app.include_router(build_arena_router(
            _publish_event,
            gateway_url=os.environ.get("MJ_GATEWAY_URL", "http://127.0.0.1:8000"),
            admin_key_provider=default_admin_key,
            events_provider=lambda rid: list(_runs.get(rid, [])),
        ))
    except ImportError:
        pass
    try:
        from mayajaal.continuity.router import build_router as build_continuity_router
        app.include_router(build_continuity_router(_publish_event))
    except ImportError:
        pass


_mount_plugins()


# ------------------------------------------------------------------ demo: start a scripted attack
# The live page's "Start attack" button. Runs scripts/record_runs.py --dry: one fixed request sequence
# through the real gateway as the phished nurse. Nothing is saved; events stream to /ws as usual.

_attack: dict[str, Any] = {"proc": None, "config": None}
_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "record_runs.py"


@app.get("/analyst/brief")
def analyst_brief(run_id: str | None = None):
    """Incident brief for a run (default: the current one). Rule-based facts and playbook always;
    Claude's analysis on top when ANTHROPIC_API_KEY is set. Sync def: FastAPI runs it in a thread."""
    from mayajaal.analyst import brief

    rid = run_id or _current_run
    if not rid or rid not in _runs:
        raise HTTPException(404, "unknown run")
    return {"run_id": rid, **brief(list(_runs[rid]))}


@app.get("/analyst/report")
def analyst_report(run_id: str | None = None):
    """Downloadable forensic report (Markdown): brief, indicators, playbook and full timeline."""
    from fastapi.responses import PlainTextResponse
    from mayajaal.analyst import report_markdown

    rid = run_id or _current_run
    if not rid or rid not in _runs:
        raise HTTPException(404, "unknown run")
    return PlainTextResponse(report_markdown(list(_runs[rid])), media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="mayajaal-report-{rid}.md"'})


class InvestigateIn(BaseModel):
    run_id: str | None = None
    question: str | None = None


@app.post("/investigate")
def investigate_run(body: InvestigateIn):
    """Run the Deep Agents investigator over a run (default: current). Read-only over recorded events;
    every other run in the hub is searchable for repeat indicators. Needs ANTHROPIC_API_KEY."""
    from mayajaal.investigator import investigate

    rid = body.run_id or _current_run
    if not rid or rid not in _runs:
        raise HTTPException(404, "unknown run")
    others = {k: list(v) for k, v in _runs.items() if k != rid}
    return {"run_id": rid, **investigate(list(_runs[rid]), others, question=body.question)}


def _attack_running() -> bool:
    p = _attack["proc"]
    return p is not None and p.returncode is None


@app.get("/demo/attack")
async def attack_status():
    return {"running": _attack_running(), "config": _attack["config"]}


@app.post("/demo/attack")
async def attack_start(body: dict[str, Any] | None = None):
    import sys
    config = str((body or {}).get("config") or "mayajaal")
    if config not in ("baseline", "static", "mayajaal"):
        raise HTTPException(422, "config must be baseline, static or mayajaal")
    pace = float((body or {}).get("pace") or 1.6)
    if _attack_running():
        raise HTTPException(409, "an attack is already running")
    _attack["proc"] = await asyncio.create_subprocess_exec(
        sys.executable, str(_SCRIPT), "--dry", "--configs", config, "--pace", str(max(0.2, min(pace, 5.0))),
        cwd=str(_SCRIPT.parents[1] / "backend"),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    _attack["config"] = config
    return {"started": True, "config": config}


def main() -> None:
    import uvicorn

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8002)
    p.add_argument("--replay", type=Path, help="JSONL file to replay on a loop (mock mode)")
    p.add_argument("--loop", action="store_true")
    p.add_argument("--speed", type=float, default=1.0)
    args = p.parse_args()

    if args.replay:
        @app.on_event("startup")
        async def _start_replay():  # noqa: ANN202
            asyncio.create_task(_replay(args.replay, args.loop, args.speed))
    else:
        _load_log()

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
