"""RealWorld: the real tier's WorldProvider, backed by backend/data/real/real.db.

RealStore owns the SQLite connection and every query (auth, canaries, files, dumps).
RealWorld is the thin per-session WorldProvider the surfaces router sees.

Observations carry `signature` = HMAC-SHA256(server key, canonical fields), so a lab value changed
behind the API's back is detectable with RealStore.verify_observation(). Writes through
put_observation() are authorised writes and get re-signed by the server.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import posixpath
import secrets
import sqlite3
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any

from mayajaal.world_api import FsNode, Observation, Patient, PortalUser

DEFAULT_HOME = "/home/n.okafor"


# --------------------------------------------------------------------------- signing

def signing_key(data_dir: Path) -> bytes:
    """Server HMAC key: env MJ_REAL_SIGNING_KEY, else data/real/signing.key (created on first use)."""
    env = os.environ.get("MJ_REAL_SIGNING_KEY")
    if env:
        return env.encode()
    path = Path(data_dir) / "signing.key"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32))
        os.chmod(path, 0o600)
    return path.read_text().strip().encode()


def _canonical(row: dict[str, Any]) -> bytes:
    return "|".join([
        str(row["obs_id"]), str(row["mrn"]), str(row["code"]), f"{float(row['value']):.4f}",
        str(row["unit"]), str(row["issued"]), str(row["performer_hospital"]),
    ]).encode()


def sign_observation(key: bytes, row: dict[str, Any]) -> str:
    return "hmac-sha256:" + hmac.new(key, _canonical(row), hashlib.sha256).hexdigest()


# --------------------------------------------------------------------------- store


class RealStore:
    """All access to real.db. One per process; thread-safe enough for uvicorn + TestClient."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        from mayajaal.real.seed import DB_PATH, seed

        self.db_path = Path(db_path or os.environ.get("MJ_REAL_DB") or DB_PATH)
        if not self.db_path.exists():
            seed(self.db_path)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self.key = signing_key(self.db_path.parent)
        self._dump_cache: dict[str, str] = {}

    # -- low level
    def _all(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, args).fetchall()

    def _one(self, sql: str, args: tuple = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, args).fetchone()

    def _write(self, sql: str, args: tuple = ()) -> None:
        with self._lock:
            self._conn.execute(sql, args)
            self._conn.commit()
        self._dump_cache.clear()

    # -- auth / users
    def authenticate(self, username: str, password: str) -> PortalUser | None:
        from mayajaal.real.seed import hash_password

        row = self._one("SELECT * FROM users WHERE username = ?", (username,))
        if row is None:
            hash_password(password, "00" * 16)          # same cost on a miss: no user-enumeration timing
            return None
        if not hmac.compare_digest(hash_password(password, row["salt"]), row["password_hash"]):
            return None
        return _user(row)

    def users(self) -> list[PortalUser]:
        return [_user(r) for r in self._all("SELECT * FROM users ORDER BY role, username")]

    def canaries(self) -> list[str]:
        return [r["canary"] for r in self._all("SELECT canary FROM canaries ORDER BY canary")]

    def meta(self, key: str, default: str = "") -> str:
        row = self._one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else default

    # -- patients
    def total_patients(self, hospital_id: str | None = None) -> int:
        if hospital_id:
            return self._one("SELECT COUNT(*) n FROM patients WHERE hospital_id = ?", (hospital_id,))["n"]
        return self._one("SELECT COUNT(*) n FROM patients")["n"]

    def list_patients(self, hospital_id: str | None, offset: int, limit: int) -> list[Patient]:
        if hospital_id:
            rows = self._all("SELECT * FROM patients WHERE hospital_id = ? ORDER BY mrn LIMIT ? OFFSET ?",
                             (hospital_id, max(0, limit), max(0, offset)))
        else:
            rows = self._all("SELECT * FROM patients ORDER BY mrn LIMIT ? OFFSET ?", (max(0, limit), max(0, offset)))
        return [_patient(r) for r in rows]

    def get_patient(self, mrn: str) -> Patient | None:
        row = self._one("SELECT * FROM patients WHERE mrn = ?", (mrn,))
        return _patient(row) if row else None

    def patient_hospital(self, mrn: str) -> str | None:
        row = self._one("SELECT hospital_id FROM patients WHERE mrn = ?", (mrn,))
        return row["hospital_id"] if row else None

    def mrns(self, hospital_id: str) -> list[str]:
        return [r["mrn"] for r in self._all("SELECT mrn FROM patients WHERE hospital_id = ? ORDER BY mrn", (hospital_id,))]

    # -- observations
    def observations(self, mrn: str) -> list[Observation]:
        rows = self._all("SELECT * FROM observations WHERE mrn = ? ORDER BY issued DESC", (mrn,))
        return [Observation(**dict(r)) for r in rows]

    def put_observation(self, obs: Observation) -> Observation:
        row = asdict(obs)
        row["signature"] = sign_observation(self.key, row)
        self._write(
            "INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?,?,?,?,?)",
            (row["obs_id"], row["mrn"], row["code"], row["display"], float(row["value"]), row["unit"],
             row["ref_range"], row["issued"], row["performer_hospital"], row["signature"]))
        return Observation(**row)

    def verify_observation(self, obs: Observation) -> bool:
        return hmac.compare_digest(obs.signature or "", sign_observation(self.key, asdict(obs)))

    # -- filesystem (the real jump box)
    def _file(self, path: str) -> sqlite3.Row | None:
        return self._one("SELECT * FROM files WHERE path = ?", (path,))

    def stat(self, path: str) -> FsNode | None:
        path = normalize_path(path)
        row = self._file(path)
        if row is None:
            return None
        children: list[str] = []
        size = row["size"]
        if row["kind"] == "dir":
            prefix = path.rstrip("/") + "/"
            for r in self._all("SELECT path FROM files WHERE path LIKE ? AND path != ?", (prefix + "%", path)):
                rest = r["path"][len(prefix):]
                if rest and "/" not in rest:
                    children.append(rest)
            children.sort()
        elif row["generator"]:
            size = len(self.read_file(path).encode())
        return FsNode(path=path, kind=row["kind"], size=size, mode=row["mode"], owner=row["owner"],
                      group=row["grp"], mtime=row["mtime"], children=children)

    def read_file(self, path: str) -> str:
        path = normalize_path(path)
        row = self._file(path)
        if row is None:
            raise FileNotFoundError(path)
        if row["kind"] == "dir":
            raise IsADirectoryError(path)
        gen = row["generator"]
        if not gen:
            return row["content"] or ""
        if path not in self._dump_cache:
            self._dump_cache[path] = self._render(gen, row["mtime"])
        return self._dump_cache[path]

    def write_file(self, path: str, content: str) -> None:
        path = normalize_path(path)
        parent = posixpath.dirname(path) or "/"
        prow = self._file(parent)
        if prow is None or prow["kind"] != "dir":
            raise FileNotFoundError(parent)
        existing = self._file(path)
        if existing is not None and existing["kind"] == "dir":
            raise IsADirectoryError(path)
        self._write("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?,?,?)",
                    (path, "file", len(content.encode()), "-rw-r--r--", "n.okafor", "nurses",
                     "2026-11-14T00:00:00", content, None))

    def is_dump(self, path: str) -> bool:
        row = self._file(normalize_path(path))
        return bool(row and row["generator"] == "dump:full")

    def dump_rows(self, path: str, limit: int) -> list[Patient]:
        return self.list_patients(None, 0, limit) if self.is_dump(path) else []

    def dump_row_count(self, path: str) -> int:
        return self.total_patients() if self.is_dump(path) else 0

    # -- dump rendering (from REAL rows: this is how canaries leak in the baseline config)
    def _render(self, gen: str, mtime: str) -> str:
        if gen == "users:csv":
            lines = ["username,display_name,role,hospital_id,last_login,mfa"]
            lines += [f"{u.username},{u.display_name},{u.role},{u.hospital_id},{u.last_login},{str(u.mfa).lower()}"
                      for u in self.users()]
            return "\n".join(lines) + "\n"
        when = mtime.replace("T", " ")
        out = [
            "--",
            "-- PostgreSQL database dump",
            "--",
            "-- Dumped from database version 15.4 (ehr_meridian)",
            f"-- Host: ehr-db01.aur.meridian.local   Started on {when}",
            "",
            "SET client_encoding = 'UTF8';",
            "SET standard_conforming_strings = on;",
            "",
            "CREATE TABLE public.patients (mrn text PRIMARY KEY, name text, dob date, sex char(1), "
            "hospital_id text, address text, phone text, ssn text, conditions text, medications text, "
            "allergies text, attending text, notes text);",
            "",
            "COPY public.patients (mrn, name, dob, sex, hospital_id, address, phone, ssn, conditions, "
            "medications, allergies, attending, notes) FROM stdin;",
        ]
        for r in self._all("SELECT * FROM patients ORDER BY mrn"):
            out.append("\t".join(_copy_field(r[k]) for k in (
                "mrn", "name", "dob", "sex", "hospital_id", "address", "phone", "ssn", "conditions",
                "medications", "allergies", "attending", "notes")))
        out += ["\\.", "",
                "CREATE TABLE public.lab_results (obs_id text, mrn text, code text, display text, value numeric, "
                "unit text, ref_range text, issued timestamp, performer_hospital text, signature text);",
                "",
                "COPY public.lab_results (obs_id, mrn, code, display, value, unit, ref_range, issued, "
                "performer_hospital, signature) FROM stdin;"]
        for r in self._all("SELECT * FROM observations ORDER BY obs_id"):
            out.append("\t".join(_copy_field(r[k]) for k in r.keys()))
        out += ["\\.", "",
                "CREATE TABLE public.portal_users (username text, display_name text, role text, hospital_id text, "
                "password_hash text, api_secret text);",
                "",
                "COPY public.portal_users (username, display_name, role, hospital_id, password_hash, api_secret) FROM stdin;"]
        for r in self._all("SELECT * FROM users ORDER BY username"):
            out.append("\t".join(_copy_field(v) for v in (
                r["username"], r["display_name"], r["role"], r["hospital_id"],
                f"pbkdf2_sha256$100000${r['salt']}${r['password_hash']}", r["secret"] or "\\N")))
        out += ["\\.", "", "-- PostgreSQL database dump complete", ""]
        return "\n".join(out)


def _copy_field(v: Any) -> str:
    if v is None:
        return "\\N"
    return str(v).replace("\t", " ").replace("\n", " ")


def _patient(r: sqlite3.Row) -> Patient:
    return Patient(mrn=r["mrn"], name=r["name"], dob=r["dob"], sex=r["sex"], hospital_id=r["hospital_id"],
                   address=r["address"], phone=r["phone"], conditions=json.loads(r["conditions"]),
                   medications=json.loads(r["medications"]), allergies=json.loads(r["allergies"]),
                   attending=r["attending"], notes=r["notes"] or "")


def _user(r: sqlite3.Row) -> PortalUser:
    return PortalUser(username=r["username"], display_name=r["display_name"], role=r["role"],
                      hospital_id=r["hospital_id"], last_login=r["last_login"], mfa=bool(r["mfa"]))


def normalize_path(path: str, home: str = DEFAULT_HOME) -> str:
    path = (path or "/").strip()
    if path == "~" or path.startswith("~/"):
        path = home + path[1:]
    if not path.startswith("/"):
        path = home + "/" + path
    norm = posixpath.normpath(path)
    return "/" if norm in ("", ".", "//") else norm


# --------------------------------------------------------------------------- provider


class RealWorld:
    """WorldProvider for the real tier (tier = "real").

    scope_hospital: when set (non-baseline configs), the clinical API only sees that hospital's
    patients, so an unfiltered list is a ward list and never a citywide one. Defence in depth: the
    policy engine already keeps cross-hospital reads off the real tier in those configs.
    """

    tier = "real"

    def __init__(self, session_id: str = "real", store: RealStore | None = None,
                 scope_hospital: str | None = None) -> None:
        self.session_id = session_id
        self.store = store or RealStore()
        self.scope_hospital = scope_hospital

    def _in_scope(self, hospital_id: str) -> bool:
        return self.scope_hospital is None or hospital_id == self.scope_hospital

    # FHIR-ish
    def total_patients(self) -> int:
        return self.store.total_patients(self.scope_hospital)

    def list_patients(self, hospital_id: str | None, offset: int, limit: int) -> list[Patient]:
        if self.scope_hospital is not None:
            if hospital_id and hospital_id != self.scope_hospital:
                return []
            hospital_id = self.scope_hospital
        return self.store.list_patients(hospital_id, offset, limit)

    def get_patient(self, mrn: str) -> Patient | None:
        p = self.store.get_patient(mrn)
        return p if p and self._in_scope(p.hospital_id) else None

    def observations(self, mrn: str) -> list[Observation]:
        return self.store.observations(mrn) if self.get_patient(mrn) else []

    def verify_observation(self, obs: Observation) -> bool:
        """True only if obs.signature is the server HMAC over this exact content."""
        return self.store.verify_observation(obs)

    def put_observation(self, obs: Observation) -> Observation:
        if not self.verify_observation(obs):
            raise PermissionError("result signature verification failed")
        return self.store.put_observation(obs)

    # Admin portal
    def portal_users(self) -> list[PortalUser]:
        return self.store.users()

    # Jump-box shell
    def hostname(self) -> str:
        return self.store.meta("hostname", "jump-eas")

    def stat(self, path: str) -> FsNode | None:
        return self.store.stat(path)

    def read_file(self, path: str) -> str:
        return self.store.read_file(path)

    def write_file(self, path: str, content: str) -> None:
        self.store.write_file(path, content)

    def dump_rows(self, path: str, limit: int) -> list[Patient]:
        return self.store.dump_rows(path, limit)

    def dump_row_count(self, path: str) -> int:
        return self.store.dump_row_count(path)
