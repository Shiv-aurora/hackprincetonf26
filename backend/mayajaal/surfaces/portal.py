"""Admin portal surface: a slightly dated hospital IT intranet.

    GET  /portal                 sign-in page
    POST /portal/login           form target; redirects to the user directory (auth is the gateway's job)
    GET  /portal/admin/users     user directory      (world.portal_users())
    GET  /portal/backups         nightly backup jobs to the shared pathology lab's backup host
    GET  /portal/network         inter-hospital site-to-site VPN links (contracts/world.json)

Every page returns JSON instead of HTML when the client prefers `application/json`.
"""

from __future__ import annotations

import html
import posixpath
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import APIRouter, Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from mayajaal.world_api import FsNode, ResolveWorld, WorldProvider

from ._common import Call, hospital_name, hospitals, stable_int, wants_json, world_json

ORG = "Meridian Health Network"
PORTAL_TITLE = f"{ORG} — IT Services"
PORTAL_VERSION = "3.8.2"
BACKUP_HOST = "lumbak01.mhn.local"
BACKUP_HOST_IP = "10.60.4.21"
BACKUP_SHARE = "/srv/ehr_backups"
BACKUP_MOUNT = "/mnt/backups"

_ROLE_LABEL = {
    "nurse": "Nursing", "physician": "Physician", "lab_tech": "Laboratory",
    "it_admin": "IT Administrator", "service": "Service account",
}

# --------------------------------------------------------------------------- page chrome

_CSS = """
body{margin:0;background:#e9ecef;font:12px Tahoma,Verdana,Geneva,sans-serif;color:#222}
#top{background:linear-gradient(#2d5f99,#1d4677);color:#fff;padding:8px 14px;border-bottom:3px solid #f2a900}
#top .org{font-size:17px;font-weight:bold;letter-spacing:.3px}
#top .sub{font-size:11px;color:#cfe0f5}
#top .who{float:right;font-size:11px;margin-top:6px}
#top .who a{color:#fff}
#nav{background:#d5dde6;border-bottom:1px solid #9aa9b8;padding:4px 14px}
#nav a{color:#1d4677;text-decoration:none;margin-right:16px;font-weight:bold}
#nav a.on{color:#000;text-decoration:underline}
#main{background:#fff;margin:12px 14px;padding:12px 16px;border:1px solid #a7b4c2;min-height:300px}
h1{font-size:15px;color:#1d4677;margin:0 0 8px;border-bottom:1px solid #ccd5df;padding-bottom:4px}
h2{font-size:13px;color:#1d4677;margin:16px 0 6px}
table.grid{border-collapse:collapse;width:100%;margin-top:6px}
table.grid th{background:#e3e9f0;border:1px solid #a7b4c2;text-align:left;padding:3px 6px;font-size:11px}
table.grid td{border:1px solid #c9d2db;padding:3px 6px;font-size:11px}
table.grid tr:nth-child(even) td{background:#f6f8fa}
.ok{color:#18752e;font-weight:bold}.warn{color:#a66300;font-weight:bold}.bad{color:#b3261e;font-weight:bold}
.note{background:#fff8dc;border:1px solid #e6d28a;padding:6px 8px;margin:8px 0;font-size:11px}
.mono{font-family:"Courier New",monospace}
#foot{margin:0 14px 14px;font-size:10px;color:#666}
form.login{width:300px;margin:30px auto;border:1px solid #a7b4c2;background:#f6f8fa;padding:14px 18px}
form.login label{display:block;margin-top:8px;font-weight:bold}
form.login input[type=text],form.login input[type=password]{width:100%;box-sizing:border-box;padding:3px;border:1px solid #8a99a8}
form.login button{margin-top:12px;background:#2d5f99;color:#fff;border:1px solid #1d4677;padding:4px 14px;cursor:pointer}
"""

_NAV = [("/portal/admin/users", "Users"), ("/portal/backups", "Backups"), ("/portal/network", "Network")]


def _e(v: Any) -> str:
    return html.escape("" if v is None else str(v))


def _page(title: str, body: str, *, active: str = "", user: str = "", nav: bool = True) -> HTMLResponse:
    who = f'<div class="who">Signed in as <b>{_e(user)}</b> | <a href="/portal">Sign out</a></div>' if user else ""
    links = "".join(f'<a href="{href}"{" class=on" if href == active else ""}>{label}</a>' for href, label in _NAV)
    nav_html = f'<div id="nav">{links}<a href="/fhir/metadata">FHIR API</a></div>' if nav else ""
    year = datetime.now().year
    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>{_e(title)} - {_e(ORG)} IT Services</title>
<style>{_CSS}</style></head>
<body>
<div id="top">{who}<div class="org">{_e(ORG)}</div><div class="sub">IT Services Portal &middot; Clinical Systems Administration</div></div>
{nav_html}
<div id="main">
{body}
</div>
<div id="foot">IT Services Portal v{PORTAL_VERSION} &middot; &copy; 2014&ndash;{year} {_e(ORG)}. Authorized use only. All activity is logged and monitored.
For assistance contact the Service Desk at ext. 4357 (HELP).</div>
</body></html>"""
    return HTMLResponse(doc, headers={"Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN"})


def _table(headers: list[str], rows: list[list[str]]) -> str:
    th = "".join(f"<th>{_e(h)}</th>" for h in headers)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<table class="grid"><tr>{th}</tr>{trs}</table>'


def _human(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{n} B"


def _fmt_dt(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
    except (ValueError, AttributeError):
        return iso or ""


# --------------------------------------------------------------------------- data builders


def users_data(world: WorldProvider) -> list[dict[str, Any]]:
    out = []
    for u in world.portal_users():
        d = asdict(u)
        d["hospital"] = hospital_name(u.hospital_id)
        d["status"] = "active"
        out.append(d)
    return out


def _safe_stat(world: WorldProvider, path: str) -> FsNode | None:
    try:
        return world.stat(path)
    except Exception:  # noqa: BLE001
        return None


def _backup_files(world: WorldProvider) -> list[FsNode]:
    root = _safe_stat(world, BACKUP_MOUNT)
    if root is None or root.kind != "dir":
        return []
    files: list[FsNode] = []
    for child in root.children:
        node = _safe_stat(world, posixpath.join(BACKUP_MOUNT, child))
        if node is None:
            continue
        if node.kind == "file":
            files.append(node)
        else:  # one level of per-site folders
            for grandchild in node.children:
                g = _safe_stat(world, posixpath.join(node.path, grandchild))
                if g is not None and g.kind == "file":
                    files.append(g)
    return files


def _synth_backup_files() -> list[FsNode]:
    """Used only when the world exposes no backup mount."""
    today = date.today()
    out = []
    for i in range(1, 8):
        d = today - timedelta(days=i)
        size = 3_800_000_000 + stable_int("dump", d.isoformat()) % 400_000_000
        out.append(FsNode(path=f"{BACKUP_MOUNT}/db_dump_{d.isoformat()}.sql.gz", kind="file", size=size,
                          owner="svc_backup", group="backup", mtime=f"{d.isoformat()}T02:{10 + i:02d}:00"))
    return out


def backups_data(world: WorldProvider) -> dict[str, Any]:
    files = _backup_files(world) or _synth_backup_files()
    files.sort(key=lambda f: f.mtime, reverse=True)
    jobs = []
    for i, f in enumerate(files):
        name = posixpath.basename(f.path)
        r = stable_int("backup-status", f.path) % 20
        status = "Completed with warnings" if (i > 0 and r == 0) else "Completed"
        try:
            started = datetime.fromisoformat(f.mtime) - timedelta(minutes=40 + stable_int(f.path) % 25)
            started_s = started.isoformat(timespec="seconds")
        except ValueError:
            started_s = f.mtime
        jobs.append({
            "job": "EHR-NIGHTLY-FULL" if name.startswith("db_dump") else "FILE-NIGHTLY",
            "file": name,
            "source": "ehr-db01.eas.mhn.local (Eastbank Community)",
            "target": f"{BACKUP_HOST}:{BACKUP_SHARE}/{name}",
            "path": f.path,
            "started": started_s,
            "finished": f.mtime,
            "status": status,
            "size_bytes": f.size,
            "size": _human(f.size),
            "retention_days": 30,
        })
    return {
        "backup_host": BACKUP_HOST,
        "backup_host_ip": BACKUP_HOST_IP,
        "backup_host_site": hospital_name("lum"),
        "share": f"{BACKUP_HOST}:{BACKUP_SHARE}",
        "mounted_at": BACKUP_MOUNT,
        "schedule": "Nightly 01:30 (full), retention 30 days",
        "service_account": "svc_backup",
        "jobs": jobs,
    }


def network_data() -> dict[str, Any]:
    hs = hospitals()
    idx = {h["id"]: i for i, h in enumerate(hs)}
    sites = [{
        "id": h["id"], "name": h["name"],
        "subnet": f"10.{10 * (idx[h['id']] + 1)}.0.0/16",
        "gateway": f"vpn-gw.{h['id']}.mhn.local",
        "gateway_ip": f"10.{10 * (idx[h['id']] + 1)}.0.1",
    } for h in hs]
    links = []
    for a, b in world_json()["links"]:
        k = stable_int("vpn", a, b)
        links.append({
            "tunnel": f"s2s-{a}-{b}",
            "site_a": a, "site_a_name": hospital_name(a),
            "site_b": b, "site_b_name": hospital_name(b),
            "peer_a": f"10.{10 * (idx[a] + 1)}.0.1",
            "peer_b": f"10.{10 * (idx[b] + 1)}.0.1",
            "protocol": "IPsec IKEv2",
            "cipher": "AES-256-GCM / SHA-384 / DH20",
            "status": "up",
            "uptime_days": 3 + k % 140,
            "rekey_interval": "8h",
        })
    return {"network": f"{ORG} inter-site WAN", "sites": sites, "links": links}


# --------------------------------------------------------------------------- routes


def add_portal_routes(router: APIRouter, resolve_world: ResolveWorld) -> None:

    async def run(request: Request, handler: Callable[[Call], Response]) -> Response:
        call = await Call.open(request, resolve_world)
        return call.finish(handler(call))

    @router.get("/portal")
    async def portal_home(request: Request) -> Response:
        def h(call: Call) -> Response:
            if wants_json(request):
                return JSONResponse({"service": f"{ORG} IT Services Portal", "version": PORTAL_VERSION,
                                     "login": "/portal/login", "methods": ["password", "totp"]})
            body = """
<form class="login" method="post" action="/portal/login" autocomplete="off">
<div style="font-weight:bold;color:#1d4677;font-size:13px">Staff sign-in</div>
<div style="font-size:11px;color:#555;margin-top:2px">Use your network (MHN) account.</div>
<label for="u">Username</label><input type="text" id="u" name="username">
<label for="p">Password</label><input type="password" id="p" name="password">
<label for="t">Authenticator code <span style="font-weight:normal">(if enrolled)</span></label><input type="text" id="t" name="totp">
<button type="submit">Sign in</button>
<div style="font-size:10px;color:#666;margin-top:10px">Forgotten password? Call the Service Desk (ext. 4357).</div>
</form>
<div class="note">Planned maintenance: EHR read-only window Sunday 02:00&ndash;04:00. Backup jobs to the Lumen Labs
backup host will run as scheduled.</div>"""
            return _page("Sign in", body, nav=False)
        return await run(request, h)

    @router.post("/portal/login")
    async def portal_login(request: Request) -> Response:
        def h(call: Call) -> Response:
            if wants_json(request):
                return JSONResponse({"status": "ok", "next": "/portal/admin/users"})
            return RedirectResponse("/portal/admin/users", status_code=303)
        return await run(request, h)

    @router.get("/portal/admin/users")
    async def portal_users(request: Request) -> Response:
        def h(call: Call) -> Response:
            users = users_data(call.world)
            if wants_json(request):
                return JSONResponse({"users": users, "total": len(users)})
            rows = [[
                f'<span class="mono">{_e(u["username"])}</span>', _e(u["display_name"]),
                _e(_ROLE_LABEL.get(u["role"], u["role"])), _e(u["hospital"]), _e(_fmt_dt(u["last_login"])),
                '<span class="ok">Enrolled</span>' if u["mfa"] else '<span class="bad">Not enrolled</span>',
                "Active", '<a href="#">Edit</a> | <a href="#">Reset password</a>',
            ] for u in users]
            no_mfa = sum(1 for u in users if not u["mfa"])
            body = (f"<h1>User Directory</h1><div>{len(users)} accounts. "
                    + (f'<span class="warn">{no_mfa} account(s) without MFA.</span>' if no_mfa else "")
                    + "</div>"
                    + _table(["Username", "Name", "Role", "Facility", "Last login", "MFA", "Status", ""], rows))
            return _page("User Directory", body, active="/portal/admin/users", user=call.ctx.username)
        return await run(request, h)

    @router.get("/portal/backups")
    async def portal_backups(request: Request) -> Response:
        def h(call: Call) -> Response:
            data = backups_data(call.world)
            if wants_json(request):
                return JSONResponse(data)
            cls = {"Completed": "ok", "Completed with warnings": "warn", "Failed": "bad"}
            rows = [[
                _e(j["job"]), f'<span class="mono">{_e(j["file"])}</span>', _e(j["source"]),
                f'<span class="mono">{_e(j["target"])}</span>', _e(_fmt_dt(j["started"])), _e(_fmt_dt(j["finished"])),
                f'<span class="{cls.get(j["status"], "")}">{_e(j["status"])}</span>', _e(j["size"]),
            ] for j in data["jobs"]]
            body = f"""<h1>Backup Jobs</h1>
<table class="grid" style="width:auto">
<tr><th>Backup host</th><td class="mono">{_e(data["backup_host"])} ({_e(data["backup_host_ip"])})</td></tr>
<tr><th>Location</th><td>{_e(data["backup_host_site"])} &mdash; shared pathology data centre</td></tr>
<tr><th>Share</th><td class="mono">{_e(data["share"])} &rarr; {_e(data["mounted_at"])} on jump hosts</td></tr>
<tr><th>Schedule</th><td>{_e(data["schedule"])}</td></tr>
<tr><th>Run as</th><td class="mono">{_e(data["service_account"])}</td></tr>
</table>
<h2>Job history</h2>
{_table(["Job", "Archive", "Source", "Target", "Started", "Finished", "Status", "Size"], rows)}
<div class="note">Restores require a change ticket. Archives are kept for 30 days on the backup host.</div>"""
            return _page("Backup Jobs", body, active="/portal/backups", user=call.ctx.username)
        return await run(request, h)

    @router.get("/portal/network")
    async def portal_network(request: Request) -> Response:
        def h(call: Call) -> Response:
            data = network_data()
            if wants_json(request):
                return JSONResponse(data)
            site_rows = [[_e(s["name"]), f'<span class="mono">{_e(s["subnet"])}</span>',
                          f'<span class="mono">{_e(s["gateway"])} ({_e(s["gateway_ip"])})</span>']
                         for s in data["sites"]]
            link_rows = [[
                f'<span class="mono">{_e(l["tunnel"])}</span>', _e(l["site_a_name"]), _e(l["site_b_name"]),
                f'<span class="mono">{_e(l["peer_a"])} &harr; {_e(l["peer_b"])}</span>', _e(l["protocol"]),
                _e(l["cipher"]), '<span class="ok">Up</span>', f'{l["uptime_days"]} d',
            ] for l in data["links"]]
            body = (f"<h1>Site-to-Site VPN</h1><h2>Sites</h2>"
                    + _table(["Site", "Subnet", "VPN gateway"], site_rows)
                    + "<h2>Tunnels</h2>"
                    + _table(["Tunnel", "Site A", "Site B", "Peers", "Protocol", "Cipher suite", "Status", "Uptime"],
                             link_rows))
            return _page("Network", body, active="/portal/network", user=call.ctx.username)
        return await run(request, h)
