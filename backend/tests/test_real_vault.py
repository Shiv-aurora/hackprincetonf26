"""Real tier encryption at rest (real/vault.py): stolen real.db is unreadable, the authorized
path is unchanged, the ledger still sees canaries, and /_mj/vault proves it to an admin."""

from __future__ import annotations

import itertools
import json
import re
import shutil
import sqlite3
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from mayajaal.contracts import load_world
from mayajaal.real.app import create_app
from mayajaal.real.fakes import FakeShadowShell, fake_shadow_app, fake_surfaces_factory
from mayajaal.real.ledger import CanaryLedger
from mayajaal.real.seed import CANARY_NOTE, PHISHED_USER, SIM_CLINICIANS, seed
from mayajaal.real.vault import (
    META_WRAPPED_DEK, PREFIX, VaultError, canary_row_key, kek_from_shares, open_vault, unwrap_dek,
)
from mayajaal.real.world import RealStore

ADMIN = "test-admin-key"
HOLDERS = load_world()["key_shares"]["holders"]


@pytest.fixture(scope="module")
def store(tmp_path_factory) -> RealStore:
    return RealStore(seed(tmp_path_factory.mktemp("vault") / "real.db", canary_seed=23))


def raw_bytes(db: Path) -> bytes:
    return b"".join(p.read_bytes() for p in (db, Path(f"{db}-journal"), Path(f"{db}-wal")) if p.exists())


def all_ssns(store: RealStore) -> list[str]:
    conn = sqlite3.connect(store.db_path)
    return [store.vault.decrypt(s, "patients", "ssn", mrn)
            for mrn, s in conn.execute("SELECT mrn, ssn FROM patients")]


def wrapped_dek(db: Path) -> str:
    return sqlite3.connect(db).execute("SELECT value FROM meta WHERE key = ?", (META_WRAPPED_DEK,)).fetchone()[0]


# --------------------------------------------------------------------------- at rest


def test_raw_db_bytes_contain_no_canary_or_ssn_plaintext(store: RealStore) -> None:
    raw = raw_bytes(store.db_path)
    canaries = store.canaries()
    assert len(canaries) == 12
    # plaintext, hex, base64 and case variants (the ledger's own definition of "leaked")
    assert CanaryLedger(canaries).scan(raw) == set()
    assert b"MJ-CANARY-" not in raw.upper()
    ssns = all_ssns(store)
    assert len(ssns) == store.total_patients() and sum(re.fullmatch(r"\d{3}-\d{2}-\d{4}", s) is not None
                                                      for s in ssns) == len(ssns) - 1   # 1 SSN is a canary
    assert not [s for s in ssns if s.encode() in raw]
    assert re.search(rb"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)", raw) is None
    # and the KEK is nowhere on disk: only share files and the wrapped DEK
    keys = store.vault.keys_dir
    assert sorted(p.name for p in keys.iterdir()) == sorted(f"share-{h}.json" for h in HOLDERS)
    assert wrapped_dek(store.db_path).startswith(PREFIX)


def test_every_sensitive_value_is_ciphertext(store: RealStore) -> None:
    conn = sqlite3.connect(store.db_path)
    for table, cols in {"patients": ("notes", "ssn", "address", "phone"), "users": ("secret",),
                        "canaries": ("canary",)}.items():
        for col in cols:
            vals = [v for (v,) in conn.execute(f"SELECT {col} FROM {table}")]
            assert vals and all(v.startswith(PREFIX) for v in vals), (table, col)
    contents = [v for (v,) in conn.execute("SELECT content FROM files WHERE content IS NOT NULL")]
    assert contents and all(v.startswith(PREFIX) for v in contents)
    # random nonce per value: identical plaintexts (note templates) give different ciphertexts
    notes = [v for (v,) in conn.execute("SELECT notes FROM patients")]
    assert len(set(notes)) == len(notes)


# --------------------------------------------------------------------------- key custody


def test_two_shares_cannot_rebuild_the_kek_any_three_can(store: RealStore) -> None:
    keys, wrapped = store.vault.keys_dir, wrapped_dek(store.db_path)
    for pair in itertools.combinations(HOLDERS, 2):
        with pytest.raises(VaultError, match="need 3"):
            kek_from_shares(keys, list(pair), 3)
    deks = set()
    for trio in itertools.combinations(HOLDERS, 3):
        deks.add(unwrap_dek(kek_from_shares(keys, list(trio), 3), wrapped))
    assert len(deks) == 1                   # all 20 trios unlock the same DEK


def test_stolen_db_with_fewer_than_three_shares_stays_locked(store: RealStore, tmp_path: Path) -> None:
    stolen = tmp_path / "stolen.db"
    shutil.copy(store.db_path, stolen)
    loot = tmp_path / "keys"
    loot.mkdir()
    with pytest.raises(VaultError):                                     # the database file alone
        RealStore(stolen, keys_dir=loot)
    for h in ("eas", "lum"):                                            # plus two captured hospitals
        shutil.copy(store.vault.keys_dir / f"share-{h}.json", loot)
    with pytest.raises(VaultError, match="need 3"):
        RealStore(stolen, keys_dir=loot)
    # a third share opens it, and only then is the plaintext readable
    shutil.copy(store.vault.keys_dir / "share-aur.json", loot)
    assert sorted(RealStore(stolen, keys_dir=loot).canaries()) == sorted(store.canaries())


def test_wrong_kek_does_not_unwrap(store: RealStore) -> None:
    with pytest.raises(VaultError, match="wrong KEK"):
        unwrap_dek(b"\x00" * 32, wrapped_dek(store.db_path))


# --------------------------------------------------------------------------- AEAD integrity


def test_tampered_ciphertext_or_wrong_associated_data_fails(store: RealStore) -> None:
    v = store.vault
    ct = v.encrypt("MJ-CANARY-deadbeef", "patients", "notes", "MRN-000001")
    assert v.decrypt(ct, "patients", "notes", "MRN-000001") == "MJ-CANARY-deadbeef"
    body = ct[len(PREFIX):]
    flipped = PREFIX + body[:20] + ("A" if body[20] != "A" else "B") + body[21:]
    with pytest.raises(VaultError, match="failed authentication"):
        v.decrypt(flipped, "patients", "notes", "MRN-000001")
    with pytest.raises(VaultError):                                   # moved to another patient
        v.decrypt(ct, "patients", "notes", "MRN-000002")
    with pytest.raises(VaultError):                                   # moved to another column
        v.decrypt(ct, "patients", "ssn", "MRN-000001")
    with pytest.raises(VaultError):                                   # moved to another table
        v.decrypt(ct, "users", "notes", "MRN-000001")
    with pytest.raises(VaultError, match="not encrypted"):            # plaintext at rest is refused
        v.decrypt("MJ-CANARY-deadbeef", "patients", "notes", "MRN-000001")


def test_row_swap_on_disk_is_detected(store: RealStore, tmp_path: Path) -> None:
    db = tmp_path / "swap.db"
    shutil.copy(store.db_path, db)
    conn = sqlite3.connect(db)
    (a, na), (b, _nb) = conn.execute("SELECT mrn, notes FROM patients ORDER BY mrn LIMIT 2").fetchall()
    conn.execute("UPDATE patients SET notes = ? WHERE mrn = ?", (na, b))
    conn.commit()
    swapped = RealStore(db, keys_dir=store.vault.keys_dir)
    assert swapped.get_patient(a) is not None
    with pytest.raises(VaultError):
        swapped.get_patient(b)


# --------------------------------------------------------------------------- authorized path


class Rig:
    def __init__(self, store: RealStore, config: str) -> None:
        self.events: list = []

        async def sink(*evs):                       # in-process: never talks to the hub on :8002
            self.events.extend(evs)

        self.app = create_app(fake_surfaces_factory, store=store, sink=sink, default_config=config,
                              shadow_transport=httpx.ASGITransport(app=fake_shadow_app()),
                              shadow_ws_connect=FakeShadowShell, admin_key_value=ADMIN)
        self.gw = self.app.state.gateway
        self.client = TestClient(self.app)

    def login(self, username: str, password: str) -> dict[str, str]:
        r = self.client.post("/auth/login", json={"username": username, "password": password})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['token']}"}


def canary_patient(store: RealStore) -> tuple[str, str, str]:
    conn = sqlite3.connect(store.db_path)
    stored, loc, ref = conn.execute(
        "SELECT canary, location, ref FROM canaries WHERE location = 'patients.notes' ORDER BY ref LIMIT 1").fetchone()
    return store.vault.decrypt(stored, "canaries", "canary", canary_row_key(loc, ref)), ref, store.patient_hospital(ref)


def test_authorized_clinical_read_returns_decrypted_data(store: RealStore) -> None:
    canary, mrn, hosp = canary_patient(store)
    user, _d, _r, _h, pw = next(c for c in SIM_CLINICIANS if c[3] == hosp and c[2] == "physician")
    rig = Rig(store, "mayajaal")
    h = {**rig.login(user, pw), "X-MJ-Admin": ADMIN, "X-MJ-Actor": "clinician"}
    r = rig.client.get(f"/fhir/Patient/{mrn}", headers=h)
    assert r.status_code == 200 and r.headers["x-mj-decision"] == "allow_real"
    body = r.json()
    assert body["tier"] == "real" and body["mrn"] == mrn
    row = sqlite3.connect(store.db_path).execute(
        "SELECT address, phone, notes FROM patients WHERE mrn = ?", (mrn,)).fetchone()
    assert body["address"] == store.vault.decrypt(row[0], "patients", "address", mrn)
    assert body["phone"] == store.vault.decrypt(row[1], "patients", "phone", mrn)
    assert re.fullmatch(r"\(\d{3}\) 555-\d{4}", body["phone"])
    assert body["notes"].endswith(CANARY_NOTE.format(c=canary))
    assert PREFIX not in r.text                                       # wire format is plaintext as before
    lst = rig.client.get(f"/fhir/Patient?hospital={hosp}&_count=5", headers=h).json()
    assert all(not e["resource"]["address"].startswith(PREFIX) for e in lst["entry"])


def test_ledger_still_catches_a_canary_in_a_decrypted_response(store: RealStore) -> None:
    canary, mrn, _ = canary_patient(store)
    rig = Rig(store, "baseline")
    h = {**rig.login(*PHISHED_USER), "X-MJ-Run": "run-vault"}
    r = rig.client.get(f"/fhir/Patient/{mrn}", headers=h)
    assert r.status_code == 200 and canary in r.text
    assert rig.gw.ledger.leaked("run-vault") == 1
    assert rig.gw.ledger.leaked_ids("run-vault") == {canary}


# --------------------------------------------------------------------------- migration


def test_legacy_plaintext_db_is_migrated_on_startup(store: RealStore, tmp_path: Path) -> None:
    db = tmp_path / "legacy.db"
    shutil.copy(store.db_path, db)
    conn = sqlite3.connect(db)                       # turn the copy back into a pre-vault plaintext db
    v = store.vault
    for table, key, cols in (("patients", "mrn", ("notes", "ssn", "address", "phone")),
                             ("users", "username", ("secret",)), ("files", "path", ("content",))):
        for col in cols:
            for rk, val in conn.execute(f"SELECT {key}, {col} FROM {table}").fetchall():
                conn.execute(f"UPDATE {table} SET {col} = ? WHERE {key} = ?", (v.decrypt(val, table, col, rk), rk))
    for val, loc, ref in conn.execute("SELECT canary, location, ref FROM canaries").fetchall():
        conn.execute("UPDATE canaries SET canary = ? WHERE location = ? AND ref = ?",
                     (v.decrypt(val, "canaries", "canary", canary_row_key(loc, ref)), loc, ref))
    conn.execute("DELETE FROM meta WHERE key LIKE 'vault%'")
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    assert CanaryLedger(store.canaries()).scan(db.read_bytes())       # plaintext before

    migrated = RealStore(db, keys_dir=tmp_path / "keys")              # fresh KEK + DEK, rows encrypted
    assert migrated.migrated > 1000
    assert CanaryLedger(store.canaries()).scan(raw_bytes(db)) == set()
    assert sorted(migrated.canaries()) == sorted(store.canaries())
    mrn = store.list_patients("nor", 0, 1)[0].mrn
    assert migrated.get_patient(mrn) == store.get_patient(mrn)
    assert RealStore(db, keys_dir=tmp_path / "keys").migrated == 0    # idempotent on the next start


def test_open_vault_refuses_to_overwrite_a_partial_share_set(tmp_path: Path) -> None:
    keys = tmp_path / "keys"
    keys.mkdir()
    (keys / "share-aur.json").write_text(json.dumps({"index": 1, "share": "00" * 32}))
    conn = sqlite3.connect(tmp_path / "x.db")
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
    with pytest.raises(VaultError, match="refusing to overwrite"):
        open_vault(conn, tmp_path / "x.db", keys_dir=keys)


# --------------------------------------------------------------------------- /_mj/vault


def test_vault_endpoint_requires_admin_and_proves_encryption(store: RealStore) -> None:
    rig = Rig(store, "mayajaal")
    assert rig.client.get("/_mj/vault").status_code == 404
    assert rig.client.get("/_mj/vault", headers={"X-MJ-Admin": "wrong"}).status_code == 404
    nurse = rig.login(*PHISHED_USER)
    assert PREFIX not in rig.client.get("/_mj/vault", headers=nurse).text
    r = rig.client.get("/_mj/vault", headers={"X-MJ-Admin": ADMIN})
    assert r.status_code == 200
    d = r.json()
    assert d["algorithm"] == "AES-256-GCM"
    fields = {(f["table"], f["column"]): f for f in d["encrypted_fields"]}
    assert {("patients", c) for c in ("notes", "ssn", "address", "phone")} | {("users", "secret")} <= set(fields)
    pts = fields[("patients", "notes")]
    assert pts["rows"] == store.total_patients() == pts["encrypted_rows"]
    assert all(f["encrypted_rows"] + f["null_rows"] == f["rows"] for f in fields.values())
    assert d["shares"]["threshold"] == 3 and d["shares"]["holders"] == HOLDERS
    assert len(d["shares"]["used_at_start"]) == 3
    sample = {f["field"]: f for f in d["sample"]["fields"]}
    assert sample["notes"]["encrypted"] and sample["notes"]["stored"].startswith(PREFIX)
    assert not sample["name"]["encrypted"] and sample["mrn"]["stored"] == d["sample"]["row_key"]
    sc = d["self_check"]
    assert sc["ok"] is True and sc["canaries_checked"] == 12
    assert sc["canary_plaintexts_found"] == 0 and sc["ssn_like_strings_found"] == 0
    assert not CanaryLedger(store.canaries()).scan(r.text)            # the proof itself leaks nothing
