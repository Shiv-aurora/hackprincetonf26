"""Offline evaluation of MIRAGE-lite breadcrumb planning. SIMULATION ONLY.

    cd backend && uv run python -m mayajaal.mirage.evaluate [--seeds 500] [--steps 30]

This simulates sessions drawn from OUR OWN hand-written model and asks how quickly the intent filter
identifies the true goal under three breadcrumb strategies. It is a sanity check of the planner's
logic, not a measurement of real attackers or of real agent behaviour.

Simulated attacker (one session per seed per true goal; the same seed gives the same request
stream under every strategy, so strategies are compared on common random numbers):
  - stage starts at "recon" and advances with prob SIM_ADVANCE per request ("act" absorbing);
  - each request's category is drawn from (1 - NOISE) * P(category | goal, stage) + NOISE * GENERIC,
    where GENERIC is a goal-agnostic mix (portal pages, lists, record reads, discovery). Benign
    sessions draw from P(category | benign) only. NOISE makes routine traffic weaker evidence than
    the filter believes, which is where breadcrumbs earn their keep;
  - the session counts as diverted once the filter's P(benign) < 0.35 (the gateway's suspicious
    threshold); breadcrumbs are only planted after that;
  - when a breadcrumb of kind k is planted, the next request takes it with probability
    P_sim(engage | goal, k) and the filter observes {"breadcrumb": k, "engaged": taken}.
    "matched":       P_sim = the planner's own table (mirage/model.py);
    "misspecified":  P_sim = 0.5 * table + 0.5 * 0.4 (attackers less predictable than we assume).

Strategies: mirage (max-IG planner), random (uniform unplanted kind, same cadence), none.
Metrics: steps until P(true goal) > 0.8 (censored at --steps; "reached" = share that got there),
and top-goal accuracy at step 10.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import time
from pathlib import Path
from typing import Any

from mayajaal.mirage.intent import LIKELIHOOD, IntentFilter
from mayajaal.mirage.model import ENGAGE, GOALS, STAGES
from mayajaal.mirage.planner import Planner, RandomPlanner
from mayajaal.world_api import SessionContext

LABEL = "Simulation of our own model (hand-written likelihoods), not a measurement of real attackers."
NOISE = 0.5
SIM_ADVANCE = 0.2
DIVERT_BELOW = 0.35
CONFIDENT = 0.8
ACC_STEP = 10
GENERIC = {"portal_admin": 0.2, "list_xhosp": 0.15, "record_read": 0.2, "fhir_meta": 0.15,
           "discovery": 0.15, "other": 0.15}
STRATEGIES = ("mirage", "random", "none")
VARIANTS = ("matched", "misspecified")
OUT_PATH = Path(__file__).with_name("eval_results.json")


class SimWorld:
    tier = "shadow"
    static = False

    def __init__(self) -> None:
        self.breadcrumbs: dict[str, str] = {}

    def plant_breadcrumb(self, kind: str) -> str:
        return self.breadcrumbs.setdefault(kind, f"/sim/{kind}")


def _draw(rng: random.Random, dist: dict[str, float]) -> str:
    r, acc = rng.random() * sum(dist.values()), 0.0
    for k, v in dist.items():
        acc += v
        if r <= acc:
            return k
    return k


def _request_dist(goal: str, stage: str) -> dict[str, float]:
    base = LIKELIHOOD[(goal, stage)]
    if goal == "benign":
        return dict(base)
    cats = list(base) + [c for c in GENERIC if c not in base]     # fixed order: deterministic draws
    return {c: (1 - NOISE) * base.get(c, 0.0) + NOISE * GENERIC.get(c, 0.0) for c in cats}


_DISTS = {(g, s): _request_dist(g, s) for g in GOALS for s in STAGES}


def sim_engage(variant: str, goal: str, kind: str) -> float:
    p = ENGAGE[kind][goal]
    return p if variant == "matched" else 0.5 * p + 0.5 * 0.4


def run_session(goal: str, seed: int, strategy: str, variant: str, steps: int) -> dict[str, Any]:
    req_rng = random.Random(f"req|{goal}|{seed}")
    eng_rng = random.Random(f"eng|{goal}|{seed}|{strategy}")
    planner: Planner | None = {"mirage": Planner(), "random": RandomPlanner(rng=random.Random(f"pick|{seed}")),
                               "none": None}[strategy]
    filt, world = IntentFilter(), SimWorld()
    ctx = SessionContext(session_id=f"sim-{goal}-{seed}", run_id="mirage-eval")
    stage_i, diverted, pending = 0, False, None
    hit, top_at, planted = None, None, []
    for t in range(1, steps + 1):
        stage = STAGES[stage_i]
        feats: dict[str, Any] = {"category": _draw(req_rng, _DISTS[(goal, stage)])}
        if pending is not None:
            feats["breadcrumb"] = pending
            feats["engaged"] = eng_rng.random() < sim_engage(variant, goal, pending)
            pending = None
        st = filt.observe(ctx.session_id, feats)
        if stage_i < len(STAGES) - 1 and req_rng.random() < SIM_ADVANCE:
            stage_i += 1
        if hit is None and st.posterior[goal] > CONFIDENT:
            hit = t
        if t == ACC_STEP:
            top_at = st.top_goal
        diverted = diverted or st.posterior["benign"] < DIVERT_BELOW
        if planner is not None:
            ev = planner.maybe_plant(st.posterior, world, ctx, diverted=diverted)
            if ev is not None:
                pending = ev.data["kind"]
                planted.append((t, pending, ev.data["info_gain"]))
    return {"steps_to_confident": hit, "correct_at_10": top_at == goal, "diverted": diverted,
            "breadcrumbs": planted}


def evaluate(seeds: int = 300, steps: int = 30) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for variant in VARIANTS:
        results[variant] = {}
        for goal in GOALS:
            results[variant][goal] = {}
            for strategy in STRATEGIES:
                runs = [run_session(goal, s, strategy, variant, steps) for s in range(seeds)]
                hits = [r["steps_to_confident"] for r in runs]
                censored = [h if h is not None else steps for h in hits]
                gains = [g for r in runs for (_, _, g) in r["breadcrumbs"]]
                results[variant][goal][strategy] = {
                    "mean_steps_to_0.8": round(statistics.fmean(censored), 2),
                    "median_steps_to_0.8": statistics.median(censored),
                    "reached_0.8": round(sum(h is not None for h in hits) / seeds, 3),
                    "accuracy_at_10": round(sum(r["correct_at_10"] for r in runs) / seeds, 3),
                    "diverted": round(sum(r["diverted"] for r in runs) / seeds, 3),
                    "breadcrumbs_per_session": round(sum(len(r["breadcrumbs"]) for r in runs) / seeds, 2),
                    "mean_info_gain_bits": round(statistics.fmean(gains), 3) if gains else 0.0,
                }
    return results


def _summary(results: dict[str, Any]) -> dict[str, Any]:
    """Averages over the four attack goals (benign is reported separately as a false-positive check)."""
    out: dict[str, Any] = {}
    attack = [g for g in GOALS if g != "benign"]
    for variant, per_goal in results.items():
        out[variant] = {}
        for strategy in STRATEGIES:
            rows = [per_goal[g][strategy] for g in attack]
            out[variant][strategy] = {
                "mean_steps_to_0.8": round(statistics.fmean(r["mean_steps_to_0.8"] for r in rows), 2),
                "reached_0.8": round(statistics.fmean(r["reached_0.8"] for r in rows), 3),
                "accuracy_at_10": round(statistics.fmean(r["accuracy_at_10"] for r in rows), 3),
            }
    return out


def format_table(results: dict[str, Any], summary: dict[str, Any], steps: int) -> str:
    lines = [f"MIRAGE-lite offline evaluation -- {LABEL}", ""]
    for variant in VARIANTS:
        lines.append(f"[{variant}]  steps to P(true goal) > 0.8 (censored at {steps}) | reached | acc@10")
        lines.append(f"  {'goal':8} " + "  ".join(f"{s:>22}" for s in STRATEGIES))
        for goal in GOALS + ("ATTACK AVG",):
            cells = []
            for s in STRATEGIES:
                r = summary[variant][s] if goal == "ATTACK AVG" else results[variant][goal][s]
                cells.append(f"{r['mean_steps_to_0.8']:6.1f} | {r['reached_0.8']:4.0%} | {r['accuracy_at_10']:4.0%}")
            lines.append(f"  {goal[:10]:10} " + "  ".join(f"{c:>22}" for c in cells))
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seeds", type=int, default=500)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args(argv)
    t0 = time.time()
    results = evaluate(args.seeds, args.steps)
    summary = _summary(results)
    print(format_table(results, summary, args.steps))
    payload = {"label": LABEL, "seeds_per_cell": args.seeds, "max_steps": args.steps,
               "confident_threshold": CONFIDENT, "accuracy_step": ACC_STEP, "noise": NOISE,
               "strategies": list(STRATEGIES), "variants": list(VARIANTS),
               "summary_attack_goals": summary, "results": results}
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {args.out}  ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    main()
