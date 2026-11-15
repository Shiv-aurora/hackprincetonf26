"""Device trust: is this login coming from one of the hospital's own workstations?

Hospitals (and most zero-trust setups) only issue clinical sessions to managed devices, each of which
holds a device certificate. A phished password typed on the attacker's own laptop arrives without one.
We model the certificate as a signed token in a header:

    X-Device-Token: <device_id>.<HMAC-SHA256(device key, device_id), first 32 hex>

The device key lives with the real tier (backend/data/real/device.key, gitignored, or MJ_DEVICE_KEY).
The shadow tier never sees it. This is a stand-in for mTLS client certificates, not a replacement:
an attacker who runs code ON the nurse's workstation inherits its device identity.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from functools import lru_cache

HEADER = "x-device-token"


@lru_cache(maxsize=1)
def device_key() -> bytes:
    env = os.environ.get("MJ_DEVICE_KEY")
    if env:
        return env.encode()
    from mayajaal.real.seed import DATA_DIR

    path = DATA_DIR / "device.key"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32))
        os.chmod(path, 0o600)
    return path.read_text().strip().encode()


def _sig(device_id: str, key: bytes) -> str:
    return hmac.new(key, device_id.encode(), hashlib.sha256).hexdigest()[:32]


def mint(device_id: str, key: bytes | None = None) -> str:
    """Token for a managed workstation (used by the clinician simulator and tests)."""
    return f"{device_id}.{_sig(device_id, key or device_key())}"


def verify(token: str | None, key: bytes | None = None) -> str | None:
    """The device id if the token is valid, else None."""
    if not token or "." not in token:
        return None
    device_id, sig = token.rsplit(".", 1)
    if not device_id or not hmac.compare_digest(sig, _sig(device_id, key or device_key())):
        return None
    return device_id


__all__ = ["HEADER", "device_key", "mint", "verify"]
