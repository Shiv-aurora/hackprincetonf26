"""Synnovis-style scenario: the shared pathology lab goes dark and VitalSwitch reroutes.

A **scripted incident replay** (run.started: model "scripted", live False). Every number in it
comes from the VitalSwitch simulation in vitalswitch.py on a deterministic order stream.

    cd backend && uv run python -m mayajaal.continuity.scenario synnovis [--speed 1] [--run-id ...]

Timeline (wall seconds at speed 1, ~80 s total):
    run.started → all nodes healthy + key shares safe → baseline continuity.stats
    → Lumen compromised → its key share captured (1 of 3, key safe) → Lumen quarantined
    → projected stats if nothing reroutes → ~40 lab.order queued / rerouted / unservable /
    completed with continuity.stats after each decision epoch → run.ended

Simulated minutes map to wall time by a log time-lapse (the first hour plays slowly, the long
tail of urgent/routine completions is compressed). `eta_min` values are simulated minutes.
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import math
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from mayajaal.contracts import Event, load_world, make_event

from . import vitalswitch as vs
from .custody import KeyCustody

Sink = Callable[[Event], Awaitable[None] | None]

ATTACKER_LABEL = "synnovis-replay"
SHARED_LAB = vs.SHARED_LAB

# time-lapse: wall_s = A * ln(1 + sim_min / B), capped
LAPSE_A = 22.0
LAPSE_B = 20.0
ORDERS_START_S = 7.0
LAPSE_CAP_S = 62.0
DECISION_LAG_S = 0.6       # rerouted shows a beat after the epoch closes


def lapse(sim_min: float) -> float:
    return ORDERS_START_S + min(LAPSE_A * math.log1p(max(sim_min, 0.0) / LAPSE_B), LAPSE_CAP_S)


@dataclass(frozen=True)
class Step:
    """One scheduled event: when (wall s at speed 1), and what to build."""
    at: float
    order: int                 # tie-break for steps at the same instant
    type: str
    data: dict[str, Any]
    hospital_id: str | None = None


# ---------------------------------------------------------------- comparison


def synnovis_comparison(*, seed: int = 1, n: int = 40) -> dict:
    """Three-policy comparison on the scenario's order stream (JSON-ready)."""
    orders = vs.synnovis_orders(n, seed=seed)
    out = vs.compare_policies(orders, vs.outage_network())
    out["baseline"] = vs.on_time_summary(vs.plan_vitalswitch(orders, vs.LabNetwork.from_world()))
    out["scenario"] = "synnovis"
    out["seed"] = seed
    out["model"] = {
        "shared_lab": SHARED_LAB,
        "in_house_spare_fraction": vs.IN_HOUSE_SPARE,
        "courier_overhead_min": vs.COURIER_OVERHEAD_MIN,
        "min_per_grid_unit": vs.MIN_PER_GRID_UNIT,
        "deadlines_min": vs.DEADLINE_MIN,
        "epoch_min": vs.EPOCH_MIN,
        "note": "Scripted simulation. Lumen stays down for the whole scenario.",
    }
    return out


def format_comparison(cmp: dict) -> str:
    rows = [("baseline (Lumen up)", cmp["baseline"])] + [
        (name, cmp["policies"][key]) for key, name in
        (("no_reroute", "no reroute (wait)"), ("nearest", "nearest healthy lab"), ("vitalswitch", "VitalSwitch"))
    ]
    lines = [f"Synnovis-style outage, {cmp['orders']} lab orders (seed {cmp['seed']}) — on-time %",
             f"{'policy':<22}{'STAT':>8}{'urgent':>9}{'routine':>9}{'unservable':>12}"]
    for name, s in rows:
        lines.append(f"{name:<22}{s['stat_on_time_pct']:>8.1f}{s['urgent_on_time_pct']:>9.1f}"
                     f"{s['routine_on_time_pct']:>9.1f}{s['unservable']:>12d}")
    return "\n".join(lines)


# ---------------------------------------------------------------- timeline


def _projected_stats(decided: list[vs.Assignment], totals: dict[str, int], shock: dict) -> dict:
    """continuity.stats over the full order book: placed orders count by their plan,
    unplaced ones keep the no-reroute outcome (shock)."""
    out: dict[str, Any] = {}
    for u in vs.URGENCIES:
        total = totals[u]
        if not total:
            out[f"{u}_on_time_pct"] = 100.0
            continue
        placed = [a for a in decided if a.order.urgency == u]
        unplaced_ok = (total - len(placed)) * shock[f"{u}_on_time_pct"] / 100.0
        out[f"{u}_on_time_pct"] = round(100.0 * (sum(a.on_time for a in placed) + unplaced_ok) / total, 1)
    out["unservable"] = sum(a.status == "unservable" for a in decided)
    return out


def build_timeline(*, seed: int = 1, n: int = 40, custody: KeyCustody | None = None) -> list[Step]:
    world = load_world()
    custody = custody or KeyCustody(world=world)
    orders = vs.synnovis_orders(n, seed=seed)
    plan = vs.plan_vitalswitch(orders, vs.outage_network(world))
    baseline = vs.on_time_summary(vs.plan_vitalswitch(orders, vs.LabNetwork.from_world(world)))
    shock = vs.on_time_summary(vs.plan_no_reroute(orders, vs.outage_network(world)))

    steps: list[Step] = []
    seq = iter(range(1, 1_000_000))

    def add(at: float, type: str, data: dict, hospital_id: str | None = None) -> None:
        steps.append(Step(round(at, 3), next(seq), type, data, hospital_id))

    add(0.0, "run.started", {"mission": "disrupt", "config": "mayajaal", "model": "scripted",
                             "attacker_label": ATTACKER_LABEL, "live": False})
    for h in world["hospitals"]:
        add(0.2, "node.status", {"status": "healthy", "reason": ""}, h["id"])
        add(0.2, "keyshare.status", custody.status_event(h["id"]).data, h["id"])
    add(0.5, "continuity.stats", vs.stats_payload(baseline))

    add(3.0, "node.status", {"status": "compromised",
                             "reason": "Ransomware encrypting LIS servers (simulated Synnovis-style incident)."},
        SHARED_LAB)
    add(3.6, "keyshare.status", custody.capture(SHARED_LAB).data, SHARED_LAB)
    held = len(custody.captured)
    add(5.0, "node.status", {"status": "quarantined",
                             "reason": f"Isolated from the Jaal; links cut. {held} of {custody.threshold} "
                                       "key shares captured, master key safe."}, SHARED_LAB)
    add(5.5, "continuity.stats", vs.stats_payload(shock))

    def order_data(a: vs.Assignment, status: str, to: str | None, eta: float | None) -> dict:
        o = a.order
        return {"order_id": o.order_id, "urgency": o.urgency, "test": o.test, "from_hospital": o.origin,
                "to_hospital": to, "status": status, "eta_min": eta}

    for a in plan:
        add(lapse(a.order.created_min), "lab.order", order_data(a, "queued", None, None), a.order.origin)

    # Decisions, grouped by epoch, each epoch followed by the running stats. Stats are projected
    # over the incident's whole order book: an order VitalSwitch has not placed yet is still
    # waiting for Lumen (the no-reroute outcome: late), so on-time % climbs from the shock value.
    totals = {u: sum(o.urgency == u for o in orders) for u in vs.URGENCIES}
    decided: list[vs.Assignment] = []
    by_epoch: dict[float, list[vs.Assignment]] = {}
    for a in plan:
        by_epoch.setdefault(a.dispatched_min, []).append(a)
    for now in sorted(by_epoch):
        batch = by_epoch[now]
        t = lapse(now) + DECISION_LAG_S
        for i, a in enumerate(batch):
            at = t + 0.15 * i
            if a.status == "unservable":
                add(at, "lab.order", order_data(a, "unservable", None, None), a.order.origin)
            else:
                add(at, "lab.order", order_data(a, "rerouted", a.lab_id, a.eta_min), a.order.origin)
        decided.extend(batch)
        add(t + 0.15 * len(batch), "continuity.stats", _projected_stats(decided, totals, shock))

    for a in plan:
        if a.status == "completed" and a.completion_min is not None:
            add(lapse(a.completion_min) + DECISION_LAG_S, "lab.order",
                order_data(a, "completed", a.lab_id, 0.0), a.lab_id)

    final = vs.on_time_summary(plan)
    end = max(s.at for s in steps) + 1.0
    add(end, "continuity.stats", vs.stats_payload(final))
    nearest = vs.on_time_summary(vs.plan_nearest(orders, vs.outage_network(world)))
    summary = (f"Scripted Synnovis-style replay. Lumen quarantined; {held}/{custody.threshold} key shares captured, "
               f"key safe. STAT on time: VitalSwitch {final['stat_on_time_pct']:.0f}% vs nearest-lab "
               f"{nearest['stat_on_time_pct']:.0f}% vs no reroute {shock['stat_on_time_pct']:.0f}%; "
               f"{final['unservable']} unservable (no lab could meet the deadline).")
    add(end + 0.5, "run.ended", {
        "outcome": {"believed_success": True, "secrets_leaked": 0, "suspected_honeypot": False,
                    "mission_won": final["stat_on_time_pct"] < 80.0},
        "summary": summary,
        "duration_s": 0.0,  # filled in at emission
    })
    steps.sort(key=lambda s: (s.at, s.order))
    return steps


# ---------------------------------------------------------------- run


async def _send(sink: Sink, ev: Event) -> None:
    res = sink(ev)
    if inspect.isawaitable(res):
        await res


async def run_synnovis(sink: Sink, speed: float = 1.0, run_id: str | None = None, *,
                       seed: int = 1, n: int = 40) -> dict:
    """Emit the scenario through `sink` in real time (scaled by `speed`). Returns
    {"run_id", "comparison", "events"}."""
    if speed <= 0:
        raise ValueError("speed must be > 0")
    run_id = run_id or f"synnovis-{uuid.uuid4().hex[:8]}"
    steps = build_timeline(seed=seed, n=n)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    wall0 = time.time()
    for seq, step in enumerate(steps, start=1):
        delay = t0 + step.at / speed - loop.time()
        if delay > 0:
            await asyncio.sleep(delay)
        data = step.data
        if step.type == "run.ended":
            data = {**data, "duration_s": round(time.time() - wall0, 2)}
        ev = make_event(step.type, data, run_id=run_id, actor="system", hospital_id=step.hospital_id, seq=seq)  # type: ignore[arg-type]
        await _send(sink, ev)
    return {"run_id": run_id, "comparison": synnovis_comparison(seed=seed, n=n), "events": len(steps)}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m mayajaal.continuity.scenario")
    p.add_argument("scenario", choices=["synnovis"])
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--run-id", default=None)
    p.add_argument("--seed", type=int, default=1)
    args = p.parse_args(argv)

    from mayajaal.contracts import HUB_INGEST
    from mayajaal.hub.client import emit

    print(f"[continuity] synnovis replay → {HUB_INGEST} (speed {args.speed})")
    result = asyncio.run(run_synnovis(emit, speed=args.speed, run_id=args.run_id, seed=args.seed))
    print(f"[continuity] run {result['run_id']}: {result['events']} events")
    print(format_comparison(result["comparison"]))


if __name__ == "__main__":
    main()
