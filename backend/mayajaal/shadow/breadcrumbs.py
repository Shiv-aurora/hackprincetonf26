"""Lures the breadcrumb planner can drop into a session's world. Each returns the nodes to add
(path -> Node) and the main path; any secret inside is minted as a fresh honeytoken."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from mayajaal.shadow.dump import DumpSpec
from mayajaal.shadow.fs import BACKUPS, HOME, USER, Node, d, f
from mayajaal.shadow.honeytokens import make_api_key, make_password
from mayajaal.shadow.population import NOW
from mayajaal.shadow.seeding import b62, entity_rng

if TYPE_CHECKING:
    from mayajaal.shadow.world import ShadowWorld


def plant(w: "ShadowWorld", kind: str) -> tuple[str, dict[str, Node]]:
    rng = entity_rng(w.key, w.seed_session, f"breadcrumb/{kind}")
    nodes: dict[str, Node] = {}

    if kind == "backup_share":
        path = f"{BACKUPS}/archive/pmi_full_2026-10-31.sql.gz"
        rows = w.census.n - rng.randint(70, 140)
        spec = DumpSpec(path=path, started=datetime(2026, 10, 31, 23, 40, rng.randint(0, 59)), rows=rows,
                        size=rng.randint(44_100_000, 45_600_000))
        tid = w.mint("file", path, label="breadcrumb/backup_share", value=path)
        nodes_tokens = [tid] + ([w.tok_mrn] if w.token_idx < rows else [])
        nodes[f"{BACKUPS}/archive"] = d(mtime=datetime(2026, 11, 1, 0, 3))
        nodes[path] = Node("file", "-rwxr-xr-x", "root", "root", datetime(2026, 11, 1, 0, 2, 11), size=spec.size,
                           dump=spec, tokens=nodes_tokens)
        nodes[f"{BACKUPS}/archive/RETENTION.txt"] = f(
            "Month-end full export of meridian_pmi (all facilities). Kept 12 months per records policy MHN-RP-07.\n"
            "Restores: Lumen IT change ticket required. Contact: d.mensah@eas.meridian.local / it-ops@lum.meridian.local\n",
            "-rwxr-xr-x", mtime=datetime(2026, 1, 9, 10, 15))
        return path, nodes

    if kind == "admin_credential":
        path = f"{HOME}/Documents/downtime_procedure.txt"
        pw = make_password(rng)
        tid = w.mint("credential", path, label="breadcrumb/admin_credential", value=pw)
        nodes[path] = f(f"""EHR DOWNTIME PROCEDURE - Eastbank Community (rev. Sept 2026)

1. Switch to paper downtime forms (red binder at the 3E desk).
2. If the portal is up but SSO is down, use the break-glass admin account:

     portal:   https://portal.eas.meridian.local/admin
     user:     it.breakglass
     password: {pw}

   Tell Daniel Mensah (x4020) as soon as you use it so it can be rotated.
3. Lab results: call Lumen x7710 for STAT results; routine results will backfill.
""", "-rw-rw-r--", USER, USER, datetime(2026, 9, 22, 4, 12), tokens=[tid])   # reading it is the take
        return path, nodes

    if kind == "research_dataset":
        path = f"{BACKUPS}/research_cohort_q4/linkage_key_DO_NOT_SHARE.csv"
        rows = w.cohort_rows()
        tid = w.mint("file", path, label="breadcrumb/research_dataset", value=path)

        def content() -> str:
            out = ["study_id,mrn,family_name,given_name,dob,site"]
            for i, idx in enumerate(rows):
                c = w.core(idx)
                out.append(f"RC4-{i + 1:04d},{c.mrn},{c.family},{c.given},{c.dob.isoformat()},{c.hospital_id.upper()}")
            return "\n".join(out) + "\n"
        nodes[path] = f(content, "-rwxr-xr-x", mtime=datetime(2026, 11, 13, 17, 4), patient_rows=lambda: rows,
                        tokens=[tid])
        return path, nodes

    if kind == "lab_service_account":
        path = "/opt/lis/.svc_lisresults.env"
        key = make_api_key(rng)
        tid = w.mint("api_key", path, label="breadcrumb/lab_service_account", value=key)
        nodes[path] = f(f"""# service account for result corrections (amend/verify) -- Lumen LIS
# used by the overnight reconciliation job; scope includes results.write
LIS_SVC_USER=svc_lisresults
LIS_SVC_KEY={key}
LIS_ENDPOINT=https://lis-api.lum.meridian.local/v2
LIS_AMEND_REASON_DEFAULT="post-analytical correction"
""", "-rw-r--r--", "lissync", "lissync", datetime(2026, 10, 28, 3, 50), tokens=[tid])
        return path, nodes

    if kind == "vpn_config":
        path = f"{HOME}/Downloads/meridian-lumen-vpn.ovpn"
        pw = make_password(rng)
        tid = w.mint("credential", path, label="breadcrumb/vpn_config", value=pw)
        nodes[path] = f(f"""# Meridian <-> Lumen site VPN (ward support profile)
# auth: svc_wardvpn / {pw}   (shared account, per Daniel, do not save in the client)
client
dev tun
proto udp
remote vpn.lum.meridian.local 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth SHA256
cipher AES-256-GCM
auth-user-pass
verb 3
<ca>
-----BEGIN CERTIFICATE-----
{chr(10).join(b62(rng, 64) for _ in range(12))}
-----END CERTIFICATE-----
</ca>
""", "-rw-rw-r--", USER, USER, NOW - timedelta(days=23, hours=4), tokens=[tid])
        return path, nodes

    raise ValueError(f"unknown breadcrumb kind: {kind}")
