"""Tiny client every backend component uses to send events to the hub.

    from mayajaal.hub.client import emit
    await emit(make_event("request", {...}, run_id=..., actor="attacker", tier="shadow"))

Never raises: if the hub is down, the event is dropped and a warning is printed once.
"""

from __future__ import annotations

import httpx

from mayajaal.contracts import HUB_INGEST, Event

_client: httpx.AsyncClient | None = None
_warned = False


async def emit(*events: Event) -> None:
    global _client, _warned
    if not events:
        return
    if _client is None:
        _client = httpx.AsyncClient(timeout=2.0)
    try:
        await _client.post(HUB_INGEST, json=[e.model_dump() for e in events])
    except httpx.HTTPError as exc:
        if not _warned:
            print(f"[hub.client] hub unreachable, dropping events: {exc}")
            _warned = True


def emit_sync(*events: Event) -> None:
    try:
        httpx.post(HUB_INGEST, json=[e.model_dump() for e in events], timeout=2.0)
    except httpx.HTTPError:
        pass
