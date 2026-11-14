"""Tests for mayajaal.surfaces against a small in-memory world (no real/shadow imports)."""

from __future__ import annotations

import base64
import re
from dataclasses import replace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mayajaal.contracts import Event
from mayajaal.surfaces import HONEYTOKEN_HEADER, build_router
from mayajaal.world_api import FsNode, Observation, Patient, PortalUser, SessionContext

FORBIDDEN = re.compile(r"fake|shadow|decoy|honeypot|mayajaal|maya", re.I)
HOSPS = ["aur", "riv", "nor", "eas", "wes", "lum"]
SECRET = "CANARY-7Q2X-SECRET-0001"


class StubWorld:
    tier = "real"

    def __init__(self, session_id: str = "s1", n: int = 45):
        self.session_id = session_id
        self.patients = [
            Patient(
                mrn=f"MRN-{418200 + i}", name=f"Pat{i} Lastname{i}", dob="1970-01-0%d" % (1 + i % 9),
                sex="F" if i % 2 else "M", hospital_id=HOSPS[i % len(HOSPS)],
                address=f"{i} Elm St, Meridian City, MC 04412", phone="555-0100",
                conditions=["E11.9 Type 2 diabetes"], medications=["Metformin 500 mg BID"],
                allergies=["Penicillin"], attending="Dr. A. Rao",
                notes=f"Stable. Ref {SECRET}" if i == 0 else "",
            ) for i in range(n)
        ]
        self.obs: dict[str, Observation] = {}
        for p in self.patients:
            o = Observation(obs_id=f"obs-{p.mrn}-hb", mrn=p.mrn, code="718-7", display="Hemoglobin",
                            value=13.9, unit="g/dL", ref_range="12.0-15.5", issued="2026-11-12T08:00:00+00:00",
                            performer_hospital="lum", signature=f"sig-{p.mrn}")
            self.obs[o.obs_id] = o
        self.touched_honeytokens: list[str] = []
        self.users = [
            PortalUser("n.okafor", "Nkechi Okafor", "nurse", "eas", "2026-11-13T23:10:00", False),
            PortalUser("j.marsh", "Jordan Marsh", "it_admin", "aur", "2026-11-12T09:00:00", True),
        ]
        self.fs = {
            "/mnt/backups": FsNode("/mnt/backups", "dir", children=["db_dump_2026-11-13.sql.gz",
                                                                    "db_dump_2026-11-12.sql.gz"]),
            "/mnt/backups/db_dump_2026-11-13.sql.gz": FsNode("/mnt/backups/db_dump_2026-11-13.sql.gz", "file",
                                                             size=4_123_456_789, mtime="2026-11-13T02:10:00"),
            "/mnt/backups/db_dump_2026-11-12.sql.gz": FsNode("/mnt/backups/db_dump_2026-11-12.sql.gz", "file",
                                                             size=4_101_000_000, mtime="2026-11-12T02:09:00"),
        }

    def total_patients(self) -> int:
        return len(self.patients)

    def list_patients(self, hospital_id, offset, limit):
        ps = [p for p in self.patients if hospital_id in (None, p.hospital_id)]
        return ps[offset:offset + limit]

    def get_patient(self, mrn):
        for p in self.patients:
            if p.mrn == mrn:
                if p.notes:
                    self.touched_honeytokens.append("ht-" + mrn)
                return p
        return None

    def observations(self, mrn):
        return [o for o in self.obs.values() if o.mrn == mrn]

    def put_observation(self, obs):
        self.obs[obs.obs_id] = obs
        return obs

    def portal_users(self):
        return self.users

    def hostname(self):
        return "jump-eas"

    def stat(self, path):
        return self.fs.get(path)

    def read_file(self, path):
        return ""

    def write_file(self, path, content):
        pass

    def dump_rows(self, path, limit):
        return self.patients[:limit]

    def dump_row_count(self, path):
        return len(self.patients)


@pytest.fixture
def env():
    world = StubWorld()
    events: list[Event] = []
    ctxs: list[SessionContext] = []

    async def sink(ev: Event) -> None:
        events.append(ev)

    def resolve(ctx: SessionContext):
        ctxs.append(ctx)
        return world

    app = FastAPI()
    app.include_router(build_router(resolve, sink))
    client = TestClient(app, headers={"X-MJ-Session": "sess-9", "X-MJ-Run": "run-1", "X-MJ-Hospital": "eas"})
    return client, world, events, ctxs


def _assert_clean(resp):
    assert not FORBIDDEN.search(resp.text), FORBIDDEN.search(resp.text).group(0)
    for k, v in resp.headers.items():
        if k.lower() == HONEYTOKEN_HEADER.lower():
            continue
        assert not FORBIDDEN.search(f"{k}: {v}"), (k, v)


# --------------------------------------------------------------------------- FHIR


def test_patient_bundle_and_paging(env):
    client, world, events, ctxs = env
    r = client.get("/fhir/Patient", params={"_count": 10, "_offset": 10})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/fhir+json")
    b = r.json()
    assert b["resourceType"] == "Bundle" and b["type"] == "searchset"
    assert b["total"] == 45 and len(b["entry"]) == 10
    rels = {l["relation"]: l["url"] for l in b["link"]}
    assert {"self", "first", "previous", "next", "last"} <= rels.keys()
    assert "_offset=20" in rels["next"] and "_offset=0" in rels["previous"] and "_offset=40" in rels["last"]
    assert b["entry"][0]["resource"]["id"] == "MRN-418210"
    assert b["entry"][0]["fullUrl"].endswith("/fhir/Patient/MRN-418210")
    # context came from headers
    assert ctxs[-1].session_id == "sess-9" and ctxs[-1].run_id == "run-1"
    # default count and last page
    d = client.get("/fhir/Patient").json()
    assert len(d["entry"]) == 20
    last = client.get("/fhir/Patient", params={"_offset": 40}).json()
    assert len(last["entry"]) == 5 and "next" not in {l["relation"] for l in last["link"]}
    assert not events


def test_patient_filters_and_forwarded_host(env):
    client, *_ = env
    b = client.get("/fhir/Patient", params={"hospital": "lum"}).json()
    assert b["total"] == len([i for i in range(45) if HOSPS[i % 6] == "lum"])
    assert all(e["resource"]["managingOrganization"]["reference"] == "Organization/lum" for e in b["entry"])
    n = client.get("/fhir/Patient", params={"name": "pat3"}).json()
    assert {e["resource"]["id"] for e in n["entry"]} == {"MRN-418203"} | {f"MRN-{418230 + i}" for i in range(10)}
    r = client.get("/fhir/Patient", headers={"X-Forwarded-Host": "ehr.meridianhealth.org",
                                             "X-Forwarded-Proto": "https"})
    assert r.json()["link"][0]["url"].startswith("https://ehr.meridianhealth.org/fhir/Patient")
    bad = client.get("/fhir/Patient", params={"_count": "lots"})
    assert bad.status_code == 400 and bad.json()["resourceType"] == "OperationOutcome"


def test_patient_read_shape(env):
    client, *_ = env
    r = client.get("/fhir/Patient/MRN-418201")
    p = r.json()
    assert r.status_code == 200 and p["resourceType"] == "Patient" and p["id"] == "MRN-418201"
    assert p["identifier"][0]["value"] == "MRN-418201"
    assert p["name"][0]["family"] == "Lastname1" and p["name"][0]["given"] == ["Pat1"]
    assert p["gender"] == "female" and p["birthDate"] == "1970-01-02"
    assert p["managingOrganization"]["reference"] == "Organization/riv"
    nf = client.get("/fhir/Patient/MRN-000000")
    assert nf.status_code == 404 and nf.json()["resourceType"] == "OperationOutcome"


def test_observation_shape(env):
    client, *_ = env
    b = client.get("/fhir/Observation", params={"patient": "Patient/MRN-418201"}).json()
    assert b["total"] == 1
    o = b["entry"][0]["resource"]
    assert o["resourceType"] == "Observation" and o["status"] == "final"
    assert o["code"]["coding"][0] == {"system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin"}
    assert o["valueQuantity"]["value"] == 13.9 and o["valueQuantity"]["unit"] == "g/dL"
    assert o["referenceRange"][0]["low"]["value"] == 12 and o["referenceRange"][0]["high"]["value"] == 15.5
    assert o["issued"] == "2026-11-12T08:00:00+00:00"
    assert o["performer"][0]["reference"] == "Organization/lum"
    assert o["subject"]["reference"] == "Patient/MRN-418201"
    assert client.get("/fhir/Observation").status_code == 400


def test_other_clinical_resources(env):
    client, *_ = env
    for rt in ("DiagnosticReport", "MedicationRequest", "AllergyIntolerance", "Condition"):
        b = client.get(f"/fhir/{rt}", params={"patient": "MRN-418202"}).json()
        assert b["resourceType"] == "Bundle" and b["total"] == 1, rt
        assert b["entry"][0]["resource"]["resourceType"] == rt
    dr = client.get("/fhir/DiagnosticReport", params={"patient": "MRN-418202"}).json()["entry"][0]["resource"]
    assert dr["result"][0]["reference"] == "Observation/obs-MRN-418202-hb"
    md = client.get("/fhir/metadata")
    assert md.json()["resourceType"] == "CapabilityStatement" and md.json()["fhirVersion"] == "4.0.1"
    orgs = client.get("/fhir/Organization").json()
    assert orgs["total"] == 6


def test_document_reference_returns_note(env):
    client, world, *_ = env
    r = client.get("/fhir/DocumentReference", params={"patient": "MRN-418200"})
    b = r.json()
    assert b["total"] == 1
    doc = b["entry"][0]["resource"]
    att = doc["content"][0]["attachment"]
    note = base64.b64decode(att["data"]).decode()
    assert note == world.patients[0].notes and SECRET in note
    assert att["size"] == len(note.encode())
    # reading the note touched a honeytoken in this world -> internal header for the gateway
    assert r.headers[HONEYTOKEN_HEADER] == "ht-MRN-418200"
    # direct read by id
    one = client.get(f"/fhir/DocumentReference/{doc['id']}")
    assert one.status_code == 200 and one.json()["id"] == doc["id"]
    # header lists only new touches
    r2 = client.get("/fhir/Patient/MRN-418201")
    assert HONEYTOKEN_HEADER not in r2.headers
    # patient with no note -> empty bundle
    assert client.get("/fhir/DocumentReference", params={"patient": "MRN-418201"}).json()["total"] == 0


# --------------------------------------------------------------------------- integrity path


def _obs_body(mrn: str, value: float, sig: str | None, obs_id: str | None = None) -> dict:
    body = {
        "resourceType": "Observation",
        "status": "final",
        "code": {"coding": [{"system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin"}]},
        "subject": {"reference": f"Patient/{mrn}"},
        "valueQuantity": {"value": value, "unit": "g/dL"},
        "performer": [{"reference": "Organization/lum"}],
    }
    if obs_id:
        body["id"] = obs_id
    if sig is not None:
        body["extension"] = [{"url": "https://fhir.meridianhealth.org/StructureDefinition/result-signature",
                              "valueString": sig}]
    return body


def test_tamper_without_signature_rejected(env):
    client, world, events, _ = env
    oid = "obs-MRN-418201-hb"
    r = client.put(f"/fhir/Observation/{oid}", json=_obs_body("MRN-418201", 6.1, None, oid))
    assert r.status_code == 422 and r.json()["resourceType"] == "OperationOutcome"
    assert len(events) == 1
    ev = events[0]
    assert ev.type == "tamper.attempt" and ev.actor == "attacker" and ev.tier == "real"
    assert ev.session_id == "sess-9" and ev.run_id == "run-1" and ev.hospital_id == "eas"
    assert ev.data["accepted"] is False and ev.data["accepted_by"] == []
    assert sorted(ev.data["rejected_by"]) == sorted(HOSPS)
    assert ev.data["resource"] == f"Observation/{oid}"
    assert world.obs[oid].value == 13.9  # rejected write left the record unchanged
    _assert_clean(r)


def test_tamper_wrong_signature_and_post_rejected(env):
    client, world, events, _ = env
    oid = "obs-MRN-418201-hb"
    r = client.put(f"/fhir/Observation/{oid}", json=_obs_body("MRN-418201", 6.1, "forged", oid))
    assert r.status_code == 422
    r = client.post("/fhir/Observation", json=_obs_body("MRN-418201", 6.1, None))
    assert r.status_code == 422
    assert [e.data["accepted"] for e in events] == [False, False]


def test_tamper_valid_signature_only_local(env):
    client, world, events, _ = env
    oid = "obs-MRN-418201-hb"
    r = client.put(f"/fhir/Observation/{oid}", json=_obs_body("MRN-418201", 9.9, "sig-MRN-418201", oid))
    assert r.status_code == 200
    assert r.json()["valueQuantity"]["value"] == 9.9
    assert world.obs[oid].value == 9.9
    assert len(events) == 1 and events[0].data["accepted_by"] == ["eas"] and events[0].data["accepted"]


def test_custom_integrity_check_and_shadow_tier():
    world = StubWorld()
    world.tier = "shadow"
    events: list[Event] = []
    seen = {}

    async def sink(ev):
        events.append(ev)

    def check(obs, w, ctx):
        seen["obs"] = obs
        return ["eas", "aur", "lum"], []

    app = FastAPI()
    app.include_router(build_router(lambda ctx: world, sink, integrity_check=check))
    c = TestClient(app)
    r = c.post("/fhir/Observation", json=_obs_body("MRN-418205", 4.2, None))
    assert r.status_code == 201 and "Location" in r.headers
    assert seen["obs"].value == 4.2 and seen["obs"].mrn == "MRN-418205"
    assert events[0].tier == "shadow" and events[0].data["accepted_by"] == ["eas", "aur", "lum"]
    _assert_clean(r)


def test_sink_failure_does_not_break_response():
    world = StubWorld()

    async def sink(ev):
        raise RuntimeError("hub down")

    app = FastAPI()
    app.include_router(build_router(lambda ctx: world, sink))
    r = TestClient(app).put("/fhir/Observation/obs-MRN-418201-hb", json=_obs_body("MRN-418201", 1.0, None))
    assert r.status_code == 422


# --------------------------------------------------------------------------- portal


def test_portal_html_pages(env):
    client, *_ = env
    r = client.get("/portal")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "Meridian Health Network" in r.text and "IT Services" in r.text and "<form" in r.text
    r = client.get("/portal/admin/users", headers={"X-MJ-User": "n.okafor"})
    assert "n.okafor" in r.text and "Jordan Marsh" in r.text and "Not enrolled" in r.text
    r = client.get("/portal/backups")
    assert "db_dump_2026-11-13.sql.gz" in r.text and "Lumen Shared Pathology" in r.text and "3.8 GB" in r.text
    r = client.get("/portal/network")
    assert "s2s-aur-riv" in r.text and "Westfield Heart Institute" in r.text
    login = client.post("/portal/login", data={"username": "x", "password": "y"}, follow_redirects=False)
    assert login.status_code == 303 and login.headers["location"] == "/portal/admin/users"


def test_portal_json_variants(env):
    client, *_ = env
    h = {"Accept": "application/json"}
    u = client.get("/portal/admin/users", headers=h)
    assert u.headers["content-type"].startswith("application/json")
    assert {x["username"] for x in u.json()["users"]} == {"n.okafor", "j.marsh"}
    bk = client.get("/portal/backups", headers=h).json()
    assert bk["backup_host_site"] == "Lumen Shared Pathology"
    assert [j["file"] for j in bk["jobs"]] == ["db_dump_2026-11-13.sql.gz", "db_dump_2026-11-12.sql.gz"]
    assert bk["jobs"][0]["size_bytes"] == 4_123_456_789
    net = client.get("/portal/network", headers=h).json()
    assert len(net["links"]) == 10 and net["links"][0]["site_a"] == "aur"
    assert client.get("/portal", headers=h).json()["login"] == "/portal/login"
    # browsers (text/html first) still get HTML
    br = client.get("/portal/backups", headers={"Accept": "text/html,application/xhtml+xml,application/json;q=0.9"})
    assert br.headers["content-type"].startswith("text/html")


def test_backups_without_mount_fall_back(env):
    client, world, *_ = env
    world.fs = {}
    bk = client.get("/portal/backups", headers={"Accept": "application/json"}).json()
    assert len(bk["jobs"]) == 7 and all(j["file"].startswith("db_dump_") for j in bk["jobs"])


# --------------------------------------------------------------------------- no tells


def test_no_forbidden_words_anywhere(env):
    client, world, *_ = env
    world.tier = "shadow"
    gets = [
        "/fhir/metadata", "/fhir/Patient", "/fhir/Patient?name=pat", "/fhir/Patient?hospital=eas",
        "/fhir/Patient/MRN-418200", "/fhir/Patient/nope",
        "/fhir/Observation?patient=MRN-418200", "/fhir/DiagnosticReport?patient=MRN-418200",
        "/fhir/MedicationRequest?patient=MRN-418200", "/fhir/AllergyIntolerance?patient=MRN-418200",
        "/fhir/Condition?patient=MRN-418200", "/fhir/DocumentReference?patient=MRN-418200",
        "/fhir/Organization", "/fhir/Organization/lum", "/fhir/Observation",
        "/portal", "/portal/admin/users", "/portal/backups", "/portal/network",
    ]
    for accept in ("text/html", "application/json"):
        for path in gets:
            _assert_clean(client.get(path, headers={"Accept": accept}))
    _assert_clean(client.put("/fhir/Observation/obs-MRN-418200-hb",
                             json=_obs_body("MRN-418200", 2.0, "sig-MRN-418200", "obs-MRN-418200-hb")))
    _assert_clean(client.put("/fhir/Observation/x", content=b"not json"))
    _assert_clean(client.post("/portal/login", data={}, follow_redirects=False))
