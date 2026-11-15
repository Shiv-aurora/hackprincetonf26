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
from mayajaal.mirage.model import (ENGAGE, GOALS, HOST, KINDS, entropy, info_gain, normalize, p_engage,
                                   posterior_after, robust_engage)
from mayajaal.mirage.suspicion import DEFAULT as DEFAULT_SUSPICION
from mayajaal.mirage.suspicion import LureState, SuspicionModel, apply_plant, plant_effect, survived

EVERY = 4
MIN_GAIN = 0.03
BUDGET = 3            # lures per session: enough to learn, few enough to stay believable
MAX_HEADER = 1024
LURES_KEY = "lures"   # optional key in X-MJ-Posterior: {"<kind>": <info gain in bits>, ...}
# Chance per request that a diverted session opens each lure host page (rough averages of the
# request model in mirage/intent.py; judgement calls). The planner uses them to price waiting:
# a page that has not been viewed yet will not stay that way.
VIEW_RATE: dict[str, float] = {"docs": 0.15, "backups": 0.05}


def parse_lure_directives(value: str | bytes | None) -> dict[str, float] | None:
    """The gateway's lure directives from X-MJ-Posterior: {kind: info_gain_bits} for every lure that
    should exist in this session's shadow world. None when the header carries no directives (older
    gateway: the shadow-side planner then decides by itself). Unknown kinds are dropped."""
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
    lures = data.get(LURES_KEY) if isinstance(data, dict) else None
    if not isinstance(lures, dict):
        return None
    out: dict[str, float] = {}
    for k in KINDS:
        v = lures.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            out[k] = max(0.0, float(v))
    return out


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

    def decide(self, posterior: Mapping[str, float], st: LureState) -> tuple[str, float] | None:
        """(kind, IG bits) to plant now given the session's lure state, or None. This baseline keeps
        the fixed pacing rules: one lure per `every` requests, `budget` per session, max IG."""
        if st.last_plant is not None and st.step - st.last_plant < self.every:
            return None
        if len(st.planted) >= self.budget:
            return None
        return self.choose(posterior, [k for k in self.kinds if k not in st.planted])

    def apply_directives(self, directives: Mapping[str, float], posterior: Mapping[str, float], world: Any,
                         ctx: Any) -> list[Event]:
        """Make the session's shadow world match the gateway's lure directives: plant every listed
        kind that is not there yet and return one `breadcrumb.planted` event per new lure."""
        if getattr(world, "tier", "shadow") != "shadow" or getattr(world, "static", False):
            return []
        events: list[Event] = []
        for kind, gain in directives.items():
            if kind not in self.table or kind in (getattr(world, "breadcrumbs", None) or ()):
                continue
            path = world.plant_breadcrumb(kind)
            data = {"kind": kind, "path": str(path), "info_gain": round(gain, 4),
                    "target_goals": self.target_goals(posterior, kind)}
            events.append(make_event("breadcrumb.planted", data, run_id=getattr(ctx, "run_id", "adhoc") or "adhoc",
                                     actor="defender", session_id=ctx.session_id,
                                     hospital_id=getattr(ctx, "hospital_id", None) or None, tier="shadow"))
        return events

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


class StealthPlanner(Planner):
    """MIRAGE-S: suspicion-aware, non-myopic lure planning.

    The one-step planner above asks only "which lure tells me most about the goal?" and relies on a
    fixed pace (one per 4 requests, 3 per session) to stay believable. This planner replaces the
    fixed pace with an explicit model of the attacker's own suspicion (mirage/suspicion.py) and
    looks `depth` lures ahead. Planting kind k in belief b and lure state s is worth

        Q(k | b, s) = (1 - q) * [ IG(k | b) + gamma * E_o max(0, max_k' Q(k' | b_o, s')) ]
                      - q * [ H(b) + engage_value ]

    where q = P(cautious | s) * P(a cautious attacker quits on seeing k | s). If the attacker walks
    away we never resolve the remaining H(b) bits and we lose the engagement itself (engage_value,
    in bits). Waiting is worth 0, so a lure is planted only when max_k Q clears `min_gain`.

    q is what makes this stealthy: a lure on a page the session has already viewed, a lure right
    after another one, and each additional lure all raise it (see SuspicionModel.weight). With
    p_cautious = 0 the suspicion terms vanish and this is a paced-by-nothing greedy planner.

    Looking ahead also prices the closing window: the next lure is assumed to come `burst_gap`
    requests later, by which time each host page has been opened with probability
    1 - (1 - view_rate)^gap and a lure there would be late. Inside the burst window the planner
    compares planting now (burst penalty) with waiting it out (risk of the page being viewed).
    """

    def __init__(self, *, depth: int = 2, suspicion: SuspicionModel = DEFAULT_SUSPICION, gamma: float = 0.9,
                 engage_value: float = 0.5, budget: int = len(KINDS), min_gain: float = MIN_GAIN,
                 trust: float = 1.0, host: Mapping[str, str] | None = None,
                 view_rate: Mapping[str, float] | None = None, **kw: Any) -> None:
        super().__init__(every=1, min_gain=min_gain, budget=budget, **kw)
        self.view_rate = dict(VIEW_RATE if view_rate is None else view_rate)
        self.depth = max(1, depth)
        self.suspicion = suspicion
        self.gamma = gamma
        self.engage_value = engage_value
        self.host = dict(host or HOST)
        self.trust = trust
        self.rows = {k: robust_engage(self.table[k], trust) for k in self.kinds}

    def q_values(self, posterior: Mapping[str, float], st: LureState, depth: int | None = None) -> dict[str, float]:
        """Q(k | b, s) in bits for every lure that could still be planted."""
        b = normalize(posterior)
        return self._q(b, st, self.depth if depth is None else depth)

    def _viewed_within(self, n: int) -> dict[str, float]:
        """P(each host page gets opened within the next n requests)."""
        return {p: 1.0 - (1.0 - r) ** max(0, n) for p, r in self.view_rate.items()}

    def _q(self, b: Mapping[str, float], st: LureState, depth: int,
           viewed_p: Mapping[str, float] | None = None) -> dict[str, float]:
        """`viewed_p`: for a hypothetical future state, the chance each not-yet-viewed page has been
        opened by then (the lure would then be late)."""
        if len(st.planted) >= self.budget:
            return {}
        h = entropy(b.values())
        out: dict[str, float] = {}
        for k in self.kinds:
            if k in st.planted:
                continue
            row = self.rows[k]
            ig = info_gain(b, row)
            lo, q_cautious = plant_effect(self.suspicion, st, k, self.host)
            page = self.host.get(k)
            if viewed_p and page not in st.viewed:
                v = viewed_p.get(page, 0.0)
                q_cautious = (1.0 - v) * q_cautious + v * self.suspicion.quit_prob(lo + self.suspicion.w_late)
            q = st.p_cautious * q_cautious
            future = 0.0
            if depth > 1 and ig > 0:
                nxt = st.copy()
                survived(nxt, apply_plant(self.suspicion, nxt, k, self.host))
                gap = self.suspicion.burst_gap                 # the next lure would be paced, not a burst
                nxt.step += gap
                later = self._viewed_within(gap)
                pe = p_engage(b, row)
                for outcome, po in ((True, pe), (False, 1.0 - pe)):
                    if po > 1e-9:
                        nq = self._q(posterior_after(b, row, outcome), nxt, depth - 1, later)
                        future += po * max(0.0, max(nq.values(), default=0.0))
            out[k] = (1.0 - q) * (ig + self.gamma * future) - q * (h + self.engage_value)
        return out

    def decide(self, posterior: Mapping[str, float], st: LureState) -> tuple[str, float] | None:
        b = normalize(posterior)
        q = self._q(b, st, self.depth)
        if not q:
            return None
        kind = max(q, key=lambda k: (q[k], -self.kinds.index(k)))
        if q[kind] < self.min_gain:
            return None
        if self.depth > 1 and st.last_plant is not None:
            wait = self.suspicion.burst_gap - (st.step - st.last_plant)
            if wait > 0:                                       # inside the burst window: plant or wait it out?
                later = st.copy()
                later.step += wait
                qw = self._q(b, later, self.depth, self._viewed_within(wait))
                if self.gamma ** wait * max(qw.values(), default=0.0) > q[kind]:
                    return None
        return kind, info_gain(b, self.table[kind])


__all__ = ["Planner", "RandomPlanner", "StealthPlanner", "parse_posterior_header", "parse_lure_directives",
           "EVERY", "MIN_GAIN", "BUDGET", "LURES_KEY"]
