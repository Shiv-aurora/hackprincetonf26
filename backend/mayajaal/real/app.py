"""Gateway (:8000): the only port attackers and clinicians hit.

    uv run uvicorn mayajaal.real.app:app --port 8000

- POST /auth/login {username, password} -> {token, session_id}; Bearer auth afterwards.
- Every other request is classified, run through the policy engine (policy.py), then either served
  by the REAL tier (the surfaces router mounted on RealWorld, in-process), proxied to the SHADOW tier
  (http://127.0.0.1:8001, same path/query/body, plus X-MJ-* headers), or refused (step_up / deny).
- WS /shell is proxied to ws://127.0.0.1:8001/shell when diverted, else served locally.
- Every outgoing body and shell frame is scanned by the canary ledger.
- real.db is encrypted at rest (real/vault.py); RealStore decrypts in-process only for what the real
  tier serves. GET /_mj/vault (X-MJ-Admin) shows what is encrypted, key custody and a raw-bytes check.

Config: env MJ_CONFIG = baseline | static | mayajaal (default mayajaal), overridable per request
with header X-MJ-Config. X-MJ-Run sets the run id. X-MJ-Actor: clinician labels simulator traffic
(ground truth for the UI and the ledger; the policy engine never reads it).

Shadow -> gateway signal: a shadow response header `X-MJ-Honeytoken-Touched: <token_id>[,<id>...]`
(or, on WS, a text frame {"type": "mj.honeytoken", "token_id": ...}, which is swallowed) moves
the session to the attacker lane. X-MJ-* response headers are always stripped before the client.
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from fastapi import APIRouter, FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from mayajaal.contracts import Event, make_event
from mayajaal.mirage.intent import IntentFilter, features_from_request, make_lane_adjuster
from mayajaal.real.devices import HEADER as DEVICE_HEADER, verify as verify_device
from mayajaal.real.firstsight import FirstSight
from mayajaal.real.scatter import scatter as scatter_snapshot
from mayajaal.real.ledger import CanaryLedger
from mayajaal.real.policy import (
    LANE_ORDER,
    Classified, Decision, LaneAdjuster, PolicyInput, classify, decide, shell_technique, technique,
)
from mayajaal.real.world import RealStore, RealWorld
from mayajaal.world_api import HEADER_MAP, SessionContext

SHADOW_URL = os.environ.get("MJ_SHADOW_URL", "http://127.0.0.1:8001")
CONFIGS = ("baseline", "static", "mayajaal")
HONEYTOKEN_HEADER = "x-mj-honeytoken-touched"
HOP_HEADERS = {"host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade",
               "authorization", "cookie", "accept-encoding", "proxy-authorization", "te", "trailer"}
RESP_DROP = {"content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"}

Sink = Callable[..., Awaitable[None]]              # async (*events) -> None ; hub.client.emit fits
SurfacesFactory = Callable[[Callable[[SessionContext], Any], Callable[[Event], Awaitable[None]]], APIRouter]


def admin_key() -> str:
    """Key that unlocks /_mj/* and X-MJ-Decision debug headers (clinician sim, bench harness)."""
    env = os.environ.get("MJ_ADMIN_KEY")
    if env:
        return env
    from mayajaal.real.seed import DATA_DIR

    path = DATA_DIR / "admin.key"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(16))
        os.chmod(path, 0o600)
    return path.read_text().strip()


@dataclass
class GatewaySession:
    session_id: str
    token: str = ""
    username: str = ""
    role: str = ""
    hospital_id: str = ""
    run_id: str = "adhoc"
    config: str = "mayajaal"
    actor: str = "attacker"            # "clinician" only when labelled by the simulator
    authenticated: bool = True
    lane: str = "normal"
    diverted: bool = False
    honeytokens: set[str] = field(default_factory=set)
    created: float = field(default_factory=time.time)
    sighted: bool = False      # First Sight has flagged this session
    scattered: bool = False            # Scatter has run for this session
    current_config: str = "mayajaal"   # config of the request being served (RealWorld scoping)

    def context(self, run_id: str, lane: str) -> SessionContext:
        return SessionContext(session_id=self.session_id, run_id=run_id, username=self.username,
                              role=self.role, hospital_id=self.hospital_id or "eas", lane=lane)


# --------------------------------------------------------------------------- WS upstream adapter


class _WebsocketsUpstream:
    """Adapter over `websockets` so tests can swap in a fake with the same 4 members."""

    def __init__(self, url: str, headers: dict[str, str]) -> None:
        self.url, self.headers, self._cm, self.conn = url, headers, None, None
        self.handshake_headers: dict[str, str] = {}

    async def __aenter__(self) -> "_WebsocketsUpstream":
        from websockets.asyncio.client import connect

        self._cm = connect(self.url, additional_headers=self.headers, open_timeout=5, max_size=None)
        self.conn = await self._cm.__aenter__()
        resp = getattr(self.conn, "response", None)
        if resp is not None:
            self.handshake_headers = {k.lower(): v for k, v in resp.headers.raw_items()}
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._cm.__aexit__(*exc)

    async def send(self, data: str | bytes) -> None:
        await self.conn.send(data)

    def __aiter__(self):
        return self.conn.__aiter__()

    async def close(self) -> None:
        await self.conn.close()


WsConnect = Callable[[str, dict[str, str]], Any]


# --------------------------------------------------------------------------- gateway


class Gateway:
    def __init__(self, *, store: RealStore | None = None, sink: Sink | None = None,
                 surfaces_factory: SurfacesFactory | None = None, shadow_url: str = SHADOW_URL,
                 shadow_transport: httpx.AsyncBaseTransport | None = None,
                 shadow_ws_connect: WsConnect | None = None, default_config: str | None = None,
                 lane_adjuster: LaneAdjuster | None = None, admin_key_value: str | None = None) -> None:
        if sink is None:
            from mayajaal.hub.client import emit as sink
        self.sink = sink
        self.store = store or RealStore()
        self.ledger = CanaryLedger(self.store.canaries())
        cfg = (default_config or os.environ.get("MJ_CONFIG") or "mayajaal").lower()
        self.default_config = cfg if cfg in CONFIGS else "mayajaal"
        self.default_run = os.environ.get("MJ_RUN", "adhoc")
        self.shadow_url = shadow_url.rstrip("/")
        self.shadow = httpx.AsyncClient(base_url=self.shadow_url, transport=shadow_transport, timeout=30.0)
        self.ws_connect: WsConnect = shadow_ws_connect or _WebsocketsUpstream
        self.adjuster = lane_adjuster
        # First Sight (CUSUM over weak signals) runs under MayaJaal only; MJ_FIRST_SIGHT=0 turns it off.
        self.first_sight: FirstSight | None = None if os.environ.get("MJ_FIRST_SIGHT", "1") == "0" else FirstSight()
        self.admin_key = admin_key_value or admin_key()
        # Scatter: on detection, an encrypted split copy of the real DB goes out to the hospitals.
        self.scatter_on = os.environ.get("MJ_SCATTER", "1") != "0"
        self.last_scatter = 0.0
        self.by_token: dict[str, GatewaySession] = {}
        self.by_id: dict[str, GatewaySession] = {}
        self.surfaces_factory = surfaces_factory
        self.local_app = self._build_local_app()
        self.local = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.local_app),
                                       base_url="http://real.local", timeout=30.0)

    # ---------------------------------------------------------------- real tier (surfaces + RealWorld)
    def resolve_world(self, ctx: SessionContext) -> RealWorld:
        s = self.by_id.get(ctx.session_id)
        config = s.current_config if s else "mayajaal"
        scope = None if config == "baseline" else (s.hospital_id if s else ctx.hospital_id)
        return RealWorld(ctx.session_id, self.store, scope_hospital=scope)

    async def _sink_one(self, ev: Event) -> None:
        await self.sink(ev)

    def _build_local_app(self) -> FastAPI:
        inner = FastAPI(title="MayaJaal real tier surfaces")
        factory = self.surfaces_factory
        if factory is None:
            try:
                from mayajaal.surfaces import build_router as factory   # Agent C; wired at integration
            except ImportError:
                factory = None
        if factory is None:
            inner.include_router(_unwired_router())
        else:
            inner.include_router(factory(self.resolve_world, self._sink_one))
        return inner

    # ---------------------------------------------------------------- sessions
    def session_for(self, headers: Any, client: str, query: Any = None) -> GatewaySession:
        token = _bearer(headers) or (query.get("token") if query is not None else None)
        if token and token in self.by_token:
            return self.by_token[token]
        ua = headers.get("user-agent", "")
        run = headers.get("x-mj-run") or self.default_run
        sid = "anon-" + hashlib.sha256(f"{client}|{ua}|{run}".encode()).hexdigest()[:8]
        s = self.by_id.get(sid)
        if s is None:
            s = GatewaySession(session_id=sid, authenticated=False, lane="unauth", run_id=run,
                               config=self._config(headers, None), actor=_actor(headers))
            self.by_id[sid] = s
        return s

    def _config(self, headers: Any, s: GatewaySession | None) -> str:
        h = (headers.get("x-mj-config") or "").lower()
        if h in CONFIGS:
            return h
        return s.config if s else self.default_config

    def _run(self, headers: Any, s: GatewaySession) -> str:
        return headers.get("x-mj-run") or s.run_id or self.default_run

    def _is_admin(self, headers: Any) -> bool:
        k = headers.get("x-mj-admin")
        return bool(k) and secrets.compare_digest(k, self.admin_key)

    # ---------------------------------------------------------------- events
    async def _emit(self, *events: Event) -> None:
        if events:
            await self.sink(*events)

    def _ev(self, type_: str, data: dict, s: GatewaySession, run_id: str, *, actor: str, tier: str = "none") -> Event:
        return make_event(type_, data, run_id=run_id, actor=actor, session_id=s.session_id,
                          hospital_id=s.hospital_id or None, tier=tier)

    async def canary_check(self, s: GatewaySession, run_id: str) -> None:
        await self._emit(self._ev("canary.check", {"protected_total": self.ledger.total,
                                                   "leaked": self.ledger.leaked(run_id)},
                                  s, run_id, actor="defender"))

    async def scan_out(self, s: GatewaySession, run_id: str, payload: bytes | str | None) -> None:
        """Ledger: count protected canaries leaving the gateway (clinician traffic is not a leak)."""
        if s.actor == "clinician":
            return
        if self.ledger.record(run_id, self.ledger.scan(payload)):
            await self.canary_check(s, run_id)

    def touched(self, s: GatewaySession, value: str | None) -> bool:
        if not value:
            return False
        ids = {t.strip() for t in value.split(",") if t.strip()}
        s.honeytokens |= ids
        if ids:
            s.lane = "attacker"
        return bool(ids)

    # ---------------------------------------------------------------- policy
    def evaluate(self, s: GatewaySession, config: str, req: Classified) -> Decision:
        target_hospital, exists = None, True
        if req.target_mrn:
            target_hospital = self.store.patient_hospital(req.target_mrn)
            exists = target_hospital is not None
        inp = PolicyInput(
            config=config, req=req, authenticated=s.authenticated, role=s.role, hospital_id=s.hospital_id,
            target_hospital=target_hospital, target_exists=exists,
            lane=s.lane if s.authenticated else "normal", diverted=s.diverted,
            honeytoken_touched=bool(s.honeytokens))
        return decide(inp, self.adjuster)

    def maybe_scatter(self, s: GatewaySession, run_id: str, trigger: str) -> None:
        """Start a Scatter in the background, at most once per session and once a minute overall."""
        if (not self.scatter_on or s.config != "mayajaal" or s.scattered
                or s.actor == "clinician" or time.time() - self.last_scatter < 60):
            return
        s.scattered = True
        self.last_scatter = time.time()

        async def run() -> None:
            from mayajaal.real.vault import _key_shares_cfg
            try:
                holders, k = _key_shares_cfg()
                res = await asyncio.to_thread(scatter_snapshot, self.store.db_path, holders, k,
                                              self.store.db_path.parent / "nodes")
            except Exception as exc:  # noqa: BLE001
                print(f"[gateway] scatter failed: {exc!r}")
                return
            await self._emit(self._ev("vault.scattered", res.as_event(trigger), s, run_id,
                                      actor="defender", tier="real"))
        asyncio.get_running_loop().create_task(run())

    async def apply(self, s: GatewaySession, d: Decision, run_id: str) -> None:
        """Update session state from a decision and emit policy.decision / session.diverted."""
        if d.lane != "unauth":
            s.lane = d.lane
        events = [self._ev("policy.decision", {"lane": d.lane, "action": d.action, "reason": d.reason},
                           s, run_id, actor="defender", tier=d.tier)]
        if d.lane in ("suspicious", "attacker") and d.lane != "unauth":
            self.maybe_scatter(s, run_id, d.reason[:120])
        if d.action == "divert_shadow" and not s.diverted:
            s.diverted = True
            events.append(self._ev("session.diverted", {"from_tier": "real", "to_tier": "shadow",
                                                        "reason": d.reason}, s, run_id,
                                   actor="defender", tier="shadow"))
        await self._emit(*events)

    def mj_headers(self, s: GatewaySession, run_id: str, lane: str, config: str) -> dict[str, str]:
        ctx = s.context(run_id, lane)
        h = {HEADER_MAP[k]: str(getattr(ctx, k)) for k in HEADER_MAP}
        h["X-MJ-Config"] = config
        return h

    # ---------------------------------------------------------------- HTTP
    async def handle(self, request: Request, path: str) -> Response:
        body = await request.body()
        client = request.client.host if request.client else "?"
        s = self.session_for(request.headers, client)
        config = self._config(request.headers, s)
        run_id = self._run(request.headers, s)
        if s.actor != "clinician" and _actor(request.headers) == "clinician":
            s.actor = "clinician"
        req_path = "/" + path
        query = dict(request.query_params)
        req = classify(request.method, req_path, query, body.decode("utf-8", errors="ignore"))
        intent = getattr(self, "intent", None)
        sighted_now = self.first_sight_before(s, config, req)
        with (intent.bind(s.session_id) if intent is not None else contextlib.nullcontext()):
            d = self.evaluate(s, config, req)
        if s.sighted and d.lane == "suspicious" and d.reason.startswith("Session is in the"):
            tail = {"step_up": " Step-up authentication required; no data served.",
                    "divert_shadow": " Moved into the decoy."}.get(d.action, "")
            d = dataclasses.replace(d, reason=(sighted_now or "Flagged earlier by First Sight.") + tail)
        await self.apply(s, d, run_id)

        tier = d.tier
        new_touch = False
        if d.action in ("allow_real", "divert_shadow"):
            s.current_config = config
            headers = {k: v for k, v in request.headers.items()
                       if k.lower() not in HOP_HEADERS and not k.lower().startswith("x-mj-")}
            headers.update(self.mj_headers(s, run_id, d.lane, config))
            # Both tiers must build links from the public origin, never their own host:port.
            headers["X-Forwarded-Host"] = (request.headers.get("x-forwarded-host")
                                           or request.headers.get("host") or "")
            headers["X-Forwarded-Proto"] = (request.headers.get("x-forwarded-proto") or request.url.scheme)
            if intent is not None and d.action == "divert_shadow":
                headers["X-MJ-Posterior"] = intent.header(s.session_id)
            client_ = self.local if d.action == "allow_real" else self.shadow
            url = req_path + (("?" + request.url.query) if request.url.query else "")
            try:
                up = await client_.request(request.method, url, content=body, headers=headers)
                status, content, up_headers = up.status_code, up.content, up.headers
            except httpx.HTTPError as exc:
                status, content, up_headers = 502, json.dumps({"error": "bad_gateway"}).encode(), {}
                print(f"[gateway] upstream {tier} error: {exc!r}")
            if d.action == "divert_shadow":
                new_touch = bool(self.touched(s, up_headers.get(HONEYTOKEN_HEADER)))
            out_headers = {k: v for k, v in up_headers.items()
                           if k.lower() not in RESP_DROP and not k.lower().startswith("x-mj-")}
            resp = Response(content=content, status_code=status, headers=out_headers)
        elif d.action == "step_up":
            content = json.dumps({"error": "step_up_required",
                                  "message": "Additional verification required: re-authenticate with your "
                                             "badge and MFA to open this record."}).encode()
            status = 401
            resp = Response(content, 401, media_type="application/json",
                            headers={"WWW-Authenticate": 'Bearer error="insufficient_user_authentication"'})
        else:
            status = 401 if not s.authenticated else 403
            msg = "authentication required" if status == 401 else "forbidden"
            content = json.dumps({"error": msg}).encode()
            resp = Response(content, status, media_type="application/json")

        await self.scan_out(s, run_id, content)
        if self.first_sight is not None and s.authenticated:
            self.first_sight.after(s.session_id, status=status)

        method, shown = request.method, req_path + (("?" + request.url.query) if request.url.query else "")
        if req.surface == "shell" and req.command:
            method, shown = "EXEC", req.command[:200]
        await self._emit(self._ev("request", {
            "method": method, "path": shown, "surface": req.surface, "status": status,
            "bytes": len(content or b""), "technique": technique(req, d.lane, req_path), **client_meta(request)},
            s, run_id, actor=s.actor, tier=tier if status < 500 else "none"))

        if intent is not None and s.authenticated:
            intent.observe(s.session_id, features_from_request(
                request.method, req_path, query, status, surface=req.surface,
                technique=technique(req, d.lane, req_path), honeytoken_touched=new_touch,
                own_hospital=getattr(s, "hospital_id", None) or None))
            ev = intent.maybe_event(s.session_id, run_id=run_id, hospital_id=getattr(s, "hospital_id", None) or None)
            if ev is not None:
                await self._emit(ev)

        if self._is_admin(request.headers):
            resp.headers["X-MJ-Decision"] = d.action
            resp.headers["X-MJ-Lane"] = d.lane
            resp.headers["X-MJ-Tier"] = tier
            resp.headers["X-MJ-Rule"] = d.rule
        return resp

    # ---------------------------------------------------------------- First Sight
    def first_sight_before(self, s: GatewaySession, config: str, req: Classified) -> str | None:
        """Feed the First Sight test; if it has just fired, raise the lane and return the reason."""
        if self.first_sight is None or config != "mayajaal" or not s.authenticated:
            return None
        st = self.first_sight.before(s.session_id, target_patient=req.target_mrn if req.kind == "clinical_read" else None)
        return self._first_sight_fire(s, st)

    def _first_sight_fire(self, s: GatewaySession, st: Any) -> str | None:
        if st is None or not st.fired or s.sighted:
            return None
        s.sighted = True
        if LANE_ORDER.get(s.lane, 0) < LANE_ORDER["suspicious"]:
            s.lane = "suspicious"
        return st.reason

    # ---------------------------------------------------------------- login
    async def login(self, request: Request) -> Response:
        try:
            if "json" in request.headers.get("content-type", ""):
                creds = await request.json()
            else:
                creds = dict(await request.form())
        except Exception:  # noqa: BLE001
            creds = {}
        username, password = str(creds.get("username", "")), str(creds.get("password", ""))
        config = self._config(request.headers, None)
        run_id = request.headers.get("x-mj-run") or self.default_run
        actor = _actor(request.headers)

        user = await asyncio.to_thread(self.store.authenticate, username, password) if username else None
        if user is not None:
            s = self._new_session(username=user.username, role=user.role, hospital_id=user.hospital_id,
                                  run_id=run_id, config=config, actor=actor)
            await self._emit(self._ev("request", {"method": "POST", "path": "/auth/login", "surface": "api",
                                                  "status": 200, "bytes": 0,
                                                  "technique": None if actor == "clinician" else "T1078",
                                                  **client_meta(request)},
                                      s, run_id, actor=actor, tier="real"))
            if self.first_sight is not None and config == "mayajaal":
                meta = client_meta(request)
                device = verify_device(request.headers.get(DEVICE_HEADER))
                st = self.first_sight.on_login(s.session_id, username=user.username, role=user.role,
                                         ua=meta["user_agent"], ip=meta["client_ip"], managed=device is not None)
                why = self._first_sight_fire(s, st)
                if why:
                    self.maybe_scatter(s, run_id, why[:120])
                    await self._emit(self._ev("policy.decision", {
                        "lane": "suspicious", "action": "allow_real",
                        "reason": why + " Login allowed; clinical reads now need badge + MFA, everything else goes to the decoy."},
                        s, run_id, actor="defender", tier="real"))
            if actor != "clinician":
                await self.canary_check(s, run_id)
            return JSONResponse({"token": s.token, "session_id": s.session_id, "username": user.username,
                                 "role": user.role, "hospital_id": user.hospital_id})

        # Not a real user. In deception configs, the credential may be a shadow honeytoken
        # (e.g. a service password planted in a fake .bash_history): ask the shadow tier.
        if config != "baseline" and username:
            s = await self._honeytoken_login(request, username, password, config, run_id, actor)
            if s is not None:
                return JSONResponse({"token": s.token, "session_id": s.session_id, "username": s.username,
                                     "role": s.role, "hospital_id": s.hospital_id})
        if self.first_sight is not None:
            self.first_sight.on_failed_login(client_meta(request)["client_ip"])
        anon = self.session_for(request.headers, request.client.host if request.client else "?")
        await self._emit(self._ev("request", {"method": "POST", "path": "/auth/login", "surface": "api",
                                              "status": 401, "bytes": 0, "technique": "T1110",
                                              **client_meta(request)},
                                  anon, run_id, actor=actor, tier="real"))
        return JSONResponse({"error": "invalid credentials"}, status_code=401)

    def _new_session(self, **kw: Any) -> GatewaySession:
        s = GatewaySession(session_id=secrets.token_hex(4), token=secrets.token_urlsafe(24), **kw)
        self.by_token[s.token] = s
        self.by_id[s.session_id] = s
        return s

    async def _honeytoken_login(self, request: Request, username: str, password: str, config: str,
                                run_id: str, actor: str) -> GatewaySession | None:
        probe = GatewaySession(session_id=secrets.token_hex(4), username=username, role="", hospital_id="eas",
                               run_id=run_id, config=config, actor=actor, lane="attacker")
        try:
            up = await self.shadow.post("/auth/login", json={"username": username, "password": password},
                                        headers=self.mj_headers(probe, run_id, "attacker", config))
        except httpx.HTTPError:
            return None
        if up.status_code != 200 or not up.headers.get(HONEYTOKEN_HEADER):
            return None
        try:
            info = up.json()
        except ValueError:
            info = {}
        s = self._new_session(username=username, role=str(info.get("role") or "it_admin"),
                              hospital_id=str(info.get("hospital_id") or "eas"), run_id=run_id,
                              config=config, actor=actor)
        self.touched(s, up.headers.get(HONEYTOKEN_HEADER))
        s.diverted = True
        reason = "Login with a honeytoken credential."
        await self._emit(
            self._ev("policy.decision", {"lane": "attacker", "action": "divert_shadow", "reason": reason},
                     s, run_id, actor="defender", tier="shadow"),
            self._ev("session.diverted", {"from_tier": "real", "to_tier": "shadow", "reason": reason},
                     s, run_id, actor="defender", tier="shadow"),
            self._ev("request", {"method": "POST", "path": "/auth/login", "surface": "api", "status": 200,
                                 "bytes": len(up.content), "technique": "T1078", **client_meta(request)},
                     s, run_id, actor=actor, tier="shadow"))
        await self.canary_check(s, run_id)
        return s

    # ---------------------------------------------------------------- WS /shell
    async def shell(self, ws: WebSocket) -> None:
        client = ws.client.host if ws.client else "?"
        s = self.session_for(ws.headers, client, ws.query_params)
        config = self._config(ws.headers, s)
        run_id = self._run(ws.headers, s)
        req = Classified("shell", "shell")
        d = self.evaluate(s, config, req)
        await self.apply(s, d, run_id)

        if d.action in ("deny", "step_up"):
            status = 401 if (d.action == "step_up" or not s.authenticated) else 403
            await self._shell_event(s, run_id, "SSH", "/shell", status, "none", "T1021.004")
            await ws.close(code=4401 if status == 401 else 4403)
            return
        tier = d.tier
        await self._shell_event(s, run_id, "SSH", "/shell", 101, tier, "T1021.004")
        s.current_config = config
        headers = self.mj_headers(s, run_id, d.lane, config)
        if d.action == "divert_shadow":
            await self._shell_shadow(ws, s, run_id, headers)
        else:
            await self._shell_local(ws, s, run_id, headers)

    async def _shell_event(self, s: GatewaySession, run_id: str, method: str, path: str, status: int,
                           tier: str, tech: str | None, nbytes: int = 0) -> None:
        await self._emit(self._ev("request", {"method": method, "path": path[:200], "surface": "shell",
                                              "status": status, "bytes": nbytes, "technique": tech},
                                  s, run_id, actor=s.actor, tier=tier))

    async def _on_client_frame(self, s: GatewaySession, run_id: str, tier: str, buf: list[str],
                               data: str | bytes | None) -> None:
        for cmd in _commands_from_frame(data, buf):
            await self._shell_event(s, run_id, "EXEC", cmd, 200, tier, shell_technique(cmd))

    async def _shell_local(self, ws: WebSocket, s: GatewaySession, run_id: str, mj: dict[str, str]) -> None:
        """Hand the raw ASGI connection to the real-tier surfaces app, scanning every frame out."""
        scope = dict(ws.scope)
        kept = [(k, v) for k, v in scope.get("headers", [])
                if k.lower() not in (b"authorization", b"cookie") and not k.lower().startswith(b"x-mj-")]
        scope["headers"] = kept + [(k.lower().encode(), v.encode()) for k, v in mj.items()]
        for key in ("endpoint", "path_params", "route", "router", "app"):
            scope.pop(key, None)
        buf: list[str] = []
        recv, send = ws._receive, ws._send               # noqa: SLF001 (raw ASGI bridge)

        async def receive() -> dict:
            msg = await recv()
            if msg["type"] == "websocket.receive":
                await self._on_client_frame(s, run_id, "real", buf, msg.get("text") or msg.get("bytes"))
            return msg

        async def send_(msg: dict) -> None:
            if msg["type"] == "websocket.send":
                await self.scan_out(s, run_id, msg.get("text") or msg.get("bytes"))
            elif msg["type"] == "websocket.accept":
                msg = {**msg, "headers": [(k, v) for k, v in msg.get("headers", [])
                                          if not k.lower().startswith(b"x-mj-")]}
            await send(msg)

        await self.local_app(scope, receive, send_)

    async def _shell_shadow(self, ws: WebSocket, s: GatewaySession, run_id: str, mj: dict[str, str]) -> None:
        url = self.shadow_url.replace("http://", "ws://").replace("https://", "wss://") + "/shell"
        if ws.url.query:
            url += "?" + "&".join(f"{k}={v}" for k, v in ws.query_params.items() if k != "token")
        try:
            upstream_cm = self.ws_connect(url, mj)
            upstream = await upstream_cm.__aenter__()
        except Exception as exc:  # noqa: BLE001
            print(f"[gateway] shadow shell unreachable: {exc!r}")
            await ws.close(code=1011)
            return
        try:
            self.touched(s, getattr(upstream, "handshake_headers", {}).get(HONEYTOKEN_HEADER))
            await ws.accept()
            buf: list[str] = []

            async def client_to_upstream() -> None:
                while True:
                    msg = await ws.receive()
                    if msg["type"] == "websocket.disconnect":
                        return
                    data = msg.get("text") if msg.get("text") is not None else msg.get("bytes")
                    if data is None:
                        continue
                    await self._on_client_frame(s, run_id, "shadow", buf, data)
                    await upstream.send(data)

            async def upstream_to_client() -> None:
                async for data in upstream:
                    if isinstance(data, str) and '"mj.honeytoken"' in data[:60]:
                        ctl: Any = {}
                        with contextlib.suppress(ValueError):
                            ctl = json.loads(data)
                        if isinstance(ctl, dict) and ctl.get("type") == "mj.honeytoken":
                            self.touched(s, str(ctl.get("token_id", "")))
                            continue
                    await self.scan_out(s, run_id, data)
                    if isinstance(data, bytes):
                        await ws.send_bytes(data)
                    else:
                        await ws.send_text(data)

            tasks = [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            for t in done:
                if t.exception() and not isinstance(t.exception(), asyncio.CancelledError):
                    print(f"[gateway] shell proxy ended: {t.exception()!r}")
        finally:
            with contextlib.suppress(Exception):
                await upstream_cm.__aexit__(None, None, None)
            with contextlib.suppress(Exception):
                await ws.close()

    async def aclose(self) -> None:
        await self.shadow.aclose()
        await self.local.aclose()


# --------------------------------------------------------------------------- helpers


def _bearer(headers: Any) -> str | None:
    auth = headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None


def _actor(headers: Any) -> str:
    return "clinician" if (headers.get("x-mj-actor") or "").lower() == "clinician" else "attacker"


def _commands_from_frame(data: str | bytes | None, buf: list[str]) -> list[str]:
    """Pull complete shell commands out of a client frame (JSON {cmd|command|input|data} or raw keys)."""
    if data is None:
        return []
    text = data.decode("utf-8", errors="ignore") if isinstance(data, bytes) else data
    with contextlib.suppress(ValueError, TypeError):
        obj = json.loads(text)
        if isinstance(obj, dict):
            for k in ("cmd", "command"):
                if isinstance(obj.get(k), str):
                    return [obj[k].strip()] if obj[k].strip() else []
            for k in ("input", "data", "line"):
                if isinstance(obj.get(k), str):
                    text = obj[k]
                    break
            else:
                return []
        elif not isinstance(obj, str):
            return []
    out: list[str] = []
    cur = "".join(buf)
    for ch in text:
        if ch in "\r\n":
            if cur.strip():
                out.append(cur.strip())
            cur = ""
        elif ch in "\x7f\b":
            cur = cur[:-1]
        elif ch >= " " or ch == "\t":
            cur += ch
    buf[:] = [cur]
    return out


def _unwired_router() -> APIRouter:
    r = APIRouter()

    @r.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def unwired(path: str) -> JSONResponse:
        return JSONResponse({"error": "real-tier surfaces not wired yet", "path": "/" + path}, status_code=503)

    return r


# --------------------------------------------------------------------------- app factory



def client_meta(conn: Any) -> dict[str, str | None]:
    """Who sent this request, as far as our own gateway can see: the peer address (or, behind a local
    tunnel such as Cloudflare, the address it reports) and the client's User-Agent. Nothing is run on
    the client; this is only what the client sent us."""
    h = conn.headers
    peer = conn.client.host if getattr(conn, "client", None) else None
    ip = peer
    if peer in (None, "127.0.0.1", "::1", "localhost"):
        fwd = h.get("cf-connecting-ip") or (h.get("x-forwarded-for") or "").split(",")[0].strip()
        ip = fwd or peer
    ua = (h.get("user-agent") or "")[:160] or None
    return {"client_ip": ip, "user_agent": ua}


def create_app(surfaces_factory: SurfacesFactory | None = None, *, store: RealStore | None = None,
               sink: Sink | None = None, shadow_url: str = SHADOW_URL,
               shadow_transport: httpx.AsyncBaseTransport | None = None,
               shadow_ws_connect: WsConnect | None = None, default_config: str | None = None,
               lane_adjuster: LaneAdjuster | None = None, admin_key_value: str | None = None,
               db_path: Path | str | None = None) -> FastAPI:
    if store is None:
        store = RealStore(db_path)
    intent = IntentFilter()
    if lane_adjuster is None:
        lane_adjuster = make_lane_adjuster(intent)
    gw = Gateway(store=store, sink=sink, surfaces_factory=surfaces_factory, shadow_url=shadow_url,
                 shadow_transport=shadow_transport, shadow_ws_connect=shadow_ws_connect,
                 default_config=default_config, lane_adjuster=lane_adjuster, admin_key_value=admin_key_value)
    gw.intent = intent
    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        await gw.aclose()

    app = FastAPI(title="MayaJaal gateway", lifespan=lifespan)
    app.state.gateway = gw
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "service": "gateway", "config": gw.default_config,
                "patients": gw.store.total_patients(), "sessions": len(gw.by_id)}

    @app.post("/auth/login")
    async def login(request: Request) -> Response:
        return await gw.login(request)

    @app.get("/_mj/ledger")
    async def ledger(request: Request, run: str | None = None) -> Response:
        if not gw._is_admin(request.headers):
            return JSONResponse({"error": "not found"}, status_code=404)
        if run:
            return JSONResponse({"run_id": run, "protected_total": gw.ledger.total, "leaked": gw.ledger.leaked(run)})
        return JSONResponse({"protected_total": gw.ledger.total, "runs": gw.ledger.runs()})

    @app.get("/_mj/vault")
    async def vault(request: Request) -> Response:
        """Encryption-at-rest proof: fields, key custody, a stored row, raw-bytes canary self-check."""
        if not gw._is_admin(request.headers):
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(await asyncio.to_thread(gw.store.vault_report))

    @app.get("/_mj/sessions")
    async def sessions(request: Request) -> Response:
        if not gw._is_admin(request.headers):
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse([{"session_id": s.session_id, "username": s.username, "role": s.role,
                              "hospital_id": s.hospital_id, "run_id": s.run_id, "lane": s.lane,
                              "diverted": s.diverted, "actor": s.actor, "honeytokens": sorted(s.honeytokens)}
                             for s in gw.by_id.values()])

    @app.websocket("/shell")
    async def shell(ws: WebSocket) -> None:
        await gw.shell(ws)

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    async def everything(path: str, request: Request) -> Response:
        return await gw.handle(request, path)

    return app


def __getattr__(name: str) -> Any:
    # `app` is built lazily so importing this module (tests, the sim) doesn't touch real.db.
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
