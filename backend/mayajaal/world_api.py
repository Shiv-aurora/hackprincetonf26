"""WorldProvider — the interface between data (real or shadow) and the attacker surfaces.
FROZEN after Wave 0. Owned by the integrator.

    Agent A  implements ShadowWorld(WorldProvider)    in mayajaal/shadow/   (tier = "shadow")
    Agent B  implements RealWorld(WorldProvider)      in mayajaal/real/     (tier = "real")
    Agent C  builds the surfaces (FHIR-ish REST, admin portal, fake shell) on top of ANY WorldProvider,
             in mayajaal/surfaces/, exposed as  build_router(resolve_world, sink) -> APIRouter

The same surfaces code serves both tiers, so the attacker sees an identical interface either way.
Surfaces never import mayajaal.real or mayajaal.shadow; they only see this protocol.

Data shapes are plain dicts / dataclasses so they serialise straight into HTTP responses.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Protocol

from mayajaal.contracts import Event, Tier

# --------------------------------------------------------------------------- records


@dataclass
class Patient:
    mrn: str                       # "MRN-418230" (real) / "MRN-7F3A-0193" style allowed in shadow
    name: str
    dob: str                       # ISO date
    sex: Literal["F", "M", "X"]
    hospital_id: str               # see contracts/world.json
    address: str
    phone: str
    conditions: list[str]          # e.g. ["E11.9 Type 2 diabetes"]
    medications: list[str]
    allergies: list[str]
    attending: str                 # clinician display name
    notes: str = ""                # free-text clinical note (real tier hides canaries here)


@dataclass
class Observation:
    obs_id: str
    mrn: str
    code: str                      # LOINC-ish, e.g. "718-7"
    display: str                   # "Hemoglobin"
    value: float
    unit: str
    ref_range: str
    issued: str                    # ISO datetime
    performer_hospital: str        # which lab produced it
    signature: str = ""            # integrity tag (real tier); shadow may fake it


@dataclass
class FsNode:
    path: str                      # absolute, e.g. "/mnt/backups/db_dump_2026-11-13.sql.gz"
    kind: Literal["file", "dir"]
    size: int = 0
    mode: str = "-rw-r-----"
    owner: str = "root"
    group: str = "root"
    mtime: str = "2026-11-13T02:10:00"
    children: list[str] = field(default_factory=list)   # dir only: child names


@dataclass
class PortalUser:
    username: str
    display_name: str
    role: str                      # "nurse" | "physician" | "lab_tech" | "it_admin" | "service"
    hospital_id: str
    last_login: str
    mfa: bool


# --------------------------------------------------------------------------- provider


class WorldProvider(Protocol):
    """One coherent view of a hospital network for one session."""

    tier: Tier                     # "real" or "shadow"
    session_id: str

    # FHIR-ish
    def total_patients(self) -> int: ...
    def list_patients(self, hospital_id: str | None, offset: int, limit: int) -> list[Patient]: ...
    def get_patient(self, mrn: str) -> Patient | None: ...
    def observations(self, mrn: str) -> list[Observation]: ...
    def put_observation(self, obs: Observation) -> Observation: ...        # tamper attempts land here

    # Admin portal
    def portal_users(self) -> list[PortalUser]: ...

    # Jump-box shell
    def hostname(self) -> str: ...                                         # e.g. "jump-eas"
    def stat(self, path: str) -> FsNode | None: ...
    def read_file(self, path: str) -> str: ...                             # text; .gz dumps return SQL text
    def write_file(self, path: str, content: str) -> None: ...             # per-session overlay in shadow

    # Exfil support: when the attacker copies a dump out, what rows did they "get"?
    def dump_rows(self, path: str, limit: int) -> list[Patient]: ...
    def dump_row_count(self, path: str) -> int: ...


# --------------------------------------------------------------------------- wiring types

EventSink = Callable[[Event], Awaitable[None]]
"""Async function that sends an event to the hub (mayajaal.hub.client.emit fits)."""


@dataclass
class SessionContext:
    """What the gateway tells a surface about the caller (via headers when proxied)."""
    session_id: str                # X-MJ-Session
    run_id: str = "adhoc"          # X-MJ-Run
    username: str = ""             # X-MJ-User
    role: str = ""                 # X-MJ-Role
    hospital_id: str = "eas"       # X-MJ-Hospital
    lane: str = "normal"           # X-MJ-Lane


ResolveWorld = Callable[[SessionContext], WorldProvider]
"""Given the caller's session, return the WorldProvider that should serve it."""

HEADER_MAP: dict[str, str] = {
    "session_id": "X-MJ-Session", "run_id": "X-MJ-Run", "username": "X-MJ-User",
    "role": "X-MJ-Role", "hospital_id": "X-MJ-Hospital", "lane": "X-MJ-Lane",
}


def context_from_headers(headers: Any) -> SessionContext:
    kw = {k: headers.get(h) for k, h in HEADER_MAP.items() if headers.get(h)}
    return SessionContext(**{"session_id": "anon", **kw})
