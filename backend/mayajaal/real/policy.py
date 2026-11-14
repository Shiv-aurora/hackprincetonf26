"""Policy engine: which lane is this session in, and which tier (if any) serves this request?

Pure functions only, no I/O. The gateway gathers the facts (PolicyInput) and acts on the Decision.

    classify(method, path, query, body)   -> Classified   what kind of request is this?
    decide(PolicyInput, adjust=None)       -> Decision     lane + action + reason

Three steps in decide():
  1. LANE.   Start from the session's current lane (lanes only go up). Unauthenticated callers are
             "unauth"; a session that touched a honeytoken is "attacker". Then each request can raise
             the lane through SIGNALS (a nurse opening a shell, cross-hospital enumeration, ...).
  2. ADJUST. Optional hook for the intent model (mirage): it may raise or lower the lane.
  3. ACTION. Look up ACTIONS[config mode][kind][lane]. A few documented special cases sit on top.

Hard rules this table encodes (see DESIGN.md §5):
  - A clinical read is NEVER served fake data. A suspicious session gets step_up (401), an attacker
    session gets deny (403). Only reads of records that don't exist in the real tier (e.g. a shadow
    honeytoken MRN) may go to the shadow tier, because no real patient's data is replaced.
  - Shell, backups, admin, bulk export, cross-hospital enumeration and lab writes from a suspicious
    or attacker session are diverted to the shadow tier (mayajaal and static configs).
  - Diversion is sticky for every non-clinical surface.
  - baseline never diverts: shell and backups are served from the real tier (the vulnerability).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Literal, Mapping
from urllib.parse import unquote

from mayajaal.contracts import ConfigId, Lane, PolicyAction, Surface

Kind = Literal[
    "clinical_read",    # one patient's record or labs
    "clinical_list",    # a patient list (ward list if it's the caller's own hospital)
    "clinical_write",   # POST/PUT/PATCH/DELETE on clinical data (tamper attempts land here)
    "bulk_export",      # _count > BULK_LIMIT or $export
    "admin",            # admin portal
    "shell",            # jump-box shell (WS /shell, POST /shell/exec)
    "backup",           # anything touching backups / dumps
    "other",
]

BULK_LIMIT = 100
ADMIN_ROLES = {"it_admin"}
LAB_WRITERS = {"lab_tech", "service", "physician"}
MRN_RE = re.compile(r"MRN-[A-Za-z0-9-]+")
HOSPITAL_PARAMS = ("hospital", "hospital_id", "organization", "_hospital", "facility")
BACKUP_RE = re.compile(r"/mnt/backups|backup|db_dump|\.sql(\.gz)?\b|pg_dump", re.I)
LANE_ORDER: dict[str, int] = {"normal": 0, "suspicious": 1, "attacker": 2}


@dataclass(frozen=True)
class Classified:
    surface: Surface
    kind: Kind
    target_mrn: str | None = None
    hospital_filter: str | None = None   # explicit hospital filter on a list ("*" = all)
    count: int | None = None
    command: str | None = None           # shell command, when we can see it


@dataclass(frozen=True)
class PolicyInput:
    config: ConfigId
    req: Classified
    authenticated: bool = True
    role: str = ""
    hospital_id: str = ""                # caller's own hospital
    target_hospital: str | None = None   # hospital of the record touched (resolved by the gateway)
    target_exists: bool = True           # does the target record exist in the REAL tier?
    lane: Lane = "normal"                # session lane before this request
    diverted: bool = False               # session already diverted (sticky)
    honeytoken_touched: bool = False


@dataclass(frozen=True)
class Decision:
    lane: Lane
    action: PolicyAction
    reason: str
    rule: str = ""

    @property
    def tier(self) -> str:
        return {"allow_real": "real", "divert_shadow": "shadow"}.get(self.action, "none")


LaneAdjuster = Callable[[PolicyInput, Lane, str], "tuple[Lane, str] | None"]
"""Intent-model hook: (input, lane so far, reason so far) -> (new lane, reason) or None to keep."""


# --------------------------------------------------------------------------- classification


def _int(v: str | None) -> int | None:
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None


def _command_from_body(body: str) -> str:
    import json

    try:
        data = json.loads(body)
    except (ValueError, TypeError):
        return body.strip()
    if isinstance(data, dict):
        for k in ("cmd", "command", "input", "data", "line"):
            if isinstance(data.get(k), str):
                return data[k].strip()
    return body.strip() if isinstance(body, str) else ""


def classify(method: str, path: str, query: Mapping[str, str] | None = None, body: str = "") -> Classified:
    """Map a request to (surface, kind, target). Knows nothing about the caller."""
    q = {k: v for k, v in (query or {}).items()}
    method = method.upper()
    p = unquote(path or "/")
    low = p.lower()
    count = _int(q.get("_count") or q.get("count") or q.get("limit"))

    if low.startswith("/shell"):
        cmd = _command_from_body(body) if body else None
        kind: Kind = "backup" if cmd and BACKUP_RE.search(cmd) else "shell"
        return Classified("shell", kind, command=cmd)

    if low.startswith("/portal"):
        return Classified("portal", "admin")

    if low.startswith("/fhir"):
        if "$export" in p or (count is not None and count > BULK_LIMIT):
            return Classified("fhir", "bulk_export", count=count)
        parts = [s for s in p.split("/") if s]           # ["fhir", "Patient", "MRN-1"...]
        resource = parts[1] if len(parts) > 1 else ""
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            mrn = _mrn_in(parts[2:], q)
            return Classified("fhir", "clinical_write", target_mrn=mrn)
        if resource == "Patient" and len(parts) >= 3:
            return Classified("fhir", "clinical_read", target_mrn=parts[2], count=count)
        if resource == "Patient":
            hf = next((q[k] for k in HOSPITAL_PARAMS if q.get(k)), None)
            if hf and "/" in hf:                          # organization=Organization/aur
                hf = hf.rsplit("/", 1)[-1]
            return Classified("fhir", "clinical_list", hospital_filter=hf, count=count)
        if resource == "Observation":
            mrn = _mrn_in(parts[2:], q)
            if mrn is None and len(parts) < 3:            # labs with no patient = a citywide lab list
                return Classified("fhir", "clinical_list", hospital_filter="*", count=count)
            return Classified("fhir", "clinical_read", target_mrn=mrn, count=count)
        return Classified("fhir", "other", count=count)

    if BACKUP_RE.search(low):
        return Classified("api", "backup")
    if "export" in low:
        return Classified("api", "bulk_export", count=count)
    return Classified("api", "other", count=count)


def _mrn_in(parts: list[str], q: Mapping[str, str]) -> str | None:
    for k in ("patient", "subject", "mrn", "patient_id"):
        if q.get(k):
            return q[k].rsplit("/", 1)[-1]
    for s in parts:
        if MRN_RE.fullmatch(s):
            return s
    return None


# --------------------------------------------------------------------------- the rule table

A, D, S, X = "allow_real", "divert_shadow", "step_up", "deny"

# ACTIONS[mode][kind] = {lane: action}. "mode" is "baseline" or "deceive" (mayajaal + static).
ACTIONS: dict[str, dict[str, dict[str, str]]] = {
    "deceive": {
        #                  normal        suspicious     attacker      unauth
        "clinical":       {"normal": A, "suspicious": S, "attacker": X, "unauth": X},
        "clinical_xhosp": {"normal": S, "suspicious": S, "attacker": X, "unauth": X},
        "clinical_ghost": {"normal": A, "suspicious": S, "attacker": D, "unauth": X},  # record not in real tier
        "sensitive":      {"normal": A, "suspicious": D, "attacker": D, "unauth": D},
        "other":          {"normal": A, "suspicious": A, "attacker": D, "unauth": D},
    },
    "baseline": {   # RBAC only. No deception, so nothing is ever diverted.
        "clinical":       {"normal": A, "suspicious": A, "attacker": A, "unauth": X},
        "clinical_xhosp": {"normal": A, "suspicious": A, "attacker": A, "unauth": X},
        "clinical_ghost": {"normal": A, "suspicious": A, "attacker": A, "unauth": X},
        "sensitive":      {"normal": A, "suspicious": A, "attacker": A, "unauth": X},
        "other":          {"normal": A, "suspicious": A, "attacker": A, "unauth": X},
    },
}
SENSITIVE_KINDS = {"shell", "backup", "admin", "bulk_export", "clinical_write"}


def _bucket(inp: PolicyInput) -> str:
    k = inp.req.kind
    if k in SENSITIVE_KINDS:
        return "sensitive"
    if k == "clinical_list":
        return "sensitive" if _is_cross_hospital(inp) else "clinical"     # enumeration is non-clinical
    if k == "clinical_read":
        if not inp.target_exists:
            return "clinical_ghost"
        return "clinical_xhosp" if _is_cross_hospital(inp) else "clinical"
    return "other"


def _is_cross_hospital(inp: PolicyInput) -> bool:
    if inp.req.kind == "clinical_list":
        hf = inp.req.hospital_filter
        return hf is not None and hf != inp.hospital_id      # no filter = the caller's ward list
    return inp.target_hospital is not None and inp.target_hospital != inp.hospital_id


def _signal(inp: PolicyInput) -> tuple[Lane, str] | None:
    """Does THIS request make the session suspicious? (lane, reason) or None."""
    r, role = inp.req, inp.role or "unknown"
    if r.kind in ("shell", "backup") and role not in ADMIN_ROLES:
        what = "Backup access" if r.kind == "backup" else "Interactive shell"
        return "suspicious", f"{what} from a {role} account has no clinical use."
    if r.kind == "admin" and role not in ADMIN_ROLES:
        return "suspicious", f"{role.capitalize()} role requesting the admin portal."
    if r.kind == "bulk_export" and role != "service":
        n = f" ({r.count})" if r.count else ""
        return "suspicious", f"Bulk export{n} from an interactive {role} session."
    if r.kind == "clinical_list" and _is_cross_hospital(inp):
        where = "every hospital" if inp.req.hospital_filter == "*" else inp.req.hospital_filter
        return "suspicious", f"Cross-hospital enumeration: {role} at {inp.hospital_id} listing {where}."
    if r.kind == "clinical_read" and inp.target_exists and _is_cross_hospital(inp):
        return "suspicious", f"Cross-hospital record read: {role} at {inp.hospital_id}, record at {inp.target_hospital}."
    if r.kind == "clinical_write" and role not in LAB_WRITERS:
        return "suspicious", f"Lab result write from a {role} account."
    return None


def decide(inp: PolicyInput, adjust: LaneAdjuster | None = None) -> Decision:
    mode = "baseline" if inp.config == "baseline" else "deceive"

    # 1. lane
    if not inp.authenticated:
        lane: Lane = "attacker" if inp.honeytoken_touched else "unauth"
        reason = "Session touched a honeytoken." if inp.honeytoken_touched else "No valid session token."
    else:
        lane = "attacker" if inp.honeytoken_touched else inp.lane
        reason = "Session touched a honeytoken." if inp.honeytoken_touched else ""
        sig = _signal(inp)
        if sig and LANE_ORDER.get(sig[0], 0) > LANE_ORDER.get(lane, 0):
            lane, reason = sig
        elif sig and not reason:
            reason = sig[1]

    # 2. intent model hook
    if adjust is not None:
        adj = adjust(inp, lane, reason)
        if adj is not None:
            lane, reason = adj

    # 3. action
    bucket = _bucket(inp)
    action = ACTIONS[mode][bucket][lane]
    rule = f"{mode}/{bucket}/{lane}"

    if mode == "deceive":
        # RBAC first contact: a non-admin opening the admin portal from a clean session is simply
        # denied (and becomes suspicious). If they keep pushing, they get the shadow portal.
        if (inp.req.kind == "admin" and inp.role not in ADMIN_ROLES and inp.authenticated
                and inp.lane == "normal" and not inp.diverted and lane == "suspicious"):
            action, rule = X, "deceive/admin/first-contact"
        # Sticky diversion for every non-clinical surface.
        elif inp.diverted and bucket in ("sensitive", "other") and action == A:
            action, rule = D, f"deceive/{bucket}/sticky"
        # A diverted session asking for a record that only exists in the shadow (a honeytoken MRN).
        elif bucket == "clinical_ghost" and inp.diverted and lane != "unauth":
            action, rule = D, "deceive/clinical_ghost/diverted"
    else:
        if inp.req.kind == "admin" and inp.role not in ADMIN_ROLES:
            action, rule = X, "baseline/admin/rbac"

    if not reason:
        reason = _default_reason(inp, bucket, action, lane)
    if action == S:
        reason += " Step-up authentication required; no data served."
    elif action == X and bucket.startswith("clinical") and lane in ("suspicious", "attacker"):
        reason += " Clinical data is never faked: denied."
    return Decision(lane=lane, action=action, reason=reason, rule=rule)


def _default_reason(inp: PolicyInput, bucket: str, action: str, lane: str) -> str:
    if action == D and inp.diverted:
        return "Diverted session stays in the shadow tier."
    if action == X and not inp.authenticated:
        return "Authentication required."
    if action in (S, X, D) and lane in ("suspicious", "attacker"):
        return f"Session is in the {lane} lane."
    if bucket == "clinical":
        return "Ward list read within care team." if inp.req.kind == "clinical_list" else "Clinician read within care team."
    if inp.config == "baseline":
        return "Role-based access allows it (baseline: no deception)."
    return "Within role."


# --------------------------------------------------------------------------- MITRE ATT&CK mapping

_SHELL_TECHNIQUES: list[tuple[re.Pattern, str]] = [(re.compile(p, re.I), t) for p, t in [
    (r"bash_history|\bhistory\b", "T1552.003"),
    (r"\b(scp|rsync|curl|wget|nc|ncat|ftp|sftp)\b", "T1048"),
    (r"credentials|\.env\b|passwd|/etc/shadow|id_rsa|\.pgpass|secret", "T1552.001"),
    (r"\b(tar|zip|gzip|base64|openssl)\b", "T1560"),
    (r"\b(zcat|cat|head|tail|less|more|grep|strings|psql)\b.*(backup|dump|\.sql)", "T1005"),
    (r"\b(rm|shred|truncate)\b", "T1485"),
    (r"systemctl\s+(stop|disable)|\bkill(all)?\b", "T1489"),
    (r"\b(sed|tee|echo|printf)\b.*>|update\s+\w+\s+set|insert\s+into", "T1565.001"),
    (r"\bssh\b", "T1021.004"),
    (r"\b(ls|find|tree|du|df|stat|locate)\b", "T1083"),
    (r"\b(whoami|id|hostname|uname|ps|netstat|ss|ifconfig|ip)\b", "T1082"),
]]


def technique(req: Classified, lane: Lane, path: str = "") -> str | None:
    """Simple ATT&CK id for the UI. Normal clinical traffic gets none."""
    if req.surface == "shell":
        if req.command:
            for rx, t in _SHELL_TECHNIQUES:
                if rx.search(req.command):
                    return t
            return "T1059.004"
        return "T1021.004"
    if lane == "unauth":
        return "T1595"
    k = req.kind
    if k == "admin":
        return "T1087.002" if "user" in path.lower() else "T1078"
    if k == "bulk_export":
        return "T1119"
    if k == "backup":
        return "T1005"
    if k == "clinical_write":
        return "T1565.001"
    if lane == "normal":
        return None
    if k == "clinical_list":
        return "T1087"
    if k == "clinical_read":
        return "T1213"
    return None


def shell_technique(command: str) -> str:
    return technique(Classified("shell", "shell", command=command or None), "suspicious") or "T1059.004"
