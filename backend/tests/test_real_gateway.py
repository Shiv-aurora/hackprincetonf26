"""Gateway: login, routing, stickiness, canary ledger, clinician false positives.

Uses fakes for the shadow upstream and the surfaces router; the hub is not needed.
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from mayajaal.real.app import create_app
from mayajaal.real.clinician_sim import run_sim
from mayajaal.real.fakes import FakeShadowShell, fake_shadow_app, fake_surfaces_factory
from mayajaal.real.ledger import CanaryLedger
from mayajaal.real.seed import PHISHED_USER, seed
from mayajaal.real.world import RealStore

ADMIN = "test-admin-key"


@pytest.fixture(scope="module")
def store(tmp_path_factory) -> RealStore:
    return RealStore(seed(tmp_path_factory.mktemp("real") / "real.db", canary_seed=11))


class Rig:
    def __init__(self, store: RealStore, config: str) -> None:
        self.events: list = []

        async def sink(*evs):
            self.events.extend(evs)

        self.shadow = fake_shadow_app()
        FakeShadowShell.instances.clear()
        self.app = create_app(fake_surfaces_factory, store=store, sink=sink, default_config=config,
                              shadow_transport=httpx.ASGITransport(app=self.shadow),
                              shadow_ws_connect=FakeShadowShell, admin_key_value=ADMIN)
        self.gw = self.app.state.gateway
        self.client = TestClient(self.app)
        self.store = store

    def login(self, username=PHISHED_USER[0], password=PHISHED_USER[1], **headers) -> dict[str, str]:
        r = self.client.post("/auth/login", json={"username": username, "password": password}, headers=headers)
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['token']}", "X-MJ-Admin": ADMIN}

    def types(self, t: str) -> list:
        return [e for e in self.events if e.type == t]

    def own_mrn(self, hospital="eas") -> str:
        return self.store.mrns(hospital)[0]


@pytest.fixture
def rig(store) -> Rig:
    return Rig(store, "mayajaal")


@pytest.fixture
def baseline(store) -> Rig:
    return Rig(store, "baseline")


def canary_patient(store: RealStore) -> tuple[str, str]:
    import sqlite3

    from mayajaal.real.vault import canary_row_key

    row = sqlite3.connect(store.db_path).execute(
        "SELECT canary, location, ref FROM canaries WHERE location = 'patients.notes' LIMIT 1").fetchone()
    # canaries are encrypted at rest (real/vault.py); the store's in-memory DEK decrypts them
    return store.vault.decrypt(row[0], "canaries", "canary", canary_row_key(row[1], row[2])), row[2]


# --------------------------------------------------------------------------- login


def test_health_and_login(rig: Rig) -> None:
    assert rig.client.get("/health").json()["ok"] is True
    r = rig.client.post("/auth/login", json={"username": "n.okafor", "password": "Spring2026!"})
    body = r.json()
    assert r.status_code == 200 and body["token"] and body["session_id"] and body["role"] == "nurse"
    assert rig.client.post("/auth/login", json={"username": "n.okafor", "password": "nope"}).status_code == 401
    assert rig.client.post("/auth/login", data={"username": "n.okafor", "password": "Spring2026!"}).status_code == 200
    checks = rig.types("canary.check")
    assert checks and checks[0].data == {"protected_total": 12, "leaked": 0}


def test_unauthenticated_lane(rig: Rig) -> None:
    r = rig.client.get(f"/fhir/Patient/{rig.own_mrn()}")
    assert r.status_code == 401 and "tier" not in r.text           # clinical: denied, never faked
    r = rig.client.post("/shell/exec", json={"cmd": "ls /mnt/backups"})
    assert r.json()["tier"] == "shadow"
    assert rig.types("policy.decision")[-1].data["lane"] == "unauth"


# --------------------------------------------------------------------------- routing


def test_normal_read_is_real_and_headers_forwarded(rig: Rig) -> None:
    h = rig.login()
    r = rig.client.get(f"/fhir/Patient/{rig.own_mrn()}", headers=h)
    assert r.status_code == 200 and r.json()["tier"] == "real"
    assert r.headers["x-mj-decision"] == "allow_real"
    req = rig.types("request")[-1]
    assert req.tier == "real" and req.data["surface"] == "fhir" and req.actor == "attacker"
    # unfiltered list = ward list, scoped to the caller's hospital in deception configs
    r = rig.client.get("/fhir/Patient", params={"_count": 50}, headers=h)
    assert {e["resource"]["hospital_id"] for e in r.json()["entry"]} == {"eas"}


def test_diversion_is_sticky_and_clinical_never_faked(rig: Rig) -> None:
    h = rig.login()
    r = rig.client.post("/shell/exec", json={"cmd": "cat ~/.bash_history"}, headers=h)
    assert r.json()["tier"] == "shadow" and r.headers["x-mj-decision"] == "divert_shadow"
    assert not any(k.lower() == "x-mj-shadow-internal" for k in r.headers)   # x-mj-* stripped
    sent = rig.shadow.state.received[-1]["headers"]
    assert "authorization" not in sent and sent["x-mj-user"] == "n.okafor" and sent["x-mj-lane"] == "suspicious"
    assert sent["x-mj-config"] == "mayajaal" and sent["x-mj-hospital"] == "eas"

    # sticky: an innocuous API call now also goes to the shadow
    assert rig.client.get("/api/whoami", headers=h).json()["tier"] == "shadow"
    # ...but a clinical read is step-up, never shadow data
    r = rig.client.get(f"/fhir/Patient/{rig.own_mrn()}", headers=h)
    assert r.status_code == 401 and r.json()["error"] == "step_up_required"
    assert r.headers["x-mj-decision"] == "step_up"
    # a shadow-only MRN (honeytoken) goes to the shadow
    assert rig.client.get("/fhir/Patient/MRN-7F3A-0193", headers=h).json()["tier"] == "shadow"

    diverted = rig.types("session.diverted")
    assert len(diverted) == 1 and diverted[0].data["to_tier"] == "shadow"
    shell_req = [e for e in rig.types("request") if e.data["method"] == "EXEC"][0]
    assert shell_req.tier == "shadow" and shell_req.data["technique"] == "T1552.003"


def test_admin_first_contact_is_diverted_not_denied(rig: Rig) -> None:
    """MayaJaal never tips the intruder off with a refusal on non-clinical surfaces."""
    h = rig.login()
    r1 = rig.client.get("/portal/admin/users", headers=h)
    assert r1.status_code == 200 and r1.json()["tier"] == "shadow"
    assert r1.headers["x-mj-lane"] == "suspicious"
    assert rig.types("session.diverted")


def test_honeytoken_touch_moves_session_to_attacker_lane(rig: Rig) -> None:
    h = rig.login()
    rig.client.post("/shell/exec", json={"cmd": "cat /mnt/backups/honey.sql"}, headers=h)
    s = next(s for s in rig.gw.by_id.values() if s.username == "n.okafor")
    assert s.lane == "attacker" and "ht-test-1" in s.honeytokens
    r = rig.client.get(f"/fhir/Patient/{rig.own_mrn()}", headers=h)
    assert r.status_code == 403 and r.headers["x-mj-decision"] == "deny"


def test_honeytoken_credential_login_is_diverted(rig: Rig) -> None:
    r = rig.client.post("/auth/login", json={"username": "svc_lisbackup", "password": "Lumen#Night2026"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert rig.client.get("/portal/admin/users", headers=h).json()["tier"] == "shadow"
    assert rig.types("session.diverted")


def test_baseline_never_diverts_and_leaks(baseline: Rig) -> None:
    h = baseline.login(**{"X-MJ-Run": "run-base"})
    r = baseline.client.post("/shell/exec", json={"cmd": "zcat /mnt/backups/db_dump_2026-11-13.sql.gz"}, headers=h)
    assert r.status_code == 200 and r.headers["x-mj-decision"] == "allow_real"
    assert baseline.client.get("/fhir/Patient", params={"_count": 5000}, headers=h).json()["tier"] == "real"
    assert baseline.client.get("/portal/admin/users", headers=h).status_code == 403   # RBAC
    assert baseline.shadow.state.received == []
    assert all(e.data["action"] != "divert_shadow" for e in baseline.types("policy.decision"))
    assert not baseline.types("session.diverted")
    # the real dump went out: every canary leaked (the comparison point)
    assert baseline.gw.ledger.leaked("run-base") == 12
    assert baseline.types("canary.check")[-1].data["leaked"] == 12


def test_baseline_header_override(rig: Rig) -> None:
    h = rig.login()
    r = rig.client.post("/shell/exec", json={"cmd": "hostname"}, headers={**h, "X-MJ-Config": "baseline"})
    assert r.headers["x-mj-decision"] == "allow_real" and r.text.strip() == "jump-eas"


# --------------------------------------------------------------------------- canary ledger


def test_canary_detected_in_response_body(baseline: Rig) -> None:
    canary, mrn = canary_patient(baseline.store)
    h = baseline.login(**{"X-MJ-Run": "run-c1"})
    r = baseline.client.get(f"/fhir/Patient/{mrn}", headers={**h, "X-MJ-Run": "run-c1"})
    assert canary in r.text
    assert baseline.gw.ledger.leaked("run-c1") == 1
    checks = [e for e in baseline.types("canary.check") if e.run_id == "run-c1"]
    assert [c.data["leaked"] for c in checks] == [0, 1]
    # same canary again: count unchanged, no new event
    baseline.client.get(f"/fhir/Patient/{mrn}", headers={**h, "X-MJ-Run": "run-c1"})
    assert len([e for e in baseline.types("canary.check") if e.run_id == "run-c1"]) == 2


def test_mayajaal_cross_hospital_canary_read_is_blocked(rig: Rig) -> None:
    canary, mrn = canary_patient(rig.store)
    h = rig.login(**{"X-MJ-Run": "run-c2"})
    r = rig.client.get(f"/fhir/Patient/{mrn}", headers=h)
    assert r.status_code == 401 and canary not in r.text
    assert rig.gw.ledger.leaked("run-c2") == 0


def test_ledger_catches_encoded_canaries() -> None:
    led = CanaryLedger(["MJ-CANARY-0badf00d", "MJ-CANARY-12345678"])
    assert led.scan("x MJ-CANARY-0badf00d y") == {"MJ-CANARY-0badf00d"}
    assert led.scan("mj-canary-0BADF00D") == {"MJ-CANARY-0badf00d"}
    for prefix in (b"", b"a", b"ab", b"abc"):
        enc = base64.b64encode(prefix + b"...MJ-CANARY-12345678...")
        assert led.scan(enc) == {"MJ-CANARY-12345678"}, prefix
    assert led.scan(b"MJ-CANARY-12345678".hex()) == {"MJ-CANARY-12345678"}
    import gzip
    assert led.scan(gzip.compress(b"MJ-CANARY-12345678")) == {"MJ-CANARY-12345678"}
    assert led.scan("MJ-CANARY-deadbeef nothing here") == set()
    assert led.record("r", {"MJ-CANARY-12345678"}) and not led.record("r", {"MJ-CANARY-12345678"})


# --------------------------------------------------------------------------- shell over WS


def test_ws_shell_baseline_local_and_scanned(baseline: Rig) -> None:
    h = baseline.login(**{"X-MJ-Run": "run-ws"})
    with baseline.client.websocket_connect("/shell", headers=h) as ws:
        assert ws.receive_text().startswith("real@jump-eas")
        ws.send_text(json.dumps({"cmd": "cat /etc/lab-sync/credentials.env"}))
        assert "LIS_API_SECRET=MJ-CANARY-" in ws.receive_text()
    assert baseline.gw.ledger.leaked("run-ws") == 1
    execs = [e for e in baseline.types("request") if e.data["method"] == "EXEC"]
    assert execs and execs[0].tier == "real" and execs[0].data["technique"] == "T1552.001"


def test_ws_shell_diverted_to_shadow(rig: Rig) -> None:
    h = rig.login()
    with rig.client.websocket_connect("/shell", headers=h) as ws:
        assert ws.receive_text().startswith("shadow@")
        ws.send_text("cat /mnt/honey.txt\n")
        assert ws.receive_text().startswith("shadow-out:")       # control frame swallowed
    up = FakeShadowShell.instances[-1]
    assert up.url.endswith("/shell") and up.headers["X-MJ-User"] == "n.okafor"
    s = next(s for s in rig.gw.by_id.values() if s.username == "n.okafor")
    assert s.diverted and s.lane == "attacker" and "ht-ws-1" in s.honeytokens


def test_ws_shell_token_in_query(rig: Rig) -> None:
    tok = rig.login()["Authorization"].split()[1]
    with rig.client.websocket_connect(f"/shell?token={tok}") as ws:
        assert ws.receive_text().startswith("shadow@")
    assert "token" not in FakeShadowShell.instances[-1].url


# --------------------------------------------------------------------------- clinicians


async def test_clinicians_never_diverted_or_served_shadow(store: RealStore) -> None:
    rig = Rig(store, "mayajaal")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=rig.app), base_url="http://gw") as c:
        res = await run_sim(client=c, rate=0, n_requests=80, admin_key=ADMIN, store=store, seed=3,
                            run_id="run-clin")
    assert res["requests"] == 80 and res["false_positives"] == 0, res
    assert rig.shadow.state.received == []
    assert not rig.types("session.diverted")
    clin = [e for e in rig.types("request") if e.actor == "clinician"]
    assert len(clin) >= 80 and all(e.tier == "real" for e in clin)
    assert all(e.data["lane"] == "normal" for e in rig.types("policy.decision"))
    assert rig.gw.ledger.leaked("run-clin") == 0       # clinician reads are not leaks
