"""HTTP routes for the continuity scenario. The integrator mounts this on the hub:

    from mayajaal.continuity.router import build_router
    app.include_router(build_router(sink))     # sink: async (Event) -> None, e.g. hub.client.emit

    POST /scenario/synnovis/start   {"speed"?: float, "run_id"?: str}  → {"run_id", "speed"}  (409 if one is running)
    GET  /scenario/synnovis/status  → {"running", "run_id"}
    GET  /scenario/compare          → three-policy comparison (see scenario.synnovis_comparison)
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .scenario import Sink, run_synnovis, synnovis_comparison


class StartBody(BaseModel):
    speed: float = Field(default=1.0, gt=0, le=1000)
    run_id: str | None = None


def build_router(sink: Sink) -> APIRouter:
    router = APIRouter(tags=["continuity"])
    state: dict = {"task": None, "run_id": None}
    cached: dict = {}

    def running() -> bool:
        task = state["task"]
        return task is not None and not task.done()

    @router.post("/scenario/synnovis/start")
    async def start(body: StartBody | None = None):
        body = body or StartBody()
        if running():
            raise HTTPException(409, detail={"error": "scenario already running", "run_id": state["run_id"]})
        run_id = body.run_id or f"synnovis-{uuid.uuid4().hex[:8]}"
        state["run_id"] = run_id
        state["task"] = asyncio.create_task(run_synnovis(sink, speed=body.speed, run_id=run_id))
        return {"run_id": run_id, "speed": body.speed}

    @router.get("/scenario/synnovis/status")
    async def status():
        return {"running": running(), "run_id": state["run_id"]}

    @router.get("/scenario/compare")
    async def compare():
        if "cmp" not in cached:
            cached["cmp"] = synnovis_comparison()
        return cached["cmp"]

    return router
