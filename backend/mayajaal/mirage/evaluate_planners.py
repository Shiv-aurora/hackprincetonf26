"""Offline comparison of lure planners, old and new, in one harness. SIMULATION ONLY.

    cd backend && uv run python -m mayajaal.mirage.evaluate_planners [--seeds 1000] [--steps 30]

Everything here is drawn from OUR OWN hand-written model (mirage/intent.py, mirage/model.py,
mirage/suspicion.py). It checks the planners' logic against each other under stated assumptions. It
is not a measurement of real attackers, real agents or a red team.

Simulated session (extends mirage/evaluate.py; the request stream for a (goal, seed) is identical):
  - requests are drawn from (1 - NOISE) * P(category | goal, stage) + NOISE * GENERIC, the stage
    advances with prob SIM_ADVANCE, the session is diverted once P(benign) < 0.35;
  - after diversion a request of category `backup` views the backups page and `portal_admin` views
    the documents page; a lure planted on a page that was already viewed is "late";
  - a planted lure is seen on the next request and taken with P_sim(engage | goal, kind):
        "matched"       P_sim = the planner's own table
        "misspecified"  P_sim = 0.5 * table + 0.5 * 0.4
  - attacker temperament decides whether the session survives each lure it is shown:
        "bold"              never leaves
        "cautious"          leaves with the probability mirage/suspicion.py assigns (the defender's
                            suspicion model is right)
        "cautious_shifted"  leaves according to DIFFERENT weights (suspicion.SHIFTED): the defender's
                            suspicion model is wrong
    A session that leaves produces no more evidence: it is censored at --steps for "steps to
    identify" and counts as not identified unless it already was.

Common random numbers: for a given (goal, seed) every strategy sees the same request stream, the
same take/ignore draw per lure kind and the same leave draw for the i-th lure, so differences
between strategies are paired.

Strategies:
    none            no lures
    random          uniformly random lure, one per 4 requests, 3 per session
    ig1             the previous planner: max one-step information gain, one per 4 requests, 3 per session
    ig_fast         ablation: max one-step information gain every request, up to 5 (no pacing rule)
    lookahead       ablation: 2-lure lookahead on information only (no suspicion model)
    stealth1        ablation: suspicion-aware, one-step
    stealth         MIRAGE-S: suspicion-aware with 2-lure lookahead (the gateway's default planner)
    stealth_robust  MIRAGE-S + lure evidence mixed with a flat 0.5 (trust 0.7) in filter and planner

Metrics (attack goals, equal weight): steps until P(true goal) > 0.8 (censored), share identified,
top-goal accuracy when the session ends, requests the attacker stayed for, share that left early.
Benign sessions: share ever diverted (false diversion) and share cleared again by the end.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

from mayajaal.mirage.evaluate import (ACC_STEP, CONFIDENT, DIVERT_BELOW, NOISE, SIM_ADVANCE, _DISTS, _draw,
                                      sim_engage)
from mayajaal.mirage.intent import IntentFilter
from mayajaal.mirage.model import GOALS, HOST, KINDS, STAGES
from mayajaal.mirage.planner import Planner, RandomPlanner, StealthPlanner
from mayajaal.mirage.suspicion import DEFAULT, SHIFTED, LureState, apply_plant, survived

LABEL = ("Simulation of our own hand-written attacker, engagement and suspicion models. "
         "Not a measurement of real attackers and not red-team data.")
STRATEGIES = ("none", "random", "ig1", "ig_fast", "lookahead", "stealth1", "stealth", "stealth_robust")
VARIANTS = ("matched", "misspecified")
ATTACKERS = ("bold", "cautious", "cautious_shifted")
ATTACK = tuple(g for g in GOALS if g != "benign")
MIXED = "mixed"            # derived: half bold, half cautious (the prior the stealth planner assumes)
REPORTED = ATTACKERS + (MIXED,)
BASELINE = "ig1"
ROBUST_TRUST = 0.7
PAGE_OF = {"backup": "backups", "portal_admin": "docs"}
TRUE_SUSPICION = {"bold": None, "cautious": DEFAULT, "cautious_shifted": SHIFTED}
OUT_PATH = Path(__file__).with_name("eval_planners.json")
Z = 1.959964


def make_planner(strategy: str, seed: int) -> Any:
    if strategy == "none":
        return None
    if strategy == "random":
        return RandomPlanner(rng=random.Random(f"pick|{seed}"))
    if strategy == "ig1":
        return Planner()
    if strategy == "ig_fast":
        return Planner(every=1, budget=len(KINDS))
    if strategy in ("lookahead", "stealth"):
        return StealthPlanner(depth=2)
    if strategy == "stealth1":
        return StealthPlanner(depth=1)
    if strategy == "stealth_robust":
        return StealthPlanner(depth=2, trust=ROBUST_TRUST)
    raise ValueError(strategy)


def run_session(goal: str, seed: int, strategy: str, variant: str, attacker: str, steps: int) -> dict[str, Any]:
    req_rng = random.Random(f"req|{goal}|{seed}")
    u_take = {k: random.Random(f"take|{goal}|{seed}|{k}").random() for k in KINDS}
    u_leave = [random.Random(f"leave|{goal}|{seed}|{i}").random() for i in range(len(KINDS))]
    planner = make_planner(strategy, seed)
    filt = IntentFilter(planner=None, lure_trust=ROBUST_TRUST if strategy == "stealth_robust" else 1.0)
    sid = f"sim-{goal}-{seed}"
    belief = LureState(p_cautious=0.0 if strategy == "lookahead" else 0.5)     # the defender's model
    truth = LureState()                                                        # the attacker's own head
    true_model = TRUE_SUSPICION[attacker]
    stage_i, diverted, pending = 0, False, None
    hit, top_at, first_claim, late, left, top = None, None, None, 0, False, "benign"
    t = 0
    for t in range(1, steps + 1):
        cat = _draw(req_rng, _DISTS[(goal, STAGES[stage_i])])
        feats: dict[str, Any] = {"category": cat}
        if pending is not None:
            feats["breadcrumb"] = pending
            feats["engaged"] = u_take[pending] < sim_engage(variant, goal, pending)
            pending = None
        st = filt.observe(sid, feats)
        if stage_i < len(STAGES) - 1 and req_rng.random() < SIM_ADVANCE:
            stage_i += 1
        top = st.top_goal
        if hit is None and st.posterior[goal] > CONFIDENT:
            hit = t
        if first_claim is None and top != "benign" and st.posterior[top] > CONFIDENT:
            first_claim = top
        if t == ACC_STEP:
            top_at = top
        if diverted and cat in PAGE_OF:
            belief.viewed.add(PAGE_OF[cat])
            truth.viewed.add(PAGE_OF[cat])
        diverted = diverted or st.posterior["benign"] < DIVERT_BELOW
        if planner is None or not diverted or len(belief.planted) >= len(KINDS):
            continue
        belief.step = truth.step = t
        pick = planner.decide(st.posterior, belief)
        if pick is None:
            continue
        kind = pick[0]
        late += HOST[kind] in truth.viewed
        q_model = apply_plant(DEFAULT, belief, kind)
        i = truth.seen
        q_true = apply_plant(true_model, truth, kind) if true_model is not None else 0.0
        if u_leave[i] < q_true:                 # shown the lure, the attacker walks away
            left = True
            break
        survived(belief, q_model)
        pending = kind
    return {"steps": hit, "identified": hit is not None, "final_correct": top == goal,
            "correct_at_10": (top_at or top) == goal, "claim_wrong": first_claim not in (None, goal),
            "engagement": t, "left": left, "diverted": diverted, "lures": len(belief.planted), "late": late,
            "cleared": top == "benign"}


# --------------------------------------------------------------------------- statistics


def mean_ci(xs: list[float]) -> tuple[float, float]:
    """Mean and 95% half-width (normal approximation)."""
    if len(xs) < 2:
        return (statistics.fmean(xs) if xs else 0.0), 0.0
    return statistics.fmean(xs), Z * statistics.stdev(xs) / math.sqrt(len(xs))


def strat_ci(per_goal: list[list[float]]) -> tuple[float, float]:
    """Equal-weight average over goals with a stratified 95% half-width."""
    k = len(per_goal)
    m = statistics.fmean(statistics.fmean(v) for v in per_goal)
    var = sum((statistics.variance(v) if len(v) > 1 else 0.0) / len(v) for v in per_goal) / k ** 2
    return m, Z * math.sqrt(var)


METRICS = {
    "steps": lambda r, T: float(r["steps"] if r["steps"] is not None else T),
    "identified": lambda r, T: float(r["identified"]),
    "final_correct": lambda r, T: float(r["final_correct"]),
    "accuracy_at_10": lambda r, T: float(r["correct_at_10"]),
    "claim_wrong": lambda r, T: float(r["claim_wrong"]),
    "engagement": lambda r, T: float(r["engagement"]),
    "left": lambda r, T: float(r["left"]),
    "lures": lambda r, T: float(r["lures"]),
    "late_lures": lambda r, T: float(r["late"]),
}


def _cell(args: tuple[str, str, str, str, int, int]) -> tuple[tuple[str, str, str, str], list[dict[str, Any]]]:
    variant, attacker, goal, strategy, seeds, steps = args
    return (variant, attacker, goal, strategy), [run_session(goal, s, strategy, variant, attacker, steps)
                                                 for s in range(seeds)]


def run_all(seeds: int, steps: int, workers: int | None = None,
            strategies: tuple[str, ...] = STRATEGIES) -> dict[tuple[str, str, str, str], list[dict[str, Any]]]:
    jobs = [(v, a, g, s, seeds, steps) for v in VARIANTS for a in ATTACKERS for g in GOALS for s in strategies
            if not (g == "benign" and a != "bold")]              # benign users do not "leave"
    if workers == 1:
        return dict(map(_cell, jobs))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(_cell, jobs, chunksize=1))


def summarise(raw: dict[tuple[str, str, str, str], list[dict[str, Any]]], steps: int,
              strategies: tuple[str, ...] = STRATEGIES) -> dict[str, Any]:
    """Per (variant, attacker, strategy): each metric as [mean, 95% half-width] over the four attack
    goals (stratified), the paired difference to the previous planner (`ig1`), and benign checks."""
    out: dict[str, Any] = {}

    def strata(v: str, a: str, s: str) -> list[list[dict[str, Any]]]:
        kinds = ("bold", "cautious") if a == MIXED else (a,)
        return [raw[(v, k, g, s)] for k in kinds for g in ATTACK]

    for v in VARIANTS:
        out[v] = {}
        for a in REPORTED:
            out[v][a] = {}
            for s in strategies:
                cell: dict[str, Any] = {}
                for name, fn in METRICS.items():
                    cell[name] = [round(x, 4) for x in strat_ci([[fn(r, steps) for r in runs]
                                                                 for runs in strata(v, a, s)])]
                    if s != BASELINE and BASELINE in strategies:
                        diffs = [[fn(r, steps) - fn(b, steps) for r, b in zip(runs, base)]
                                 for runs, base in zip(strata(v, a, s), strata(v, a, BASELINE))]
                        cell[f"{name}_vs_{BASELINE}"] = [round(x, 4) for x in strat_ci(diffs)]
                if a != MIXED:
                    cell["by_goal_steps"] = {g: [round(x, 4) for x in mean_ci([METRICS["steps"](r, steps)
                                                                               for r in raw[(v, a, g, s)]])]
                                             for g in ATTACK}
                out[v][a][s] = cell
        out[v]["benign"] = {}
        for s in strategies:
            runs = raw[(v, "bold", "benign", s)]
            div = [r for r in runs if r["diverted"]]
            out[v]["benign"][s] = {
                "false_diversion": [round(x, 4) for x in mean_ci([float(r["diverted"]) for r in runs])],
                "lures_per_session": round(statistics.fmean(r["lures"] for r in runs), 4),
                "diverted_sessions": len(div),
                "diverted_cleared_by_end": round(sum(r["cleared"] for r in div) / len(div), 4) if div else None,
            }
    return out


def format_table(summary: dict[str, Any], steps: int, strategies: tuple[str, ...] = STRATEGIES) -> str:
    lines = [f"MIRAGE lure planners -- {LABEL}", ""]
    for v in VARIANTS:
        for a in REPORTED:
            lines.append(f"[{v} engagement table / {a} attacker]  mean +- 95% half-width over 4 attack goals")
            lines.append(f"  {'strategy':15} {'steps to 0.8':>14} {'identified':>13} {'final acc':>13} "
                         f"{'stayed (req)':>14} {'left early':>13} {'lures':>6} {'d steps vs ig1':>16}")
            for s in strategies:
                c = summary[v][a][s]
                d = c.get(f"steps_vs_{BASELINE}")
                lines.append(
                    f"  {s:15} {c['steps'][0]:7.2f} +-{c['steps'][1]:4.2f} "
                    f"{c['identified'][0]:7.1%} +-{c['identified'][1]:4.1%} "
                    f"{c['final_correct'][0]:7.1%} +-{c['final_correct'][1]:4.1%} "
                    f"{c['engagement'][0]:8.2f} +-{c['engagement'][1]:4.2f} "
                    f"{c['left'][0]:7.1%} +-{c['left'][1]:4.1%} {c['lures'][0]:6.2f} "
                    + (f"{d[0]:+8.2f} +-{d[1]:4.2f}" if d else f"{'--':>14}"))
            lines.append("")
        b = summary[v]["benign"]
        lines.append(f"[{v}] benign sessions: false diversion "
                     + ", ".join(f"{s} {b[s]['false_diversion'][0]:.1%}" for s in strategies))
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> dict[str, Any]:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seeds", type=int, default=1000)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args(argv)
    t0 = time.time()
    raw = run_all(args.seeds, args.steps, args.workers)
    summary = summarise(raw, args.steps)
    print(format_table(summary, args.steps))
    payload = {"label": LABEL, "seeds_per_cell": args.seeds, "max_steps": args.steps,
               "confident_threshold": CONFIDENT, "accuracy_step": ACC_STEP, "noise": NOISE,
               "sim_advance": SIM_ADVANCE, "divert_below": DIVERT_BELOW, "baseline": BASELINE,
               "strategies": list(STRATEGIES), "variants": list(VARIANTS), "attackers": list(REPORTED),
               "mixed": "bold and cautious sessions pooled with equal weight",
               "ci": "95% normal approximation, stratified over the four attack goals; *_vs_ig1 are paired",
               "summary": summary}
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {args.out}  ({time.time() - t0:.1f}s)")
    return payload


if __name__ == "__main__":
    main()
