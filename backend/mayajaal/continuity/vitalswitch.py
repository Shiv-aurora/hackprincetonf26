"""VitalSwitch: patient-aware lab rerouting when a shared pathology lab goes dark.

Model (all times in simulated minutes since the outage):
- Labs are the hospitals' in-house labs plus Lumen Shared Pathology (contracts/world.json).
  During normal operations an in-house lab is busy with its own work, so only a fraction of its
  `lab_capacity_per_hr` is spare for diverted orders (IN_HOUSE_SPARE). Lumen exists to take this
  outsourced work, so all of its capacity counts.
- A lab processes one test per slot of 60 / capacity minutes. A test arriving at minute `a`
  takes the earliest free slot starting at or after `a`, then needs the test's analysis time.
- Courier transport between sites: COURIER_OVERHEAD_MIN + MIN_PER_GRID_UNIT * distance on the
  0-100 city grid. In-house is 0.
- Quarantined / down / compromised labs take nothing.

Policies compared on the same order stream:
- no_reroute: everything keeps waiting for the shared lab (Lumen) until it is restored.
- nearest: each order goes to the nearest healthy lab (in practice its own lab), first come
  first served, regardless of urgency or deadline.
- vitalswitch: every EPOCH_MIN, orders that have arrived are sorted by urgency then deadline and
  each takes the feasible lab with the earliest completion. Orders no lab can finish before
  their deadline are marked unservable and consume no capacity (escalated to a human).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, replace
from typing import Literal

from mayajaal.contracts import load_world

Urgency = Literal["stat", "urgent", "routine"]
URGENCIES: tuple[Urgency, ...] = ("stat", "urgent", "routine")
URGENCY_RANK = {"stat": 0, "urgent": 1, "routine": 2}
DEADLINE_MIN = {"stat": 60.0, "urgent": 240.0, "routine": 1440.0}

MIN_PER_GRID_UNIT = 0.4
COURIER_OVERHEAD_MIN = 12.0
IN_HOUSE_SPARE = 0.10      # share of an in-house lab's hourly capacity free for diverted work
EPOCH_MIN = 2.0            # VitalSwitch decision interval
SHARED_LAB = "lum"
USABLE = {"healthy", "degraded"}

# Analysis (instrument) time per test, minutes — rough, plausible turnaround components.
TEST_ANALYSIS_MIN = {
    "Troponin I": 18, "Potassium": 12, "Lactate": 10, "Crossmatch": 30, "Hemoglobin": 8,
    "INR": 15, "CBC": 10, "Creatinine": 12, "CRP": 15,
    "Lipid panel": 20, "HbA1c": 20, "Vitamin D": 30, "TSH": 25, "Ferritin": 25,
}
TESTS_BY_URGENCY: dict[Urgency, list[str]] = {
    "stat": ["Troponin I", "Potassium", "Lactate", "Crossmatch", "Hemoglobin"],
    "urgent": ["INR", "CBC", "Creatinine", "CRP"],
    "routine": ["Lipid panel", "HbA1c", "Vitamin D", "TSH", "Ferritin"],
}


# ---------------------------------------------------------------- data


@dataclass(frozen=True)
class LabOrder:
    order_id: str
    urgency: Urgency
    test: str
    origin: str               # hospital id that ordered it
    created_min: float
    deadline_min: float       # absolute minute by which the result must be back

    @classmethod
    def make(cls, order_id: str, urgency: Urgency, test: str, origin: str, created_min: float) -> "LabOrder":
        return cls(order_id, urgency, test, origin, created_min, created_min + DEADLINE_MIN[urgency])

    @property
    def analysis_min(self) -> float:
        return float(TEST_ANALYSIS_MIN.get(self.test, 20))


@dataclass
class Lab:
    id: str
    x: float
    y: float
    capacity_per_hr: float
    status: str = "healthy"
    _slots: set[int] = field(default_factory=set, repr=False)

    @property
    def usable(self) -> bool:
        return self.status in USABLE and self.capacity_per_hr > 0

    @property
    def slot_min(self) -> float:
        cap = self.capacity_per_hr * (0.5 if self.status == "degraded" else 1.0)
        return 60.0 / cap

    def earliest_slot(self, arrival_min: float) -> int:
        k = math.ceil(arrival_min / self.slot_min - 1e-9)
        while k in self._slots:
            k += 1
        return k

    def book(self, k: int) -> None:
        self._slots.add(k)


@dataclass(frozen=True)
class Assignment:
    order: LabOrder
    lab_id: str | None
    status: Literal["completed", "late", "unservable"]
    dispatched_min: float
    completion_min: float | None

    @property
    def on_time(self) -> bool:
        return self.status == "completed"

    @property
    def eta_min(self) -> float | None:
        """Minutes from the routing decision until the result is back."""
        if self.completion_min is None:
            return None
        return round(self.completion_min - self.dispatched_min, 1)


class LabNetwork:
    """Labs and their positions. `copy()` gives an empty schedule for a fresh simulation."""

    def __init__(self, labs: dict[str, Lab]) -> None:
        self.labs = labs

    @classmethod
    def from_world(cls, world: dict | None = None, *, in_house_spare: float = IN_HOUSE_SPARE,
                   shared_lab: str = SHARED_LAB) -> "LabNetwork":
        world = world or load_world()
        labs = {}
        for h in world["hospitals"]:
            frac = 1.0 if h["id"] == shared_lab else in_house_spare
            labs[h["id"]] = Lab(h["id"], h["x"], h["y"], h["lab_capacity_per_hr"] * frac)
        return cls(labs)

    def copy(self) -> "LabNetwork":
        return LabNetwork({k: replace(v, _slots=set()) for k, v in self.labs.items()})

    def set_status(self, lab_id: str, status: str) -> "LabNetwork":
        self.labs[lab_id].status = status
        return self

    def transport_min(self, a: str, b: str) -> float:
        if a == b:
            return 0.0
        la, lb = self.labs[a], self.labs[b]
        return COURIER_OVERHEAD_MIN + MIN_PER_GRID_UNIT * math.hypot(la.x - lb.x, la.y - lb.y)

    def usable_labs(self) -> list[Lab]:
        return [lab for lab in self.labs.values() if lab.usable]

    def quote(self, order: LabOrder, lab: Lab, now: float) -> tuple[int, float]:
        """(slot, completion minute) if `order` were dispatched to `lab` at `now`."""
        arrival = now + self.transport_min(order.origin, lab.id)
        k = lab.earliest_slot(arrival)
        return k, (k + 1) * lab.slot_min + order.analysis_min


# ---------------------------------------------------------------- policies


def _sort_key(o: LabOrder) -> tuple:
    return (URGENCY_RANK[o.urgency], o.deadline_min, o.created_min, o.order_id)


def plan_vitalswitch(orders: list[LabOrder], network: LabNetwork, *, epoch_min: float = EPOCH_MIN) -> list[Assignment]:
    """Greedy: per decision epoch, urgency then deadline, earliest feasible completion."""
    net = network.copy()
    pending = sorted(orders, key=lambda o: o.created_min)
    out: list[Assignment] = []
    i = 0
    while i < len(pending):
        # decide at the end of the epoch in which the next order arrived
        now = (math.floor(pending[i].created_min / epoch_min) + 1) * epoch_min
        batch = []
        while i < len(pending) and pending[i].created_min < now:
            batch.append(pending[i])
            i += 1
        for order in sorted(batch, key=_sort_key):
            best: tuple[float, float, Lab, int] | None = None
            for lab in net.usable_labs():
                k, done = net.quote(order, lab, now)
                if done > order.deadline_min:
                    continue
                key = (done, net.transport_min(order.origin, lab.id))
                if best is None or key < best[:2]:
                    best = (*key, lab, k)
            if best is None:
                out.append(Assignment(order, None, "unservable", now, None))
                continue
            done, _, lab, k = best
            lab.book(k)
            out.append(Assignment(order, lab.id, "completed", now, done))
    return out


def plan_nearest(orders: list[LabOrder], network: LabNetwork) -> list[Assignment]:
    """Naive reroute: nearest healthy lab, first come first served, no urgency awareness."""
    net = network.copy()
    out = []
    for order in sorted(orders, key=lambda o: (o.created_min, o.order_id)):
        labs = net.usable_labs()
        if not labs:
            out.append(Assignment(order, None, "unservable", order.created_min, None))
            continue
        lab = min(labs, key=lambda lb: (net.transport_min(order.origin, lb.id), lb.id))
        k, done = net.quote(order, lab, order.created_min)
        lab.book(k)
        status = "completed" if done <= order.deadline_min else "late"
        out.append(Assignment(order, lab.id, status, order.created_min, done))
    return out


def plan_no_reroute(orders: list[LabOrder], network: LabNetwork, *, shared_lab: str = SHARED_LAB,
                    restore_min: float | None = None) -> list[Assignment]:
    """Every order waits for the shared lab. If it is down, it waits until `restore_min`
    (None = not restored within the scenario, so every result is late)."""
    net = network.copy()
    lab = net.labs[shared_lab]
    up_from = 0.0 if lab.usable else restore_min
    out = []
    for order in sorted(orders, key=lambda o: (o.created_min, o.order_id)):
        if up_from is None:
            out.append(Assignment(order, shared_lab, "late", order.created_min, None))
            continue
        arrival = max(order.created_min + net.transport_min(order.origin, shared_lab), up_from)
        k = lab.earliest_slot(arrival)
        lab.book(k)
        done = (k + 1) * lab.slot_min + order.analysis_min
        status = "completed" if done <= order.deadline_min else "late"
        out.append(Assignment(order, shared_lab, status, order.created_min, done))
    return out


# ---------------------------------------------------------------- metrics


def on_time_summary(assignments: list[Assignment]) -> dict:
    res: dict = {}
    for u in URGENCIES:
        rows = [a for a in assignments if a.order.urgency == u]
        ok = sum(a.on_time for a in rows)
        res[f"{u}_on_time_pct"] = round(100.0 * ok / len(rows), 1) if rows else 100.0
        res[f"{u}_total"] = len(rows)
        res[f"{u}_on_time"] = ok
    res["unservable"] = sum(a.status == "unservable" for a in assignments)
    res["late"] = sum(a.status == "late" for a in assignments)
    return res


def stats_payload(summary: dict) -> dict:
    """The continuity.stats event payload for a summary."""
    return {
        "stat_on_time_pct": summary["stat_on_time_pct"],
        "urgent_on_time_pct": summary["urgent_on_time_pct"],
        "routine_on_time_pct": summary["routine_on_time_pct"],
        "unservable": summary["unservable"],
    }


def outage_network(world: dict | None = None, *, down: str = SHARED_LAB) -> LabNetwork:
    return LabNetwork.from_world(world).set_status(down, "quarantined")


def compare_policies(orders: list[LabOrder], network: LabNetwork | None = None) -> dict:
    """On-time % per urgency for the three policies on the same order stream."""
    net = network or outage_network()
    return {
        "orders": len(orders),
        "policies": {
            "no_reroute": on_time_summary(plan_no_reroute(orders, net)),
            "nearest": on_time_summary(plan_nearest(orders, net)),
            "vitalswitch": on_time_summary(plan_vitalswitch(orders, net)),
        },
    }


# ---------------------------------------------------------------- order streams

ORIGIN_WEIGHTS = {"aur": 0.26, "nor": 0.2, "riv": 0.18, "eas": 0.18, "wes": 0.18}
URGENCY_WEIGHTS = {"stat": 0.45, "urgent": 0.3, "routine": 0.25}


def synnovis_orders(n: int = 40, *, window_min: float = 40.0, seed: int = 1, first_id: int = 4101) -> list[LabOrder]:
    """Deterministic stream of Lumen-bound lab orders in the first `window_min` of the outage."""
    rng = random.Random(seed)
    times = sorted(round(rng.uniform(0, window_min), 1) for _ in range(n))
    orders = []
    for i, t in enumerate(times):
        origin = rng.choices(list(ORIGIN_WEIGHTS), weights=list(ORIGIN_WEIGHTS.values()))[0]
        urgency: Urgency = rng.choices(URGENCIES, weights=[URGENCY_WEIGHTS[u] for u in URGENCIES])[0]
        test = rng.choice(TESTS_BY_URGENCY[urgency])
        orders.append(LabOrder.make(f"LAB-{first_id + i}", urgency, test, origin, t))
    return orders
