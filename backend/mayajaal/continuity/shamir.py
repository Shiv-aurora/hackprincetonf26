"""Shamir secret sharing over GF(256), byte-wise.

Each byte of the secret is the constant term of its own random polynomial of degree
threshold-1 over GF(2^8) (AES polynomial x^8+x^4+x^3+x+1). Share x (1..255) holds the
polynomials evaluated at x. Any `threshold` shares recover the secret by Lagrange
interpolation at 0; fewer reveal nothing (every secret is equally likely).

    shares = split(secret, threshold=3, n=6)      # [(1, b"..."), ..., (6, b"...")]
    combine(shares[:3]) == secret
"""

from __future__ import annotations

import secrets

Share = tuple[int, bytes]

# ---------------------------------------------------------------- GF(256) tables

_EXP = [0] * 512
_LOG = [0] * 256


def _build_tables() -> None:
    x = 1
    for i in range(255):
        _EXP[i] = x
        _LOG[x] = i
        # multiply by the generator 3 (= x + 1)
        x ^= (x << 1) ^ (0x11B if x & 0x80 else 0)
        x &= 0xFF
    for i in range(255, 512):
        _EXP[i] = _EXP[i - 255]


_build_tables()


def gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def gf_div(a: int, b: int) -> int:
    if b == 0:
        raise ZeroDivisionError("division by zero in GF(256)")
    if a == 0:
        return 0
    return _EXP[(_LOG[a] - _LOG[b]) % 255]


def _eval_poly(coeffs: list[int], x: int) -> int:
    """Horner evaluation; coeffs[0] is the constant term."""
    y = 0
    for c in reversed(coeffs):
        y = gf_mul(y, x) ^ c
    return y


# ---------------------------------------------------------------- API


def split(secret: bytes, threshold: int, n: int) -> list[Share]:
    """Split `secret` into `n` shares, any `threshold` of which reconstruct it."""
    if not 1 <= threshold <= n <= 255:
        raise ValueError("need 1 <= threshold <= n <= 255")
    if not secret:
        raise ValueError("secret must be non-empty")
    out = [bytearray() for _ in range(n)]
    for byte in secret:
        coeffs = [byte] + [secrets.randbelow(256) for _ in range(threshold - 1)]
        for i in range(n):
            out[i].append(_eval_poly(coeffs, i + 1))
    return [(i + 1, bytes(b)) for i, b in enumerate(out)]


def combine(shares: list[Share]) -> bytes:
    """Lagrange-interpolate at x=0. With fewer than `threshold` shares the result is a
    uniformly unrelated value, not the secret — callers must enforce the threshold."""
    if not shares:
        raise ValueError("no shares")
    xs = [x for x, _ in shares]
    if len(set(xs)) != len(xs) or any(not 1 <= x <= 255 for x in xs):
        raise ValueError("share indices must be distinct and in 1..255")
    length = len(shares[0][1])
    if any(len(y) != length for _, y in shares):
        raise ValueError("shares have different lengths")
    # Lagrange basis at 0: l_j = prod_{m != j} x_m / (x_m - x_j); subtraction is XOR.
    basis = []
    for j, xj in enumerate(xs):
        num, den = 1, 1
        for m, xm in enumerate(xs):
            if m != j:
                num = gf_mul(num, xm)
                den = gf_mul(den, xm ^ xj)
        basis.append(gf_div(num, den))
    out = bytearray(length)
    for (_, y), lj in zip(shares, basis):
        for k in range(length):
            out[k] ^= gf_mul(y[k], lj)
    return bytes(out)
