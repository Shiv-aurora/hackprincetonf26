"""Attacker-facing surfaces shared by the real tier (:8000) and the shadow tier (:8001).

    from mayajaal.surfaces import build_router
    app.include_router(build_router(resolve_world, emit, integrity_check=...))

Only sees the WorldProvider protocol; never imports mayajaal.real or mayajaal.shadow.
Emits only `tamper.attempt` events (the gateway emits `request` events).
If the world has `touched_honeytokens`, responses carry `X-MJ-Honeytoken-Touched: <new ids>`
for the gateway to consume and strip.
"""

from __future__ import annotations

from fastapi import APIRouter

from mayajaal.world_api import EventSink, ResolveWorld

from ._common import HONEYTOKEN_HEADER
from .fhir import IntegrityCheck, add_fhir_routes
from .portal import add_portal_routes

__all__ = ["build_router", "HONEYTOKEN_HEADER", "IntegrityCheck"]


def build_router(resolve_world: ResolveWorld, sink: EventSink, *,
                 integrity_check: IntegrityCheck | None = None) -> APIRouter:
    """FHIR R4-shaped REST under /fhir and the IT admin portal under /portal.

    integrity_check(obs, world, ctx) -> (accepted_by, rejected_by), sync or async. Called after
    world.put_observation(). When None: a missing or non-matching signature is rejected by every
    hospital; a matching one is accepted only by the caller's hospital (ctx.hospital_id).
    """
    router = APIRouter()
    add_fhir_routes(router, resolve_world, sink, integrity_check)
    add_portal_routes(router, resolve_world)
    return router
