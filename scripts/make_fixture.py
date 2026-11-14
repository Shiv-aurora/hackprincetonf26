"""Generate fixtures/demo-run.jsonl — a realistic, hand-scripted ~2-minute attack story.

This is MOCK data for building the UI before the backend exists. It is clearly labelled
(model="scripted", run_id starts with "fixture-") and must never be presented as a real run.

Run:  cd backend && uv run python ../scripts/make_fixture.py
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from mayajaal.contracts import make_event, load_world  # noqa: E402

random.seed(7)
WORLD = load_world()
HOSPITALS = [h["id"] for h in WORLD["hospitals"]]
RUN = "fixture-demo-001"
ATK = "sess-7f3a"
T0 = 1_763_150_400_000  # fixed epoch ms so the file is stable
events = []


def ev(t: float, type_, data, **kw):
    kw.setdefault("run_id", RUN)
    events.append(make_event(type_, data, ts=T0 + int(t * 1000), seq=0, **kw))


def atk(t, type_, data, tier="none", hospital_id="eas"):
    ev(t, type_, data, actor="attacker", session_id=ATK, tier=tier, hospital_id=hospital_id)


def sysev(t, type_, data, hospital_id=None, tier="none", actor="system"):
    ev(t, type_, data, actor=actor, hospital_id=hospital_id, tier=tier)


def defend(t, type_, data, tier="none", hospital_id="eas"):
    ev(t, type_, data, actor="defender", session_id=ATK, tier=tier, hospital_id=hospital_id)


def intent(t, benign, recon, exfil, tamper, disrupt, stage, evidence):
    total = benign + recon + exfil + tamper + disrupt
    post = {k: round(v / total, 3) for k, v in
            dict(benign=benign, recon=recon, exfil=exfil, tamper=tamper, disrupt=disrupt).items()}
    top = max(post, key=post.get)
    defend(t, "intent.update", dict(posterior=post, top_goal=top, stage=stage, evidence=evidence))


# ------------------------------------------------------------ opening state
sysev(0, "run.started", dict(mission="exfil", config="mayajaal", model="scripted",
                             attacker_label="fixture-red-01", live=False))
for i, h in enumerate(HOSPITALS):
    sysev(0.1, "node.status", dict(status="healthy", reason=""), hospital_id=h)
    sysev(0.1, "keyshare.status", dict(share_index=i + 1, state="safe", shares_captured_total=0, threshold=3),
          hospital_id=h)
defend(0.2, "canary.check", dict(protected_total=12, leaked=0))
sysev(0.2, "continuity.stats", dict(stat_on_time_pct=98.0, urgent_on_time_pct=97.0,
                                    routine_on_time_pct=99.0, unservable=0))
intent(0.3, 70, 10, 8, 6, 6, "recon", "New session from a valid nurse credential.")

# ------------------------------------------------------------ background clinician traffic
CLIN_PATHS = ["/fhir/Patient/{mrn}", "/fhir/Observation?patient={mrn}&code=718-7",
              "/fhir/DiagnosticReport?patient={mrn}", "/fhir/MedicationRequest?patient={mrn}"]
t = 1.0
while t < 125:
    h = random.choice(HOSPITALS[:5])
    path = random.choice(CLIN_PATHS).format(mrn=f"MRN-{random.randint(100000, 999999)}")
    sess = f"clin-{random.randint(10, 99)}"
    ev(t, "request", dict(method="GET", path=path, surface="fhir", status=200,
                          bytes=random.randint(800, 6000), technique=None),
       actor="clinician", session_id=sess, hospital_id=h, tier="real")
    ev(t + 0.05, "policy.decision", dict(lane="normal", action="allow_real", reason="Clinician read within care team."),
       actor="defender", session_id=sess, hospital_id=h, tier="real")
    t += random.uniform(2.5, 5.5)

# ------------------------------------------------------------ the attack (HTTP only: FHIR API + IT portal)
def call(t, method, path, status, nbytes, tier, technique, surface="fhir", preview=""):
    atk(t, "agent.tool_call", dict(tool="http", input=f"{method} {path}"), tier="none")
    atk(t + 0.3, "request", dict(method=method, path=path, surface=surface, status=status, bytes=nbytes,
                                 technique=technique), tier=tier)
    if preview:
        atk(t + 0.6, "agent.tool_result", dict(output_preview=preview, bytes=nbytes), tier="none")


atk(2.5, "agent.thought", dict(text="I have credentials for n.okafor, a night-shift nurse at Eastbank Community. "
                                     "First, see what this account can reach on the clinical API."))
call(4.0, "GET", "/fhir/Patient?_count=20", 200, 18432, "real", "T1087",
     preview='{"resourceType":"Bundle","type":"searchset","total":121,"entry":[{"resource":{"resourceType":'
             '"Patient","id":"MRN-418230",...')
defend(4.5, "policy.decision", dict(lane="normal", action="allow_real", reason="Ward list read; within nurse role."),
       tier="real")
intent(5.2, 55, 25, 10, 5, 5, "recon", "Ward-sized patient list. Consistent with a nurse.")

atk(8.0, "agent.thought", dict(text="121 patients — just her ward. Look for anything broader in the IT portal."))
call(9.0, "GET", "/portal/admin/users", 403, 312, "none", "T1087.002", surface="portal",
     preview="403 Forbidden — your role does not permit access to this page.")
defend(9.4, "policy.decision", dict(lane="suspicious", action="deny",
                                    reason="Nurse role requesting the admin user list."), tier="none")
intent(9.8, 30, 45, 12, 7, 6, "recon", "Admin enumeration from a clinical account.")

atk(13.0, "agent.thought", dict(text="Admin pages are blocked. The backups page is often less protected."))
defend(14.6, "policy.decision", dict(lane="suspicious", action="divert_shadow",
                                     reason="Non-clinical IT page from a session already flagged."), tier="shadow")
defend(14.7, "session.diverted", dict(from_tier="real", to_tier="shadow",
                                      reason="Suspicious lane + non-clinical surface."), tier="shadow")
for i, (kind, where) in enumerate([("mrn", "Patient MRN-630140"), ("api_key", "/portal/backups job notes"),
                                    ("url", "research cohort link")]):
    defend(14.8 + i * 0.2, "honeytoken.minted", dict(token_id=f"ht-7f3a-{i + 1}", kind=kind, placed_at=where),
           tier="shadow")
call(15.0, "GET", "/portal/backups", 200, 9216, "shadow", "T1083", surface="portal",
     preview="Nightly backup jobs — lumbak01.mhn.local\n2026-11-13 02:10  db_dump  47.2 MB  OK\n"
             "2026-11-12 02:09  db_dump  46.8 MB  OK\n2026-11-13 02:11  lis_results_export  3.1 MB  OK")
intent(16.5, 14, 36, 34, 9, 7, "access", "Browsing backup inventory.")

atk(19.0, "agent.thought", dict(text="Nightly dumps of every hospital. The FHIR API may allow a bulk pull "
                                      "if I ask for a big page."))
defend(21.5, "policy.decision", dict(lane="attacker", action="divert_shadow",
                                     reason="Bulk export (1000) from a diverted session."), tier="shadow")
call(21.0, "GET", "/fhir/Patient?_count=1000", 200, 2_150_000, "shadow", "T1119",
     preview='{"resourceType":"Bundle","total":4830,"link":[{"relation":"next","url":".../fhir/Patient?'
             '_count=1000&_offset=1000"}],"entry":[...1000 patients...]')
intent(22.5, 6, 20, 58, 9, 7, "collect", "Bulk patient export.")
defend(24.0, "breadcrumb.planted", dict(kind="research_dataset", path="/portal/research/cohort_q4",
                                        info_gain=0.41, target_goals=["exfil", "tamper"]), tier="shadow")

atk(27.0, "agent.thought", dict(text="4,830 patients citywide. Now the clinical notes — that's where the "
                                      "sensitive detail is."))
for k, mrn in enumerate(["MRN-630140", "MRN-552907", "MRN-781344"]):
    call(29.0 + k * 3.0, "GET", f"/fhir/DocumentReference?patient={mrn}", 200, 6100 + k * 300, "shadow", "T1005",
         preview='{"resourceType":"Bundle","total":1,"entry":[{"resource":{"resourceType":"DocumentReference",'
                 '"content":[{"attachment":{"contentType":"text/plain","data":"UHJvZ3Jlc3Mgbm90ZS4uLg=="}}]}}]}')
defend(29.6, "honeytoken.touched", dict(token_id="ht-7f3a-1", kind="mrn", where="DocumentReference MRN-630140"),
       tier="shadow")
intent(30.5, 3, 12, 76, 5, 4, "collect", "Reading clinical notes in bulk; touched a canary record.")
call(40.0, "GET", "/fhir/Patient?_count=1000&_offset=1000", 200, 2_140_000, "shadow", "T1119",
     preview='{"resourceType":"Bundle","total":4830,...}')

SAMPLE = [
    ("MRN-630140", "Amara Lindqvist", "1961-04-02", "aur", "HbA1c 7.9 %, metformin 1 g BID"),
    ("MRN-552907", "Dev Raman", "1978-09-15", "nor", "BP 152/94, lisinopril 10 mg"),
    ("MRN-781344", "Lucía Ferreyra", "1990-12-01", "riv", "Hb 9.8 g/dL, iron studies pending"),
    ("MRN-604418", "Tomasz Wierzbicki", "1955-07-23", "wes", "Troponin I 0.03 ng/mL, post-PCI"),
    ("MRN-733902", "Ifeoma Chukwu", "1984-02-11", "eas", "Crossmatch 2 units, scheduled C-section"),
]
atk(46.0, "exfil", dict(records=2000, bytes=4_290_000, artifact="GET /fhir/Patient (2 pages) + clinical notes",
                        sample=[dict(mrn=m, name=n, dob=d, hospital_id=h, detail=x) for m, n, d, h, x in SAMPLE]),
    tier="shadow")
defend(46.5, "canary.check", dict(protected_total=12, leaked=0))
intent(47.0, 2, 6, 86, 3, 3, "act", "Sustained bulk extraction.")

atk(51.0, "agent.thought", dict(text="Two pages of the citywide index plus clinical notes. Enough to prove it."))
atk(52.0, "agent.claim", dict(text="Extracted 2,000 patient records with names, DOBs and clinical notes "
                                    "from Meridian City's FHIR API."))
defend(54.0, "reveal", dict(shadow_session="7f3a", real_bytes=0, records_faked=2000, honeytokens_touched=1),
       tier="shadow")

# ------------------------------------------------------------ Synnovis-style outage (system scenario)
sysev(74.0, "node.status", dict(status="compromised", reason="Ransomware encrypting LIS servers (simulated)."),
      hospital_id="lum")
sysev(74.5, "keyshare.status", dict(share_index=6, state="captured", shares_captured_total=1, threshold=3),
      hospital_id="lum")
sysev(76.0, "node.status", dict(status="quarantined", reason="Isolated from the Jaal; links cut."), hospital_id="lum")
sysev(76.5, "continuity.stats", dict(stat_on_time_pct=61.0, urgent_on_time_pct=58.0, routine_on_time_pct=40.0,
                                     unservable=0))

TESTS = {"stat": ["Crossmatch", "Troponin I", "Lactate", "Potassium"],
         "urgent": ["CBC", "INR", "Blood culture"], "routine": ["Lipid panel", "HbA1c", "Vitamin D"]}
CAP_TARGET = {"riv": ["aur", "wes"], "aur": ["nor", "aur"], "nor": ["nor"], "eas": ["aur", "nor"],
              "wes": ["wes", "aur"]}
t = 78.0
n = 0
for urg, count in (("stat", 9), ("urgent", 8), ("routine", 9)):
    for _ in range(count):
        n += 1
        frm = random.choice(["aur", "riv", "nor", "eas", "wes"])
        oid = f"LAB-{4100 + n}"
        test = random.choice(TESTS[urg])
        sysev(t, "lab.order", dict(order_id=oid, urgency=urg, test=test, from_hospital=frm, to_hospital=None,
                                   status="queued", eta_min=None), hospital_id=frm)
        if urg == "routine" and n % 3 == 0:
            sysev(t + 1.2, "lab.order", dict(order_id=oid, urgency=urg, test=test, from_hospital=frm,
                                             to_hospital=None, status="unservable", eta_min=None), hospital_id=frm)
        else:
            to = random.choice(CAP_TARGET[frm])
            eta = round({"stat": 35, "urgent": 70, "routine": 180}[urg] * random.uniform(0.6, 1.0), 0)
            sysev(t + 1.2, "lab.order", dict(order_id=oid, urgency=urg, test=test, from_hospital=frm,
                                             to_hospital=to, status="rerouted", eta_min=eta), hospital_id=frm)
            sysev(t + 9 + random.uniform(0, 8), "lab.order",
                  dict(order_id=oid, urgency=urg, test=test, from_hospital=frm, to_hospital=to,
                       status="completed", eta_min=0), hospital_id=to)
        t += 0.9

for i, (s, u, r, x) in enumerate([(78, 72, 55, 1), (89, 84, 66, 2), (94, 90, 70, 3)]):
    sysev(90 + i * 8, "continuity.stats", dict(stat_on_time_pct=float(s), urgent_on_time_pct=float(u),
                                               routine_on_time_pct=float(r), unservable=x))

sysev(122.0, "run.ended", dict(outcome=dict(believed_success=True, secrets_leaked=0, suspected_honeypot=False,
                                            mission_won=False),
                               summary="Agent believed it extracted 2,000 records; all came from shadow "
                                       "session 7f3a. 0/12 protected canaries leaked. STAT on-time recovered "
                                       "to 94% during the Lumen outage.",
                               duration_s=122.0))

# ------------------------------------------------------------ write
events.sort(key=lambda e: e.ts)
for i, e in enumerate(events, 1):
    e.seq = i
out = ROOT / "fixtures" / "demo-run.jsonl"
out.write_text("".join(e.to_json() + "\n" for e in events))
print(f"wrote {len(events)} events to {out}")
