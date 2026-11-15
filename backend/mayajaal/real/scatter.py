"""Scatter: the moment an attacker is spotted, move an encrypted copy of the hospital's data out to the network.

While the attacker is busy in the decoy, the real tier takes a consistent snapshot of its database
(whose sensitive fields are already encrypted, see vault.py), encrypts the WHOLE snapshot again under a
fresh one-time key, and spreads it across the hospitals:

    snapshot  --AES-256-GCM, fresh key K-->  ciphertext C
    C is cut into 3 pieces; piece p is stored at two hospitals (p and p+3), so no hospital holds all of C
    K is Shamir-split 3-of-6; every hospital holds one share, none holds K

Then it proves the copy is good: it rebuilds C from one holder of each piece, rebuilds K from three key
shares, decrypts, and checks the SHA-256 against the snapshot.

What this buys:
  - A hospital that is captured or ransomed later gives the attacker one third of a ciphertext and one
    key share: nothing readable. Even three captured hospitals leave pieces missing unless they happen to
    hold all three pieces, and they would still need the field-level key on top.
  - If the attacker destroys or encrypts the live database, it can be rebuilt from the other hospitals.

What it does NOT do (said plainly): the live database stays where it is, so care keeps running; this is
an off-site, encrypted, split copy, not a move. In the demo all six "hospitals" are folders on one
machine (backend/data/real/nodes/<hospital>/, gitignored). Pure real-tier code; the shadow never sees it.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from mayajaal.continuity import shamir

PIECES = 3


@dataclass
class ScatterResult:
    snapshot_id: str
    bytes: int
    pieces: int
    replicas: int
    holders: list[str]
    key_threshold: int
    verified: bool
    seconds: float
    sha256: str

    def as_event(self, trigger: str) -> dict:
        return {"snapshot_id": self.snapshot_id, "bytes": self.bytes, "pieces": self.pieces,
                "replicas": self.replicas, "holders": self.holders, "key_threshold": self.key_threshold,
                "verified": self.verified, "seconds": self.seconds, "trigger": trigger}


def snapshot(db_path: Path) -> bytes:
    """A consistent copy of a live SQLite database, as bytes."""
    src = sqlite3.connect(db_path)
    try:
        return src.serialize()
    finally:
        src.close()


def _pieces(data: bytes, n: int) -> list[bytes]:
    size = -(-len(data) // n)
    return [data[i * size:(i + 1) * size] for i in range(n)]


def scatter(db_path: Path | str, holders: list[str], threshold: int, nodes_dir: Path | str) -> ScatterResult:
    t0 = time.perf_counter()
    db_path, nodes_dir = Path(db_path), Path(nodes_dir)
    if len(holders) < 2 * PIECES:
        raise ValueError(f"need at least {2 * PIECES} hospitals")
    plain = snapshot(db_path)
    digest = hashlib.sha256(plain).hexdigest()
    sid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)

    key = AESGCM.generate_key(bit_length=256)
    nonce = secrets.token_bytes(12)
    aad = f"mj-scatter|v1|{sid}".encode()
    ct = nonce + AESGCM(key).encrypt(nonce, plain, aad)
    pieces = _pieces(ct, PIECES)
    shares = shamir.split(key, threshold, len(holders))

    for i, h in enumerate(holders):
        d = nodes_dir / h
        d.mkdir(parents=True, exist_ok=True)
        os.chmod(d, 0o700)
        p = i % PIECES                                         # hospital i holds piece i mod 3
        (d / f"{sid}.piece{p}").write_bytes(pieces[p])
        x, y = shares[i]
        (d / f"{sid}.keyshare").write_text(json.dumps({"x": x, "y": y.hex()}))
        (d / f"{sid}.json").write_text(json.dumps({"snapshot_id": sid, "piece": p, "pieces": PIECES,
                                                   "key_threshold": threshold, "sha256": digest}))

    verified = rebuild(nodes_dir, sid, holders[PIECES:PIECES * 2], threshold) == plain   # the OTHER replicas
    return ScatterResult(sid, len(plain), PIECES, len(holders) // PIECES, list(holders), threshold, verified,
                         round(time.perf_counter() - t0, 2), digest)


def rebuild(nodes_dir: Path | str, sid: str, from_holders: list[str], threshold: int) -> bytes:
    """Recover the snapshot from the given hospitals. Needs every piece and `threshold` key shares."""
    nodes_dir = Path(nodes_dir)
    pieces: dict[int, bytes] = {}
    shares: list[shamir.Share] = []
    for h in from_holders:
        d = nodes_dir / h
        meta = json.loads((d / f"{sid}.json").read_text())
        pieces[meta["piece"]] = (d / f"{sid}.piece{meta['piece']}").read_bytes()
        s = json.loads((d / f"{sid}.keyshare").read_text())
        shares.append((s["x"], bytes.fromhex(s["y"])))
    if len(pieces) < PIECES:
        raise ValueError(f"missing pieces: have {sorted(pieces)} of {PIECES}")
    if len(shares) < threshold:
        raise ValueError(f"need {threshold} key shares, got {len(shares)}")
    key = shamir.combine(shares[:threshold])
    ct = b"".join(pieces[i] for i in range(PIECES))
    return AESGCM(key).decrypt(ct[:12], ct[12:], f"mj-scatter|v1|{sid}".encode())


__all__ = ["scatter", "rebuild", "snapshot", "ScatterResult", "PIECES"]
