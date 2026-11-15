"""Clinician simulator: normal care traffic through the gateway, to measure false positives.

    uv run python -m mayajaal.real.clinician_sim --rate 0.5            # forever, 0.5 req/s
    uv run python -m mayajaal.real.clinician_sim --rate 5 --n 200      # 200 requests, then report

Logs in as several clinicians (test accounts from seed.SIM_CLINICIANS) and makes ordinary care reads
of patients in each clinician's OWN hospital: ward list, one patient, that patient's labs.
Every request carries `X-MJ-Actor: clinician` (a ground-truth label for the UI and the canary
ledger; the policy engine never looks at it) and the admin key, so the gateway reports its decision
in X-MJ-Decision. Any decision other than allow_real is a false positive.
"""

from __future__ import annotations

import argparse
import asyncio
import random
from collections import Counter
from typing import Any

import httpx

from mayajaal.real.devices import mint as mint_device
from mayajaal.real.seed import SIM_CLINICIANS
from mayajaal.real.world import RealStore


async def run_sim(base_url: str = "http://127.0.0.1:8000", *, rate: float = 0.5, n_requests: int | None = None,
                  duration: float | None = None, client: httpx.AsyncClient | None = None,
                  admin_key: str | None = None, run_id: str | None = None, store: RealStore | None = None,
                  seed: int | None = None, verbose: bool = False) -> dict[str, Any]:
    """Run the simulator. Returns {requests, false_positives, decisions, statuses, fp_examples}."""
    if admin_key is None:
        from mayajaal.real.app import admin_key as _ak
        admin_key = _ak()
    store = store or RealStore()
    rng = random.Random(seed)
    own_client = client is None
    client = client or httpx.AsyncClient(base_url=base_url, timeout=15.0)
    base_headers = {"X-MJ-Actor": "clinician", "X-MJ-Admin": admin_key, "User-Agent": "MeridianEHR/4.2 (clinician)"}
    if run_id:
        base_headers["X-MJ-Run"] = run_id

    clinicians = []
    try:
        for username, _display, role, hospital, password in SIM_CLINICIANS:
            # each clinician signs in from one of their hospital's managed workstations
            dev = {"X-Device-Token": mint_device(f"ws-{hospital}-{abs(hash(username)) % 40:02d}")}
            r = await client.post("/auth/login", json={"username": username, "password": password},
                                  headers={**base_headers, **dev})
            if r.status_code != 200:
                print(f"[clinician_sim] login failed for {username}: {r.status_code}")
                continue
            tok = r.json()["token"]
            clinicians.append({"username": username, "role": role, "hospital": hospital,
                               "headers": {**base_headers, "Authorization": f"Bearer {tok}"},
                               "mrns": store.mrns(hospital)})
        if not clinicians:
            raise RuntimeError("no clinician could log in")

        decisions: Counter[str] = Counter()
        statuses: Counter[int] = Counter()
        fp_examples: list[str] = []
        sent = 0
        loop = asyncio.get_running_loop()
        t_end = loop.time() + duration if duration else None
        while (n_requests is None or sent < n_requests) and (t_end is None or loop.time() < t_end):
            c = rng.choice(clinicians)
            mrn = rng.choice(c["mrns"])
            path = rng.choice([
                f"/fhir/Patient?hospital={c['hospital']}&_count=20",
                f"/fhir/Patient/{mrn}",
                f"/fhir/Observation?patient={mrn}",
                f"/fhir/Patient/{mrn}",
                f"/fhir/Observation?patient={mrn}",
            ])
            r = await client.get(path, headers=c["headers"])
            sent += 1
            decision = r.headers.get("x-mj-decision") or ("allow_real" if r.status_code < 400 else f"http_{r.status_code}")
            decisions[decision] += 1
            statuses[r.status_code] += 1
            if decision != "allow_real" and len(fp_examples) < 10:
                fp_examples.append(f"{c['username']} GET {path} -> {decision} ({r.status_code})")
            if verbose:
                print(f"{c['username']:<12} {r.status_code} {decision:<14} GET {path}")
            if rate > 0:
                await asyncio.sleep(1.0 / rate)
    finally:
        if own_client:
            await client.aclose()

    fps = sum(v for k, v in decisions.items() if k != "allow_real")
    return {"requests": sent, "false_positives": fps, "decisions": dict(decisions),
            "statuses": dict(statuses), "fp_examples": fp_examples}


def main() -> None:
    p = argparse.ArgumentParser(description="Simulate normal clinician reads through the gateway")
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--rate", type=float, default=0.5, help="requests per second (0 = as fast as possible)")
    p.add_argument("--n", type=int, default=None, help="stop after N requests")
    p.add_argument("--duration", type=float, default=None, help="stop after this many seconds")
    p.add_argument("--run", default=None, help="X-MJ-Run to tag the traffic with")
    p.add_argument("--quiet", action="store_true")
    args = p.parse_args()
    try:
        res = asyncio.run(run_sim(args.url, rate=args.rate, n_requests=args.n, duration=args.duration,
                                  run_id=args.run, verbose=not args.quiet))
    except KeyboardInterrupt:
        return
    print(f"\nclinician requests: {res['requests']}  false positives (not allow_real): {res['false_positives']}")
    print(f"decisions: {res['decisions']}  statuses: {res['statuses']}")
    for ex in res["fp_examples"]:
        print("  FP:", ex)


if __name__ == "__main__":
    main()
