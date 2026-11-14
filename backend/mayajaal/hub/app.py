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
