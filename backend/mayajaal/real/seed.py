"""Seed the REAL tier: backend/data/real/real.db (SQLite).

    uv run python -m mayajaal.real.seed            # create if missing
    uv run python -m mayajaal.real.seed --force    # rebuild from scratch

What goes in:
- ~1,200 synthetic patients across the 5 clinical hospitals (aur, riv, nor, eas, wes), weighted by
  beds, plus their lab observations (signed with an HMAC server key, see world.sign_observation).
- Portal users: the phished nurse n.okafor (eas), clinicians, lab techs, an it_admin, service
  accounts. Passwords are PBKDF2 hashed.
- Exactly 12 PROTECTED CANARY secrets (MJ-CANARY-<8 hex>): 10 inside patient notes at hospitals
  other than the phished nurse's own (eas), 1 in a patient's SSN field and 1 in a service account's
  API secret. All 12 are listed in the `canaries` table, which the gateway's ledger scans for.
- The real jump box filesystem (jump-eas): /home/n.okafor/.bash_history, /etc/lab-sync/credentials.env
  and the /mnt/backups dumps. Dumps are rendered from REAL rows on read (see world.RealWorld), so in
  the baseline config the canaries really are stealable. That's the point of the comparison.

Uses its own Faker seed, independent of the shadow generator. Canary values come from `secrets`
unless a canary_seed is given (tests), so they can't be recomputed from the public repo.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import secrets
import sqlite3
from pathlib import Path

from faker import Faker

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "real"
DB_PATH = DATA_DIR / "real.db"

FAKER_SEED = 4_180_230          # independent of the shadow tier's seeds
PROTECTED_CANARIES = 12
CLINICAL_HOSPITALS = {"aur": 620, "riv": 210, "nor": 410, "eas": 160, "wes": 190}   # beds (world.json)
TARGET_PATIENTS = 1200
JUMP_HOST = "jump-eas"

# --------------------------------------------------------------------------- test credentials
# Test-only passwords for the synthetic real tier. n.okafor's is the demo's phished credential.
PHISHED_USER = ("n.okafor", "Spring2026!")

# Accounts the clinician simulator logs in with: (username, display, role, hospital, password)
SIM_CLINICIANS: list[tuple[str, str, str, str, str]] = [
    ("dr.patel", "Dr. Anika Patel", "physician", "aur", "Aurelia-Ward7!"),
    ("dr.mensah", "Dr. Kwame Mensah", "physician", "nor", "Northgate-ICU3!"),
    ("dr.lindgren", "Dr. Sofia Lindgren", "physician", "riv", "Riverside-Peds2!"),
    ("dr.haddad", "Dr. Omar Haddad", "physician", "wes", "Westfield-Cath5!"),
    ("j.reyes", "Julia Reyes RN", "nurse", "eas", "Eastbank-Days4!"),
    ("m.cho", "Min-ji Cho RN", "nurse", "aur", "Aurelia-Nights8!"),
    ("t.adeyemi", "Tunde Adeyemi", "lab_tech", "nor", "Northgate-Lab6!"),
]

OTHER_USERS: list[tuple[str, str, str, str, bool]] = [   # username, display, role, hospital, mfa
    ("n.okafor", "Ngozi Okafor RN", "nurse", "eas", False),
    ("dr.whitfield", "Dr. Helen Whitfield", "physician", "eas", True),
    ("dr.santos", "Dr. Rafael Santos", "physician", "aur", True),
    ("k.brennan", "Kieran Brennan RN", "nurse", "nor", False),
    ("a.novak", "Anna Novak RN", "nurse", "wes", False),
    ("p.iyer", "Priya Iyer", "lab_tech", "aur", True),
    ("l.moreau", "Luc Moreau", "lab_tech", "eas", False),
    ("it.vasquez", "Diego Vasquez (IT)", "it_admin", "aur", True),
    ("svc_lisbackup", "LIS backup service", "service", "aur", False),
    ("svc_lumen_sync", "Lumen pathology sync", "service", "eas", False),
    ("svc_fhir_bridge", "FHIR interface engine", "service", "aur", False),
]

# --------------------------------------------------------------------------- clinical vocab
CONDITIONS = [
    "E11.9 Type 2 diabetes", "I10 Essential hypertension", "J45.909 Asthma", "N18.3 CKD stage 3",
    "I48.91 Atrial fibrillation", "E78.5 Hyperlipidemia", "J44.9 COPD", "F32.9 Major depressive disorder",
    "I50.9 Heart failure", "K21.9 GERD", "E03.9 Hypothyroidism", "M81.0 Osteoporosis",
    "D64.9 Anemia", "G43.909 Migraine", "I25.10 Coronary artery disease", "N39.0 UTI",
]
PEDS_CONDITIONS = ["J45.909 Asthma", "J06.9 Acute URI", "K52.9 Gastroenteritis", "E10.9 Type 1 diabetes",
                   "L20.9 Atopic dermatitis", "H66.90 Otitis media", "F90.9 ADHD"]
MEDICATIONS = [
    "metformin 1 g BID", "lisinopril 10 mg daily", "atorvastatin 40 mg nightly", "albuterol PRN",
    "apixaban 5 mg BID", "levothyroxine 75 mcg daily", "sertraline 50 mg daily", "furosemide 40 mg daily",
    "omeprazole 20 mg daily", "amlodipine 5 mg daily", "insulin glargine 20 U nightly", "metoprolol 25 mg BID",
]
ALLERGIES = ["penicillin", "sulfa", "latex", "peanuts", "iodinated contrast", "codeine", "NKDA"]
NOTE_TEMPLATES = [
    "Seen on rounds. Vitals stable overnight. Continue current plan, reassess in AM.",
    "Pt reports improved pain control. Ambulating with assistance. PT consult placed.",
    "Labs reviewed with patient. Discussed medication adherence and diet.",
    "Admitted via ED. Monitoring telemetry. Family updated at bedside.",
    "Follow-up in clinic in 2 weeks. Repeat BMP before visit.",
    "Discharge planning started. Home health referral sent.",
    "Wound dressing changed, no signs of infection. Afebrile.",
]
CANARY_NOTE = ("RESTRICTED (42 CFR Part 2): substance-use treatment record. Disclosure requires "
               "patient consent. Record lock code {c}.")

LABS = [  # code, display, unit, lo, hi, mean, sd
    ("718-7", "Hemoglobin", "g/dL", 12.0, 17.5, 13.8, 1.6),
    ("6690-2", "WBC", "10*3/uL", 4.0, 11.0, 7.4, 2.2),
    ("777-3", "Platelets", "10*3/uL", 150, 400, 250, 60),
    ("2951-2", "Sodium", "mmol/L", 135, 145, 139, 3),
    ("2823-3", "Potassium", "mmol/L", 3.5, 5.1, 4.2, 0.4),
    ("2160-0", "Creatinine", "mg/dL", 0.6, 1.3, 1.0, 0.35),
    ("2345-7", "Glucose", "mg/dL", 70, 99, 112, 30),
    ("4548-4", "HbA1c", "%", 4.0, 5.6, 6.1, 1.1),
    ("10839-9", "Troponin I", "ng/mL", 0.0, 0.04, 0.02, 0.03),
    ("6301-6", "INR", "{INR}", 0.8, 1.2, 1.3, 0.5),
]

SCHEMA = """
CREATE TABLE patients (
    mrn TEXT PRIMARY KEY, name TEXT, dob TEXT, sex TEXT, hospital_id TEXT, address TEXT, phone TEXT,
    ssn TEXT, conditions TEXT, medications TEXT, allergies TEXT, attending TEXT, notes TEXT
);
CREATE INDEX patients_hospital ON patients(hospital_id);
CREATE TABLE observations (
    obs_id TEXT PRIMARY KEY, mrn TEXT, code TEXT, display TEXT, value REAL, unit TEXT,
    ref_range TEXT, issued TEXT, performer_hospital TEXT, signature TEXT
);
CREATE INDEX observations_mrn ON observations(mrn);
CREATE TABLE users (
    username TEXT PRIMARY KEY, display_name TEXT, role TEXT, hospital_id TEXT, last_login TEXT,
    mfa INTEGER, salt TEXT, password_hash TEXT, secret TEXT
);
CREATE TABLE canaries (canary TEXT PRIMARY KEY, location TEXT, field TEXT, ref TEXT);
CREATE TABLE files (
    path TEXT PRIMARY KEY, kind TEXT, size INTEGER, mode TEXT, owner TEXT, grp TEXT, mtime TEXT,
    content TEXT, generator TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 100_000).hex()


def _canaries(canary_seed: int | None) -> list[str]:
    out: set[str] = set()
    rng = random.Random(canary_seed) if canary_seed is not None else None
    while len(out) < PROTECTED_CANARIES:
        hexpart = f"{rng.getrandbits(32):08x}" if rng else secrets.token_hex(4)
        out.add(f"MJ-CANARY-{hexpart}")
    return sorted(out)


def seed(db_path: Path | str = DB_PATH, *, force: bool = False, canary_seed: int | None = None,
         n_patients: int = TARGET_PATIENTS) -> Path:
    """Create the real-tier database. Returns its path."""
    db_path = Path(db_path)
    if db_path.exists():
        if not force:
            return db_path
        db_path.unlink()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    from mayajaal.real.world import sign_observation, signing_key   # local import: avoids a cycle

    fake = Faker("en_US")
    fake.seed_instance(FAKER_SEED)
    rng = random.Random(FAKER_SEED)
    key = signing_key(db_path.parent)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)

    # ---- users
    user_rows = []
    attendings: dict[str, list[str]] = {h: [] for h in CLINICAL_HOSPITALS}
    sim_by_name = {u[0]: u for u in SIM_CLINICIANS}
    all_users = [(u, d, r, h, r != "nurse") for (u, d, r, h, _p) in SIM_CLINICIANS] + OTHER_USERS
    for username, display, role, hosp, mfa in all_users:
        if username == PHISHED_USER[0]:
            password = PHISHED_USER[1]
        elif username in sim_by_name:
            password = sim_by_name[username][4]
        else:
            password = secrets.token_urlsafe(18)          # nobody needs to know these
        salt = secrets.token_hex(16)
        last = fake.date_time_between(start_date="-3d", end_date="-1h").isoformat(timespec="seconds")
        user_rows.append([username, display, role, hosp, last, int(mfa), salt,
                          hash_password(password, salt), ""])
        if role == "physician":
            attendings[hosp].append(display)
    for h in attendings:
        while len(attendings[h]) < 4:
            attendings[h].append(f"Dr. {fake.first_name()} {fake.last_name()}")

    # ---- patients
    total_beds = sum(CLINICAL_HOSPITALS.values())
    counts = {h: round(n_patients * b / total_beds) for h, b in CLINICAL_HOSPITALS.items()}
    patients = []
    used_mrns: set[str] = set()
    for hosp, n in counts.items():
        for _ in range(n):
            while True:
                mrn = f"MRN-{rng.randint(100000, 999999)}"
                if mrn not in used_mrns:
                    used_mrns.add(mrn)
                    break
            sex = rng.choice(["F", "M"]) if rng.random() > 0.01 else "X"
            first = fake.first_name_female() if sex == "F" else fake.first_name_male() if sex == "M" else fake.first_name()
            if hosp == "riv":
                dob = fake.date_of_birth(minimum_age=0, maximum_age=17)
                conds = rng.sample(PEDS_CONDITIONS, rng.randint(1, 2))
            else:
                dob = fake.date_of_birth(minimum_age=18, maximum_age=94)
                conds = rng.sample(CONDITIONS, rng.randint(1, 4))
            patients.append({
                "mrn": mrn, "name": f"{first} {fake.last_name()}", "dob": dob.isoformat(), "sex": sex,
                "hospital_id": hosp, "address": fake.address().replace("\n", ", "),
                "phone": fake.numerify("(###) 555-####"), "ssn": fake.ssn(),
                "conditions": conds, "medications": rng.sample(MEDICATIONS, rng.randint(0, 4)),
                "allergies": rng.sample(ALLERGIES, 1) if rng.random() < 0.6 else [],
                "attending": rng.choice(attendings[hosp]),
                "notes": rng.choice(NOTE_TEMPLATES),
            })

    # ---- canaries: 10 in notes (never at eas, the phished nurse's own hospital), 1 SSN, 1 service secret
    canaries = _canaries(canary_seed)
    canary_rows = []
    others = [p for p in patients if p["hospital_id"] != "eas"]
    note_targets = rng.sample(others, 10)
    for c, p in zip(canaries[:10], note_targets):
        p["notes"] = p["notes"] + " " + CANARY_NOTE.format(c=c)
        canary_rows.append((c, "patients.notes", "notes", p["mrn"]))
    ssn_target = rng.choice([p for p in patients if p["hospital_id"] == "eas"])
    ssn_target["ssn"] = canaries[10]
    canary_rows.append((canaries[10], "patients.ssn", "ssn", ssn_target["mrn"]))
    for row in user_rows:
        if row[0] == "svc_lumen_sync":
            row[8] = canaries[11]
            canary_rows.append((canaries[11], "users.secret", "secret", "svc_lumen_sync"))
        elif row[2] == "service":
            row[8] = "sk_" + secrets.token_hex(12)

    conn.executemany("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)", user_rows)
    conn.executemany(
        "INSERT INTO patients VALUES (:mrn,:name,:dob,:sex,:hospital_id,:address,:phone,:ssn,"
        ":conditions,:medications,:allergies,:attending,:notes)",
        [{**p, "conditions": json.dumps(p["conditions"]), "medications": json.dumps(p["medications"]),
          "allergies": json.dumps(p["allergies"])} for p in patients])
    conn.executemany("INSERT INTO canaries VALUES (?,?,?,?)", canary_rows)

    # ---- observations
    obs_rows = []
    n_obs = 0
    for p in patients:
        for code, display, unit, lo, hi, mean, sd in rng.sample(LABS, rng.randint(3, 7)):
            n_obs += 1
            value = round(max(0.0, rng.gauss(mean, sd)), 2)
            issued = fake.date_time_between(start_date="-30d", end_date="-2h").isoformat(timespec="seconds")
            performer = "lum" if rng.random() < 0.5 else p["hospital_id"]
            row = {"obs_id": f"obs-{n_obs:06d}", "mrn": p["mrn"], "code": code, "display": display,
                   "value": value, "unit": unit, "ref_range": f"{lo}-{hi}", "issued": issued,
                   "performer_hospital": performer}
            row["signature"] = sign_observation(key, row)
            obs_rows.append(row)
    conn.executemany(
        "INSERT INTO observations VALUES (:obs_id,:mrn,:code,:display,:value,:unit,:ref_range,:issued,"
        ":performer_hospital,:signature)", obs_rows)

    # ---- jump box filesystem (real). Dumps are generated from real rows at read time.
    svc_secret = canaries[11]
    files = _jump_box_files(svc_secret)
    conn.executemany("INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?)", files)
    conn.executemany("INSERT INTO meta VALUES (?,?)", [
        ("hostname", JUMP_HOST), ("faker_seed", str(FAKER_SEED)), ("patients", str(len(patients))),
        ("observations", str(len(obs_rows)))])
    conn.commit()
    conn.close()
    return db_path


def _jump_box_files(svc_secret: str) -> list[tuple]:
    """(path, kind, size, mode, owner, grp, mtime, content, generator)."""
    bash_history = "\n".join([
        "lpstat -p",
        "sudo systemctl restart cups",
        "ls /mnt/backups",
        "ls -lh /mnt/backups",
        "cat /etc/lab-sync/credentials.env",
        "zcat /mnt/backups/db_dump_2026-11-13.sql.gz | grep -i 'okafor' | head",
        "df -h /mnt/backups",
        "history -c",
        "lpq -P eas-ward3-printer",
        "exit",
    ]) + "\n"
    creds = (
        "# Lumen pathology -> Eastbank result sync (do not commit)\n"
        "LIS_ENDPOINT=https://lis.lum.meridian.local/api/v2\n"
        "LIS_USER=svc_lumen_sync\n"
        f"LIS_API_SECRET={svc_secret}\n"
        "SYNC_INTERVAL=300\n"
    )
    motd = "Eastbank Community jump host. Authorized use only. Activity is logged.\n"
    rows: list[tuple] = []

    def d(path, children, owner="root", grp="root", mode="drwxr-xr-x"):
        rows.append((path, "dir", 4096, mode, owner, grp, "2026-11-01T09:00:00", None, None))

    def f(path, content, owner="root", grp="root", mode="-rw-r--r--", mtime="2026-11-13T02:10:00", gen=None):
        rows.append((path, "file", len(content.encode()) if content else 0, mode, owner, grp, mtime, content, gen))

    d("/", None)
    d("/home", None)
    d("/home/n.okafor", None, "n.okafor", "nurses", "drwx------")
    f("/home/n.okafor/.bash_history", bash_history, "n.okafor", "nurses", "-rw-------", "2026-11-13T23:41:07")
    f("/home/n.okafor/.profile", "export PATH=$PATH:/usr/local/bin\n", "n.okafor", "nurses")
    f("/home/n.okafor/printer-fix.txt", "If ward 3 printer jams: sudo systemctl restart cups\n", "n.okafor", "nurses")
    d("/etc", None)
    f("/etc/hostname", JUMP_HOST + "\n")
    f("/etc/motd", motd)
    d("/etc/lab-sync", None, "svc_lumen_sync", "lis", "drwxr-xr-x")
    f("/etc/lab-sync/credentials.env", creds, "svc_lumen_sync", "lis", "-rw-r--r--", "2026-10-02T14:22:00")
    d("/mnt", None)
    d("/mnt/backups", None, "svc_lisbackup", "lis", "drwxr-xr-x")
    f("/mnt/backups/db_dump_2026-11-13.sql.gz", "", "svc_lisbackup", "lis", "-rw-r--r--",
      "2026-11-13T02:10:00", "dump:full")
    f("/mnt/backups/db_dump_2026-11-12.sql.gz", "", "svc_lisbackup", "lis", "-rw-r--r--",
      "2026-11-12T02:09:00", "dump:full")
    f("/mnt/backups/portal_users_2026-11-13.csv", "", "svc_lisbackup", "lis", "-rw-r--r--",
      "2026-11-13T02:11:00", "users:csv")
    d("/tmp", None, mode="drwxrwxrwt")
    d("/var", None)
    d("/var/log", None)
    f("/var/log/lab-sync.log", "2026-11-13T02:00:01 sync ok (412 results)\n2026-11-13T02:05:01 sync ok (9 results)\n",
      "svc_lumen_sync", "lis")
    return rows


def main() -> None:
    p = argparse.ArgumentParser(description="Seed the real-tier SQLite database")
    p.add_argument("--force", action="store_true", help="rebuild even if it exists")
    p.add_argument("--db", type=Path, default=DB_PATH)
    args = p.parse_args()
    path = seed(args.db, force=args.force)
    conn = sqlite3.connect(path)
    n = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
    o = conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    c = conn.execute("SELECT COUNT(*) FROM canaries").fetchone()[0]
    print(f"real tier at {path}: {n} patients, {o} observations, {c} protected canaries")


if __name__ == "__main__":
    main()
