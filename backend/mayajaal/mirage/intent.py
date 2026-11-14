"""MIRAGE-lite intent filter: a per-session Bayesian filter over what a session is trying to do.

Hidden state per session: goal G in {benign, recon, exfil, tamper, disrupt} x stage S in
{recon, access, collect, act}. Every request the gateway sees becomes one observation (a category
plus a few flags) and the filter does a standard predict / update step:

  predict   goals are sticky. Each request an attack goal hands GOAL_DRIFT of its mass to the attack
            goals in prior proportion (attackers change plans; keeps the model humble) and a benign
            session turns hostile with prob BENIGN_TURN. Nothing drifts back to benign: only
            evidence can clear a session. Stages only move left to right: stay with prob
            1 - STAGE_ADVANCE, else advance one stage; "act" is absorbing.
  update    b(g, s) *= [P(category | g, s) ** w] * prod P(flag | g) ** TEMPER
            Requests are correlated, so evidence is tempered: w = TEMPER / sqrt(k) where k counts
            consecutive repeats of the same category (ten note reads are not ten independent clues).

P(category | g, s) is proportional to W[category][g] * M[category][s], normalised over categories.
W is the goal weight (columns normalised to 1) and M is the stage multiplier, which only applies to
attack goals (a benign clinician has no kill-chain stage). Hand-written table (relative weights):

    category          benign  recon  exfil  tamper  disrupt |  @recon  @access  @collect  @act
    list_ward           40      6      5      6       4     |    1       1        1        1
    list_large           4      5      8      4       3     |    1       1        2        1
    list_xhosp           1     14      9      5       6     |    2       1        1        0.5
    record_read         30      6      7     10       4     |    1       1        1.5      1
    doc_read             6      4     14      3       2     |    0.5     1        2        1
    fhir_meta            2      8      3      3       3     |    2       1        0.5      0.5
    bulk_export          0.3    4     12      2       3     |    0.5     1        2        1
    bulk_export_huge     0.1    2     14      1       3     |    0.5     0.5      2        1.5
    obs_write            2      1      1     22       4     |    0.5     0.5      1        2
    record_write         1      1      1      8       6     |    0.5     0.5      1        2
    delete               0.1    0.5    0.5    3      14     |    0.5     0.5      1        2
    portal_admin         1     14      5      5       7     |    2       2        0.5      0.5
    backup               0.2    7     12      2       6     |    1       2        2        1
    portal_network       0.2    8      2      2      10     |    2       1        0.5      1
    login                4      2      2      2       2     |    1       2        0.5      0.5
    login_fail           0.5    4      2      2       3     |    1       2        0.5      0.5
    discovery            0.5   12      4      4       6     |    2       1        0.5      0.5
    cred_access          0.2    6      6      6       6     |    1       2        1        0.5
    collection           0.3    3     12      2       2     |    0.5     0.5      2        1
    exfil_channel        0.1    1     12      1       2     |    0.5     0.5      1        2
    impact               0.1    0.5    1      2      14     |    0.5     0.5      0.5      2
    other                5      5      4      4       4     |    1       1        1        1

Flags, P(flag | goal) per request. Only a PRESENT flag is evidence (touches and denials are rare
events; their absence on one request says almost nothing, so it is treated as uninformative):

    flag              benign  recon  exfil  tamper  disrupt
    denied             0.02   0.10   0.08   0.08    0.08
    honeytoken         0.002  0.06   0.15   0.06    0.05

Breadcrumb engagement (features {"breadcrumb": kind, "engaged": bool}) is a proper binary
observation using P(engage | goal, kind) from mirage/model.py. The live gateway never sees it
directly (a breadcrumb engagement shows up as a honeytoken touch); the offline evaluation uses it.

Categories come from an HTTP request (features_from_request):
    fhir   GET  /fhir/Patient?hospital=<own>&_count<=50     list_ward     (51..100 -> list_large)
           GET  /fhir/Patient?hospital=<other|*> or /fhir/Observation with no patient   list_xhosp
           GET  /fhir/Patient/{mrn}, /fhir/Observation?patient=, Condition, ...   record_read
           GET  /fhir/DocumentReference...                    doc_read
           _count 101..999 -> bulk_export, _count >= 1000 or $export -> bulk_export_huge
           POST/PUT/PATCH /fhir/Observation -> obs_write, other writes -> record_write, DELETE -> delete
           /fhir/metadata, /fhir/Organization                 fhir_meta
    portal /portal/backups or any backup/dump path -> backup, /portal/network -> portal_network,
           any other /portal page -> portal_admin
    api    /auth/login -> login / login_fail (status >= 400)
    anything else falls back to its MITRE technique (discovery, cred_access, collection,
    exfil_channel, impact, record_write) or "other".
    status 401/403 sets the `denied` flag; honeytoken_touched sets the `honeytoken` flag.

This is a hand-built model for a demo, not a trained classifier. Numbers are judgement calls.
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import math
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Iterator, Mapping
from urllib.parse import parse_qsl, unquote

from mayajaal.contracts import Event, make_event
from mayajaal.mirage.model import ENGAGE, GOALS, STAGES, normalize, parse_table

if TYPE_CHECKING:     # type only; never imported at runtime
    from mayajaal.real.policy import LaneAdjuster, PolicyInput

# --------------------------------------------------------------------------- model parameters

PRIOR: dict[str, float] = {"benign": 0.80, "recon": 0.08, "exfil": 0.05, "tamper": 0.04, "disrupt": 0.03}
STAGE_PRIOR: tuple[float, ...] = (0.70, 0.20, 0.08, 0.02)
GOAL_DRIFT = 0.04     # per request, an attack goal hands this much mass to the attack goals (by prior)
BENIGN_TURN = 0.005   # per request, a benign session may turn hostile (stolen session, insider)
STAGE_ADVANCE = 0.15
TEMPER = 0.7          # requests are correlated, so each counts as 0.7 of an independent observation
                      # (likelihood ** TEMPER); the k-th consecutive repeat of a category counts 1/sqrt(k) of that
EMIT_DELTA = 0.05

_CAT_ROWS = parse_table(__doc__, "category")
CATEGORIES: tuple[str, ...] = tuple(_CAT_ROWS)
_W = {c: dict(zip(GOALS, row[:5])) for c, row in _CAT_ROWS.items()}
_M = {c: dict(zip(STAGES, row[5:9])) for c, row in _CAT_ROWS.items()}
FLAGS: dict[str, dict[str, float]] = {f: dict(zip(GOALS, row)) for f, row in parse_table(__doc__, "flag").items()}


def _build_likelihood() -> dict[tuple[str, str], dict[str, float]]:
    """LIK[(goal, stage)][category] = P(category | goal, stage)."""
    col = {g: sum(_W[c][g] for c in CATEGORIES) for g in GOALS}
    out: dict[tuple[str, str], dict[str, float]] = {}
    for g in GOALS:
        for s in STAGES:
            raw = {c: _W[c][g] / col[g] * (1.0 if g == "benign" else _M[c][s]) for c in CATEGORIES}
            z = sum(raw.values())
            out[(g, s)] = {c: v / z for c, v in raw.items()}
    return out


LIKELIHOOD = _build_likelihood()

# --------------------------------------------------------------------------- features from HTTP

BULK_LIMIT = 100
HUGE_BULK = 1000
HOSPITAL_PARAMS = ("hospital", "hospital_id", "organization", "_hospital", "facility")
_PER_PATIENT = {"Patient", "Observation", "Condition", "MedicationRequest", "AllergyIntolerance",
                "DiagnosticReport", "Encounter", "Procedure", "Immunization"}
_TECH: tuple[tuple[str, str], ...] = (
    ("T1565", "record_write"),
    ("T1485", "impact"), ("T1489", "impact"), ("T1490", "impact"), ("T1486", "impact"), ("T1499", "impact"),
    ("T1048", "exfil_channel"), ("T1041", "exfil_channel"), ("T1567", "exfil_channel"),
    ("T1005", "collection"), ("T1119", "collection"), ("T1213", "collection"), ("T1560", "collection"),
    ("T1530", "collection"),
    ("T1552", "cred_access"), ("T1078", "cred_access"), ("T1110", "cred_access"), ("T1555", "cred_access"),
    ("T1083", "discovery"), ("T1082", "discovery"), ("T1087", "discovery"), ("T1595", "discovery"),
    ("T1018", "discovery"), ("T1046", "discovery"), ("T1069", "discovery"), ("T1021", "discovery"),
)


def _int(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _technique_category(technique: str | None) -> str | None:
    if not technique:
        return None
    t = technique.upper()
    return next((c for prefix, c in _TECH if t.startswith(prefix)), None)


def features_from_request(method: str, path: str, query: Mapping[str, str] | str | None = None,
                          status: int = 200, surface: str | None = None, technique: str | None = None,
                          honeytoken_touched: bool = False, own_hospital: str | None = None) -> dict:
    """Turn one HTTP request into the filter's observation features.

    Returns {"category", "surface", "method", "count", "status", "denied", "honeytoken", "technique"}.
    `own_hospital` (the caller's hospital id) lets us tell a ward list from cross-hospital enumeration.
    """
    method = (method or "GET").upper()
    raw = unquote(path or "/")
    if "?" in raw:
        raw, qs = raw.split("?", 1)
        q = dict(parse_qsl(qs))
    else:
        q = {}
    if isinstance(query, str):
        q.update(dict(parse_qsl(query.lstrip("?"))))
    elif query:
        q.update({str(k): str(v) for k, v in query.items()})
    low = raw.lower()
    count = _int(q.get("_count") or q.get("count") or q.get("limit"))
    if surface is None:
        surface = ("fhir" if low.startswith("/fhir") else "portal" if low.startswith("/portal")
                   else "shell" if low.startswith("/shell") else "api")

    cat = "other"
    backupish = any(k in low for k in ("backup", "db_dump", ".sql", "pg_dump"))
    if low.startswith("/fhir"):
        parts = [p for p in raw.split("/") if p]
        resource = parts[1] if len(parts) > 1 else ""
        has_id = len(parts) > 2
        if method == "DELETE":
            cat = "delete"
        elif method in ("POST", "PUT", "PATCH"):
            cat = "obs_write" if resource == "Observation" else "record_write"
        elif "$export" in raw or (count is not None and count >= HUGE_BULK):
            cat = "bulk_export_huge"
        elif count is not None and count > BULK_LIMIT:
            cat = "bulk_export"
        elif resource == "DocumentReference":
            cat = "doc_read"
        elif resource in ("metadata", "Organization", "") or resource.startswith("$"):
            cat = "fhir_meta"
        elif resource in _PER_PATIENT:
            patient = next((q[k] for k in ("patient", "subject", "mrn", "patient_id") if q.get(k)), None)
            if has_id or patient:
                cat = "record_read"
            elif resource != "Patient":
                cat = "list_xhosp"                                   # labs with no patient: citywide list
            else:
                hf = next((q[k] for k in HOSPITAL_PARAMS if q.get(k)), None)
                if hf and "/" in hf:
                    hf = hf.rsplit("/", 1)[-1]
                cross = hf is not None and (hf in ("*", "all") or (own_hospital is not None and hf != own_hospital))
                if cross:
                    cat = "list_xhosp"
                elif count is not None and count > 50:
                    cat = "list_large"
                else:
                    cat = "list_ward"
        else:
            cat = _technique_category(technique) or "other"
    elif low.startswith("/portal"):
        cat = "backup" if "backup" in low else "portal_network" if "network" in low else "portal_admin"
    elif backupish:
        cat = "backup"
    elif low.startswith("/auth/login"):
        cat = "login_fail" if status >= 400 else "login"
    else:
        cat = _technique_category(technique) or ("discovery" if surface == "shell" else "other")

    return {"category": cat, "surface": surface, "method": method, "count": count, "status": status,
            "denied": status in (401, 403) and not cat.startswith("login"),
            "honeytoken": bool(honeytoken_touched), "technique": technique}


# --------------------------------------------------------------------------- state

_PHRASES: dict[str, str] = {
    "list_ward": "Ward-sized patient list at the caller's own hospital.",
    "list_large": "Unusually large patient list{n}.",
    "list_xhosp": "Cross-hospital patient listing.",
    "record_read": "Single patient record read.",
    "doc_read": "Clinical note read (DocumentReference).",
    "fhir_meta": "FHIR capability / organisation discovery.",
    "bulk_export": "Bulk export{n} from an interactive session.",
    "bulk_export_huge": "Bulk export{n} from an interactive session.",
    "obs_write": "Write to a lab result (Observation).",
    "record_write": "Write to a clinical record.",
    "delete": "Delete request on clinical data.",
    "portal_admin": "Admin portal request.",
    "backup": "Backup jobs / database dumps requested.",
    "portal_network": "Inter-hospital network page viewed.",
    "login": "Sign-in.",
    "login_fail": "Failed sign-in.",
    "discovery": "Discovery activity{t}.",
    "cred_access": "Credential access{t}.",
    "collection": "Data collection{t}.",
    "exfil_channel": "Exfiltration channel{t}.",
    "impact": "Service / data impact{t}.",
    "other": "Request with no clear clinical purpose.",
}


@dataclass
class IntentState:
    posterior: dict[str, float]
    top_goal: str
    stage: str
    evidence: str = ""
    stage_posterior: dict[str, float] = field(default_factory=dict)
    observations: int = 0

    def header(self) -> str:
        return posterior_header(self.posterior)


@dataclass
class _Session:
    belief: dict[tuple[str, str], float]
    n: int = 0
    evidence: str = "No requests yet."
    state: IntentState | None = None
    last_emitted: dict[str, float] | None = None
    last_top: str | None = None
    doc_reads: int = 0
    last_category: str | None = None
    repeat: int = 1


def _initial_belief(prior: Mapping[str, float]) -> dict[tuple[str, str], float]:
    return {(g, s): prior[g] * sp for g in GOALS for s, sp in zip(STAGES, STAGE_PRIOR)}


_CURRENT: contextvars.ContextVar[str | None] = contextvars.ContextVar("mj_intent_session", default=None)


class IntentFilter:
    """Per-session Bayesian goal filter. Not thread-safe; the gateway is a single event loop."""

    def __init__(self, prior: Mapping[str, float] | None = None, *, drift: float = GOAL_DRIFT, turn: float = BENIGN_TURN,
                 advance: float = STAGE_ADVANCE, temper: float = TEMPER, max_sessions: int = 4096) -> None:
        self.prior = normalize(prior or PRIOR)
        self.temper = temper
        self.drift = drift
        self.turn = turn
        za = sum(self.prior[g] for g in GOALS if g != "benign")
        self._pa = {g: self.prior[g] / za for g in GOALS if g != "benign"}
        self.advance = advance
        self.max_sessions = max_sessions
        self._sessions: OrderedDict[str, _Session] = OrderedDict()

    # ---------------------------------------------------------------- sessions
    def _session(self, sid: str) -> _Session:
        s = self._sessions.get(sid)
        if s is None:
            s = _Session(belief=_initial_belief(self.prior))
            self._sessions[sid] = s
            while len(self._sessions) > self.max_sessions:
                self._sessions.popitem(last=False)
        else:
            self._sessions.move_to_end(sid)
        return s

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def peek(self, session_id: str) -> IntentState | None:
        """Current state, or None if the session has not been observed yet."""
        s = self._sessions.get(session_id)
        return s.state if s is not None else None

    def state(self, session_id: str) -> IntentState:
        st = self.peek(session_id)
        return st if st is not None else self._summarise(_Session(belief=_initial_belief(self.prior)))

    @contextlib.contextmanager
    def bind(self, session_id: str | None) -> Iterator[None]:
        """Tell the lane adjuster which session the policy engine is deciding for."""
        tok = _CURRENT.set(session_id)
        try:
            yield
        finally:
            _CURRENT.reset(tok)

    # ---------------------------------------------------------------- filter
    def _predict(self, b: dict[tuple[str, str], float]) -> dict[tuple[str, str], float]:
        goal_m = {g: sum(b[(g, s)] for s in STAGES) for g in GOALS}
        attack_m = 1.0 - goal_m["benign"]
        out: dict[tuple[str, str], float] = {}
        for g in GOALS:
            # stage marginal within this goal, advanced one step
            within = [b[(g, s)] / goal_m[g] if goal_m[g] > 0 else sp for s, sp in zip(STAGES, STAGE_PRIOR)]
            moved = [0.0] * len(STAGES)
            for i, p in enumerate(within):
                if i == len(STAGES) - 1:
                    moved[i] += p
                else:
                    moved[i] += p * (1 - self.advance)
                    moved[i + 1] += p * self.advance
            if g == "benign":
                kept, inflow = goal_m[g] * (1 - self.turn), 0.0
            else:
                kept, inflow = goal_m[g] * (1 - self.drift), (attack_m * self.drift
                                                                + goal_m["benign"] * self.turn) * self._pa[g]
            for i, s in enumerate(STAGES):
                # kept mass advances through the stages; switched-in mass starts at the stage prior
                out[(g, s)] = kept * moved[i] + inflow * STAGE_PRIOR[i]
        return out

    def _likelihood(self, g: str, s: str, features: Mapping[str, Any], repeat: int = 1) -> float:
        lik = 1.0
        cat = features.get("category")
        if cat:
            lik *= LIKELIHOOD[(g, s)].get(cat, LIKELIHOOD[(g, s)]["other"]) ** (self.temper / math.sqrt(repeat))
        for flag, table in FLAGS.items():
            if features.get(flag):
                lik *= table[g] ** self.temper
        kind = features.get("breadcrumb")
        if kind in ENGAGE and features.get("engaged") is not None:
            pe = ENGAGE[kind][g]
            lik *= pe if features["engaged"] else 1.0 - pe
        return lik

    def observe(self, session_id: str, features: Mapping[str, Any]) -> IntentState:
        s = self._session(session_id)
        cat = features.get("category")
        s.repeat = s.repeat + 1 if cat and cat == s.last_category else 1
        s.last_category = cat
        b = self._predict(s.belief)
        post = {k: v * self._likelihood(k[0], k[1], features, s.repeat) for k, v in b.items()}
        z = sum(post.values())
        if z <= 0 or not math.isfinite(z):        # impossible observation: keep the predicted belief
            post, z = b, sum(b.values())
        s.belief = {k: v / z for k, v in post.items()}
        s.n += 1
        if features.get("category") == "doc_read":
            s.doc_reads += 1
        s.evidence = self._evidence(features, s)
        s.state = self._summarise(s)
        return s.state

    def observe_request(self, session_id: str, method: str, path: str, query: Any = None, status: int = 200,
                        surface: str | None = None, technique: str | None = None,
                        honeytoken_touched: bool = False, own_hospital: str | None = None) -> IntentState:
        return self.observe(session_id, features_from_request(method, path, query, status, surface, technique,
                                                              honeytoken_touched, own_hospital))

    def _summarise(self, s: _Session) -> IntentState:
        post = {g: sum(s.belief[(g, st)] for st in STAGES) for g in GOALS}
        top = max(GOALS, key=lambda g: post[g])
        attack = {st: sum(s.belief[(g, st)] for g in GOALS if g != "benign") for st in STAGES}
        stage_post = normalize(attack, STAGES)
        stage = max(STAGES, key=lambda st: stage_post[st])
        return IntentState(posterior=post, top_goal=top, stage=stage, evidence=s.evidence,
                           stage_posterior=stage_post, observations=s.n)

    def _evidence(self, f: Mapping[str, Any], s: _Session) -> str:
        cat = f.get("category") or "other"
        n = f" ({f['count']})" if f.get("count") else ""
        t = f" ({f['technique']})" if f.get("technique") else ""
        text = _PHRASES.get(cat, _PHRASES["other"]).format(n=n, t=t) if cat in _PHRASES else ""
        if cat == "doc_read" and s.doc_reads > 1:
            text = f"Clinical note read #{s.doc_reads} (DocumentReference)."
        if f.get("denied"):
            text += " Denied."
        if f.get("honeytoken"):
            text += " Honeytoken touched."
        kind = f.get("breadcrumb")
        if kind and f.get("engaged") is not None:
            text += f" {'Took' if f['engaged'] else 'Ignored'} the {kind.replace('_', ' ')} breadcrumb."
        return text.strip()

    # ---------------------------------------------------------------- events
    def maybe_event(self, session_id: str, *, run_id: str, hospital_id: str | None = None,
                    force: bool = False) -> Event | None:
        """intent.update for this session if the posterior moved meaningfully since the last one."""
        s = self._sessions.get(session_id)
        if s is None or s.state is None:
            return None
        ev = intent_event(s.state, run_id=run_id, session_id=session_id, hospital_id=hospital_id,
                          last=s.last_emitted, last_top=s.last_top, force=force)
        if ev is not None:
            s.last_emitted = dict(s.state.posterior)
            s.last_top = s.state.top_goal
        return ev

    def header(self, session_id: str) -> str:
        return posterior_header(self.state(session_id).posterior)


# --------------------------------------------------------------------------- helpers


def rounded(posterior: Mapping[str, float], digits: int = 3) -> dict[str, float]:
    """Round to `digits` and make the result sum to exactly 1 (residual goes on the top goal)."""
    p = normalize(posterior)
    r = {g: round(p[g], digits) for g in GOALS}
    top = max(GOALS, key=lambda g: p[g])
    r[top] = round(1.0 - sum(v for g, v in r.items() if g != top), digits)
    return r


def moved_meaningfully(new: Mapping[str, float], last: Mapping[str, float] | None,
                       last_top: str | None = None, delta: float = EMIT_DELTA) -> bool:
    if last is None:
        return True
    new_top = max(GOALS, key=lambda g: new.get(g, 0.0))
    old_top = last_top or max(GOALS, key=lambda g: last.get(g, 0.0))
    return new_top != old_top or any(abs(new.get(g, 0.0) - last.get(g, 0.0)) > delta for g in GOALS)


def intent_event(state: IntentState, *, run_id: str, session_id: str, hospital_id: str | None = None,
                 last: Mapping[str, float] | None = None, last_top: str | None = None,
                 force: bool = False) -> Event | None:
    """Build an `intent.update` event, or None when the posterior has not moved meaningfully since
    `last` (top goal unchanged and no probability moved by more than EMIT_DELTA)."""
    if not force and not moved_meaningfully(state.posterior, last, last_top):
        return None
    data = {"posterior": rounded(state.posterior), "top_goal": state.top_goal, "stage": state.stage,
            "evidence": state.evidence[:300]}
    return make_event("intent.update", data, run_id=run_id, actor="defender", session_id=session_id,
                      hospital_id=hospital_id, tier="none")


def posterior_header(posterior: Mapping[str, float]) -> str:
    """Compact JSON for the X-MJ-Posterior header, e.g. {"benign":0.05,"recon":0.1,...}."""
    return json.dumps(rounded(posterior), separators=(",", ":"))


# --------------------------------------------------------------------------- lane adjuster

LANE_ORDER: dict[str, int] = {"normal": 0, "suspicious": 1, "attacker": 2}
SUSPICIOUS_BELOW = 0.35
ATTACKER_BELOW = 0.10


def make_lane_adjuster(intent: IntentFilter, *, session_of: Callable[[Any], str | None] | None = None,
                       suspicious_below: float = SUSPICIOUS_BELOW,
                       attacker_below: float = ATTACKER_BELOW) -> "LaneAdjuster":
    """A LaneAdjuster for policy.decide(): raise the lane to suspicious when P(benign) < 0.35 and to
    attacker when P(benign) < 0.10. Never lowers a lane; never touches the "unauth" lane.

    Which session? `session_of(inp)` if given, else the session bound with `intent.bind(session_id)`
    around the decide() call. The posterior used is the one after the session's previous request.
    """

    def adjust(inp: "PolicyInput", lane: str, reason: str) -> tuple[str, str] | None:
        if lane not in LANE_ORDER:
            return None
        sid = session_of(inp) if session_of is not None else _CURRENT.get()
        if not sid:
            return None
        st = intent.peek(sid)
        if st is None:
            return None
        pb = st.posterior["benign"]
        target = "attacker" if pb < attacker_below else "suspicious" if pb < suspicious_below else None
        if target is None or LANE_ORDER[target] <= LANE_ORDER[lane]:
            return None
        why = (f"Intent model: P(benign) {pb:.2f}, likely {st.top_goal} "
               f"({st.posterior[st.top_goal]:.0%}).")
        return target, (f"{reason} {why}".strip() if reason else why)

    return adjust


__all__ = ["IntentFilter", "IntentState", "features_from_request", "intent_event", "make_lane_adjuster",
           "posterior_header", "rounded", "CATEGORIES", "LIKELIHOOD", "PRIOR"]
