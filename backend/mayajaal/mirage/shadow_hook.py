"""Shadow-process glue for the breadcrumb planner. Must never import mayajaal.real.

    from mayajaal.mirage.shadow_hook import make_planner_middleware
    app.middleware("http")(make_planner_middleware(get_shadow_world, emit))

Runs BEFORE the request is served, so a breadcrumb planted now is already visible in this response
(e.g. a new account on the portal user directory). Only acts when the gateway sent X-MJ-Posterior
and the request is for the per-session MayaJaal shadow (X-MJ-Config absent or "mayajaal"; the
static honeypot never gets adaptive lures).

Two modes, chosen by the header itself:
  - the header carries lure directives ("lures": {kind: info_gain}): the gateway's planner has
    decided (it sees every request, so it knows which pages the session has viewed and whether a
    lure was taken or ignored); this hook only makes the shadow world match;
  - no directives (older gateway): the local planner decides from the posterior, as before.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from mayajaal.mirage.planner import Planner, parse_lure_directives, parse_posterior_header
from mayajaal.world_api import EventSink, SessionContext, context_from_headers

POSTERIOR_HEADER = "x-mj-posterior"


def make_planner_middleware(resolve_world: Callable[[SessionContext], Any], sink: EventSink,
                            planner: Planner | None = None) -> Callable[[Any, Any], Awaitable[Any]]:
    planner = planner or Planner()

    async def mirage_planner(request: Any, call_next: Callable[[Any], Awaitable[Any]]) -> Any:
        value = request.headers.get(POSTERIOR_HEADER)
        config = (request.headers.get("x-mj-config") or "mayajaal").lower()
        if value and config == "mayajaal":
            posterior = parse_posterior_header(value)
            if posterior:
                try:
                    ctx = context_from_headers(request.headers)
                    world = resolve_world(ctx)
                    directives = parse_lure_directives(value)
                    if directives is None:            # older gateway: decide here, as before
                        ev = planner.maybe_plant(posterior, world, ctx)
                        events = [ev] if ev is not None else []
                    else:                             # the gateway decided; make the world match
                        events = planner.apply_directives(directives, posterior, world, ctx)
                    for ev in events:
                        await sink(ev)
                except Exception as exc:      # a planner bug must never break the shadow response
                    print(f"[mirage] planner error: {exc!r}")
        return await call_next(request)

    mirage_planner.planner = planner           # type: ignore[attr-defined]
    return mirage_planner
