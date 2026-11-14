"""MIRAGE-lite breadcrumb planner: exact IG, max-IG choice, cadence, shadow isolation, middleware."""

from __future__ import annotations

import math
import re
import subprocess
import sys
from pathlib import Path

import pytest

from mayajaal.contracts import BreadcrumbPlanted
from mayajaal.mirage.model import ENGAGE, GOALS, KINDS, entropy, info_gain
from mayajaal.mirage.planner import Planner, RandomPlanner, parse_posterior_header
from mayajaal.world_api import SessionContext

MIRAGE_DIR = Path(__file__).resolve().parents[1] / "mayajaal" / "mirage"
BACKEND = MIRAGE_DIR.parents[1]


def H2(p: float) -> float:
    return 0.0 if p in (0.0, 1.0) else -(p * math.log2(p) + (1 - p) * math.log2(1 - p))


class FakeWorld:
    tier = "shadow"
    static = False

    def __init__(self) -> None:
        self.breadcrumbs: dict[str, str] = {}

    def plant_breadcrumb(self, kind: str) -> str:
        return self.breadcrumbs.setdefault(kind, f"/fake/{kind}")


CTX = SessionContext(session_id="sess-1", run_id="run-1", hospital_id="eas", lane="suspicious")


# --------------------------------------------------------------------------- information gain


def test_ig_perfect_separator_is_one_bit():
    post = {"exfil": 0.5, "tamper": 0.5}
    assert info_gain(post, {"exfil": 1.0, "tamper": 0.0}) == pytest.approx(1.0)
    assert info_gain(post, {"exfil": 0.3, "tamper": 0.3}) == pytest.approx(0.0, abs=1e-12)


def test_ig_hand_checked_two_goal_case():
    # P(exfil)=0.6, P(tamper)=0.4; P(engage|exfil)=0.8, P(engage|tamper)=0.2
    #   P(engage) = 0.48+0.08 = 0.56 ; P(exfil|engage) = 0.48/0.56 = 6/7
    #   P(ignore) = 0.12+0.32 = 0.44 ; P(exfil|ignore) = 0.12/0.44 = 3/11
    #   IG = H(0.6) - 0.56 H(6/7) - 0.44 H(3/11)  = 0.97095 - 0.56*0.59167 - 0.44*0.84535 ~= 0.2677 bits
    expected = H2(0.6) - 0.56 * H2(6 / 7) - 0.44 * H2(3 / 11)
    assert expected == pytest.approx(0.2677, abs=1e-3)
    got = info_gain({"exfil": 0.6, "tamper": 0.4}, {"exfil": 0.8, "tamper": 0.2})
    assert got == pytest.approx(expected, abs=1e-12)


def test_ig_bounds_on_real_table():
    post = {"benign": 0.05, "recon": 0.3, "exfil": 0.4, "tamper": 0.15, "disrupt": 0.1}
    h = entropy(post.values())
    for k in KINDS:
        assert 0.0 <= info_gain(post, ENGAGE[k]) <= h
    assert info_gain({"exfil": 1.0}, ENGAGE["backup_share"]) == 0.0


# --------------------------------------------------------------------------- choice


def test_planner_picks_max_ig_kind():
    p = Planner(every=1)
    for post in ({"exfil": 0.5, "tamper": 0.5}, {"recon": 0.5, "exfil": 0.5},
                 {"benign": 0.05, "recon": 0.3, "exfil": 0.4, "tamper": 0.15, "disrupt": 0.1},
                 {"tamper": 0.45, "disrupt": 0.45, "recon": 0.1}):
        scores = {k: info_gain({g: post.get(g, 0.0) for g in GOALS}, ENGAGE[k]) for k in KINDS}
        best = max(scores, key=scores.get)
        kind, gain = p.choose(post, list(KINDS))
        assert kind == best and gain == pytest.approx(scores[best])


def test_planner_custom_table_obvious_answer():
    table = {"backup_share": {"exfil": 0.5, "tamper": 0.5}, "lab_service_account": {"exfil": 0.05, "tamper": 0.95}}
    p = Planner(table=table, every=1)
    ev = p.maybe_plant({"exfil": 0.5, "tamper": 0.5}, FakeWorld(), CTX)
    assert ev is not None and ev.data["kind"] == "lab_service_account"
    assert ev.data["info_gain"] == pytest.approx(info_gain({"exfil": 0.5, "tamper": 0.5}, table["lab_service_account"]), abs=1e-4)
    assert ev.data["target_goals"] == ["tamper"]


def test_maybe_plant_event_and_cadence():
    p = Planner(every=3, budget=5)
    w = FakeWorld()
    post = {"benign": 0.05, "recon": 0.35, "exfil": 0.35, "tamper": 0.15, "disrupt": 0.1}
    events = [p.maybe_plant(post, w, CTX) for _ in range(9)]
    planted = [e for e in events if e is not None]
    assert [i for i, e in enumerate(events) if e is not None] == [0, 3, 6]     # one per 3 requests
    kinds = [e.data["kind"] for e in planted]
    assert len(set(kinds)) == 3 and set(kinds) <= set(KINDS)                    # never the same kind twice
    for e in planted:
        assert e.type == "breadcrumb.planted" and e.tier == "shadow" and e.actor == "defender"
        assert e.session_id == "sess-1" and e.run_id == "run-1"
        BreadcrumbPlanted.model_validate(e.data)
        assert e.data["path"] == w.breadcrumbs[e.data["kind"]]
        assert e.data["info_gain"] > 0 and e.data["target_goals"]


def test_budget_threshold_and_diversion_gates():
    w = FakeWorld()
    p = Planner(every=1, budget=2)
    post = {"recon": 0.4, "exfil": 0.4, "tamper": 0.2}
    assert sum(p.maybe_plant(post, w, CTX) is not None for _ in range(6)) == 2
    # nothing left to learn -> skip
    assert Planner(every=1).maybe_plant({"exfil": 1.0}, FakeWorld(), CTX) is None
    # not diverted (static honeypot or real tier) -> skip
    static = FakeWorld()
    static.static = True
    assert Planner(every=1).maybe_plant(post, static, CTX) is None
    real = FakeWorld()
    real.tier = "real"
    assert Planner(every=1).maybe_plant(post, real, CTX) is None
    assert Planner(every=1).maybe_plant(None, FakeWorld(), CTX) is None


def test_random_planner_plants_unplanted_kinds():
    import random
    p = RandomPlanner(rng=random.Random(1), every=1, budget=5)
    w = FakeWorld()
    kinds = [p.maybe_plant({"recon": 0.5, "exfil": 0.5}, w, CTX).data["kind"] for _ in range(5)]
    assert sorted(kinds) == sorted(KINDS)


# --------------------------------------------------------------------------- header


def test_parse_posterior_header():
    assert parse_posterior_header('{"benign":0.1,"recon":0.2,"exfil":0.6,"tamper":0.05,"disrupt":0.05}')["exfil"] == pytest.approx(0.6)
    p = parse_posterior_header(b'{"exfil":3,"recon":1,"junk":9}')
    assert p == pytest.approx({"benign": 0, "recon": 0.25, "exfil": 0.75, "tamper": 0, "disrupt": 0})
    assert parse_posterior_header('{"posterior":{"exfil":1}}')["exfil"] == 1.0
    for bad in (None, "", "nope", "[1,2]", '{"exfil":-1}', '{"exfil":"x"}', '{"benign":0}', '{"exfil":NaN}',
                '{"exfil":true}', "{" + " " * 2000 + "}"):
        assert parse_posterior_header(bad) is None, bad


# --------------------------------------------------------------------------- isolation


def test_planner_source_never_references_real():
    bad = re.compile(r"^\s*(from|import)\s+mayajaal\.real|from\s+mayajaal\s+import\s+real|"
                     r"import_module\(.mayajaal\.real|data/real")
    for name in ("planner.py", "model.py", "shadow_hook.py", "__init__.py"):
        for i, line in enumerate((MIRAGE_DIR / name).read_text().splitlines(), 1):
            assert not bad.search(line), f"{name}:{i}: {line.strip()}"


def test_planner_runtime_does_not_load_real():
    code = (
        "import sys\n"
        "import mayajaal.mirage.planner, mayajaal.mirage.shadow_hook\n"
        "from mayajaal.mirage.planner import Planner\n"
        "from mayajaal.shadow import ShadowWorld\n"
        "from mayajaal.world_api import SessionContext\n"
        "w = ShadowWorld('x', key=b'k')\n"
        "ev = Planner(every=1).maybe_plant({'recon':0.4,'exfil':0.4,'tamper':0.2}, w, SessionContext('x'))\n"
        "assert ev is not None and ev.data['kind'] in w.breadcrumbs\n"
        "assert not any(m == 'mayajaal.real' or m.startswith('mayajaal.real.') for m in sys.modules), "
        "[m for m in sys.modules if 'real' in m]\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=BACKEND)
    assert r.returncode == 0, r.stderr


# --------------------------------------------------------------------------- shadow middleware


def test_planner_middleware_plants_in_shadow_world():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from mayajaal.mirage.shadow_hook import make_planner_middleware
    from mayajaal.shadow import ShadowWorld

    worlds: dict[str, ShadowWorld] = {}
    sent = []

    async def sink(*evs):
        sent.extend(evs)

    def resolve(ctx):
        return worlds.setdefault(ctx.session_id, ShadowWorld(ctx.session_id, key=b"k"))

    app = FastAPI()
    app.middleware("http")(make_planner_middleware(resolve, sink, Planner(every=2)))

    @app.get("/portal/admin/users")
    async def users():
        return {"ok": True}

    c = TestClient(app)
    hdr = {"X-MJ-Session": "sess-9", "X-MJ-Run": "run-9", "X-MJ-Lane": "suspicious",
           "X-MJ-Posterior": '{"benign":0.05,"recon":0.4,"exfil":0.4,"tamper":0.1,"disrupt":0.05}'}
    for _ in range(3):
        assert c.get("/portal/admin/users", headers=hdr).status_code == 200
    assert len(sent) == 2                                         # requests 1 and 3 (every=2)
    w = worlds["sess-9"]
    assert {e.data["kind"] for e in sent} == set(w.breadcrumbs)
    assert all(e.session_id == "sess-9" and e.run_id == "run-9" for e in sent)
    # static config and missing header are ignored
    c.get("/portal/admin/users", headers={**hdr, "X-MJ-Config": "static", "X-MJ-Session": "s2"})
    c.get("/portal/admin/users", headers={"X-MJ-Session": "s3"})
    assert len(sent) == 2 and "s2" not in worlds and "s3" not in worlds
