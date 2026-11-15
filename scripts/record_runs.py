"""Record the same scripted attack against the running stack under each defense config.

Needs the gateway (:8000), shadow tier (:8001) and hub (:8002) running with the same MJ_ADMIN_KEY
(see scripts/record.sh). For each config it registers an arena run, sends a fixed sequence of
HTTP requests through the gateway as the phished nurse, posts what the client believes it got,
finishes the run, and saves the hub's events for that run to web/public/runs/<config>.jsonl.
Everything in those files comes from the real backend; only the attacker is a fixed script.

    cd backend && uv run python ../scripts/record_runs.py
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import httpx

from mayajaal.arena.scoring import build_results
from mayajaal.analyst import brief
from mayajaal.contracts import make_event

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "runs"


class Client:
    def __init__(self, gateway: str, hub: str, config: str, pace: float) -> None:
        self.hub = hub
        self.pace = pace
        self.log: list[tuple[str, httpx.Response]] = []
        r = httpx.post(f"{hub}/arena/start", json={"mission": "exfil", "config": config, "model": "scripted",
                                                   "label": "Scripted client", "source": "bench"}, timeout=10)
        r.raise_for_status()
        start = r.json()
        self.run_id = start["run_id"]
        self.http = httpx.Client(base_url=gateway, headers=start["headers"], timeout=30)
        login = start["login"]
        self.call("POST", "/auth/login", json={"username": login["username"], "password": login["password"]},
                  show=f"POST /auth/login ({login['username']})")
        token = self.last.json()["token"]
        self.http.headers["Authorization"] = f"Bearer {token}"

    def emit(self, type_: str, data: dict[str, Any]) -> None:
        ev = make_event(type_, data, run_id=self.run_id, actor="attacker")
        httpx.post(f"{self.hub}/events", json=ev.model_dump(), timeout=10).raise_for_status()

    def call(self, method: str, path: str, *, show: str | None = None, **kw: Any) -> httpx.Response:
        self.emit("agent.tool_call", {"tool": "http", "input": show or f"{method} {path}"})
        r = self.http.request(method, path, **kw)
        self.last = r
        self.log.append((path, r))
        preview = f"HTTP {r.status_code}\n" + r.text[:380]
        self.emit("agent.tool_result", {"output_preview": preview, "bytes": len(r.content)})
        time.sleep(self.pace)
        return r

    def finish(self, claim: str) -> dict[str, Any]:
        r = httpx.post(f"{self.hub}/arena/finish", json={"run_id": self.run_id, "claim": claim,
                                                         "suspected_honeypot": False}, timeout=15)
        r.raise_for_status()
        return r.json()


def patients(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for e in bundle.get("entry", []) or []:
        p = e.get("resource", {})
        name = (p.get("name") or [{}])[0]
        full = " ".join([*(name.get("given") or []), name.get("family", "")]).strip() or name.get("text", "")
        mrn = next((i.get("value") for i in p.get("identifier", []) if i.get("value")), p.get("id", ""))
        org = (p.get("managingOrganization") or {}).get("reference", "")
        out.append({"id": p.get("id", ""), "mrn": mrn, "name": full, "dob": p.get("birthDate", ""),
                    "hospital_id": org.rsplit("/", 1)[-1] or "eas"})
    return out


JSON = {"Accept": "application/json"}
JUICY = ("research", "linkage", "dump", "svc", "vpn", "credential", "admin", "key")


def links(doc: Any, key: str) -> list[str]:
    """Every value stored under `key` anywhere in a JSON document (portal listings)."""
    out: list[str] = []
    if isinstance(doc, dict):
        for k, v in doc.items():
            if k == key and isinstance(v, str):
                out.append(v)
            else:
                out += links(v, key)
    elif isinstance(doc, list):
        for v in doc:
            out += links(v, key)
    return out


def juiciest(urls: list[str]) -> str | None:
    """A scripted attacker's taste: the first link whose name sounds valuable, else the first link."""
    return next((u for u in urls if any(w in u.lower() for w in JUICY)), urls[0] if urls else None)


def attack(c: Client) -> str:
    c.call("GET", "/fhir/Patient?_count=20")                      # ward list: normal for a nurse
    ward = patients(c.last.json()) if c.last.status_code == 200 else []
    if ward:
        c.call("GET", f"/fhir/Patient/{ward[0]['id']}")
    c.call("GET", "/portal/admin/users")                          # reaches for admin
    r = c.call("GET", "/portal/backups", headers=JSON)            # looks for backups
    archive = juiciest(links(r.json(), "download")) if r.status_code == 200 else None
    stolen: list[dict[str, Any]] = []
    total_bytes = 0
    path: str | None = "/fhir/Patient?_count=1000"
    pages = 0
    while path and pages < 4:                                     # bulk pull, following next links
        r = c.call("GET", path)
        pages += 1
        path = None
        if r.status_code == 200:
            bundle = r.json()
            stolen += patients(bundle)
            total_bytes += len(r.content)
            nxt = next((l["url"] for l in bundle.get("link", []) if l.get("relation") == "next"), None)
            if nxt:
                u = httpx.URL(nxt)
                path = u.raw_path.decode()
    for p in stolen[:3]:                                          # clinical notes for a few
        r = c.call("GET", f"/fhir/DocumentReference?patient={p['id']}")
        if r.status_code == 200:
            total_bytes += len(r.content)
    r = c.call("GET", "/portal/docs", headers=JSON)               # browses IT documents
    doc = juiciest(links(r.json(), "view")) if r.status_code == 200 else None
    if doc:
        c.call("GET", doc)                                        # opens the most valuable-looking one
    if archive:
        c.call("GET", archive)                                    # downloads a backup archive
    if stolen:
        c.emit("exfil", {"records": len(stolen), "bytes": total_bytes,
                         "artifact": f"GET /fhir/Patient ({pages} pages) + DocumentReference",
                         "sample": [{k: p[k] for k in ("mrn", "name", "dob", "hospital_id")} for p in stolen[:5]]})
        return f"Extracted {len(stolen):,} patient records with names, dates of birth and clinical notes."
    return ""


def real_records_taken(c: Client, events: list[dict[str, Any]]) -> int:
    """Patient records the client bulk-exported from the REAL tier (ground truth: the gateway's tier tag).
    The nurse's own 20-patient ward list is normal access and is not counted."""
    tiers = [e.get("tier") for e in events if e["type"] == "request" and e.get("actor") == "attacker"]
    calls = [(p, r) for p, r in c.log if p != "/auth/login"]
    tiers = tiers[-len(calls):] if calls else []
    seen: set[str] = set()
    for (path, r), tier in zip(calls, tiers):
        bulk = path.startswith("/fhir/Patient?") and "_count=20&" not in path + "&"
        if tier == "real" and bulk and r.status_code == 200:
            seen.update(p["id"] for p in patients(r.json()))
    return len(seen)


def real_records_exposed(c: Client, events: list[dict[str, Any]]) -> int:
    """Every distinct real patient the attacker was shown, including the nurse's own ward list and
    any chart: what a stolen login gets before we notice. (real_records_taken counts bulk only.)"""
    tiers = [e.get("tier") for e in events if e["type"] == "request" and e.get("actor") == "attacker"]
    calls = [(p, r) for p, r in c.log if p != "/auth/login"]
    tiers = tiers[-len(calls):] if calls else []
    seen: set[str] = set()
    for (path, r), tier in zip(calls, tiers):
        if tier != "real" or r.status_code != 200 or not path.startswith("/fhir/"):
            continue
        try:
            doc = r.json()
        except ValueError:
            continue
        if doc.get("resourceType") == "Patient":
            seen.add(doc.get("id", ""))
        seen.update(p["id"] for p in patients(doc) if p["id"])
        for e in doc.get("entry", []) or []:                 # DocumentReference / Observation bundles
            ref = ((e.get("resource") or {}).get("subject") or {}).get("reference", "")
            if ref.startswith("Patient/"):
                seen.add(ref.split("/", 1)[1])
    return len(seen - {""})


def detection(events: list[dict[str, Any]]) -> dict[str, Any]:
    """When the gateway first moved the attacker's session out of the normal lane.
    detected_at_request: attacker requests before it (0 = at the login itself)."""
    reqs = [e for e in events if e["type"] == "request" and e.get("actor") == "attacker"]
    if not reqs:
        return {"detected_at_request": None, "time_to_detect_s": None, "detected_by": None}
    sid, t0 = reqs[0]["session_id"], reqs[0]["ts"]
    for e in events:
        if (e["type"] == "policy.decision" and e.get("session_id") == sid
                and e["data"].get("lane") in ("suspicious", "attacker")):
            # A decision is emitted just before its own request's event, so it belongs to request n+1.
            # The early-warning decision at login is the exception: it follows the login event.
            n = sum(1 for r in reqs if r["ts"] <= e["ts"] and r["data"]["path"] != "/auth/login")
            n = 0 if "at login" in e["data"]["reason"] else n + 1
            return {"detected_at_request": n, "time_to_detect_s": round(max(0, e["ts"] - t0) / 1000, 2),
                    "detected_by": e["data"]["reason"][:160]}
    return {"detected_at_request": None, "time_to_detect_s": None, "detected_by": None}


def record_continuity(hub: str, speed: float) -> None:
    """The Synnovis-style lab outage runs as its own run (it emits its own run.started)."""
    r = httpx.post(f"{hub}/scenario/synnovis/start", json={"speed": speed}, timeout=10)
    r.raise_for_status()
    run_id = r.json()["run_id"]
    while httpx.get(f"{hub}/scenario/synnovis/status", timeout=10).json()["running"]:
        time.sleep(1)
    events = httpx.get(f"{hub}/runs/{run_id}", timeout=10).json()
    (OUT / "continuity.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    print(f"continuity run={run_id} events={len(events)}")


def decoy_overlap(gateway: str, hub: str, config: str) -> float | None:
    """Two fresh attacker sessions under one config: what share of the decoy patients is identical?
    A static honeypot serves the same fake hospital to everyone (fingerprintable once anyone
    publishes it); MayaJaal seeds a new one per session."""
    seen = []
    for _ in range(2):
        c = Client(gateway, hub, config, 0.1)
        c.call("GET", "/portal/backups")
        r = c.call("GET", "/fhir/Patient?_count=200")
        c.finish("")
        seen.append({(p["name"], p["dob"]) for p in patients(r.json())} if r.status_code == 200 else set())
    a, b = seen
    return round(len(a & b) / max(1, len(a | b)), 3) if a and b else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gateway", default="http://127.0.0.1:8000")
    ap.add_argument("--hub", default="http://127.0.0.1:8002")
    ap.add_argument("--configs", default="baseline,static,mayajaal")
    ap.add_argument("--dry", action="store_true", help="drive the attack live but don't save any files")
    ap.add_argument("--continuity-speed", type=float, default=2.0)
    ap.add_argument("--pace", type=float, default=0.6, help="seconds between requests")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for config in a.configs.split(","):
        c = Client(a.gateway, a.hub, config, a.pace)
        claim = attack(c)
        row = c.finish(claim)
        time.sleep(1.0)
        events = httpx.get(f"{a.hub}/runs/{c.run_id}", timeout=10).json()
        if a.dry:
            print(f"{config:9s} run={c.run_id} events={len(events)} (not saved)")
            continue
        (OUT / f"{config}.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
        # Incident brief for the run (rule-based; adds Claude's analysis if ANTHROPIC_API_KEY is set)
        (OUT / f"brief-{config}.json").write_text(json.dumps({"run_id": c.run_id, **brief(events)}, indent=2) + "\n")
        row["real_records_taken"] = real_records_taken(c, events)
        row["real_records_exposed"] = real_records_exposed(c, events)
        row.update(detection(events))
        rows.append(row)
        print(f"{config:9s} run={c.run_id} events={len(events)} leaked={row['secrets_leaked']} "
              f"diverted={row['diverted']} believed={row['believed_success']} "
              f"real_records={row['real_records_taken']} exposed={row['real_records_exposed']} "
              f"detected_at={row['detected_at_request']} ({row['time_to_detect_s']} s)")
    results = build_results(rows, note="Recorded from the running stack. The attacker is a fixed "
                                       "script (same requests under each config), not an AI agent.")
    if a.dry:
        return
    for row in rows:
        if row["config"] != "baseline":
            row["decoy_overlap_between_sessions"] = decoy_overlap(a.gateway, a.hub, row["config"])
            print(f"{row['config']:9s} decoy overlap between two sessions = {row['decoy_overlap_between_sessions']}")
    record_continuity(a.hub, a.continuity_speed)
    (OUT / "results.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
