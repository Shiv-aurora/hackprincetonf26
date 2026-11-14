"""Shared pieces of MIRAGE-lite: goals, stages, the breadcrumb engagement table, entropy and
information gain. Pure Python, no I/O, no imports from mayajaal.real (the shadow process uses it).

Breadcrumb engagement table: P(engage | goal, kind), the chance that a session pursuing `goal`
takes the lure within a few requests (opens the dump, uses the credential, ...). Hand-written:

    kind                  benign  recon  exfil  tamper  disrupt
    backup_share           0.02    0.40   0.85   0.15    0.35
    admin_credential       0.02    0.55   0.30   0.45    0.75
    research_dataset       0.02    0.30   0.80   0.05    0.05
    lab_service_account    0.01    0.30   0.10   0.85    0.40
    vpn_config             0.02    0.70   0.25   0.20    0.60

Reading it: a backup dump separates exfil from tamper; a lab service account (results.write scope)
separates tamper from exfil; a VPN config separates recon/disrupt from exfil.
"""

from __future__ import annotations

import math
from typing import Iterable, Mapping

GOALS: tuple[str, ...] = ("benign", "recon", "exfil", "tamper", "disrupt")
STAGES: tuple[str, ...] = ("recon", "access", "collect", "act")
KINDS: tuple[str, ...] = ("backup_share", "admin_credential", "research_dataset", "lab_service_account",
                          "vpn_config")


def parse_table(doc: str, first_col: str) -> dict[str, list[float]]:
    """Parse a whitespace table out of a docstring: the block starting at the header line whose first
    word is `first_col`, ending at the first blank line. '|' separators are ignored."""
    rows: dict[str, list[float]] = {}
    lines = (doc or "").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.split()[:1] == [first_col])
    for ln in lines[start + 1:]:
        if not ln.strip():
            break
        cells = ln.replace("|", " ").split()
        rows[cells[0]] = [float(c) for c in cells[1:]]
    return rows


ENGAGE: dict[str, dict[str, float]] = {
    kind: dict(zip(GOALS, vals)) for kind, vals in parse_table(__doc__, "kind").items()
}


def normalize(p: Mapping[str, float], keys: Iterable[str] = GOALS) -> dict[str, float]:
    keys = tuple(keys)
    vals = [max(0.0, float(p.get(k, 0.0))) for k in keys]
    z = sum(vals)
    if z <= 0 or not math.isfinite(z):
        return {k: 1.0 / len(keys) for k in keys}
    return {k: v / z for k, v in zip(keys, vals)}


def entropy(probs: Iterable[float]) -> float:
    """Shannon entropy in bits."""
    return -sum(p * math.log2(p) for p in probs if p > 0)


def info_gain(posterior: Mapping[str, float], engage: Mapping[str, float]) -> float:
    """Exact expected information gain (bits) about the goal from planting one breadcrumb whose binary
    outcome o in {engage, ignore} has P(engage | g) = engage[g]:

        IG = H(G) - sum_o P(o) H(G | o),   P(o) = sum_g P(o|g) P(g),   P(g|o) = P(o|g) P(g) / P(o)
    """
    goals = [g for g in posterior if posterior[g] > 0]
    prior = [posterior[g] for g in goals]
    z = sum(prior)
    if z <= 0:
        return 0.0
    prior = [p / z for p in prior]
    h = entropy(prior)
    expected = 0.0
    for outcome in (True, False):
        like = [engage.get(g, 0.0) if outcome else 1.0 - engage.get(g, 0.0) for g in goals]
        joint = [l * p for l, p in zip(like, prior)]
        po = sum(joint)
        if po > 0:
            expected += po * entropy(j / po for j in joint)
    return max(0.0, h - expected)
