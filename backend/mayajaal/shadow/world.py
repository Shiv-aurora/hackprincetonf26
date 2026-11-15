"""ShadowWorld: an endless, self-consistent, deterministic fake hospital network for one session.

Built only from a session key and public templates (Faker name lists, ICD-10 / LOINC tables).
This package must never touch the real tier's code or its data directory (see tests).
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import hmac
import posixpath
import time
from collections import OrderedDict
from datetime import datetime, timedelta
from typing import Any

from mayajaal.contracts import Event, ExfilRecord, make_event
from mayajaal.shadow import breadcrumbs as _bc
from mayajaal.shadow import fs as _fs
from mayajaal.shadow.dump import LAB_PREVIEW_PATIENTS, PREVIEW_ROWS, DumpSpec, render_dump
from mayajaal.shadow.honeytokens import (Honeytoken, make_api_key, make_password, make_url_token, rng_for,
                                         token_id)
from mayajaal.shadow.population import (CLINICAL_HOSPITALS, HOSPITAL_ORDER, NOW, Census, PatientCore,
                                        build_observations, build_patient, flag, pick_name)
from mayajaal.shadow.seeding import entity_rng
from mayajaal.world_api import EventSink, FsNode, Observation, Patient, PortalUser

STATIC_SESSION = "static"
CORE_CACHE = 2048
PENDING_CAP = 1000


class ShadowWorld:
    """WorldProvider for the shadow tier. One instance per attacker session.

    Read errors follow Python conventions: FileNotFoundError, IsADirectoryError, PermissionError.
    """

    tier = "shadow"

    def __init__(self, session_id: str, *, key: bytes, static: bool = False, sink: EventSink | None = None,
                 run_id: str = "adhoc"):
        self.session_id = session_id
        self.key = key
        self.static = static
        self.seed_session = STATIC_SESSION if static else session_id
        self.sink = sink
        self.run_id = run_id
        self.pending_events: list[Event] = []
        self._tasks: set[asyncio.Task] = set()
        try:
            self._loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        self._t0 = time.monotonic()

        self.census = Census(key, self.seed_session)
        self._cores: OrderedDict[int, PatientCore] = OrderedDict()
        self._content: dict[str, str] = {}
        self._overlay: dict[str, _fs.Node] = {}
        self._overlay_obs: dict[str, dict[str, Observation]] = {}
        self._lists: dict[str, list[int]] = {}

        self.honeytokens: dict[str, Honeytoken] = {}
        self._token_by_label: dict[str, str] = {}
        self.touched_honeytokens: set[str] = set()
        self.touch_log: list[tuple[str, str]] = []          # (token_id, where), in touch order
        self.breadcrumbs: dict[str, str] = {}                # kind -> path

        # ---- session secrets
        s = self.seed_session
        self.svc_password = make_password(rng_for(key, s, "credential"))
        self.api_key = make_api_key(rng_for(key, s, "api_key"))
        self.research_url = ("https://research-portal.lum.meridian.local/requests/q4-cohort?access="
                             + make_url_token(rng_for(key, s, "url")))
        self.token_idx = rng_for(key, s, "mrn").randrange(15, min(PREVIEW_ROWS, self.census.n) - 5)
        self._dumps = self._make_dumps()
        self.latest_dump = self._dumps[-1].path

        self.tok_credential = self.mint("credential", f"{_fs.HOME}/.bash_history", label="credential",
                                        value=self.svc_password)
        self.tok_file = self.mint("file", self.latest_dump, label="file", value=self.latest_dump)
        self.tok_mrn = self.mint("mrn", f"patient/{self.census.mrn_of[self.token_idx]}", label="mrn",
                                 value=self.census.mrn_of[self.token_idx])
        self.tok_api_key = self.mint("api_key", "/opt/lis/config.yaml", label="api_key", value=self.api_key)
        self.tok_url = self.mint("url", f"{_fs.BACKUPS}/research_cohort_q4/README.md", label="url",
                                 value=self.research_url)

        self._tree = _fs.build_tree(self)
        self._children: dict[str, set[str]] = {}
        for p in self._tree:
            self._index_child(p, self._children)

    # ================================================================ events / honeytokens

    def _event(self, type_: str, data: dict[str, Any]) -> None:
        ev = make_event(type_, data, run_id=self.run_id, actor="defender", session_id=self.session_id,
                        hospital_id="eas", tier="shadow")
        self._dispatch(ev)

    def _dispatch(self, ev: Event) -> None:
        if self.sink is None:
            self._queue(ev)
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            task = loop.create_task(self.sink(ev))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        elif self._loop is not None and self._loop.is_running() and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.sink(ev), self._loop)
        else:
            self._queue(ev)

    def _queue(self, ev: Event) -> None:
        self.pending_events.append(ev)
        if len(self.pending_events) > PENDING_CAP:
            del self.pending_events[: len(self.pending_events) - PENDING_CAP]

    def drain_events(self) -> list[Event]:
        """Events that could not be sent (no sink or no running loop). Clears the queue."""
        out, self.pending_events = self.pending_events, []
        return out

    async def flush(self) -> None:
        """Send queued events through the sink, and wait for in-flight sends."""
        if self.sink is not None:
            for ev in self.drain_events():
                await self.sink(ev)
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    def mint(self, kind: str, placed_at: str, *, label: str, value: str) -> str:
        if label in self._token_by_label:
            return self._token_by_label[label]
        tid = token_id(self.key, self.seed_session, label, kind)
        self.honeytokens[tid] = Honeytoken(tid, kind, value, placed_at)
        self._token_by_label[label] = tid
        self._event("honeytoken.minted", {"token_id": tid, "kind": kind, "placed_at": placed_at})
        return tid

    def touch(self, token_id: str, where: str = "") -> bool:
        """Mark a honeytoken touched. Emits honeytoken.touched the first time only. Returns True if new."""
        tok = self.honeytokens.get(token_id)
        if tok is None or token_id in self.touched_honeytokens:
            return False
        self.touched_honeytokens.add(token_id)
        self.touch_log.append((token_id, where))
        self._event("honeytoken.touched", {"token_id": token_id, "kind": tok.kind, "where": where})
        return True

    def touched_since(self, n: int) -> list[Honeytoken]:
        """Honeytokens first touched after the first ``n`` touches (poll with len(touch_log))."""
        return [self.honeytokens[t] for t, _ in self.touch_log[n:]]

    @property
    def touch_count(self) -> int:
        return len(self.touch_log)

    def match_honeytokens(self, text: str) -> list[Honeytoken]:
        """Honeytokens whose secret value appears in ``text`` (e.g. a later login or API call)."""
        return [t for t in self.honeytokens.values() if t.kind != "file" and t.value and t.value in text]

    # ================================================================ population

    def core(self, idx: int) -> PatientCore:
        c = self._cores.get(idx)
        if c is not None:
            self._cores.move_to_end(idx)
            return c
        hid = self.census.hospital_of[idx]
        c = build_patient(self.key, self.seed_session, idx, self.census.mrn_of[idx], hid,
                          self.census.rosters[hid], self.census.updated_at(idx))
        self._cores[idx] = c
        if len(self._cores) > CORE_CACHE:
            self._cores.popitem(last=False)
        return c

    def _idx(self, mrn: str) -> int | None:
        m = (mrn or "").strip().upper()
        if m.isdigit():
            m = "MRN-" + m
        return self.census.idx_of.get(m)

    def total_patients(self) -> int:
        return self.census.n

    def list_patients(self, hospital_id: str | None, offset: int, limit: int) -> list[Patient]:
        idxs = self.census.by_hospital.get(hospital_id, []) if hospital_id else range(self.census.n)
        offset = max(0, offset)
        return [self.core(i).to_patient() for i in idxs[offset: offset + max(0, limit)]]

    def get_patient(self, mrn: str) -> Patient | None:
        idx = self._idx(mrn)
        if idx is None:
            return None
        if idx == self.token_idx:
            self.touch(self.tok_mrn, f"patient/{self.census.mrn_of[idx]}")
        return self.core(idx).to_patient()

    def obs_internal(self, mrn: str) -> list[Observation]:
        idx = self._idx(mrn)
        base = build_observations(self.key, self.seed_session, self.core(idx)) if idx is not None else []
        over = self._overlay_obs.get(self.census.mrn_of[idx] if idx is not None else mrn, {})
        if not over:
            return base
        out = [over.get(o.obs_id, o) for o in base]
        known = {o.obs_id for o in base}
        out += [o for k, o in over.items() if k not in known]
        out.sort(key=lambda o: (o.issued, o.obs_id))
        return [dataclasses.replace(o) for o in out]

    def observations(self, mrn: str) -> list[Observation]:
        idx = self._idx(mrn)
        if idx is None:
            return []
        if idx == self.token_idx:
            self.touch(self.tok_mrn, f"observations/{self.census.mrn_of[idx]}")
        return self.obs_internal(mrn)

    def put_observation(self, obs: Observation) -> Observation:
        o = dataclasses.replace(obs)
        idx = self._idx(o.mrn)
        if idx is not None:
            o.mrn = self.census.mrn_of[idx]
        if not o.obs_id:
            t = self.world_now()
            o.obs_id = f"L{t:%y}{t.timetuple().tm_yday:03d}-{len(self._overlay_obs.get(o.mrn, {})) + 61000}.01"
        if not o.issued:
            o.issued = self.world_now().strftime("%Y-%m-%dT%H:%M:%S")
        if not o.signature:
            o.signature = hmac.new(self.key, f"{o.obs_id}|{o.mrn}|{o.code}|{o.value}".encode(),
                                   hashlib.sha256).hexdigest()[:32]
        self._overlay_obs.setdefault(o.mrn, {})[o.obs_id] = o
        return dataclasses.replace(o)

    def detail_for(self, c: PatientCore) -> str:
        """Short clinical summary like "HbA1c 7.9 %, metformin" for exfil samples."""
        lt = c.latent
        if "4548-4" in lt:
            lab = f"HbA1c {lt['4548-4']:.1f} %"
        elif lt.get("62238-1", 99) < 60:
            lab = f"eGFR {lt['62238-1']:.0f}"
        else:
            lab = f"Hb {lt['718-7']:.1f} g/dL"
        what = c.medications[0].split(" ")[0].lower() if c.medications else (
            c.conditions[0].short if c.conditions else "no active problems")
        return f"{lab}, {what}"

    def exfil_sample(self, path: str, n: int = 5) -> list[ExfilRecord]:
        """Sample rows for an ``exfil`` event (no honeytoken side effects)."""
        out = []
        for idx in self._file_rows(path)[:n]:
            c = self.core(idx)
            out.append(ExfilRecord(mrn=c.mrn, name=c.name, dob=c.dob.isoformat(), hospital_id=c.hospital_id,
                                   detail=self.detail_for(c)))
        return out

    # ---- lists used by files (cached, exclude the token patient so touches stay meaningful)

    def _cached_list(self, name: str, build) -> list[int]:
        if name not in self._lists:
            self._lists[name] = build()
        return self._lists[name]

    def eas_inpatients(self, n: int) -> list[PatientCore]:
        def build():
            out = []
            for idx in self.census.by_hospital["eas"]:
                if idx != self.token_idx and self.core(idx).inpatient:
                    out.append(idx)
                if len(out) >= 12:
                    break
            return out
        cores = [self.core(i) for i in self._cached_list("eas_inpatients", build)[:n]]
        return sorted(cores, key=lambda c: c.bed)

    def export_rows(self) -> list[int]:
        def build():
            out = []
            for idx in self.census.by_hospital["eas"][:320]:
                if idx == self.token_idx:
                    continue
                if any(o.issued >= "2026-11-06" for o in self.obs_internal(self.census.mrn_of[idx])):
                    out.append(idx)
                if len(out) >= 110:
                    break
            return out
        return self._cached_list("export", build)

    def cohort_rows(self) -> list[int]:
        def build():
            out = []
            for idx in range(PREVIEW_ROWS, self.census.n):
                if self.census.hospital_of[idx] not in ("aur", "nor", "eas"):
                    continue
                c = self.core(idx)
                if any(x.code.startswith(("E11", "N18")) for x in c.conditions):
                    out.append(idx)
                if len(out) >= 180:
                    break
            return out
        return self._cached_list("cohort", build)

    # ================================================================ portal

    def portal_users(self) -> list[PortalUser]:
        rng = entity_rng(self.key, self.seed_session, "portal")

        def ago(max_h: float, min_h: float = 0.05) -> str:
            return (NOW - timedelta(hours=rng.uniform(min_h, max_h))).strftime("%Y-%m-%dT%H:%M:%S")

        users = [PortalUser("n.okafor", _fs.USER_FULL, "nurse", "eas", (NOW - timedelta(minutes=9)).strftime(
            "%Y-%m-%dT%H:%M:%S"), False)]
        seen = {"n.okafor"}

        def add(username, display, role, hid, last, mfa):
            u, k = username, 2
            while u in seen:
                u, k = f"{username}{k}", k + 1
            seen.add(u)
            users.append(PortalUser(u, display, role, hid, last, mfa))

        for hid in HOSPITAL_ORDER:
            for doc in self.census.rosters[hid]:
                add(doc.username, doc.name, "physician", hid, ago(150), rng.random() < 0.82)
            for _ in range(rng.randint(4, 7)):
                sex = "F" if rng.random() < 0.8 else "M"
                g, fam = pick_name(rng, sex)
                add(_uname(g, fam), f"{g} {fam}", "nurse", hid, ago(96), rng.random() < 0.55)
        for _ in range(6):
            g, fam = pick_name(rng, "F" if rng.random() < 0.6 else "M")
            add(_uname(g, fam), f"{g} {fam}", "lab_tech", "lum", ago(30), rng.random() < 0.7)
        add("d.mensah", "Daniel Mensah", "it_admin", "eas", ago(20, 6), True)
        add("eastadmin", "Eastbank IT (local)", "it_admin", "eas", ago(24 * 9, 24 * 3), False)
        g, fam = pick_name(rng, "F")
        add(_uname(g, fam), f"{g} {fam}", "it_admin", "lum", ago(40), True)
        add("svc_lisbackup", "Lumen backup service", "service", "lum", "2026-11-14T02:10:02", False)
        add("svc_hl7_eas", "HL7 interface (EAS)", "service", "eas", ago(0.1, 0.01), False)
        if "admin_credential" in self.breadcrumbs:
            add("it.breakglass", "Break-glass admin (EAS)", "it_admin", "eas", "2026-09-22T04:09:51", False)
        if "lab_service_account" in self.breadcrumbs:
            add("svc_lisresults", "LIS results reconciliation", "service", "lum", ago(30, 20), False)
        if "vpn_config" in self.breadcrumbs:
            add("svc_wardvpn", "Ward support VPN (shared)", "service", "lum", ago(200, 48), False)
        return users

    # ---- files reachable through the portal over HTTP (the attacker has no shell). Lures planted by
    # the planner show up here: backup-share lures on the backups page, the rest on the documents page.
    _BASE_DOCS = (
        ("lis-client-config", "Lumen LIS client configuration", "Laboratory", "/opt/lis/config.yaml"),
        ("research-cohort-q4-readme", "Research cohort Q4: data request notes", "Research",
         f"{_fs.BACKUPS}/research_cohort_q4/README.md"),
    )
    _LURE_DOCS = {
        "admin_credential": ("downtime_procedure", "EHR downtime procedure (Eastbank)", "Procedures"),
        "lab_service_account": ("svc_lisresults", "LIS results reconciliation: service account", "Laboratory"),
        "vpn_config": ("meridian-lumen-vpn", "Meridian-Lumen site VPN profile", "Network"),
    }

    def portal_documents(self) -> list[dict[str, Any]]:
        """IT documents listed on the portal's documents page: [{id, title, category, file, ...}]."""
        docs = list(self._BASE_DOCS)
        for kind, (doc_id, title, category) in self._LURE_DOCS.items():
            if kind in self.breadcrumbs:
                docs.append((doc_id, title, category, self.breadcrumbs[kind]))
        out = []
        for doc_id, title, category, path in docs:
            st = self.stat(path)
            if st is None or st.kind != "file":
                continue
            out.append({"id": doc_id, "title": title, "category": category, "file": posixpath.basename(path),
                        "owner": st.owner, "updated": st.mtime, "size_bytes": st.size})
        out.sort(key=lambda doc: doc["updated"], reverse=True)
        return out

    def portal_file(self, ref: str) -> tuple[str, str] | None:
        """(file name, text) of a file published through the portal: a document id from
        portal_documents(), or a file on the backups share. Reading it touches its honeytokens,
        exactly like read_file. None if `ref` is not published."""
        path = next((p for doc_id, _, _, p in self._BASE_DOCS if doc_id == ref), None)
        if path is None:
            path = next((self.breadcrumbs[k] for k, (doc_id, _, _) in self._LURE_DOCS.items()
                         if doc_id == ref and k in self.breadcrumbs), None)
        if path is None:
            p = self._norm(ref if ref.startswith("/") else f"{_fs.BACKUPS}/{ref}")
            if not p.startswith(_fs.BACKUPS + "/"):
                return None
            path = p
        try:
            return posixpath.basename(path), self.read_file(path)
        except OSError:
            return None

    # ================================================================ filesystem

    def hostname(self) -> str:
        return "jump-eas"

    def world_now(self) -> datetime:
        return NOW + timedelta(seconds=time.monotonic() - self._t0)

    @staticmethod
    def _norm(path: str) -> str:
        p = (path or "/").strip()
        if p == "~" or p.startswith("~/"):
            p = _fs.HOME + p[1:]
        if not p.startswith("/"):
            p = _fs.HOME + "/" + p
        p = posixpath.normpath(p)
        if p.startswith("//"):
            p = "/" + p.lstrip("/")
        return p

    @staticmethod
    def _index_child(path: str, index: dict[str, set[str]]) -> None:
        if path == "/":
            return
        parent, name = posixpath.split(path)
        index.setdefault(parent, set()).add(name)

    def _node(self, path: str) -> _fs.Node | None:
        return self._overlay.get(path) or self._tree.get(path)

    def _children_of(self, path: str) -> list[str]:
        names = set(self._children.get(path, ()))
        for p in self._overlay:
            if posixpath.dirname(p) == path and p != "/":
                names.add(posixpath.basename(p))
        return sorted(names)

    def dumps(self) -> list[DumpSpec]:
        return self._dumps

    def _make_dumps(self) -> list[DumpSpec]:
        rng = entity_rng(self.key, self.seed_session, "dumps")
        n = self.census.n
        counts = [n - self.census.recent_13 - self.census.recent_12, n - self.census.recent_13, n]
        size = rng.randint(48_300_000, 48_900_000)   # ls -lh: 46M..48M
        out = []
        for i, day in enumerate((12, 13, 14)):
            if i:
                size += rng.randint(300_000, 700_000)
            started = datetime(2026, 11, day, 2, 10, rng.randint(0, 9))
            out.append(DumpSpec(path=f"{_fs.BACKUPS}/db_dump_2026-11-{day}.sql.gz", started=started,
                                rows=counts[i], size=size))
        return out

    def dump_tokens(self, path: str) -> list[str]:
        return ([self.tok_file] if path == self.latest_dump else []) + [self.tok_mrn]

    def stat(self, path: str) -> FsNode | None:
        p = self._norm(path)
        node = self._node(p)
        if node is None:
            return None
        if node.kind == "dir":
            size = 4096 if not p.startswith(_fs.BACKUPS) else 0
            children = self._children_of(p) if node.readable else []
        else:
            children = []
            if node.size is not None:
                size = node.size
            elif not node.readable:
                size = 0
            else:
                size = len(self._content_of(p, node).encode())
        return FsNode(path=p, kind=node.kind, size=size, mode=node.mode, owner=node.owner, group=node.group,
                      mtime=node.mtime.strftime("%Y-%m-%dT%H:%M:%S"), children=children)

    def listdir(self, path: str) -> list[str]:
        st = self.stat(path)
        if st is None:
            raise FileNotFoundError(path)
        if st.kind != "dir":
            raise NotADirectoryError(path)
        return st.children

    def _content_of(self, p: str, node: _fs.Node) -> str:
        if p in self._content:
            return self._content[p]
        if node.dump is not None:
            text = self._render_dump(node.dump)
        elif callable(node.content):
            text = node.content()
        else:
            text = node.content or ""
        self._content[p] = text
        return text

    def _render_dump(self, spec: DumpSpec) -> str:
        shown = min(PREVIEW_ROWS, spec.rows)
        rows = [(i + 1, self.core(i).to_patient(), self.core(i).updated_at) for i in range(shown)]
        labs: list[Observation] = []
        for i in range(min(LAB_PREVIEW_PATIENTS, spec.rows)):
            labs += [o for o in build_observations(self.key, self.seed_session, self.core(i))
                     if o.issued < spec.started.strftime("%Y-%m-%dT%H:%M:%S")]
        lab_total = spec.rows * 87 + spec.size % 997
        completed = spec.started + timedelta(minutes=18, seconds=spec.size % 57)
        return render_dump(spec, rows, labs, lab_total, flag, completed)

    def read_file(self, path: str) -> str:
        p = self._norm(path)
        node = self._node(p)
        if node is None:
            raise FileNotFoundError(f"{path}: No such file or directory")
        if node.kind == "dir":
            raise IsADirectoryError(f"{path}: Is a directory")
        if not node.readable:
            raise PermissionError(f"{path}: Permission denied")
        text = self._content_of(p, node)
        for tid in node.tokens:
            self.touch(tid, p)
        return text

    def write_file(self, path: str, content: str) -> None:
        p = self._norm(path)
        if not any(p == r or p.startswith(r + "/") for r in _fs.WRITABLE_ROOTS) or p in _fs.WRITABLE_ROOTS:
            raise PermissionError(f"{path}: Permission denied")
        existing = self._node(p)
        if existing is not None and existing.kind == "dir":
            raise IsADirectoryError(f"{path}: Is a directory")
        on_share = p.startswith(_fs.BACKUPS + "/")
        parent = posixpath.dirname(p)
        while self._node(parent) is None:
            self._overlay[parent] = _fs.Node("dir", "drwxr-xr-x" if on_share else "drwxrwxr-x",
                                             "root" if on_share else _fs.USER, "root" if on_share else _fs.USER,
                                             self.world_now())
            parent = posixpath.dirname(parent)
        if on_share:
            node = _fs.Node("file", "-rwxr-xr-x", "root", "root", self.world_now(), content)
        else:
            node = _fs.Node("file", "-rw-rw-r--", _fs.USER, _fs.USER, self.world_now(), content)
        self._overlay[p] = node
        self._content.pop(p, None)

    # ================================================================ exfil support

    def _file_rows(self, path: str) -> list[int] | range:
        p = self._norm(path)
        node = self._node(p)
        if node is None or node.kind != "file":
            return []
        if node.dump is not None:
            return range(node.dump.rows)
        if node.patient_rows is not None:
            return node.patient_rows()
        return []

    def dump_rows(self, path: str, limit: int) -> list[Patient]:
        p = self._norm(path)
        rows = self._file_rows(p)
        node = self._node(p)
        if node is not None and len(rows):
            for tid in node.tokens:
                if tid != self.tok_mrn or self.token_idx in rows:
                    self.touch(tid, p)
        return [self.core(i).to_patient() for i in rows[: max(0, limit)]]

    def dump_row_count(self, path: str) -> int:
        return len(self._file_rows(path))

    def dump_text(self, path: str) -> str:
        """Same as read_file for a dump (decompressed SQL)."""
        return self.read_file(path)

    # ================================================================ breadcrumbs

    def plant_breadcrumb(self, kind: str) -> str:
        """Add a believable lure (BreadcrumbKind) to this session's world; returns its path. Idempotent."""
        if kind in self.breadcrumbs:
            return self.breadcrumbs[kind]
        path, nodes = _bc.plant(self, kind)
        for p in sorted(nodes):
            parent = posixpath.dirname(p)
            while self._node(parent) is None and parent not in nodes:
                self._overlay[parent] = _fs.d(mtime=nodes[p].mtime)
                parent = posixpath.dirname(parent)
            self._overlay[p] = nodes[p]
            self._content.pop(p, None)
        self.breadcrumbs[kind] = path
        return path

    def __repr__(self) -> str:
        return f"<ShadowWorld session={self.session_id!r} static={self.static} patients={self.census.n}>"


def _uname(given: str, family: str) -> str:
    from mayajaal.shadow.population import ascii_fold
    return ascii_fold(f"{given[0]}.{family}").lower().replace("'", "")


__all__ = ["ShadowWorld", "CLINICAL_HOSPITALS"]
