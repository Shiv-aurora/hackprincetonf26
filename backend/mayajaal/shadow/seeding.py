"""Deterministic seeding for the shadow world.

Every entity draws its attributes from ``HMAC-SHA256(key, f"{session}|{entity_id}")`` so the same
session always sees the same hospital and two sessions never share one.
"""

from __future__ import annotations

import bisect
import hashlib
import hmac
import itertools
import random
from typing import Sequence, TypeVar

T = TypeVar("T")


def entity_digest(key: bytes, session: str, entity_id: str) -> bytes:
    return hmac.new(key, f"{session}|{entity_id}".encode(), hashlib.sha256).digest()


def entity_seed(key: bytes, session: str, entity_id: str) -> int:
    return int.from_bytes(entity_digest(key, session, entity_id), "big")


def entity_rng(key: bytes, session: str, entity_id: str) -> random.Random:
    return random.Random(entity_seed(key, session, entity_id))


class Weighted:
    """Fast weighted choice over a fixed table (precomputed cumulative weights)."""

    __slots__ = ("items", "cum", "total")

    def __init__(self, items: Sequence[T], weights: Sequence[float]):
        self.items = list(items)
        self.cum = list(itertools.accumulate(weights))
        self.total = self.cum[-1]

    def pick(self, rng: random.Random):
        return self.items[bisect.bisect_right(self.cum, rng.random() * self.total)]


B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def b62(rng: random.Random, n: int) -> str:
    return "".join(rng.choice(B62) for _ in range(n))


def hexs(rng: random.Random, n: int) -> str:
    return "".join(rng.choice("0123456789abcdef") for _ in range(n))
