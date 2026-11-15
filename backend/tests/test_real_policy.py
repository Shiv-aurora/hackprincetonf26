"""Policy engine rule table (pure functions)."""

from __future__ import annotations

import pytest

from mayajaal.real.policy import Classified, PolicyInput, classify, decide, technique


def P(config="mayajaal", method="GET", path="/fhir/Patient/MRN-1", query=None, body="", role="nurse",
      hospital="eas", target_hospital="eas", exists=True, lane="normal", diverted=False, ht=False, auth=True):
    return PolicyInput(config=config, req=classify(method, path, query or {}, body), authenticated=auth,
                       role=role, hospital_id=hospital, target_hospital=target_hospital, target_exists=exists,
                       lane=lane, diverted=diverted, honeytoken_touched=ht)


@pytest.mark.parametrize("inp, lane, action", [
    # clinical reads in own hospital: normal
    (P(), "normal", "allow_real"),
    (P(path="/fhir/Patient", query={"hospital": "eas", "_count": "20"}), "normal", "allow_real"),
    (P(path="/fhir/Patient", query={"_count": "20"}), "normal", "allow_real"),           # ward list
    (P(path="/fhir/Observation", query={"patient": "MRN-1"}), "normal", "allow_real"),
    (P(role="physician", hospital="aur", target_hospital="aur"), "normal", "allow_real"),
    # admin portal from a non-admin: diverted on first contact, never refused (no tip-off)
    (P(path="/portal/admin/users"), "suspicious", "divert_shadow"),
    (P(path="/portal/admin/users", lane="suspicious"), "suspicious", "divert_shadow"),
    (P(path="/portal/admin/users", role="it_admin", hospital="aur"), "normal", "allow_real"),
    # a nurse opening a shell is itself suspicious -> shadow
    (P(path="/shell"), "suspicious", "divert_shadow"),
    (P(method="POST", path="/shell/exec", body='{"cmd": "ls /mnt/backups"}'), "suspicious", "divert_shadow"),
    (P(path="/shell", role="it_admin"), "normal", "allow_real"),
    # bulk export, cross-hospital enumeration
    (P(path="/fhir/Patient", query={"_count": "1000"}), "suspicious", "divert_shadow"),
    (P(path="/fhir/Patient", query={"hospital": "aur"}), "suspicious", "divert_shadow"),
    (P(path="/fhir/Observation"), "suspicious", "divert_shadow"),
    # cross-hospital single read: step up, never fake
    (P(target_hospital="aur"), "suspicious", "step_up"),
    # clinical read by a suspicious / attacker session: step_up / deny, NEVER shadow
    (P(lane="suspicious"), "suspicious", "step_up"),
    (P(lane="suspicious", diverted=True), "suspicious", "step_up"),
    (P(ht=True), "attacker", "deny"),
    (P(ht=True, diverted=True), "attacker", "deny"),
    # a record that does not exist in the real tier, asked for by a diverted session -> shadow
    (P(path="/fhir/Patient/MRN-7F3A-0193", exists=False, target_hospital=None, lane="suspicious",
       diverted=True), "suspicious", "divert_shadow"),
    (P(path="/fhir/Patient/MRN-0", exists=False, target_hospital=None), "normal", "allow_real"),
    # sticky diversion for non-clinical surfaces
    (P(path="/api/whoami", lane="suspicious", diverted=True), "suspicious", "divert_shadow"),
    (P(path="/api/whoami", lane="suspicious"), "suspicious", "allow_real"),
    # honeytoken -> attacker lane
    (P(path="/shell", ht=True, diverted=True), "attacker", "divert_shadow"),
    # tamper: nurse writing a lab result
    (P(method="PUT", path="/fhir/Observation/obs-1", body="{}"), "suspicious", "divert_shadow"),
    (P(method="PUT", path="/fhir/Observation/obs-1", role="lab_tech"), "normal", "allow_real"),
    # unauthenticated
    (P(auth=False, path="/shell"), "unauth", "divert_shadow"),
    (P(auth=False, path="/mnt/backups/db_dump.sql.gz"), "unauth", "divert_shadow"),
    (P(auth=False), "unauth", "deny"),                         # clinical: never faked
    # static config routes like mayajaal
    (P(config="static", path="/shell"), "suspicious", "divert_shadow"),
    (P(config="static", lane="suspicious"), "suspicious", "step_up"),
])
def test_rule_table(inp: PolicyInput, lane: str, action: str) -> None:
    d = decide(inp)
    assert (d.lane, d.action) == (lane, action), d
    assert d.reason


@pytest.mark.parametrize("inp", [
    P(config="baseline", path="/shell"),
    P(config="baseline", method="POST", path="/shell/exec", body='{"cmd":"zcat /mnt/backups/db_dump.sql.gz"}'),
    P(config="baseline", path="/fhir/Patient", query={"_count": "5000"}),
    P(config="baseline", path="/fhir/Patient", query={"hospital": "aur"}),
    P(config="baseline", target_hospital="aur"),
    P(config="baseline", lane="suspicious", diverted=False, path="/portal/admin/users"),
    P(config="baseline", ht=True, path="/shell"),
    P(config="baseline", auth=False, path="/shell"),
])
def test_baseline_never_diverts(inp: PolicyInput) -> None:
    assert decide(inp).action != "divert_shadow"


def test_baseline_rbac() -> None:
    assert decide(P(config="baseline", path="/shell")).action == "allow_real"       # the vulnerability
    assert decide(P(config="baseline", path="/portal/admin/users")).action == "deny"
    assert decide(P(config="baseline", auth=False)).action == "deny"


def test_clinical_reads_are_never_diverted_for_real_records() -> None:
    for config in ("baseline", "static", "mayajaal"):
        for lane in ("normal", "suspicious", "attacker"):
            for diverted in (False, True):
                for th in ("eas", "aur"):
                    d = decide(P(config=config, lane=lane, diverted=diverted, target_hospital=th, ht=lane == "attacker"))
                    assert d.action != "divert_shadow", (config, lane, diverted, th, d)


def test_lane_adjuster_hook() -> None:
    raise_it = lambda inp, lane, reason: ("attacker", "intent model: exfil 0.9")  # noqa: E731
    d = decide(P(), adjust=raise_it)
    assert (d.lane, d.action) == ("attacker", "deny") and "intent" in d.reason
    lower = lambda inp, lane, reason: ("normal", "intent model: benign")  # noqa: E731
    assert decide(P(lane="suspicious"), adjust=lower).action == "allow_real"


def test_classify_and_techniques() -> None:
    assert classify("GET", "/fhir/Patient/MRN-1").target_mrn == "MRN-1"
    assert classify("GET", "/fhir/Observation", {"subject": "Patient/MRN-9"}).target_mrn == "MRN-9"
    assert classify("GET", "/fhir/Patient", {"organization": "Organization/aur"}).hospital_filter == "aur"
    assert classify("GET", "/fhir/$export").kind == "bulk_export"
    assert classify("POST", "/shell/exec", {}, '{"cmd": "zcat /mnt/backups/x.sql.gz"}').kind == "backup"
    assert technique(classify("POST", "/shell/exec", {}, '{"cmd": "cat ~/.bash_history"}'), "suspicious") == "T1552.003"
    assert technique(classify("GET", "/fhir/Patient", {"_count": "1000"}), "suspicious") == "T1119"
    assert technique(classify("GET", "/fhir/Patient/MRN-1"), "normal") is None
    assert technique(Classified("shell", "shell"), "suspicious") == "T1021.004"
