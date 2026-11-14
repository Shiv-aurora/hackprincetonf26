import itertools
import secrets

import pytest

from mayajaal.continuity import shamir
from mayajaal.continuity.custody import KeyCustody
from mayajaal.contracts import load_world


def test_gf_mul_div_inverse():
    for a in range(1, 256):
        for b in (1, 2, 3, 0x53, 0xCA, 255):
            assert shamir.gf_div(shamir.gf_mul(a, b), b) == a
    assert shamir.gf_mul(0x53, 0xCA) == 0x01  # AES field: 0x53 and 0xCA are inverses


def test_any_three_of_six_reconstruct():
    secret = secrets.token_bytes(32)
    shares = shamir.split(secret, 3, 6)
    for combo in itertools.combinations(shares, 3):
        assert shamir.combine(list(combo)) == secret
    assert shamir.combine(shares) == secret  # more than threshold also works


def test_two_shares_do_not_reconstruct():
    secret = secrets.token_bytes(32)
    shares = shamir.split(secret, 3, 6)
    for combo in itertools.combinations(shares, 2):
        assert shamir.combine(list(combo)) != secret


@pytest.mark.parametrize("trial", range(20))
def test_round_trip_random_keys(trial):
    secret = secrets.token_bytes(1 + trial * 3)
    t = 1 + trial % 6
    n = t + trial % 4
    shares = shamir.split(secret, t, n)
    pick = secrets.SystemRandom().sample(shares, t)
    assert shamir.combine(pick) == secret


def test_custody_capture_and_threshold():
    world = load_world()
    c = KeyCustody(world=world)
    assert c.holders == world["key_shares"]["holders"] and c.threshold == 3
    ev = c.capture("lum", run_id="t")
    assert ev.type == "keyshare.status" and ev.hospital_id == "lum"
    assert ev.data == {"share_index": 6, "state": "captured", "shares_captured_total": 1, "threshold": 3}
    assert not c.can_reconstruct(["lum"])
    assert c.attacker_key() is None
    c.capture("eas", run_id="t")
    assert c.attacker_key() is None
    assert not c.can_reconstruct(["lum", "eas", "nowhere"])
    c.capture("aur", run_id="t")
    assert c.can_reconstruct(c.captured)
    key = c.attacker_key()
    assert key is not None and c.verify(key)


def test_custody_reconstruct_refuses_below_threshold():
    c = KeyCustody(master_key=bytes(range(32)))
    two = [c.share_of("aur"), c.share_of("riv")]
    with pytest.raises(ValueError):
        c.reconstruct(two)
    assert c.reconstruct(two + [c.share_of("wes")]) == bytes(range(32))
    with pytest.raises(KeyError):
        c.capture("xyz")
