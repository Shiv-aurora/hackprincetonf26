"""MIRAGE-S: the suspicion model, the stealth planner, lure directives and the planner comparison."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mayajaal.mirage import evaluate_planners as ep
from mayajaal.mirage.intent import IntentFilter, features_from_request, make_lane_adjuster, posterior_header
from mayajaal.mirage.model import ENGAGE, GOALS, HOST, KINDS, info_gain, robust_engage
from mayajaal.mirage.planner import (Planner, StealthPlanner, parse_lure_directives, parse_posterior_header)
from mayajaal.mirage.shadow_hook import make_planner_middleware
from mayajaal.mirage.suspicion import DEFAULT, LureState, apply_plant, plant_effect, survived

MIXED = {"benign": 0.05, "recon": 0.25, "exfil": 0.3, "tamper": 0.25, "disrupt": 0.15}


# --------------------------------------------------------------------------- suspicion model


def test_suspicion_rises_with_late_dense_and_bursty_lures():
    fresh = LureState()
    _, q_first = plant_effect(DEFAULT, fresh, "backup_share")
    late = LureState(viewed={"backups"})
    _, q_late = plant_effect(DEFAULT, late, "backup_share")
    assert q_first < 0.05 < q_late                       # an entry that was not there before is a tell
    st = LureState()
    qs = []
    for i, kind in enumerate(("backup_share", "vpn_config", "lab_service_account", "admin_credential")):
        st.step = 10 * (i + 1)                           # well paced
        qs.append(apply_plant(DEFAULT, st, kind))
    assert qs == sorted(qs) and qs[-1] > 0.5             # each further windfall is less believable
    a, b = LureState(), LureState()
    apply_plant(DEFAULT, a, "backup_share")
    apply_plant(DEFAULT, b, "backup_share")
    a.step, b.step = 1, 8
    assert plant_effect(DEFAULT, a, "vpn_config")[1] > plant_effect(DEFAULT, b, "vpn_config")[1]   # burst


def test_surviving_a_lure_is_evidence_of_a_bold_attacker():
    st = LureState()
    survived(st, 0.4)
    assert 0.0 < st.p_cautious < 0.5
    survived(st, 0.0)
    assert st.p_cautious == pytest.approx(0.375)         # 0.5*0.6 / (0.5*0.6 + 0.5); a safe lure says nothing


# --------------------------------------------------------------------------- stealth planner


def test_stealth_planner_plants_a_fresh_lure_and_declines_a_late_one():
    planner = StealthPlanner()
    pick = planner.decide(MIXED, LureState())
    assert pick is not None and pick[1] == pytest.approx(info_gain(MIXED, ENGAGE[pick[0]]))
    # a late lure is worth less than the same lure on a page nobody has opened yet
    fresh_q = planner.q_values(MIXED, LureState())
    late_q = planner.q_values(MIXED, LureState(viewed={"backups", "docs"}))
    assert all(late_q[k] < fresh_q[k] for k in KINDS)
    # one lure already shown, both pages viewed since: a second, late lure is declined
    st = LureState()
    apply_plant(DEFAULT, st, pick[0])
    st.step, st.viewed = 9, {"backups", "docs"}
    assert planner.decide(MIXED, st) is None
    # against an attacker it believes is bold the same late lure is worth planting
    st.p_cautious = 0.0
    assert planner.decide(MIXED, st) is not None


def test_stealth_planner_prefers_the_unviewed_page():
    planner = StealthPlanner()
    exfil_or_tamper = {"benign": 0.02, "recon": 0.08, "exfil": 0.45, "tamper": 0.4, "disrupt": 0.05}
    assert HOST[planner.decide(exfil_or_tamper, LureState(viewed={"docs"}))[0]] == "backups"
    assert HOST[planner.decide(exfil_or_tamper, LureState(viewed={"backups"}))[0]] == "docs"


def test_stealth_planner_stops_when_the_goal_is_known_or_the_budget_is_spent():
    planner = StealthPlanner()
    sure = {"benign": 0.001, "recon": 0.001, "exfil": 0.996, "tamper": 0.001, "disrupt": 0.001}
    assert planner.decide(sure, LureState()) is None
    full = LureState(planted={k: i for i, k in enumerate(KINDS)}, p_cautious=0.0, step=50, last_plant=4)
    assert planner.decide(MIXED, full) is None
    q = planner.q_values(MIXED, LureState())
    assert set(q) == set(KINDS) and all(v == v for v in q.values())


def test_lookahead_reduces_to_information_gain_without_suspicion():
    st = LureState(p_cautious=0.0)
    q1 = StealthPlanner(depth=1).q_values(MIXED, st)
    assert q1 == pytest.approx({k: info_gain(MIXED, ENGAGE[k]) for k in KINDS})
    q2 = StealthPlanner(depth=2).q_values(MIXED, st)
    assert all(q2[k] >= q1[k] - 1e-12 for k in KINDS)       # a second lure can only add information


def test_base_planner_decide_keeps_the_old_pacing():
    p = Planner()
    st = LureState(step=1)
    first = p.decide(MIXED, st)
    assert first is not None
    apply_plant(DEFAULT, st, first[0])
    st.step = 3
    assert p.decide(MIXED, st) is None                       # one per 4 requests
    st.step = 5
    assert p.decide(MIXED, st) is not None


def test_robust_engage_shrinks_toward_flat():
    row = robust_engage(ENGAGE["backup_share"], 0.7)
    assert row["exfil"] == pytest.approx(0.7 * 0.85 + 0.15) and row["benign"] == pytest.approx(0.7 * 0.02 + 0.15)
    assert info_gain(MIXED, row) < info_gain(MIXED, ENGAGE["backup_share"])


# --------------------------------------------------------------------------- filter + directives


def test_header_carries_directives_and_stays_a_valid_posterior():
    f = IntentFilter()
    f.observe_request("s", "GET", "/portal/admin/users", status=403)
    value = f.header("s")
    assert parse_posterior_header(value) is not None and abs(sum(parse_posterior_header(value).values()) - 1) < 1e-9
    directives = parse_lure_directives(value)
    assert directives and set(directives) <= set(KINDS) and set(directives) == set(f.lures("s")["planted"])
    assert parse_lure_directives(f.header("s")).keys() >= directives.keys()      # idempotent: the full set
    assert parse_lure_directives(posterior_header(MIXED)) is None                # older header: no directives
    assert parse_lure_directives('{"lures":{"nonsense":1,"vpn_config":"x","backup_share":0.2}}') == {
        "backup_share": 0.2}
    assert json.loads(IntentFilter(planner=None).header("nobody")).keys() == set(GOALS)


def test_filter_scores_take_ignore_and_only_after_the_lure_was_shown():
    f = IntentFilter(planner=type("P", (), {"decide": staticmethod(
        lambda post, st: None if st.planted else ("backup_share", 0.3))})())
    f.observe_request("s", "GET", "/portal/admin/users", status=403)
    f.header("s")                                           # plants backup_share
    for _ in range(4):                                      # never opens the backups page: no evidence
        f.observe_request("s", "GET", "/portal/network")
    assert f.lures("s")["shown"] == {} and f.lures("s")["taken"] == {}
    f.observe_request("s", "GET", "/portal/backups")
    assert "backup_share" in f.lures("s")["shown"]
    before = f.state("s").posterior
    st = f.observe_request("s", "GET", "/portal/backups/download", {"file": "archive/pmi_full_2026-10-31.sql.gz"},
                           honeytoken_touched=True)
    assert f.lures("s")["taken"] == {"backup_share": True} and "Took the backup share lure" in st.evidence
    assert st.posterior["exfil"] > before["exfil"]
    # a session the planner never planted for, in the static config, gets no directives
    g = IntentFilter()
    g.note_config("t", "static")
    g.observe_request("t", "GET", "/portal/admin/users", status=403)
    assert parse_lure_directives(g.header("t")) is None and g.lures("t")["planted"] == {}


def test_features_name_the_page_and_the_lure():
    assert features_from_request("GET", "/portal/backups")["page"] == "backups"
    assert features_from_request("GET", "/portal/docs")["page"] == "docs"
    assert features_from_request("GET", "/portal/docs", status=403)["page"] is None
    f = features_from_request("GET", "/portal/docs/view", {"id": "svc_lisresults"})
    assert f["lure"] == "lab_service_account" and f["page"] is None and f["category"] == "portal_admin"
    assert features_from_request("GET", "/fhir/Patient")["lure"] is None


def test_lane_adjuster_still_only_raises():
    f = IntentFilter()
    adjust = make_lane_adjuster(f)
    inp = type("Inp", (), {"config": "mayajaal"})()
    with f.bind("s"):
        assert adjust(inp, "normal", "") is None             # unseen session: no opinion
        for _ in range(6):
            f.observe_request("s", "GET", "/portal/backups/download", {"file": "db_dump.sql.gz"}, status=403)
        assert adjust(inp, "normal", "")[0] in ("suspicious", "attacker")
        assert adjust(inp, "attacker", "") is None           # never lowers
        assert adjust(inp, "unauth", "") is None


class _World:
    tier, static = "shadow", False

    def __init__(self):
        self.breadcrumbs = {}

    def plant_breadcrumb(self, kind):
        return self.breadcrumbs.setdefault(kind, f"/planted/{kind}")


def test_shadow_hook_obeys_directives_and_falls_back_without_them():
    world, events = _World(), []

    async def sink(ev):
        events.append(ev)

    app = FastAPI()
    app.middleware("http")(make_planner_middleware(lambda ctx: world, sink))

    @app.get("/x")
    async def x():
        return {"lures": sorted(world.breadcrumbs)}

    client = TestClient(app)
    h = {"X-MJ-Session": "s1", "X-MJ-Posterior": posterior_header(MIXED, {"vpn_config": 0.21})}
    assert client.get("/x", headers=h).json() == {"lures": ["vpn_config"]}       # visible in this response
    assert client.get("/x", headers=h).json() == {"lures": ["vpn_config"]}
    assert [(e.type, e.data["kind"], e.data["info_gain"]) for e in events] == [
        ("breadcrumb.planted", "vpn_config", 0.21)]
    # an empty directive set means "nothing yet": the local planner must not jump in
    world2 = _World()
    app2 = FastAPI()
    app2.middleware("http")(make_planner_middleware(lambda ctx: world2, sink))
    app2.get("/x")(lambda: {"ok": True})
    c2 = TestClient(app2)
    c2.get("/x", headers={"X-MJ-Session": "s2", "X-MJ-Posterior": posterior_header(MIXED, {})})
    assert world2.breadcrumbs == {}
    c2.get("/x", headers={"X-MJ-Session": "s2", "X-MJ-Posterior": posterior_header(MIXED)})    # legacy header
    assert len(world2.breadcrumbs) == 1
    c2.get("/x", headers={"X-MJ-Session": "s3", "X-MJ-Config": "static",
                          "X-MJ-Posterior": posterior_header(MIXED, {"backup_share": 0.3})})
    assert "backup_share" not in world2.breadcrumbs or len(world2.breadcrumbs) == 1


# --------------------------------------------------------------------------- comparison harness


def test_planner_comparison_is_paired_and_labelled(tmp_path):
    out = tmp_path / "ep.json"
    data = ep.main(["--seeds", "8", "--steps", "14", "--workers", "1", "--out", str(out)])
    assert "Not a measurement of real attackers" in data["label"] and "not red-team" in data["label"]
    assert json.loads(out.read_text())["strategies"] == list(ep.STRATEGIES)
    for v in ep.VARIANTS:
        for a in ep.REPORTED:
            cells = data["summary"][v][a]
            assert cells["none"]["lures"][0] == 0 and cells["none"]["left"][0] == 0
            for s in ep.STRATEGIES:
                assert 1 <= cells[s]["steps"][0] <= 14 and 0 <= cells[s]["identified"][0] <= 1
                assert (s == "ig1") == ("steps_vs_ig1" not in cells[s])
            if a == "bold":
                assert all(cells[s]["left"][0] == 0 and cells[s]["engagement"][0] == 14 for s in ep.STRATEGIES)
        fd = {s: data["summary"][v]["benign"][s]["false_diversion"][0] for s in ep.STRATEGIES}
        assert len(set(fd.values())) == 1                    # lures only start after diversion


def test_same_seed_same_stream_and_cautious_attackers_can_leave():
    a = ep.run_session("exfil", 3, "ig1", "matched", "bold", 20)
    assert a == ep.run_session("exfil", 3, "ig1", "matched", "bold", 20)
    assert a["engagement"] == 20 and not a["left"]
    none = ep.run_session("exfil", 3, "none", "matched", "cautious", 20)
    assert none["lures"] == 0 and not none["left"]
    left = [ep.run_session("exfil", s, "ig_fast", "matched", "cautious", 25) for s in range(25)]
    assert sum(r["left"] for r in left) > sum(
        r["left"] for r in (ep.run_session("exfil", s, "stealth", "matched", "cautious", 25) for s in range(25)))
    assert all(r["engagement"] < 25 for r in left if r["left"])
    assert not ep.run_session("benign", 1, "stealth", "matched", "bold", 15)["lures"]


def test_committed_planner_results_are_labelled():
    data = json.loads(ep.OUT_PATH.read_text())
    assert data["label"] == ep.LABEL and data["baseline"] == "ig1"
    assert set(data["summary"]["matched"]["cautious"]) == set(ep.STRATEGIES)
