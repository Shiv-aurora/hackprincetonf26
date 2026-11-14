"""MIRAGE-lite breadcrumb planner. Runs in the SHADOW process: must never import mayajaal.real.

Given the gateway's goal posterior (sent along in the X-MJ-Posterior header on every proxied
request) and the session's ShadowWorld, pick the lure whose outcome (taken / ignored) is expected
to tell us the most about the attacker's goal:

    IG(kind) = H(G) - sum_{o in {engage, ignore}} P(o | kind) H(G | o, kind)

computed exactly from P(engage | goal, kind) (table in mirage/model.py). Rules:
  - only for diverted sessions (the request reached a non-static shadow world);
  - at most one breadcrumb per `every` requests of a session, each kind at most once, and at most
    `budget` per session (a jump box littered with lures stops being believable);
  - skip when the best IG is below `min_gain` bits (we already know enough).
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from mayajaal.contracts import Event, make_event
from mayajaal.mirage.model import ENGAGE, GOALS, KINDS, info_gain, normalize

EVERY = 4
MIN_GAIN = 0.03
BUDGET = 3            # lures per session: enough to learn, few enough to stay believable
MAX_HEADER = 1024


def parse_posterior_header(value: str | bytes | None) -> dict[str, float] | None:
    """Parse X-MJ-Posterior (compact JSON {"benign":0.1,...}). Unknown keys are ignored, missing goals
    count as 0, the result is renormalised. None if absent, malformed, negative or all zero."""
    if not value:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if len(value) > MAX_HEADER:
        return None
    try:
        data = json.loads(value)
    except (ValueError, TypeError):
        return None
    if isinstance(data, dict) and isinstance(data.get("posterior"), dict):
        data = data["posterior"]
    if not isinstance(data, dict):
        return None
    out: dict[str, float] = {}
    for g in GOALS:
        v = data.get(g, 0.0)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
            return None
        out[g] = float(v)
    if sum(out.values()) <= 0:
        return None
    return normalize(out)


@dataclass
class _Track:
    requests: int = 0
    last_plant: int | None = None
    planted: int = 0


class Planner:
    """Chooses and plants breadcrumbs. One instance per shadow process; tracks sessions itself."""

    def __init__(self, *, every: int = EVERY, min_gain: float = MIN_GAIN, budget: int = BUDGET,
                 table: Mapping[str, Mapping[str, float]] | None = None, kinds: Sequence[str] | None = None,
                 max_sessions: int = 4096) -> None:
        self.every = max(1, every)
        self.min_gain = min_gain
        self.budget = budget
        self.table = {k: dict(v) for k, v in (table or ENGAGE).items()}
        self.kinds = tuple(kinds or [k for k in KINDS if k in self.table])
        self.max_sessions = max_sessions
        self._tracks: dict[str, _Track] = {}

    # ---------------------------------------------------------------- choice
    def scores(self, posterior: Mapping[str, float], available: Sequence[str] | None = None) -> dict[str, float]:
        """IG in bits for each available kind."""
        p = normalize(posterior)
        return {k: info_gain(p, self.table[k]) for k in (available if available is not None else self.kinds)}

    def choose(self, posterior: Mapping[str, float], available: Sequence[str]) -> tuple[str, float] | None:
        """(kind, IG) maximising expected information gain, or None if nothing clears min_gain."""
        sc = self.scores(posterior, available)
        if not sc:
            return None
        kind = max(sc, key=lambda k: (sc[k], -self.kinds.index(k)))
        return (kind, sc[kind]) if sc[kind] >= self.min_gain else None

    def target_goals(self, posterior: Mapping[str, float], kind: str) -> list[str]:
        """Plausible goals (P >= 0.05) that take this lure more often than the posterior average."""
        p = normalize(posterior)
        row = self.table[kind]
        mean = sum(p[g] * row.get(g, 0.0) for g in GOALS)
        out = [g for g in GOALS if p[g] >= 0.05 and row.get(g, 0.0) > mean]
        if not out:
            out = [max(GOALS, key=lambda g: row.get(g, 0.0))]
        return sorted(out, key=lambda g: -p[g])

    # ---------------------------------------------------------------- planting
    def _track(self, sid: str) -> _Track:
        t = self._tracks.get(sid)
        if t is None:
            if len(self._tracks) >= self.max_sessions:
                self._tracks.pop(next(iter(self._tracks)))
            t = self._tracks[sid] = _Track()
        return t

    def maybe_plant(self, posterior: Mapping[str, float] | None, world: Any, ctx: Any, *,
                    diverted: bool | None = None) -> Event | None:
        """Call once per request that reaches the shadow tier. Plants at most one breadcrumb in
        `world` (anything with plant_breadcrumb(kind) -> path, optionally a `breadcrumbs` dict) and
        returns the `breadcrumb.planted` event, else None. `ctx` is a world_api.SessionContext."""
        t = self._track(ctx.session_id)
        t.requests += 1
        if diverted is None:
            diverted = getattr(world, "tier", "shadow") == "shadow" and not getattr(world, "static", False)
        if not posterior or not diverted:
            return None
        if t.last_plant is not None and t.requests - t.last_plant < self.every:
            return None
        if t.planted >= self.budget:
            return None
        planted = set(getattr(world, "breadcrumbs", None) or ())
        available = [k for k in self.kinds if k not in planted]
        pick = self.choose(posterior, available)
        if pick is None:
            return None
        kind, gain = pick
        path = world.plant_breadcrumb(kind)
        t.last_plant = t.requests
        t.planted += 1
        data = {"kind": kind, "path": str(path), "info_gain": round(gain, 4),
                "target_goals": self.target_goals(posterior, kind)}
        return make_event("breadcrumb.planted", data, run_id=getattr(ctx, "run_id", "adhoc") or "adhoc",
                          actor="defender", session_id=ctx.session_id,
                          hospital_id=getattr(ctx, "hospital_id", None) or None, tier="shadow")


class RandomPlanner(Planner):
    """Baseline for the offline evaluation: a uniformly random unplanted kind, no IG threshold."""

    def __init__(self, *, rng: random.Random | None = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.rng = rng or random.Random()

    def choose(self, posterior: Mapping[str, float], available: Sequence[str]) -> tuple[str, float] | None:
        if not available:
            return None
        kind = self.rng.choice(list(available))
        return kind, info_gain(normalize(posterior), self.table[kind])


__all__ = ["Planner", "RandomPlanner", "parse_posterior_header", "EVERY", "MIN_GAIN", "BUDGET"]
