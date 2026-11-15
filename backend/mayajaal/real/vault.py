"""Envelope encryption at rest for the real tier (real.db).

What is encrypted (AES-256-GCM, one random 96-bit nonce per value):
    patients.notes, patients.ssn, patients.address, patients.phone, users.secret,
    canaries.canary (the ledger's list of protected strings), files.content (jump-box file bodies,
    e.g. /etc/lab-sync/credentials.env).
What stays plaintext so lists, joins and scoping still work: patient mrn, name, dob, sex,
hospital_id, conditions, medications, allergies, attending; every observation column; user
names/roles/hospitals; PBKDF2 password hashes (already one-way); file paths and metadata.

Stored value format:  enc:v1:<base64url(nonce || ciphertext || tag)>
Associated data:      b"mj-real|v1|<table>|<column>|<row key>"  -> a ciphertext copied to another
                      row, column or table fails to decrypt (InvalidTag).

Key flow (envelope):
    DEK  random 32 bytes; encrypts the fields above. Stored ONLY wrapped, in meta.vault_wrapped_dek,
         as AES-256-GCM(KEK, DEK, aad=b"mj-real|v1|dek").
    KEK  random 32 bytes, Shamir-split 3-of-6 across the hospitals listed in contracts/world.json
         key_shares (continuity.custody.split_key). One share file per holder:
         <keys dir>/share-<hospital>.json. At gateway start any 3 share files are combined in
         memory (continuity.custody.reconstruct_key), the DEK is unwrapped, and the KEK is dropped.
         Nothing ever writes the KEK to disk.

Demo simplification (honest): all six share files live on this one machine, under
backend/data/real/keys/ (gitignored). In a deployment each hospital would hold only its own share
and release it to the gateway at start. Whoever can read 3 share files AND real.db can decrypt;
whoever has real.db alone (a stolen disk, a copied database file) cannot.

What this does NOT stop: a caller the gateway decides to serve (an authorized clinical read, or
the baseline config's jump-box backup, which the backup job renders from decrypted rows) sees
plaintext. That is the policy engine's and the shadow tier's job, not this module's.

Env: MJ_REAL_KEYS_DIR overrides the keys dir; MJ_REAL_KEY_HOLDERS=aur,nor,lum picks which
shares to load (default: the first `threshold` holders whose share files exist).
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from mayajaal.continuity.custody import KEY_BYTES, reconstruct_key, split_key
from mayajaal.continuity.shamir import Share
from mayajaal.contracts import load_world

PREFIX = "enc:v1:"
ALGORITHM = "AES-256-GCM"
NONCE_BYTES = 12
DEK_AAD = b"mj-real|v1|dek"
META_WRAPPED_DEK = "vault_wrapped_dek"

# table -> (row-key SQL expression, encrypted columns). The row key goes into the associated data.
ENCRYPTED: dict[str, tuple[str, tuple[str, ...]]] = {
    "patients": ("mrn", ("notes", "ssn", "address", "phone")),
    "users": ("username", ("secret",)),
    "canaries": ("location || '|' || ref", ("canary",)),
    "files": ("path", ("content",)),
}
PLAINTEXT: dict[str, tuple[str, ...]] = {
    "patients": ("mrn", "name", "dob", "sex", "hospital_id", "conditions", "medications", "allergies",
                 "attending"),
    "users": ("username", "display_name", "role", "hospital_id", "last_login", "mfa", "salt",
              "password_hash"),
    "observations": ("all columns",),
    "files": ("path", "kind", "size", "mode", "owner", "grp", "mtime", "generator"),
}


class VaultError(RuntimeError):
    """The vault can't be opened (missing/insufficient shares) or a value fails to decrypt."""


def canary_row_key(location: str, ref: str) -> str:
    return f"{location}|{ref}"


def _aad(table: str, column: str, row_key: str) -> bytes:
    return f"mj-real|v1|{table}|{column}|{row_key}".encode()


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


# --------------------------------------------------------------------------- the data key


class Vault:
    """Holds the unwrapped DEK in memory and encrypts/decrypts single field values."""

    def __init__(self, dek: bytes, *, holders: list[str], threshold: int, holders_used: list[str],
                 keys_dir: Path) -> None:
        if len(dek) != KEY_BYTES:
            raise ValueError(f"DEK must be {KEY_BYTES} bytes")
        self._aead = AESGCM(dek)
        self.holders = holders
        self.threshold = threshold
        self.holders_used = holders_used
        self.keys_dir = keys_dir

    def encrypt(self, plaintext: str | None, table: str, column: str, row_key: str) -> str | None:
        if plaintext is None:
            return None
        nonce = secrets.token_bytes(NONCE_BYTES)
        ct = self._aead.encrypt(nonce, str(plaintext).encode(), _aad(table, column, row_key))
        return PREFIX + _b64e(nonce + ct)

    def decrypt(self, stored: str | None, table: str, column: str, row_key: str) -> str | None:
        if stored is None:
            return None
        if not is_encrypted(stored):
            raise VaultError(f"{table}.{column}[{row_key}] is not encrypted at rest")
        raw = _b64d(stored[len(PREFIX):])
        try:
            pt = self._aead.decrypt(raw[:NONCE_BYTES], raw[NONCE_BYTES:], _aad(table, column, row_key))
        except InvalidTag as e:
            raise VaultError(f"{table}.{column}[{row_key}] failed authentication (tampered or moved)") from e
        return pt.decode()


# --------------------------------------------------------------------------- the key-encryption key


def keys_dir_for(db_path: Path | str) -> Path:
    env = os.environ.get("MJ_REAL_KEYS_DIR")
    return Path(env) if env else Path(db_path).parent / "keys"


def share_path(keys_dir: Path, holder: str) -> Path:
    return Path(keys_dir) / f"share-{holder}.json"


def _key_shares_cfg(world: dict | None = None) -> tuple[list[str], int]:
    cfg = (world or load_world())["key_shares"]
    holders = list(cfg["holders"])
    if len(holders) != int(cfg["total"]):
        raise ValueError("world.json key_shares: holders/total mismatch")
    return holders, int(cfg["threshold"])


def write_shares(kek: bytes, keys_dir: Path, holders: list[str], threshold: int) -> None:
    """Split the KEK and write one share file per holder. The KEK itself is never written."""
    keys_dir = Path(keys_dir)
    keys_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(keys_dir, 0o700)
    for holder, (index, data) in split_key(kek, holders, threshold).items():
        path = share_path(keys_dir, holder)
        path.write_text(json.dumps({"scheme": "shamir-gf256", "holder": holder, "index": index,
                                    "threshold": threshold, "total": len(holders), "share": data.hex()}))
        os.chmod(path, 0o600)


def read_share(keys_dir: Path, holder: str) -> Share | None:
    path = share_path(keys_dir, holder)
    if not path.exists():
        return None
    d = json.loads(path.read_text())
    return int(d["index"]), bytes.fromhex(d["share"])


def present_holders(keys_dir: Path, holders: list[str]) -> list[str]:
    return [h for h in holders if share_path(keys_dir, h).exists()]


def _choose_holders(keys_dir: Path, holders: list[str], threshold: int) -> list[str]:
    env = os.environ.get("MJ_REAL_KEY_HOLDERS")
    if env:
        return [h.strip() for h in env.split(",") if h.strip()]
    return present_holders(keys_dir, holders)[:threshold]


def kek_from_shares(keys_dir: Path, holders_to_use: list[str], threshold: int) -> bytes:
    """Combine share files in memory. Fewer than `threshold` distinct shares -> VaultError."""
    shares = [s for h in holders_to_use if (s := read_share(keys_dir, h)) is not None]
    try:
        return reconstruct_key(shares, threshold)
    except ValueError as e:
        raise VaultError(f"vault locked: {len(shares)} key share(s) available in {keys_dir}, "
                         f"need {threshold}") from e


def wrap_dek(kek: bytes, dek: bytes) -> str:
    nonce = secrets.token_bytes(NONCE_BYTES)
    return PREFIX + _b64e(nonce + AESGCM(kek).encrypt(nonce, dek, DEK_AAD))


def unwrap_dek(kek: bytes, wrapped: str) -> bytes:
    if not is_encrypted(wrapped):
        raise VaultError("wrapped DEK has an unknown format")
    raw = _b64d(wrapped[len(PREFIX):])
    try:
        return AESGCM(kek).decrypt(raw[:NONCE_BYTES], raw[NONCE_BYTES:], DEK_AAD)
    except InvalidTag as e:
        raise VaultError("the key shares do not unlock this database (wrong KEK)") from e


# --------------------------------------------------------------------------- open / migrate


def _meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def open_vault(conn: sqlite3.Connection, db_path: Path | str, *, keys_dir: Path | None = None,
               world: dict | None = None) -> Vault:
    """Unlock the DEK for this database, creating the KEK shares and DEK on first use.

    - DB already has a wrapped DEK: needs >= threshold share files, else VaultError.
    - DB has none (fresh seed, or a legacy plaintext real.db): reuse the KEK from existing share
      files if there are enough, else create a new KEK + share files (refusing to overwrite a
      partial set); then generate a DEK and store it wrapped. Caller commits.
    """
    holders, threshold = _key_shares_cfg(world)
    keys_dir = Path(keys_dir) if keys_dir else keys_dir_for(db_path)
    wrapped = _meta(conn, META_WRAPPED_DEK)
    present = present_holders(keys_dir, holders)
    if wrapped is None and not present:
        kek = secrets.token_bytes(KEY_BYTES)
        write_shares(kek, keys_dir, holders, threshold)
        present = list(holders)
    elif wrapped is None and len(present) < threshold:
        raise VaultError(f"only {len(present)} of {len(holders)} share files in {keys_dir}; "
                         f"refusing to overwrite them. Restore the shares or delete the directory.")
    use = _choose_holders(keys_dir, holders, threshold)
    kek = kek_from_shares(keys_dir, use, threshold)
    if wrapped is None:
        dek = secrets.token_bytes(KEY_BYTES)
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (META_WRAPPED_DEK, wrap_dek(kek, dek)))
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ("vault_algorithm", ALGORITHM))
    else:
        dek = unwrap_dek(kek, wrapped)
    del kek                                    # the KEK is not kept, and never written anywhere
    return Vault(dek, holders=holders, threshold=threshold, holders_used=use, keys_dir=keys_dir)


def encrypt_plaintext_rows(conn: sqlite3.Connection, vault: Vault) -> int:
    """Encrypt every sensitive value not yet in enc:v1 form (legacy migration; idempotent).
    Returns how many values were encrypted. Caller commits and VACUUMs."""
    n = 0
    for table, (key_expr, cols) in ENCRYPTED.items():
        for col in cols:
            rows = conn.execute(
                f"SELECT rowid, {key_expr}, {col} FROM {table} "
                f"WHERE {col} IS NOT NULL AND substr({col}, 1, {len(PREFIX)}) != ?", (PREFIX,)).fetchall()
            for rowid, row_key, value in rows:
                conn.execute(f"UPDATE {table} SET {col} = ? WHERE rowid = ?",
                             (vault.encrypt(value, table, col, row_key), rowid))
                n += 1
    return n
