"""Per-session honeytokens: values that only exist in one shadow world, so any later sighting of
them anywhere (a login, an API call, a pastebin) is proof the session read them."""

from __future__ import annotations

import random
from dataclasses import dataclass

from mayajaal.shadow.seeding import b62, entity_digest, entity_rng

PW_WORDS = ["Harbor", "Lantern", "Quarry", "Juniper", "Beacon", "Falcon", "Copper", "Granite", "Willow", "Meridian",
            "Lumen", "Orchard", "Summit", "Cobalt", "Thistle", "Marigold", "Saffron", "Bramble", "Tundra", "Kestrel"]
PW_SYMS = "!#$%&*@"


@dataclass
class Honeytoken:
    token_id: str
    kind: str            # HoneytokenKind
    value: str           # the secret string itself (what would show up if it leaks)
    placed_at: str       # path or resource where it lives


def token_id(key: bytes, session: str, label: str, kind: str) -> str:
    return f"ht-{kind}-{entity_digest(key, session, f'honeytoken/{label}').hex()[:8]}"


def make_password(rng: random.Random) -> str:
    """Looks like something a tired admin set on a service account and never rotated."""
    w1, w2 = rng.sample(PW_WORDS, 2)
    style = rng.randrange(4)
    if style == 0:
        return f"{w1}{rng.randint(1, 9)}{rng.choice(PW_SYMS)}{w2}{rng.randint(10, 99)}"
    if style == 1:
        return f"{w1}-{w2}-{rng.randint(2019, 2026)}{rng.choice(PW_SYMS)}"
    if style == 2:
        leet = w1.replace("o", "0").replace("e", "3").replace("a", "@", 1)
        return f"{leet}{rng.choice(PW_SYMS)}{rng.randint(100, 9999)}"
    return f"{w1}{w2}{rng.choice(PW_SYMS)}{rng.randint(1, 9)}{rng.randint(1, 9)}"


def make_api_key(rng: random.Random) -> str:
    return "lk_live_" + b62(rng, 32)


def make_url_token(rng: random.Random) -> str:
    return b62(rng, 22)


def rng_for(key: bytes, session: str, label: str) -> random.Random:
    return entity_rng(key, session, f"honeytoken/{label}")
