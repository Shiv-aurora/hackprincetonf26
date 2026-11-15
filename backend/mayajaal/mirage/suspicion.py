"""The attacker's side of the deception: how suspicious does a lure make them?

This is the nested ("what does the attacker believe about us?") part of MIRAGE, in the spirit of
interactive-POMDP deception planning, but reduced to one scalar so it can run per request:

    l_t = log-odds, in the attacker's head, that this environment is a decoy.

Every lure the attacker SEES adds evidence to l_t. How much depends on how implausible it is:

    w(lure) = W_BASE                        any windfall is a little too convenient
            + W_LATE     if its host page had already been viewed before it was planted
                         (an entry that was not there a minute ago is the most detectable tell)
            + W_DENSITY  * (lures already seen)        each further windfall is less believable
            + W_BURST    if it was planted within BURST_GAP requests of the previous lure

A "cautious" attacker abandons the session when shown a lure with probability
    q = sigmoid(SLOPE * (l_t - THETA)),
a "bold" attacker never does. The defender does not know which it faces; it keeps P(cautious) and
updates it each time a lure is seen and the session carries on (survival is evidence of boldness).

All weights are hand-set judgement calls, like the rest of the model. The evaluation also runs a
cautious attacker whose true weights differ from these, to show what happens when they are wrong.

Pure Python, no I/O, no imports from mayajaal.real (the shadow process may import it).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Mapping

from mayajaal.mirage.model import HOST


def sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


@dataclass(frozen=True)
class SuspicionModel:
    prior: float = 0.05          # attacker's prior that any given host is a decoy
    w_base: float = 0.4
    w_late: float = 1.6
    w_density: float = 0.35
    w_burst: float = 0.8
    burst_gap: int = 3           # requests
    slope: float = 1.5
    theta: float = 0.0           # cautious attackers start leaving around even odds

    @property
    def l0(self) -> float:
        return math.log(self.prior / (1.0 - self.prior))

    def weight(self, *, late: bool, seen: int, gap: int | None) -> float:
        """Evidence (nats of log-odds) one newly seen lure adds to the attacker's suspicion."""
        w = self.w_base + self.w_density * seen
        if late:
            w += self.w_late
        if gap is not None and gap < self.burst_gap:
            w += self.w_burst
        return w

    def quit_prob(self, log_odds: float) -> float:
        """Chance a cautious attacker abandons the session on seeing a lure at this suspicion."""
        return sigmoid(self.slope * (log_odds - self.theta))


DEFAULT = SuspicionModel()
# The evaluation's "wrong model" attacker: barely notices late entries, hates density, leaves sooner.
SHIFTED = SuspicionModel(w_late=0.4, w_density=0.9, w_burst=0.3, theta=-0.5)


@dataclass
class LureState:
    """What the defender knows about one session's lures. Lives next to the goal belief."""
    planted: dict[str, int] = field(default_factory=dict)      # kind -> request index when planted
    viewed: set[str] = field(default_factory=set)              # host pages fetched since diversion
    seen: int = 0                                              # lures the attacker has been shown
    log_odds: float = DEFAULT.l0                               # modelled attacker suspicion
    p_cautious: float = 0.5                                    # defender's belief about attacker type
    last_plant: int | None = None
    step: int = 0                                              # requests observed so far

    def copy(self) -> "LureState":
        return replace(self, planted=dict(self.planted), viewed=set(self.viewed))


def plant_effect(model: SuspicionModel, st: LureState, kind: str,
                 host: Mapping[str, str] = HOST) -> tuple[float, float]:
    """(new log-odds, quit probability for a cautious attacker) if `kind` were planted now and seen."""
    late = host.get(kind) in st.viewed
    gap = None if st.last_plant is None else st.step - st.last_plant
    lo = st.log_odds + model.weight(late=late, seen=st.seen, gap=gap)
    return lo, model.quit_prob(lo)


def apply_plant(model: SuspicionModel, st: LureState, kind: str, host: Mapping[str, str] = HOST) -> float:
    """Record that `kind` was planted and (in this model) seen. Returns the cautious quit probability.
    Fold survival into P(cautious) afterwards with `survived`."""
    lo, q = plant_effect(model, st, kind, host)
    st.planted[kind] = st.step
    st.last_plant = st.step
    st.seen += 1
    st.log_odds = lo
    return q


def survived(st: LureState, q: float) -> None:
    """The session carried on after a lure with cautious-quit probability q: Bayes on the type."""
    keep = st.p_cautious * (1.0 - q)
    z = keep + (1.0 - st.p_cautious)
    st.p_cautious = keep / z if z > 0 else 0.0


__all__ = ["SuspicionModel", "LureState", "DEFAULT", "SHIFTED", "plant_effect", "apply_plant", "survived",
           "sigmoid"]
