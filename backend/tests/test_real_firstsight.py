"""First Sight (CUSUM over weak signals): unit behaviour and its effect at the gateway."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mayajaal.real.firstsight import H, FirstSight, client_kind

from mayajaal.real.seed import PHISHED_USER as PHISHED
from test_real_gateway import ADMIN, EHR_UA, Rig, store  # noqa: F401  (store is a fixture)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_client_kind() -> None:
    assert client_kind("python-httpx/0.28.1") == "scripted"
    assert client_kind("curl/8.7.1") == "scripted"
    assert client_kind("MeridianEHR/4.2 (clinician)") == "ehr"
    assert client_kind("Mozilla/5.0 (Macintosh) Chrome/131.0") == "browser"
    assert client_kind("") == "none"
    assert client_kind("weird-bot") == "scripted"


def test_scripted_nurse_login_fires_at_login() -> None:
    ew = FirstSight(clock=Clock())
    st = ew.on_login("s1", username="n.okafor", role="nurse", ua="python-httpx/0.28.1", ip="10.0.0.9")
    assert st.fired and st.fired_at == 0 and st.score >= H
    assert "script" in st.reason and "at login" in st.reason


def test_service_account_script_is_not_flagged() -> None:
    ew = FirstSight(clock=Clock())
    st = ew.on_login("s1", username="svc.lis", role="service", ua="python-requests/2.32", ip="10.0.0.9")
    assert not st.fired


def test_ehr_client_never_fires_even_when_fast() -> None:
    clk = Clock()
    ew = FirstSight(clock=clk)
    ew.on_login("s1", username="a.nurse", role="nurse", ua="MeridianEHR/4.2", ip="10.0.0.5")
    for i in range(80):
        clk.t += 0.05                                   # bursts and polling, like a real EHR client
        st = ew.before("s1", target_patient=f"MRN-{i % 20}")
        ew.after("s1", status=200)
    assert not st.fired and st.score == 0.0


def test_browser_at_machine_pace_fires_within_a_few_requests() -> None:
    clk = Clock()
    ew = FirstSight(clock=clk)
    ew.on_login("s1", username="n.okafor", role="nurse", ua="Mozilla/5.0 Chrome/131", ip="10.0.0.9")
    fired_at = None
    for _ in range(10):
        clk.t += 0.6
        st = ew.before("s1")
        if st.fired:
            fired_at = st.fired_at
            break
    assert fired_at is not None and fired_at <= 6


def test_browser_at_human_pace_stays_quiet() -> None:
    clk = Clock()
    ew = FirstSight(clock=clk)
    ew.on_login("s1", username="n.okafor", role="nurse", ua="Mozilla/5.0 Chrome/131", ip="10.0.0.9")
    for gap in [14, 3, 40, 9, 22, 5, 61, 12, 8, 30]:
        clk.t += gap
        st = ew.before("s1")
    assert not st.fired


def test_new_address_and_failed_logins_add_up() -> None:
    clk = Clock()
    ew = FirstSight(clock=clk)
    ew.on_login("old", username="n.okafor", role="nurse", ua="Mozilla/5.0", ip="10.0.0.5")
    for _ in range(3):
        ew.on_failed_login("203.0.113.7")
    st = ew.on_login("new", username="n.okafor", role="nurse", ua="Mozilla/5.0", ip="203.0.113.7")
    assert [s for _, s, _ in st.evidence] == ["new_address", "failed_logins"]
    assert st.fired


def test_probing_raises_the_score() -> None:
    clk = Clock()
    ew = FirstSight(clock=clk)
    ew.on_login("s1", username="n.okafor", role="nurse", ua="Mozilla/5.0", ip="10.0.0.9")
    for _ in range(5):                                  # five misses in a row, at a human pace
        clk.t += 20
        ew.before("s1")
        ew.after("s1", status=404)
    assert ew.state("s1").fired


# --------------------------------------------------------------------------- at the gateway


@pytest.fixture
def scripted(store):
    rig = Rig(store, "mayajaal")
    rig.client = TestClient(rig.app, headers={"User-Agent": "python-httpx/0.28.1"})
    return rig


def _login(rig: Rig) -> dict[str, str]:
    r = rig.client.post("/auth/login", json={"username": PHISHED[0], "password": PHISHED[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", "X-MJ-Admin": ADMIN}


def test_gateway_scripted_login_sees_no_real_patient(scripted) -> None:
    h = _login(scripted)
    first = [e for e in scripted.events if e.type == "policy.decision"]
    assert first and first[0].data["lane"] == "suspicious" and "First Sight at login" in first[0].data["reason"]
    r = scripted.client.get("/fhir/Patient?_count=20", headers=h)        # the nurse's ward list
    assert r.status_code == 401 and r.headers["x-mj-decision"] == "step_up"
    assert "entry" not in r.text
    r = scripted.client.get("/portal/admin/users", headers=h)          # first non-clinical move
    assert r.headers["x-mj-decision"] == "divert_shadow"


def test_gateway_ehr_login_is_untouched(store) -> None:
    rig = Rig(store, "mayajaal")                                      # default client is EHR_UA
    assert rig.client.headers["user-agent"].startswith(EHR_UA)
    h = _login(rig)
    r = rig.client.get("/fhir/Patient?_count=20", headers=h)
    assert r.status_code == 200 and r.headers["x-mj-decision"] == "allow_real"


def test_static_config_has_no_early_warning(store) -> None:
    rig = Rig(store, "static")
    rig.client = TestClient(rig.app, headers={"User-Agent": "python-httpx/0.28.1"})
    h = _login(rig)
    r = rig.client.get("/fhir/Patient?_count=20", headers=h)
    assert r.status_code == 200 and r.headers["x-mj-decision"] == "allow_real"


# --------------------------------------------------------------------------- device trust


def test_device_token_roundtrip() -> None:
    from mayajaal.real.devices import mint, verify
    key = b"k" * 32
    tok = mint("ws-eas-04", key)
    assert verify(tok, key) == "ws-eas-04"
    assert verify(tok[:-1] + ("0" if tok[-1] != "0" else "1"), key) is None
    assert verify("ws-eas-04.deadbeef", key) is None and verify(None, key) is None


def test_unmanaged_device_alone_is_not_enough_but_with_new_address_is() -> None:
    ew = FirstSight(clock=Clock())
    st = ew.on_login("home", username="n.okafor", role="nurse", ua="Mozilla/5.0", ip="10.0.0.5", managed=False)
    assert not st.fired                                       # first-ever login, from home: no history
    st = ew.on_login("away", username="n.okafor", role="nurse", ua="Mozilla/5.0", ip="198.51.100.4",
                     managed=False)
    assert st.fired and st.fired_at == 0 and "hospital's own devices" in st.reason


def test_gateway_reads_device_certificate(store) -> None:
    from mayajaal.real.devices import mint
    rig = Rig(store, "mayajaal")
    r = rig.client.post("/auth/login", json={"username": PHISHED[0], "password": PHISHED[1]},
                        headers={"X-Device-Token": mint("ws-eas-07")})
    st = rig.gw.first_sight.state(r.json()["session_id"])
    assert st is not None and not any(s == "unmanaged_device" for _, s, _ in st.evidence)
    r = rig.client.post("/auth/login", json={"username": PHISHED[0], "password": PHISHED[1]})
    st = rig.gw.first_sight.state(r.json()["session_id"])
    assert any(s == "unmanaged_device" for _, s, _ in st.evidence)
