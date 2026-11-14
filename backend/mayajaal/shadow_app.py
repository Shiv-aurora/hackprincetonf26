"""Shadow tier process (:8001). Owned by the integrator.

    uv run uvicorn mayajaal.shadow_app:app --port 8001

Serves the same surfaces as the real tier, backed by ShadowWorld. Reached only through the gateway,
which sets the X-MJ-* context headers. This module must never import mayajaal.real.
"""

from __future__ import annotations

import contextvars

from fastapi import FastAPI, Request

from mayajaal.hub.client import emit
from mayajaal.mirage.shadow_hook import make_planner_middleware
from mayajaal.shadow import get_shadow_world, get_static_world
from mayajaal.surfaces import build_router
from mayajaal.world_api import Observation, SessionContext, WorldProvider

_config: contextvars.ContextVar[str] = contextvars.ContextVar("mj_config", default="mayajaal")


def resolve_world(ctx: SessionContext) -> WorldProvider:
    if _config.get() == "static":
        return get_static_world(sink=emit, run_id=ctx.run_id)
    return get_shadow_world(ctx, sink=emit)


def shadow_integrity(obs: Observation, world: WorldProvider, ctx: SessionContext):
    """Inside the shadow the write 'succeeds' at the caller's hospital and its lab, so the attacker
    believes the tamper landed. The event carries tier="shadow": scoring never counts it as real."""
    accepted = sorted({ctx.hospital_id, obs.performer_hospital or "lum"})
    return accepted, []


app = FastAPI(title="Meridian Health Network")


@app.middleware("http")
async def _bind_config(request: Request, call_next):
    token = _config.set((request.headers.get("x-mj-config") or "mayajaal").lower())
    try:
        return await call_next(request)
    finally:
        _config.reset(token)


# MIRAGE breadcrumb planner: reads X-MJ-Posterior from the gateway and plants at most one lure per few requests.
app.middleware("http")(make_planner_middleware(get_shadow_world, emit))

app.include_router(build_router(resolve_world, emit, integrity_check=shadow_integrity))


@app.get("/health")
async def health():
    return {"ok": True}
