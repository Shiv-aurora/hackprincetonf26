"""Process-wide registry of shadow worlds (LRU by session id)."""

from __future__ import annotations

import os
import threading
from collections import OrderedDict

from mayajaal.shadow.world import ShadowWorld
from mayajaal.world_api import EventSink, SessionContext

MAX_WORLDS = 256

_key: bytes | None = None
_worlds: OrderedDict[str, ShadowWorld] = OrderedDict()
_static: ShadowWorld | None = None
_lock = threading.RLock()


def shadow_key() -> bytes:
    """MJ_SHADOW_KEY (hex) if set, else random bytes generated once per process."""
    global _key
    with _lock:
        if _key is None:
            env = os.environ.get("MJ_SHADOW_KEY", "").strip()
            _key = bytes.fromhex(env) if env else os.urandom(32)
        return _key


def _adopt(world: ShadowWorld, sink: EventSink | None, run_id: str | None) -> ShadowWorld:
    if sink is not None and world.sink is None:
        world.sink = sink
    if run_id and run_id != "adhoc":
        world.run_id = run_id
    return world


def get_shadow_world(ctx: SessionContext, sink: EventSink | None = None) -> ShadowWorld:
    """The session-seeded shadow world for this caller (created on first use, then cached)."""
    with _lock:
        w = _worlds.get(ctx.session_id)
        if w is not None:
            _worlds.move_to_end(ctx.session_id)
            return _adopt(w, sink, ctx.run_id)
        w = ShadowWorld(ctx.session_id, key=shadow_key(), sink=sink, run_id=ctx.run_id or "adhoc")
        _worlds[ctx.session_id] = w
        while len(_worlds) > MAX_WORLDS:
            _worlds.popitem(last=False)
        return w


def get_static_world(sink: EventSink | None = None, run_id: str | None = None) -> ShadowWorld:
    """The single "static honeypot" world shared by every session (benchmark config "static")."""
    global _static
    with _lock:
        if _static is None:
            _static = ShadowWorld("static", key=shadow_key(), static=True, sink=sink, run_id=run_id or "adhoc")
        return _adopt(_static, sink, run_id)


def reset() -> None:
    """Forget all worlds (tests)."""
    global _static
    with _lock:
        _worlds.clear()
        _static = None
