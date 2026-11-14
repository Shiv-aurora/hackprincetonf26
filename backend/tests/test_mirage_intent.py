"""MIRAGE-lite intent filter: posterior math, calibration on the demo flow, lane adjuster."""

from __future__ import annotations

import json
import random

import pytest

from mayajaal.contracts import IntentUpdate
from mayajaal.mirage.intent import (CATEGORIES, LIKELIHOOD, IntentFilter, features_from_request, intent_event,
                                    make_lane_adjuster, posterior_header, rounded)
from mayajaal.mirage.model import GOALS, STAGES
from mayajaal.mirage.planner import parse_posterior_header
from mayajaal.real.policy import PolicyInput, classify, decide

LANES = ("normal", "suspicious", "attacker")
ORDER = {"normal": 0, "suspicious": 1, "attacker": 2}

# The HTTP-only demo flow: phished nurse login -> ward read -> admin portal (denied) -> backups page
# -> bulk FHIR export -> many clinical-note reads -> honeytoken touched.
EXFIL_FLOW = [
    ("GET", "/fhir/Patient", {"hospital": "eas", "_count": "20"}, 200, None, False),
    ("GET", "/portal/admin/users", {}, 403, "T1087.002", False),
    ("GET", "/portal/backups", {}, 200, "T1078", False),
    ("GET", "/fhir/Patient", {"_count": "1000"}, 200, "T1119", False),
    *[("GET", "/fhir/DocumentReference", {"patient": f"MRN-7F3A-01{i:02d}"}, 200, "T1213", False)
      for i in range(6)],
    ("GET", "/fhir/Patient/MRN-7F3A-0193", {}, 200, "T1213", True),
]


def clinician_requests(n: int, rng: random.Random):
    """Same shapes as real/clinician_sim.py: ward list, then a patient and their labs."""
    out = []
    while len(out) < n:
        mrn = f"MRN-{rng.randrange(100000, 999999)}"
        out += [("GET", "/fhir/Patient", {"hospital": "eas", "_count": "20"}),
                ("GET", f"/fhir/Patient/{mrn}", {}), ("GET", "/fhir/Observation", {"patient": mrn})]
        if rng.random() < 0.3:
            out.append(("GET", "/fhir/DocumentReference", {"patient": mrn}))
    return out[:n]


def run_flow(f: IntentFilter, sid: str = "s1"):
    states = []
    for m, p, q, st, tech, ht in EXFIL_FLOW:
        states.append(f.observe(sid, features_from_request(m, p, q, st, technique=tech, honeytoken_touched=ht,
                                                           own_hospital="eas")))
    return states


# --------------------------------------------------------------------------- model / posterior


def test_likelihood_rows_are_distributions():
    for g in GOALS:
        for s in STAGES:
            assert sum(LIKELIHOOD[(g, s)].values()) == pytest.approx(1.0)
            assert set(LIKELIHOOD[(g, s)]) == set(CATEGORIES)


def test_posterior_sums_to_one_under_random_observations():
    rng = random.Random(7)
    f = IntentFilter()
    for i in range(300):
        feats = {"category": rng.choice(CATEGORIES), "denied": rng.random() < 0.1,
                 "honeytoken": rng.random() < 0.05}
        if rng.random() < 0.1:
            feats.update(breadcrumb="backup_share", engaged=rng.random() < 0.5)
        st = f.observe("r", feats)
        assert sum(st.posterior.values()) == pytest.approx(1.0, abs=1e-9)
        assert all(0 <= v <= 1 for v in st.posterior.values())
        assert sum(st.stage_posterior.values()) == pytest.approx(1.0, abs=1e-9)
        assert sum(rounded(st.posterior).values()) == pytest.approx(1.0, abs=1e-9)
        assert st.top_goal in GOALS and st.stage in STAGES


def test_features_from_request_categories():
    F = features_from_request
    assert F("GET", "/fhir/Patient", {"hospital": "eas", "_count": "20"}, own_hospital="eas")["category"] == "list_ward"
    assert F("GET", "/fhir/Patient", {"hospital": "aur"}, own_hospital="eas")["category"] == "list_xhosp"
    assert F("GET", "/fhir/Patient", {"hospital": "*"})["category"] == "list_xhosp"
    assert F("GET", "/fhir/Observation", {})["category"] == "list_xhosp"
    assert F("GET", "/fhir/Patient", {"_count": "1000"})["category"] == "bulk_export_huge"
    assert F("GET", "/fhir/Patient?_count=250")["category"] == "bulk_export"
    assert F("GET", "/fhir/Patient/MRN-1")["category"] == "record_read"
    assert F("GET", "/fhir/Observation", "patient=MRN-1")["category"] == "record_read"
    assert F("GET", "/fhir/DocumentReference", {"patient": "MRN-1"})["category"] == "doc_read"
    assert F("PUT", "/fhir/Observation/L1")["category"] == "obs_write"
    assert F("DELETE", "/fhir/Patient/MRN-1")["category"] == "delete"
    assert F("GET", "/fhir/metadata")["category"] == "fhir_meta"
    assert F("GET", "/portal/backups")["category"] == "backup"
    assert F("GET", "/portal/network")["category"] == "portal_network"
    f = F("GET", "/portal/admin/users", status=403)
    assert f["category"] == "portal_admin" and f["denied"] and f["surface"] == "portal"
    assert F("POST", "/auth/login", status=401)["category"] == "login_fail"
    assert F("GET", "/api/whatever", technique="T1048")["category"] == "exfil_channel"
    assert F("GET", "/fhir/Patient/MRN-1", honeytoken_touched=True)["honeytoken"] is True


# --------------------------------------------------------------------------- calibration


def test_benign_clinician_pattern_stays_benign():
    f = IntentFilter()
    adjust = make_lane_adjuster(f)
    for m, p, q in clinician_requests(150, random.Random(3)):
        st = f.observe("nurse", features_from_request(m, p, q, 200, own_hospital="eas"))
        assert st.top_goal == "benign"
        assert st.posterior["benign"] > 0.9
        with f.bind("nurse"):
            assert adjust(_inp(p, q), "normal", "") is None


def test_exfil_flow_trajectory():
    states = run_flow(IntentFilter())
    tops = [s.top_goal for s in states]
    assert tops[0] == "benign" and states[0].posterior["benign"] > 0.9
    assert "recon" in tops[1:4]                                  # admin portal / backups look like recon
    first_exfil = tops.index("exfil")
    assert tops.index("recon") < first_exfil <= 4               # bulk export tips it to exfil
    assert all(t == "exfil" for t in tops[first_exfil:])
    final = states[-1].posterior
    assert 0.78 <= final["exfil"] <= 0.95, final                # ~0.85: believable, not 0.999
    assert states[-1].stage in ("collect", "act")
    # exfil rises through the note reads
    ex = [s.posterior["exfil"] for s in states[first_exfil:]]
    assert ex == sorted(ex)


def test_exfil_flow_raises_lanes():
    f = IntentFilter()
    adjust = make_lane_adjuster(f)
    lanes = []
    lane = "normal"
    for m, p, q, st, tech, ht in EXFIL_FLOW:
        with f.bind("s1"):
            adj = adjust(_inp(p, q), lane, "")
        if adj:
            lane = adj[0]
        lanes.append(lane)
        f.observe("s1", features_from_request(m, p, q, st, technique=tech, honeytoken_touched=ht, own_hospital="eas"))
    assert lanes[0] == "normal" and lanes[1] == "normal"         # nothing known before the portal hit
    assert lanes[-1] == "attacker"


# --------------------------------------------------------------------------- lane adjuster


def _inp(path: str = "/fhir/Patient/MRN-1", q: dict | None = None, **kw) -> PolicyInput:
    return PolicyInput(config="mayajaal", req=classify("GET", path, q or {}), role="nurse", hospital_id="eas", **kw)


def _filter_with_benign(target: float) -> IntentFilter:
    """A filter whose session 's' has P(benign) at about `target` (forced belief)."""
    f = IntentFilter()
    f.observe("s", {"category": "other"})
    sess = f._sessions["s"]
    for (g, st) in sess.belief:
        sess.belief[(g, st)] = (target if g == "benign" else (1 - target) / 4) / len(STAGES)
    sess.state = f._summarise(sess)
    return f


@pytest.mark.parametrize("pb,expected", [(0.9, None), (0.5, None), (0.3, "suspicious"), (0.05, "attacker")])
def test_adjuster_thresholds_from_normal(pb, expected):
    f = _filter_with_benign(pb)
    with f.bind("s"):
        out = make_lane_adjuster(f)(_inp(), "normal", "")
    assert (out[0] if out else None) == expected
    if out:
        assert "P(benign)" in out[1]


@pytest.mark.parametrize("pb", [0.99, 0.5, 0.3, 0.2, 0.05, 0.0])
@pytest.mark.parametrize("lane", LANES)
def test_adjuster_never_lowers(pb, lane):
    f = _filter_with_benign(pb)
    with f.bind("s"):
        out = make_lane_adjuster(f)(_inp(), lane, "rule reason")
    if out is not None:
        assert ORDER[out[0]] > ORDER[lane]
        assert out[1].startswith("rule reason")


def test_adjuster_inert_without_session_or_for_unauth():
    f = _filter_with_benign(0.01)
    adj = make_lane_adjuster(f)
    assert adj(_inp(), "normal", "") is None                      # no bound session
    with f.bind("unknown"):
        assert adj(_inp(), "normal", "") is None                  # never observed
    with f.bind("s"):
        assert adj(_inp(), "unauth", "") is None                  # unauth lane is the rules' business


def test_adjuster_inside_policy_decide():
    f = _filter_with_benign(0.05)
    adj = make_lane_adjuster(f)
    with f.bind("s"):
        d = decide(_inp(), adj)
        assert d.lane == "attacker" and d.action == "deny"       # clinical read: never faked
        d2 = decide(_inp(honeytoken_touched=True), adj)
        assert d2.lane == "attacker"
    f2 = _filter_with_benign(0.99)
    with f2.bind("s"):
        d3 = decide(_inp(lane="suspicious"), make_lane_adjuster(f2))
        assert d3.lane == "suspicious"                            # benign posterior does not lower


# --------------------------------------------------------------------------- events / header


def test_intent_event_emits_only_on_meaningful_moves():
    f = IntentFilter()
    f.observe("c", features_from_request("GET", "/fhir/Patient", {"hospital": "eas"}, own_hospital="eas"))
    ev = f.maybe_event("c", run_id="r1", hospital_id="eas")
    assert ev is not None and ev.type == "intent.update" and ev.actor == "defender"
    IntentUpdate.model_validate(ev.data)
    assert sum(ev.data["posterior"].values()) == pytest.approx(1.0)
    f.observe("c", features_from_request("GET", "/fhir/Patient/MRN-1", own_hospital="eas"))
    assert f.maybe_event("c", run_id="r1") is None                # nothing moved
    f.observe("c", features_from_request("GET", "/portal/admin/users", status=403))
    ev2 = f.maybe_event("c", run_id="r1")
    assert ev2 is not None and "Admin portal" in ev2.data["evidence"]


def test_intent_event_top_goal_change_and_delta():
    from mayajaal.mirage.intent import IntentState
    st = IntentState(posterior={"benign": 0.46, "recon": 0.47, "exfil": 0.03, "tamper": 0.02, "disrupt": 0.02},
                     top_goal="recon", stage="recon")
    last = {"benign": 0.48, "recon": 0.45, "exfil": 0.03, "tamper": 0.02, "disrupt": 0.02}
    assert intent_event(st, run_id="r", session_id="s", last=last) is not None     # top goal flipped
    last2 = {"benign": 0.44, "recon": 0.49, "exfil": 0.03, "tamper": 0.02, "disrupt": 0.02}
    assert intent_event(st, run_id="r", session_id="s", last=last2) is None
    assert intent_event(st, run_id="r", session_id="s", last=last2, force=True) is not None


def test_posterior_header_roundtrip():
    states = run_flow(IntentFilter())
    h = posterior_header(states[-1].posterior)
    assert " " not in h and len(h) < 120
    back = parse_posterior_header(h)
    assert back is not None and set(back) == set(GOALS)
    assert back["exfil"] == pytest.approx(states[-1].posterior["exfil"], abs=2e-3)
    assert json.loads(IntentFilter().header("nobody"))["benign"] == pytest.approx(0.8)
