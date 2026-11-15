"""How early does First Sight fire, and how often does it flag a real clinician? (simulation)

    cd backend && uv run python -m mayajaal.real.firstsight_eval

Runs the real FirstSight class on simulated sessions with a fake clock. Everything about the
sessions (client mix, pauses, typos) is a hand-set assumption, so the numbers show how the detector
BEHAVES, not how it would score in a hospital. Writes firstsight_eval.json next to this file.

Attack sequence: the same as scripts/record_runs.py. The policy rules first fire on request 3 (the admin
portal), so "before the rules" means First Sight fired at login or on requests 1-2, i.e. before
the attacker was shown anything beyond the login itself.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from statistics import median

from mayajaal.real.firstsight import FirstSight

RULE_FIRES_AT = 3
N_BENIGN = 4000
N_ATTACK = 1000
OUT = Path(__file__).with_name("firstsight_eval.json")

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0"
EHR_UA = "MeridianEHR/4.2"


class Clock:
    t = 0.0

    def __call__(self) -> float:
        return self.t


def lognormal(rng: random.Random, median_s: float, sigma: float) -> float:
    return math.exp(math.log(median_s) + sigma * rng.gauss(0, 1))


def benign(rng: random.Random, ew: FirstSight, clk: Clock, i: int) -> bool:
    """One clinician shift segment. Returns True if the detector (wrongly) fired."""
    user = f"user{i % 400}"
    home = f"10.1.{i % 400 // 250}.{i % 250}"
    ew.addresses.setdefault(user, set()).add(home)       # they have logged in before
    ip = f"172.16.9.{rng.randrange(250)}" if rng.random() < 0.05 else home    # 5%: another workstation
    for _ in range(rng.choices([0, 1, 2], [0.9, 0.07, 0.03])[0]):              # password typos
        ew.on_failed_login(ip)
        clk.t += lognormal(rng, 6, 0.4)
    ehr = rng.random() < 0.8                                                   # 20% use the web portal
    ua = EHR_UA if ehr else BROWSER_UA
    managed = ehr or rng.random() < 0.5                       # half of portal use is from home
    if not managed and rng.random() < 0.3:
        ip = f"203.0.113.{rng.randrange(250)}"                # ...and some of that from a new place
    sid = f"b{i}"
    ew.on_login(sid, username=user, role="nurse", ua=ua, ip=ip, managed=managed)
    for _ in range(rng.randint(8, 40)):
        clk.t += lognormal(rng, 0.6, 0.5) if rng.random() < 0.15 else lognormal(rng, 12, 1.0)   # double-clicks
        st = ew.before(sid, target_patient=f"MRN-{rng.randrange(22)}")
        ew.after(sid, status=404 if rng.random() < 0.02 else 200)
        if st.fired:
            return True
    return ew.state(sid).fired


PROFILES = {
    # name: (client, pause median s, pause sigma, from outside?, description)
    # "from outside": the stolen password is used from the attacker's own machine (new address, no
    # device certificate). Otherwise the attacker runs on the nurse's own workstation (malware).
    "scripted_outside": ("python-httpx/0.28.1", 0.6, 0.05, True, "a Python script from outside (the recorded attacker)"),
    "ai_agent_outside": (BROWSER_UA, 2.0, 0.25, True, "an LLM agent claiming to be Chrome, from outside"),
    "human_outside": (BROWSER_UA, 15.0, 1.0, True, "a person in a browser at human speed, from outside"),
    "spoofs_ehr_outside": (EHR_UA, 2.0, 0.25, True, "an agent copying the EHR app's client string, from outside"),
    "ai_agent_on_nurse_pc": (BROWSER_UA, 2.0, 0.25, False, "an LLM agent running on the nurse's own PC"),
    "human_on_nurse_pc": (BROWSER_UA, 15.0, 1.0, False, "a person at the nurse's own PC, human speed"),
}


def attacker(rng: random.Random, ew: FirstSight, clk: Clock, i: int, prof: tuple, tag: str = "") -> int | None:
    """Request number at which First Sight fired (0 = login), or None if it never did."""
    ua, med, sig, outside, _ = prof
    user = "n.okafor"
    ew.addresses[user] = {"10.1.0.7"}                    # the real nurse's workstation
    ip = f"198.51.100.{i % 250}" if outside else "10.1.0.7"
    sid = f"a{tag}{i}"
    st = ew.on_login(sid, username=user, role="nurse", ua=ua, ip=ip, managed=not outside)
    if st.fired:
        return 0
    for n in range(1, 16):
        clk.t += lognormal(rng, med, sig)
        st = ew.before(sid)
        ew.after(sid, status=200)
        if st.fired:
            return n
    return None


def main(seed: int = 7) -> dict:
    rng = random.Random(seed)
    clk = Clock()
    ew = FirstSight(clock=clk)
    fp = sum(benign(rng, ew, clk, i) for i in range(N_BENIGN))
    fired = [st for sid, st in ew.sessions.items() if sid.startswith("b") and st.fired]
    off_site = sum(1 for st in fired if {"unmanaged_device", "new_address"} <= {x for _, x, _ in st.evidence})
    out: dict = {
        "note": "Simulation with hand-set session distributions; shows behaviour, not field accuracy. "
                "A false alarm costs the clinician one badge + MFA prompt; they still get real data.",
        "benign_sessions": N_BENIGN, "false_alarm_rate": round(fp / N_BENIGN, 4),
        "false_alarms_from_unmanaged_device_at_new_address": round(off_site / N_BENIGN, 4),
        "rule_fires_at_request": RULE_FIRES_AT, "profiles": {},
    }
    for name, prof in PROFILES.items():
        hits = []
        for i in range(N_ATTACK):
            clk.t += 3600
            hits.append(attacker(rng, ew, clk, i, prof, tag=name))
        caught = [h for h in hits if h is not None]
        before = sum(1 for h in caught if h < RULE_FIRES_AT)
        detect = [min(h, RULE_FIRES_AT) if h is not None else RULE_FIRES_AT for h in hits]
        out["profiles"][name] = {
            "what": prof[4],
            "caught_before_rules": round(before / N_ATTACK, 3),
            "caught_at_login": round(sum(1 for h in caught if h == 0) / N_ATTACK, 3),
            "median_detect_request": median(detect),
            "median_detect_request_rules_only": RULE_FIRES_AT,
        }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    return out


if __name__ == "__main__":
    r = main()
    print(f"false alarms on {r['benign_sessions']} simulated clinician sessions: {r['false_alarm_rate']:.1%} "
          f"({r['false_alarms_from_unmanaged_device_at_new_address']:.1%} = own laptop from a new place)")
    print(f"{'profile':22s} {'before rules':>12s} {'at login':>9s} {'median request':>15s}")
    for k, v in r["profiles"].items():
        print(f"{k:22s} {v['caught_before_rules']:>12.0%} {v['caught_at_login']:>9.0%} "
              f"{v['median_detect_request']:>8} (rules: {v['median_detect_request_rules_only']})")
