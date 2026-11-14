"""Canary ledger: the ground truth for "protected secrets leaked".

Every response body and every shell frame the gateway sends to a (non-clinician) caller is scanned
for the 12 protected canary strings from real.db. Matches also count when the canary is
base64- or hex-encoded or its case was changed, and gzip bodies are decompressed first, so an
attacker can't dodge the count by encoding (that would be a fake victory for us).

Leaks are tracked per run_id. The count only ever goes up.
"""

from __future__ import annotations

import base64
import gzip
import threading
import zlib


def _needles(canary: str) -> list[tuple[str, bool]]:
    """(needle, case_sensitive) variants that prove this canary left the building."""
    raw = canary.encode()
    out: list[tuple[str, bool]] = [(canary.lower(), False), (raw.hex(), False)]
    for k in range(3):                       # base64 at each of the 3 byte alignments
        enc = base64.b64encode(b"\x00" * k + raw).decode()
        out.append((enc[4:-4], True))        # drop chars touched by the prefix/padding
    return out


class CanaryLedger:
    def __init__(self, canaries: list[str]) -> None:
        self.canaries = list(canaries)
        self.total = len(self.canaries)
        self._needles = {c: _needles(c) for c in self.canaries}
        self._leaked: dict[str, set[str]] = {}
        self._lock = threading.Lock()

    def scan(self, data: bytes | str | None) -> set[str]:
        """Which canaries appear in this payload?"""
        if not data:
            return set()
        if isinstance(data, bytes):
            if data[:2] == b"\x1f\x8b":
                try:
                    data = gzip.decompress(data)
                except (OSError, EOFError, zlib.error):
                    pass
            text = data.decode("utf-8", errors="ignore")
        else:
            text = data
        low = text.lower()
        found: set[str] = set()
        for c, needles in self._needles.items():
            for needle, case_sensitive in needles:
                if needle in (text if case_sensitive else low):
                    found.add(c)
                    break
        return found

    def record(self, run_id: str, found: set[str]) -> bool:
        """Add leaks for a run. True if the leaked count changed."""
        if not found:
            return False
        with self._lock:
            leaked = self._leaked.setdefault(run_id, set())
            before = len(leaked)
            leaked |= found
            return len(leaked) != before

    def leaked(self, run_id: str) -> int:
        return len(self._leaked.get(run_id, ()))

    def leaked_ids(self, run_id: str) -> set[str]:
        return set(self._leaked.get(run_id, ()))

    def runs(self) -> dict[str, int]:
        return {r: len(s) for r, s in self._leaked.items()}
