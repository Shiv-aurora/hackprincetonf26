"""MayaJaal event contract. FROZEN after Wave 0 — changes go through the integrator.

Every component talks to the UI only through these events. The TypeScript mirror is
web/lib/contracts.ts; keep the two in sync. Field names are snake_case on the wire.

Envelope:
    id        unique event id (str)
    ts        epoch milliseconds (int)
    run_id    one attack run / scenario (str)
    session_id  attacker or clinician session (str | None)
    seq       monotonically increasing per run (int)
    type      one of EventType
    actor     who caused it: attacker | clinician | system | defender
    hospital_id  which hospital it concerns, if any (see contracts/world.json)
    tier      real | shadow | none — which reality served it
    data      type-specific payload, validated by DATA_MODELS[type]
"""

from __future__ import annotations

import itertools
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- shared literals

Actor = Literal["attacker", "clinician", "system", "defender"]
Tier = Literal["real", "shadow", "none"]
Goal = Literal["benign", "recon", "exfil", "tamper", "disrupt"]
Stage = Literal["recon", "access", "collect", "act"]
Lane = Literal["normal", "suspicious", "attacker", "unauth"]
PolicyAction = Literal["allow_real", "divert_shadow", "deny", "step_up"]
Surface = Literal["fhir", "portal", "shell", "api"]
NodeState = Literal["healthy", "degraded", "compromised", "quarantined", "down"]
Urgency = Literal["stat", "urgent", "routine"]
OrderStatus = Literal["queued", "rerouted", "completed", "late", "unservable"]
ConfigId = Literal["baseline", "static", "mayajaal"]
MissionId = Literal["exfil", "tamper", "disrupt", "escape"]
HoneytokenKind = Literal["mrn", "credential", "url", "file", "api_key"]
BreadcrumbKind = Literal["backup_share", "admin_credential", "research_dataset", "lab_service_account", "vpn_config"]

EventType = Literal[
    "run.started", "run.ended",
    "agent.thought", "agent.tool_call", "agent.tool_result", "agent.claim",
    "request", "policy.decision", "session.diverted",
    "honeytoken.minted", "honeytoken.touched", "breadcrumb.planted",
    "intent.update", "canary.check", "exfil", "tamper.attempt",
    "node.status", "keyshare.status", "lab.order", "continuity.stats",
    "reveal", "vault.scattered",
]

# ---------------------------------------------------------------- payloads


class RunStarted(BaseModel):
    mission: MissionId
    config: ConfigId
    model: str                     # e.g. "claude-sonnet-5-5" or "scripted" / "human"
    attacker_label: str            # pseudonymous display name
    live: bool = True              # False when this is a replay


class RunOutcome(BaseModel):
    believed_success: bool         # did the attacker claim success?
    secrets_leaked: int            # protected canaries actually leaked (ground truth)
    suspected_honeypot: bool
    mission_won: bool


class RunEnded(BaseModel):
    outcome: RunOutcome
    summary: str = ""
    duration_s: float = 0


class AgentThought(BaseModel):
    text: str


class AgentToolCall(BaseModel):
    tool: Literal["http", "shell"]
    input: str                     # the command or "METHOD /path"


class AgentToolResult(BaseModel):
    output_preview: str            # first ~400 chars
    bytes: int = 0


class AgentClaim(BaseModel):
    text: str                      # e.g. "Exfiltrated 4,812 patient records."


class Request(BaseModel):
    method: str
    path: str
    surface: Surface
    status: int
    bytes: int = 0
    technique: str | None = None   # MITRE ATT&CK id, e.g. "T1083"
    client_ip: str | None = None   # where the request came from, as the gateway saw it
    user_agent: str | None = None  # the client's own User-Agent string (first 160 chars)


class PolicyDecision(BaseModel):
    lane: Lane
    action: PolicyAction
    reason: str


class SessionDiverted(BaseModel):
    from_tier: Tier
    to_tier: Tier
    reason: str


class HoneytokenMinted(BaseModel):
    token_id: str
    kind: HoneytokenKind
    placed_at: str                 # path or resource where it lives


class HoneytokenTouched(BaseModel):
    token_id: str
    kind: HoneytokenKind
    where: str = ""


class BreadcrumbPlanted(BaseModel):
    kind: BreadcrumbKind
    path: str
    info_gain: float               # bits
    target_goals: list[Goal] = Field(default_factory=list)


class IntentUpdate(BaseModel):
    posterior: dict[Goal, float]   # sums to 1
    top_goal: Goal
    stage: Stage
    evidence: str = ""             # short human-readable reason


class CanaryCheck(BaseModel):
    protected_total: int = 12
    leaked: int = 0


class ExfilRecord(BaseModel):
    mrn: str
    name: str
    dob: str
    hospital_id: str
    detail: str = ""               # e.g. "HbA1c 7.9 %, metformin"


class Exfil(BaseModel):
    records: int
    bytes: int
    artifact: str                  # e.g. "/mnt/backups/db_dump_2026-11-01.sql.gz"
    sample: list[ExfilRecord] = Field(default_factory=list)


class TamperAttempt(BaseModel):
    resource: str
    accepted: bool
    accepted_by: list[str] = Field(default_factory=list)
    rejected_by: list[str] = Field(default_factory=list)


class NodeStatus(BaseModel):
    status: NodeState
    reason: str = ""


class KeyshareStatus(BaseModel):
    share_index: int
    state: Literal["safe", "captured"]
    shares_captured_total: int = 0
    threshold: int = 3


class VaultScattered(BaseModel):
    """An encrypted copy of the real database was split across the hospitals (real/scatter.py)."""
    snapshot_id: str
    bytes: int
    pieces: int
    replicas: int
    holders: list[str]
    key_threshold: int
    verified: bool
    seconds: float
    trigger: str = ""


class LabOrder(BaseModel):
    order_id: str
    urgency: Urgency
    test: str                      # e.g. "Crossmatch", "Troponin"
    from_hospital: str
    to_hospital: str | None
    status: OrderStatus
    eta_min: float | None = None


class ContinuityStats(BaseModel):
    stat_on_time_pct: float
    urgent_on_time_pct: float
    routine_on_time_pct: float
    unservable: int


class Reveal(BaseModel):
    shadow_session: str            # short id shown on screen, e.g. "7f3a"
    real_bytes: int = 0
    records_faked: int = 0
    honeytokens_touched: int = 0


DATA_MODELS: dict[str, type[BaseModel]] = {
    "run.started": RunStarted,
    "run.ended": RunEnded,
    "agent.thought": AgentThought,
    "agent.tool_call": AgentToolCall,
    "agent.tool_result": AgentToolResult,
    "agent.claim": AgentClaim,
    "request": Request,
    "policy.decision": PolicyDecision,
    "session.diverted": SessionDiverted,
    "honeytoken.minted": HoneytokenMinted,
    "honeytoken.touched": HoneytokenTouched,
    "breadcrumb.planted": BreadcrumbPlanted,
    "intent.update": IntentUpdate,
    "canary.check": CanaryCheck,
    "exfil": Exfil,
    "tamper.attempt": TamperAttempt,
    "node.status": NodeStatus,
    "keyshare.status": KeyshareStatus,
    "lab.order": LabOrder,
    "continuity.stats": ContinuityStats,
    "reveal": Reveal,
    "vault.scattered": VaultScattered,
}

# ---------------------------------------------------------------- envelope


class Event(BaseModel):
    id: str
    ts: int
    run_id: str
    session_id: str | None = None
    seq: int
    type: EventType
    actor: Actor
    hospital_id: str | None = None
    tier: Tier = "none"
    data: dict[str, Any]

    def validated(self) -> "Event":
        DATA_MODELS[self.type].model_validate(self.data)
        return self

    def to_json(self) -> str:
        return self.model_dump_json()


_seq = itertools.count(1)


def make_event(
    type: EventType,
    data: BaseModel | dict[str, Any],
    *,
    run_id: str,
    actor: Actor,
    session_id: str | None = None,
    hospital_id: str | None = None,
    tier: Tier = "none",
    ts: int | None = None,
    seq: int | None = None,
) -> Event:
    """Build and validate an event. Use this everywhere instead of hand-built dicts."""
    payload = data.model_dump() if isinstance(data, BaseModel) else data
    ev = Event(
        id=uuid.uuid4().hex[:12],
        ts=ts if ts is not None else int(time.time() * 1000),
        run_id=run_id,
        session_id=session_id,
        seq=seq if seq is not None else next(_seq),
        type=type,
        actor=actor,
        hospital_id=hospital_id,
        tier=tier,
        data=payload,
    )
    return ev.validated()


# ---------------------------------------------------------------- world

WORLD_PATH = Path(__file__).resolve().parents[2] / "contracts" / "world.json"


def load_world() -> dict[str, Any]:
    return json.loads(WORLD_PATH.read_text())


# Hub endpoints every component uses (see contracts/README.md)
HUB_URL = os.environ.get("MJ_HUB_URL", "http://127.0.0.1:8002")
HUB_INGEST = HUB_URL + "/events"        # POST one event JSON or a list
HUB_WS = HUB_URL.replace("http", "ws", 1) + "/ws"  # UI subscribes here
