"""Export the hub's run log to the Arena leaderboard's offline copy (web/public/runs/leaderboard.json).

Reads backend/data/results.jsonl, the append-only log of every run the hub scored on this machine, and keeps
the complete ones: the attacker script ran to the end (10+ requests). Development runs that stopped after a
few requests are left out and counted in the note, so they can't pass for defense wins.

    cd backend && uv run python ../scripts/export_leaderboard.py
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from mayajaal.arena.scoring import build_results

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "backend" / "data" / "results.jsonl"
EVENTS = ROOT / "backend" / "data" / "events.jsonl"
OUT = ROOT / "web" / "public" / "runs" / "leaderboard.json"
MIN_STEPS = 10
BULK = re.compile(r"^/fhir/Patient\?.*_count=(\d+)")


def real_bulk_reads() -> dict[str, int]:
    """Per run: bulk patient reads (more than a ward's 20) that the gateway served from the REAL tier with 200.
    Ground truth is the gateway's tier tag on each request event, not the attacker's own claim."""
    out: dict[str, int] = defaultdict(int)
    for line in EVENTS.read_text().splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if e.get("type") != "request" or e.get("actor") != "attacker" or e.get("tier") != "real":
            continue
        d = e.get("data") or {}
        m = BULK.match(d.get("path") or "")
        if d.get("status") == 200 and m and int(m.group(1)) > 20:
            out[e["run_id"]] += 1
    return out


def main() -> None:
    rows = [json.loads(line) for line in SRC.read_text().splitlines() if line.strip()]
    bulk = real_bulk_reads()
    kept = [{**r, "real_data_taken": bulk.get(r["run_id"], 0) > 0}
            for r in rows if (r.get("steps") or 0) >= MIN_STEPS]
    dropped = len(rows) - len(kept)
    models = Counter(r["model"] for r in kept)
    note = (
        f"Every complete run recorded on the running system ({len(kept)} runs). All are the same scripted "
        f"attacker ({', '.join(models)}), not a person or an AI agent, run on Nov 15 2026 while building and "
        f"recording. {dropped} development runs that stopped after a few requests are not shown. "
        "secrets_leaked comes from the gateway's canary ledger, never from the attacker's claim."
    )
    OUT.write_text(json.dumps(build_results(kept, note=note), indent=2) + "\n")
    by = Counter(r["config"] for r in kept)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(kept)} runs {dict(by)}, {dropped} dropped")


if __name__ == "__main__":
    main()
