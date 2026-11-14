"""Stand-ins for the parts other agents build, so the gateway can be tested alone.

- fake_surfaces_factory(resolve_world, sink) -> APIRouter    (Agent C's build_router shape)
- fake_shadow_app() -> FastAPI                               (the :8001 shadow process)
- FakeShadowShell                                            (WS upstream adapter for the gateway)

The fake shadow marks every payload with "tier": "shadow" and records what it received, so tests
can prove that clinicians never got shadow data and that no real credential reached the shadow.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse

from mayajaal.world_api import context_from_headers


def fake_surfaces_factory(resolve_world, sink) -> APIRouter:  # noqa: ANN001
    r = APIRouter()

    def world(request_or_ws: Any):
        return resolve_world(context_from_headers(request_or_ws.headers))

    @r.get("/fhir/Patient")
    async def patients(request: Request, hospital: str | None = None, _count: int = 20) -> Any:
        w = world(request)
        rows = w.list_patients(hospital, 0, _count)
        return {"resourceType": "Bundle", "tier": w.tier, "total": len(rows),
                "entry": [{"resource": asdict(p)} for p in rows]}

    @r.get("/fhir/Patient/{mrn}")
    async def patient(mrn: str, request: Request) -> Any:
        w = world(request)
        p = w.get_patient(mrn)
        if p is None:
            return JSONResponse({"error": "not found", "tier": w.tier}, status_code=404)
        return {"tier": w.tier, **asdict(p)}

    @r.get("/fhir/Observation")
    async def observations(request: Request, patient: str = "") -> Any:
        w = world(request)
        return {"tier": w.tier, "entry": [asdict(o) for o in w.observations(patient)]}

    @r.get("/portal/admin/users")
    async def users(request: Request) -> Any:
        w = world(request)
        return {"tier": w.tier, "users": [asdict(u) for u in w.portal_users()]}

    @r.post("/shell/exec")
    async def exec_(request: Request) -> Any:
        w = world(request)
        cmd = (await request.json()).get("cmd", "")
        return PlainTextResponse(_run(w, cmd), headers={"X-MJ-Tier-Debug": w.tier})

    @r.websocket("/shell")
    async def shell(ws: WebSocket) -> None:
        w = world(ws)
        await ws.accept()
        await ws.send_text(f"{w.tier}@{w.hostname()}:~$ ")
        try:
            while True:
                msg = await ws.receive_text()
                cmd = json.loads(msg).get("cmd", "") if msg.startswith("{") else msg.strip()
                await ws.send_text(_run(w, cmd))
        except WebSocketDisconnect:
            return

    return r


def _run(w: Any, cmd: str) -> str:
    parts = cmd.split()
    if not parts:
        return ""
    if parts[0] in ("cat", "zcat") and len(parts) > 1:
        try:
            return w.read_file(parts[1])
        except (FileNotFoundError, IsADirectoryError) as e:
            return f"{parts[0]}: {e}: No such file or directory\n"
    if parts[0] == "ls":
        node = w.stat(parts[1] if len(parts) > 1 else "~")
        return "\n".join(node.children) + "\n" if node else "ls: cannot access\n"
    if parts[0] == "hostname":
        return w.hostname() + "\n"
    return f"{parts[0]}: command not found\n"


def fake_shadow_app() -> FastAPI:
    """Fake :8001. Every response says tier=shadow. Paths containing 'honey' report a touch."""
    app = FastAPI()
    app.state.received = []

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def anything(path: str, request: Request) -> Any:
        body = (await request.body()).decode(errors="ignore")
        app.state.received.append({"path": "/" + path, "headers": dict(request.headers), "body": body})
        headers = {"X-MJ-Shadow-Internal": "1"}
        if "honey" in path or "honey" in body:
            headers["X-MJ-Honeytoken-Touched"] = "ht-test-1"
        if path == "auth/login":
            creds = json.loads(body or "{}")
            if creds.get("username") == "svc_lisbackup" and creds.get("password") == "Lumen#Night2026":
                return JSONResponse({"token": "shadow", "role": "service", "hospital_id": "lum"},
                                    headers={"X-MJ-Honeytoken-Touched": "ht-cred-1"})
            return JSONResponse({"error": "invalid credentials"}, status_code=401)
        return JSONResponse({"tier": "shadow", "path": "/" + path, "records": [{"mrn": "MRN-7F3A-0193"}]},
                            headers=headers)

    return app


class FakeShadowShell:
    """Gateway WS upstream adapter (same members as app._WebsocketsUpstream), echoing as the shadow."""

    instances: list["FakeShadowShell"] = []

    def __init__(self, url: str, headers: dict[str, str]) -> None:
        self.url, self.headers = url, headers
        self.handshake_headers: dict[str, str] = {}
        self.sent: list[Any] = []
        self._q: asyncio.Queue = asyncio.Queue()
        FakeShadowShell.instances.append(self)

    async def __aenter__(self) -> "FakeShadowShell":
        await self._q.put("shadow@jump-eas:~$ ")
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._q.put(None)

    async def send(self, data: Any) -> None:
        self.sent.append(data)
        if "honey" in str(data):
            await self._q.put(json.dumps({"type": "mj.honeytoken", "token_id": "ht-ws-1"}))
        await self._q.put(f"shadow-out: {data}")

    def __aiter__(self):
        return self

    async def __anext__(self) -> Any:
        item = await self._q.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def close(self) -> None:
        await self._q.put(None)
