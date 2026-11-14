"""Shared helpers for the attacker-facing surfaces (FHIR + portal).

Nothing here may leak which tier is serving: no tier names, no internal hosts or ports.
"""

from __future__ import annotations

import hashlib
import inspect
import logging
import uuid
from functools import lru_cache
from typing import Any

from fastapi import Request
from starlette.responses import Response

from mayajaal.contracts import Event, load_world
from mayajaal.world_api import EventSink, ResolveWorld, SessionContext, WorldProvider, context_from_headers

log = logging.getLogger("mayajaal.surfaces")

HONEYTOKEN_HEADER = "X-MJ-Honeytoken-Touched"
"""Internal header for the gateway; it strips it before the response leaves."""


# --------------------------------------------------------------------------- world.json


@lru_cache(maxsize=1)
def world_json() -> dict[str, Any]:
    return load_world()


def hospitals() -> list[dict[str, Any]]:
    return list(world_json()["hospitals"])


def hospital_ids() -> list[str]:
    return [h["id"] for h in hospitals()]


def hospital_name(hid: str | None) -> str:
    for h in hospitals():
        if h["id"] == hid:
            return h["name"]
    return hid or ""


def stable_int(*parts: Any) -> int:
    """Deterministic integer from the given parts (stable across processes)."""
    raw = "|".join(str(p) for p in parts).encode()
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")


def stable_hex(*parts: Any, n: int = 12) -> str:
    raw = "|".join(str(p) for p in parts).encode()
    return hashlib.sha256(raw).hexdigest()[:n]


# --------------------------------------------------------------------------- per-request call


def _touched(world: Any) -> list[str]:
    """Snapshot of the world's touched honeytoken ids, if it tracks them."""
    raw = getattr(world, "touched_honeytokens", None)
    if raw is None:
        return []
    try:
        if isinstance(raw, dict):
            items = list(raw.keys())
        elif isinstance(raw, (set, frozenset)):
            items = sorted(raw, key=str)
        else:
            items = list(raw)
    except TypeError:
        return []
    out: list[str] = []
    for item in items:
        tid = getattr(item, "token_id", item)  # tolerate objects with a token_id attribute
        out.append(str(tid))
    return out


class Call:
    """Resolves the caller's world and remembers which honeytokens were already touched,
    so `finish()` can report the ones this request touched."""

    def __init__(self, request: Request, ctx: SessionContext, world: WorldProvider):
        self.request = request
        self.ctx = ctx
        self.world = world
        self._before = set(_touched(world))

    @classmethod
    async def open(cls, request: Request, resolve_world: ResolveWorld) -> "Call":
        ctx = context_from_headers(request.headers)
        world = resolve_world(ctx)
        if inspect.isawaitable(world):
            world = await world
        return cls(request, ctx, world)

    def new_touches(self) -> list[str]:
        seen: set[str] = set()
        out = []
        for t in _touched(self.world):
            if t not in self._before and t not in seen:
                seen.add(t)
                out.append(t)
        return out

    def finish(self, response: Response) -> Response:
        new = self.new_touches()
        if new:
            response.headers[HONEYTOKEN_HEADER] = ",".join(new)
        response.headers.setdefault("X-Request-Id", uuid.uuid4().hex)
        return response


async def safe_emit(sink: EventSink, event: Event) -> None:
    """Emitting must never break the attacker-facing response."""
    try:
        res = sink(event)
        if inspect.isawaitable(res):
            await res
    except Exception:  # noqa: BLE001
        log.warning("event sink failed for %s", event.type, exc_info=True)


# --------------------------------------------------------------------------- URLs / negotiation


def public_base(request: Request) -> str:
    """Externally visible origin. Honours X-Forwarded-* so a proxied tier never exposes its own host."""
    h = request.headers
    proto = (h.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
    host = (h.get("x-forwarded-host") or h.get("host") or request.url.netloc).split(",")[0].strip()
    prefix = (h.get("x-forwarded-prefix") or "").split(",")[0].strip().rstrip("/")
    return f"{proto}://{host}{prefix}"


def wants_json(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    if "application/json" not in accept and "+json" not in accept:
        return False
    # Browsers send text/html first; only treat JSON as preferred when it comes before HTML.
    if "text/html" in accept:
        return accept.find("json") < accept.find("text/html")
    return True
