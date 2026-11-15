"""Real tier: seed + RealWorld."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import replace

import pytest

from mayajaal.real.seed import PHISHED_USER, seed
from mayajaal.real.vault import canary_row_key
from mayajaal.real.world import RealStore, RealWorld


@pytest.fixture(scope="module")
def store(tmp_path_factory) -> RealStore:
    db = seed(tmp_path_factory.mktemp("real") / "real.db", canary_seed=7)
    return RealStore(db)


def test_seed_creates_exactly_12_canaries(store: RealStore) -> None:
    canaries = store.canaries()
    assert len(canaries) == 12 == len(set(canaries))
    assert all(re.fullmatch(r"MJ-CANARY-[0-9a-f]{8}", c) for c in canaries)
    conn = sqlite3.connect(store.db_path)
    rows = conn.execute("SELECT canary, location, ref FROM canaries").fetchall()
    assert sorted(r[1] for r in rows).count("patients.notes") == 10
    for stored_canary, location, ref in rows:
        # both the canary list and the field holding it are encrypted at rest (real/vault.py)
        canary = store.vault.decrypt(stored_canary, "canaries", "canary", canary_row_key(location, ref))
        table, col = location.split(".")
        key = "mrn" if table == "patients" else "username"
        (stored,) = conn.execute(f"SELECT {col} FROM {table} WHERE {key} = ?", (ref,)).fetchone()
        assert canary not in stored
        assert canary in store.vault.decrypt(stored, table, col, ref)
        if location == "patients.notes":   # never in the phished nurse's own hospital
            assert store.patient_hospital(ref) != "eas"


def test_seed_population_and_users(store: RealStore) -> None:
    assert 1150 <= store.total_patients() <= 1250
    assert {"aur", "riv", "nor", "eas", "wes"} == {u for u in ("aur", "riv", "nor", "eas", "wes")
                                                   if store.total_patients(u) > 0}
    nurse = store.authenticate(*PHISHED_USER)
    assert nurse is not None and nurse.role == "nurse" and nurse.hospital_id == "eas"
    assert store.authenticate("n.okafor", "wrong") is None
    roles = {u.role for u in store.users()}
    assert {"nurse", "physician", "lab_tech", "it_admin", "service"} <= roles


def test_real_jump_box_dumps_contain_all_canaries(store: RealStore) -> None:
    w = RealWorld("t", store)
    assert w.hostname() == "jump-eas"
    assert "db_dump_2026-11-13.sql.gz" in w.stat("/mnt/backups").children
    dump = w.read_file("/mnt/backups/db_dump_2026-11-13.sql.gz")
    assert all(c in dump for c in store.canaries())
    assert w.dump_row_count("/mnt/backups/db_dump_2026-11-13.sql.gz") == store.total_patients()
    assert len(w.dump_rows("/mnt/backups/db_dump_2026-11-13.sql.gz", 5)) == 5
    assert "credentials.env" in w.read_file("~/.bash_history")
    with pytest.raises(FileNotFoundError):
        w.read_file("/nope")


def test_observation_signatures_detect_tampering(store: RealStore) -> None:
    w = RealWorld("t", store)
    mrn = w.list_patients("eas", 0, 1)[0].mrn
    obs = w.observations(mrn)[0]
    assert obs.signature.startswith("hmac-sha256:") and store.verify_observation(obs)
    assert not store.verify_observation(replace(obs, value=obs.value + 1))


def test_scoped_world_hides_other_hospitals(store: RealStore) -> None:
    w = RealWorld("t", store, scope_hospital="eas")
    assert {p.hospital_id for p in w.list_patients(None, 0, 500)} == {"eas"}
    assert w.list_patients("aur", 0, 10) == []
    other = store.list_patients("aur", 0, 1)[0]
    assert w.get_patient(other.mrn) is None and w.observations(other.mrn) == []
