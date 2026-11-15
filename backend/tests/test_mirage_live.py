"""MIRAGE lures end to end, over HTTP only: the real gateway app in front of the real shadow tier
(ShadowWorld + the shared surfaces + the planner hook), all in-process. No hub, no open ports.

    lure planted (gateway decides, shadow plants) -> listed on a portal page -> fetched by the
    session -> honeytoken signal reaches the gateway -> the intent posterior moves toward the goal
    that lure is evidence for.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mayajaal.mirage.model import ENGAGE, HOST, KINDS, LURE_MARKERS, lure_of
from mayajaal.mirage.shadow_hook import make_planner_middleware
from mayajaal.real.app import create_app
from mayajaal.real.seed import PHISHED_USER, seed
from mayajaal.real.world import RealStore
from mayajaal.shadow import get_shadow_world, registry
from mayajaal.surfaces import build_router

ADMIN = "test-admin-key"
JSON = {"Accept": "application/json"}


@pytest.fixture(scope="module")
def store(tmp_path_factory) -> RealStore:
    return RealStore(seed(tmp_path_factory.mktemp("real-live") / "real.db", canary_seed=11))


def build_shadow_app(sink) -> FastAPI:
    """Same wiring as mayajaal/shadow_app.py, with a local sink instead of the hub client."""
    app = FastAPI()

    def resolve(ctx):
        return get_shadow_world(ctx, sink=sink)

    app.middleware("http")(make_planner_middleware(get_shadow_world, sink))
    app.include_router(build_router(resolve, sink))
    return app


class FixedPlanner:
    """Plants the given kinds, one per call, in order. For forcing a specific lure in a test."""

    def __init__(self, *kinds: str) -> None:
        self.kinds = list(kinds)

    def decide(self, posterior, st):
        todo = [k for k in self.kinds if k not in st.planted]
        return (todo[0], 0.25) if todo else None


class Rig:
    def __init__(self, store: RealStore, config: str = "mayajaal") -> None:
        self.events: list = []

        async def sink(*evs):
            self.events.extend(evs)

        registry.reset()
        self.shadow = build_shadow_app(sink)
        self.app = create_app(None, store=store, sink=sink, default_config=config,
                              shadow_transport=httpx.ASGITransport(app=self.shadow), admin_key_value=ADMIN)
        self.gw = self.app.state.gateway
        self.intent = self.gw.intent
        self.store = store

    def login(self, client: TestClient) -> dict[str, str]:
        r = client.post("/auth/login", json={"username": PHISHED_USER[0], "password": PHISHED_USER[1]})
        assert r.status_code == 200, r.text
        self.sid = r.json()["session_id"]
        return {"Authorization": f"Bearer {r.json()['token']}", "X-MJ-Admin": ADMIN}

    def types(self, t: str) -> list:
        return [e for e in self.events if e.type == t]

    def posterior(self) -> dict[str, float]:
        return dict(self.intent.state(self.sid).posterior)


@pytest.fixture
def rig(store) -> Rig:
    return Rig(store)


def take_url(client: TestClient, h: dict[str, str], kind: str) -> str | None:
    """Find the lure's link the way an attacker would: by reading the portal page that lists it."""
    if HOST[kind] == "backups":
        jobs = client.get("/portal/backups", headers={**h, **JSON}).json()["jobs"]
        return next((j["download"] for j in jobs if lure_of(j["download"]) == kind), None)
    docs = client.get("/portal/docs", headers={**h, **JSON}).json()["documents"]
    return next((d["view"] for d in docs if lure_of(d["view"]) == kind), None)


def divert(client: TestClient, h: dict[str, str]) -> None:
    """A nurse opening the admin portal: denied once (RBAC), then served by the shadow tier."""
    assert client.get("/portal/admin/users", headers=h).status_code == 403
    r = client.get("/portal/admin/users", headers=h)
    assert r.status_code == 200 and r.headers["x-mj-decision"] == "divert_shadow"


# --------------------------------------------------------------------------- the default planner


def test_default_planner_lure_is_planted_seen_taken_and_moves_the_posterior(rig: Rig) -> None:
    with TestClient(rig.app) as client:
        h = rig.login(client)
        divert(client, h)

        planted = rig.types("breadcrumb.planted")
        assert planted, "the gateway's planner should plant a lure as soon as the session is diverted"
        first = planted[0]
        kind = first.data["kind"]
        assert first.tier == "shadow" and first.session_id == rig.sid and first.data["info_gain"] > 0.03
        assert kind in rig.intent.lures(rig.sid)["planted"]
        # the directive travelled in X-MJ-Posterior and never reached the client
        assert not any(k.lower().startswith("x-mj-posterior") for k in client.get("/portal", headers=h).headers)

        # visible over HTTP on its host page, in the shadow tier only
        url = take_url(client, h, kind)
        assert url and LURE_MARKERS[kind] in url.lower()
        assert kind in rig.intent.lures(rig.sid)["shown"]

        before = rig.posterior()
        touched_before = len(rig.types("honeytoken.touched"))
        r = client.get(url, headers=h)
        assert r.status_code == 200 and r.headers["x-mj-tier"] == "shadow" and len(r.text) > 100
        assert not any(k.lower() == "x-mj-honeytoken-touched" for k in r.headers)       # stripped
        after = rig.posterior()

        # honeytoken signal reached the gateway, and the filter scored it as THIS lure being taken
        assert len(rig.types("honeytoken.touched")) > touched_before
        assert rig.gw.by_id[rig.sid].lane == "attacker" and rig.gw.by_id[rig.sid].honeytokens
        assert rig.intent.lures(rig.sid)["taken"] == {kind: True}
        assert "lure" in rig.intent.state(rig.sid).evidence
        # the posterior moved toward the goals that take this lure most, away from benign
        best = max(ENGAGE[kind], key=ENGAGE[kind].get)
        assert after[best] > before[best] + 0.05 and after["benign"] < before["benign"]
        assert any(e.data["evidence"].endswith("lure.") for e in rig.types("intent.update"))
        # zero protected secrets left the real tier while all this happened
        assert rig.gw.ledger.leaked("adhoc") == 0


@pytest.mark.parametrize("kind,goal", [("backup_share", "exfil"), ("research_dataset", "exfil"),
                                       ("lab_service_account", "tamper"), ("vpn_config", "recon"),
                                       ("admin_credential", "disrupt")])
def test_each_lure_kind_is_reachable_and_points_at_its_goal(rig: Rig, kind: str, goal: str) -> None:
    rig.intent.planner = FixedPlanner(kind)
    with TestClient(rig.app) as client:
        h = rig.login(client)
        divert(client, h)
        assert [e.data["kind"] for e in rig.types("breadcrumb.planted")] == [kind]
        url = take_url(client, h, kind)
        assert url, f"{kind} is not listed on its portal page"
        before = rig.posterior()
        r = client.get(url, headers=h)
        assert r.status_code == 200 and r.headers["x-mj-tier"] == "shadow"
        after = rig.posterior()
        assert rig.intent.lures(rig.sid)["taken"] == {kind: True}
        assert after[goal] > before[goal], (kind, goal, before, after)
        assert after["benign"] < before["benign"]
        # a second fetch is not a second piece of evidence
        again = rig.posterior()
        client.get(url, headers=h)
        assert rig.intent.lures(rig.sid)["taken"] == {kind: True}
        assert abs(rig.posterior()[goal] - again[goal]) < 0.2


def test_ignored_lure_counts_against_the_goals_that_would_take_it(rig: Rig) -> None:
    rig.intent.planner = FixedPlanner("backup_share")
    with TestClient(rig.app) as client:
        h = rig.login(client)
        divert(client, h)
        assert take_url(client, h, "backup_share")                   # shown on the backups page
        ratio = lambda p: p["exfil"] / p["tamper"]                 # noqa: E731
        before = rig.posterior()
        for _ in range(3):                                           # carries on without taking it
            client.get("/portal/network", headers=h)
        after = rig.posterior()
        assert rig.intent.lures(rig.sid)["taken"] == {"backup_share": False}
        assert "Ignored the backup share lure" in " ".join(e.data["evidence"] for e in rig.types("intent.update"))
        # exfil takes this lure 85% of the time, tamper 15%: ignoring it shifts weight from exfil to tamper
        assert ratio(after) < ratio(before)


# --------------------------------------------------------------------------- stealth and safety


def test_lure_is_not_added_to_a_page_the_session_already_viewed(rig: Rig) -> None:
    with TestClient(rig.app) as client:
        h = rig.login(client)
        divert(client, h)
        for page in ("/portal/backups", "/portal/docs"):
            client.get(page, headers={**h, **JSON})
        assert rig.intent.lures(rig.sid)["viewed"] == ["backups", "docs"]
        n_before = len(rig.intent.lures(rig.sid)["planted"])
        for _ in range(12):
            client.get("/portal/network", headers=h)
        lures = rig.intent.lures(rig.sid)
        # every lure planted after both pages were viewed would be "late"; the default planner declines
        assert len(lures["planted"]) == n_before


def test_real_tier_never_serves_files_and_static_config_gets_no_lures(store: RealStore) -> None:
    # an IT admin on the real tier sees the backup list but can never download an archive
    rig = Rig(store)
    with TestClient(rig.app) as client:
        r = client.post("/auth/login", json={"username": "d.mensah", "password": "nope"})
        assert r.status_code == 401
    world = rig.gw.resolve_world(type("C", (), {"session_id": "x", "hospital_id": "eas"})())
    real = FastAPI()
    real.include_router(build_router(lambda ctx: world, rig.gw._sink_one))
    with TestClient(real) as client:
        jobs = client.get("/portal/backups", headers=JSON).json()["jobs"]
        assert jobs
        r = client.get(jobs[0]["download"])
        assert r.status_code == 403 and r.json()["error"] == "change_ticket_required"
        assert client.get("/portal/docs", headers=JSON).json() == {"documents": [], "total": 0}
        assert client.get("/portal/docs/view", params={"id": "downtime_procedure"}).status_code == 404

    static = Rig(store, "static")
    with TestClient(static.app) as client:
        h = static.login(client)
        divert(client, h)
        client.get("/portal/backups", headers=h)
        assert not static.types("breadcrumb.planted")
        assert static.intent.lures(static.sid)["planted"] == {}
        sent = json.loads(static.intent.header(static.sid))
        assert "lures" not in sent or sent["lures"] == {}


def test_lure_file_names_carry_their_markers(rig: Rig) -> None:
    from mayajaal.world_api import SessionContext

    world = get_shadow_world(SessionContext(session_id="marker-check"))
    for kind in KINDS:
        assert LURE_MARKERS[kind] in world.plant_breadcrumb(kind).lower()
    docs = {d["id"] for d in world.portal_documents()}
    assert {"downtime_procedure", "svc_lisresults", "meridian-lumen-vpn"} <= docs
    assert world.portal_file("/etc/passwd") is None and world.portal_file("../../etc/passwd") is None
