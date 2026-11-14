"""Key custody: the city's 32-byte master key, split 3-of-6 across the hospitals.

"Capture one hospital and you get one key share; you need three."

    custody = KeyCustody()                       # holders/threshold from contracts/world.json
    ev = custody.capture("lum", run_id=run_id)   # keyshare.status event (captured)
    custody.can_reconstruct(["lum"])             # False
    custody.attacker_key()                       # None until 3 shares are captured
"""

from __future__ import annotations

import secrets
from collections.abc import Iterable

from mayajaal.contracts import Event, KeyshareStatus, load_world, make_event

from . import shamir

KEY_BYTES = 32


class KeyCustody:
    def __init__(self, master_key: bytes | None = None, world: dict | None = None) -> None:
        cfg = (world or load_world())["key_shares"]
        self.holders: list[str] = list(cfg["holders"])
        self.threshold: int = int(cfg["threshold"])
        if len(self.holders) != int(cfg["total"]):
            raise ValueError("world.json key_shares: holders/total mismatch")
        self._master = master_key if master_key is not None else secrets.token_bytes(KEY_BYTES)
        if len(self._master) != KEY_BYTES:
            raise ValueError(f"master key must be {KEY_BYTES} bytes")
        shares = shamir.split(self._master, self.threshold, len(self.holders))
        # share index i+1 belongs to holders[i] (matches the fixture: aur=1 ... lum=6)
        self._shares: dict[str, shamir.Share] = dict(zip(self.holders, shares))
        self.captured: set[str] = set()

    # ------------------------------------------------------------ queries

    def share_index(self, hospital_id: str) -> int:
        return self.holders.index(hospital_id) + 1

    def share_of(self, hospital_id: str) -> shamir.Share:
        if hospital_id not in self._shares:
            raise KeyError(f"{hospital_id!r} holds no key share")
        return self._shares[hospital_id]

    def can_reconstruct(self, captured_ids: Iterable[str]) -> bool:
        return len(set(captured_ids) & set(self.holders)) >= self.threshold

    def verify(self, key: bytes) -> bool:
        return secrets.compare_digest(key, self._master)

    # ------------------------------------------------------------ actions

    def capture(self, hospital_id: str, *, run_id: str = "continuity", seq: int | None = None) -> Event:
        """Mark this hospital's share captured; return the keyshare.status event."""
        self.share_of(hospital_id)  # validates
        self.captured.add(hospital_id)
        return self.status_event(hospital_id, run_id=run_id, seq=seq)

    def status_event(self, hospital_id: str, *, run_id: str = "continuity", seq: int | None = None) -> Event:
        data = KeyshareStatus(
            share_index=self.share_index(hospital_id),
            state="captured" if hospital_id in self.captured else "safe",
            shares_captured_total=len(self.captured),
            threshold=self.threshold,
        )
        return make_event("keyshare.status", data, run_id=run_id, actor="system",
                          hospital_id=hospital_id, seq=seq)

    def reconstruct(self, shares: list[shamir.Share]) -> bytes:
        """Recover the master key from shares. Refuses below the threshold."""
        if len({x for x, _ in shares}) < self.threshold:
            raise ValueError(f"need {self.threshold} distinct shares, got {len(shares)}")
        return shamir.combine(shares)

    def attacker_key(self) -> bytes | None:
        """What an attacker holding the captured shares can recover (None if too few)."""
        if not self.can_reconstruct(self.captured):
            return None
        return self.reconstruct([self._shares[h] for h in sorted(self.captured)])
