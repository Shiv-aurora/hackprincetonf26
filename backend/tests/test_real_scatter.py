"""Scatter: an encrypted split copy of the real database across the hospitals."""

from __future__ import annotations

import sqlite3

import pytest

from mayajaal.real.scatter import PIECES, rebuild, scatter

HOLDERS = ["aur", "riv", "nor", "eas", "wes", "lum"]


@pytest.fixture
def db(tmp_path):
    p = tmp_path / "real.db"
    c = sqlite3.connect(p)
    c.execute("create table t (secret text)")
    c.executemany("insert into t values (?)", [(f"enc:v1:record-{i}",) for i in range(500)])
    c.commit()
    c.close()
    return p


def test_scatter_splits_and_verifies(db, tmp_path) -> None:
    nodes = tmp_path / "nodes"
    r = scatter(db, HOLDERS, 3, nodes)
    assert r.verified and r.pieces == PIECES and r.replicas == 2
    for h in HOLDERS:                                       # every hospital: one piece + one key share
        files = sorted(f.name for f in (nodes / h).iterdir())
        assert len([f for f in files if ".piece" in f]) == 1 and any(f.endswith(".keyshare") for f in files)
        blob = b"".join(f.read_bytes() for f in (nodes / h).iterdir())
        assert b"record-1" not in blob                      # nothing readable at any single hospital


def test_rebuild_needs_every_piece_and_three_shares(db, tmp_path) -> None:
    nodes = tmp_path / "nodes"
    r = scatter(db, HOLDERS, 3, nodes)
    assert rebuild(nodes, r.snapshot_id, ["aur", "riv", "nor"], 3)        # one holder of each piece
    with pytest.raises(ValueError, match="missing pieces"):
        rebuild(nodes, r.snapshot_id, ["aur", "eas"], 3)    # both hold piece 0
    with pytest.raises(ValueError, match="missing pieces"):
        rebuild(nodes, r.snapshot_id, ["lum"], 3)


def test_rebuilt_snapshot_is_the_database(db, tmp_path) -> None:
    nodes = tmp_path / "nodes"
    r = scatter(db, HOLDERS, 3, nodes)
    data = rebuild(nodes, r.snapshot_id, ["eas", "riv", "lum"], 3)
    c = sqlite3.connect(":memory:")
    c.deserialize(data)
    assert c.execute("select count(*) from t").fetchone()[0] == 500
