"""Shadow world: determinism, session separation, coherence, overlay, honeytokens, speed, isolation."""

from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

from mayajaal.shadow.dump import PREVIEW_ROWS, parse_patient_rows
from mayajaal.shadow.population import ckd_epi_2021
from mayajaal.shadow.world import ShadowWorld
from mayajaal.world_api import Observation, SessionContext

KEY = bytes.fromhex("6d61796a61616c2d746573742d6b6579")
SHADOW_DIR = Path(__file__).resolve().parents[1] / "mayajaal" / "shadow"


@pytest.fixture(scope="module")
def world() -> ShadowWorld:
    return ShadowWorld("sess-alpha", key=KEY)


# --------------------------------------------------------------------------- determinism


def test_same_session_same_patient_over_1000_calls(world):
    mrn = world.list_patients(None, 37, 1)[0].mrn
    first = world.get_patient(mrn)
    for _ in range(1000):
        assert world.get_patient(mrn) == first
    other = ShadowWorld("sess-alpha", key=KEY)
    assert other.get_patient(mrn) == first
    assert other.observations(mrn) == world.observations(mrn)
    assert other.list_patients("wes", 10, 25) == world.list_patients("wes", 10, 25)
    assert other.read_file("~/.bash_history") == world.read_file("/home/n.okafor/.bash_history")
    assert other.stat("/mnt/backups") == world.stat("/mnt/backups")
    assert other.portal_users() == world.portal_users()


def test_different_sessions_differ(world):
    other = ShadowWorld("sess-beta", key=KEY)
    a, b = world.list_patients(None, 0, 50), other.list_patients(None, 0, 50)
    assert [p.mrn for p in a] != [p.mrn for p in b]
    assert [p.name for p in a] != [p.name for p in b]
    assert world.svc_password != other.svc_password
    assert world.api_key != other.api_key
    assert world.research_url != other.research_url
    assert ShadowWorld("sess-alpha", key=b"another-key-entirely").svc_password != world.svc_password


def test_static_world_ignores_session():
    s1 = ShadowWorld("sess-1", key=KEY, static=True)
    s2 = ShadowWorld("sess-2", key=KEY, static=True)
    assert s1.session_id == "sess-1"
    assert s1.list_patients(None, 0, 100) == s2.list_patients(None, 0, 100)
    assert s1.read_file("/home/n.okafor/.bash_history") == s2.read_file("/home/n.okafor/.bash_history")
    assert s1.honeytokens.keys() == s2.honeytokens.keys()
    assert s1.list_patients(None, 0, 5) != ShadowWorld("sess-1", key=KEY).list_patients(None, 0, 5)


# --------------------------------------------------------------------------- population shape


def test_population_and_mrn_format(world):
    n = world.total_patients()
    assert 4700 <= n <= 4900
    by_h = {h: len(world.census.by_hospital[h]) for h in world.census.by_hospital}
    assert "lum" not in by_h and set(by_h) == {"aur", "riv", "nor", "eas", "wes"}
    assert by_h["aur"] > by_h["nor"] > by_h["riv"] > by_h["eas"]
    assert world.list_patients("lum", 0, 10) == []
    pts = world.list_patients(None, 0, 400)
    assert len({p.mrn for p in pts}) == 400
    for p in pts:
        assert re.fullmatch(r"MRN-\d{6}", p.mrn)
        assert "sess" not in p.mrn and "alpha" not in p.mrn
        assert "Meridian City" in p.address
        assert re.fullmatch(r"\(\d{3}\) \d{3}-\d{4}", p.phone)
        assert p.attending.startswith("Dr. ")
    assert world.get_patient("MRN-000000") is None
    assert world.get_patient(pts[3].mrn.lower()) == pts[3]
    assert world.get_patient(pts[3].mrn[4:]) == pts[3]
    for p in world.list_patients("riv", 0, 60):
        assert int(p.dob[:4]) >= 2008


def test_attending_roster_is_stable_per_hospital(world):
    for h in ("aur", "eas", "wes"):
        roster = {c.name for c in world.census.rosters[h]}
        attendings = {p.attending for p in world.list_patients(h, 0, 200)}
        assert attendings <= roster
        assert 3 <= len(attendings) <= len(roster)


def test_labs_correlate_with_conditions(world):
    diabetic = ckd = anaemic = 0
    lum = total = 0
    for p in world.list_patients(None, 0, 600):
        obs = world.observations(p.mrn)
        assert obs, p.mrn
        codes = " ".join(p.conditions)
        by = {}
        for o in obs:
            by.setdefault(o.code, []).append(o)
            assert re.fullmatch(r"2026-(08|09|10|11)-\d\dT\d\d:\d\d:\d\d", o.issued)
            assert "2026-08-15" < o.issued <= "2026-11-14T03:47:12"
            assert o.unit and o.ref_range
            total += 1
            lum += o.performer_hospital == "lum"
            assert o.performer_hospital in ("lum", p.hospital_id)
        if "E11." in codes or "E10.9" in codes:
            assert by["4548-4"][0].value >= 6.5
            diabetic += 1
        if "N18." in codes or "E11.22" in codes:
            assert all(o.value < 64 for o in by["62238-1"])
            ckd += 1
        if "D50.9" in codes:
            assert min(o.value for o in by["718-7"]) < (12.0 if p.sex == "F" else 13.5)
            anaemic += 1
        # eGFR is computed from the same draw's creatinine (CKD-EPI 2021)
        for e in by.get("62238-1", []):
            cr = [c for c in by["2160-0"] if c.obs_id.rsplit(".", 1)[0][-5:] and c.issued[:10] == e.issued[:10]]
            if cr:
                age = 2026 - int(p.dob[:4])
                assert any(abs(ckd_epi_2021(c.value, a, p.sex) - e.value) <= 2 for c in cr for a in (age - 1, age))
    assert diabetic > 20 and ckd > 5 and anaemic > 3
    assert 0.55 < lum / total < 0.95


# --------------------------------------------------------------------------- coherence


def test_dump_rows_equal_get_patient(world):
    path = world.latest_dump
    assert world.dump_row_count(path) == world.total_patients()
    rows = world.dump_rows(path, 300)
    assert rows == world.list_patients(None, 0, 300)
    for p in rows[::7]:
        assert world.get_patient(p.mrn) == p


def test_dump_text_rows_match_dump_rows(world):
    path = world.latest_dump
    text = world.read_file(path)
    assert text.startswith("--\n-- PostgreSQL database dump\n--")
    assert "CREATE TABLE public.patients" in text and "COPY public.patients (" in text
    assert f"{world.total_patients():,} rows total" in text
    parsed = parse_patient_rows(text)
    assert len(parsed) == PREVIEW_ROWS
    assert parsed == world.dump_rows(path, PREVIEW_ROWS)
    assert world.stat(path).size > 46 * 1024 * 1024


def test_older_dumps_are_prefixes(world):
    dumps = sorted(c for c in world.stat("/mnt/backups").children if c.startswith("db_dump_"))
    assert dumps == ["db_dump_2026-11-12.sql.gz", "db_dump_2026-11-13.sql.gz", "db_dump_2026-11-14.sql.gz"]
    counts = [world.dump_row_count(f"/mnt/backups/{d}") for d in dumps]
    assert counts[0] < counts[1] < counts[2] == world.total_patients()
    sizes = [world.stat(f"/mnt/backups/{d}").size / 1048576 for d in dumps]
    assert all(46 <= s < 48.5 for s in sizes) and sizes == sorted(sizes)
    assert world.dump_rows(f"/mnt/backups/{dumps[0]}", 10) == world.dump_rows(f"/mnt/backups/{dumps[2]}", 10)


def test_files_reference_real_shadow_patients(world):
    notes = world.read_file("/home/n.okafor/Documents/handover_notes.txt")
    mrns = re.findall(r"MRN-\d{6}", notes)
    assert len(mrns) >= 3
    for m in mrns:
        p = world.get_patient(m)
        assert p is not None and p.hospital_id == "eas"
        assert p.name.split(" ", 1)[1].upper() in notes
    csv = world.read_file("/mnt/backups/lis_results_export.csv").splitlines()
    assert len(csv) > 100
    acc, mrn, *_ = csv[1].split(",")
    assert any(o.obs_id.startswith(acc) for o in world.observations(mrn))
    assert world.dump_row_count("/mnt/backups/lis_results_export.csv") > 20
    readme = world.read_file("/mnt/backups/research_cohort_q4/README.md")
    assert world.research_url in readme and "research-portal.lum.meridian.local" in readme


def test_jump_box_files(world):
    hist = world.read_file("/home/n.okafor/.bash_history")
    assert (f"mount -t cifs //lum-backup01/nightly /mnt/backups -o user=svc_lisbackup,pass={world.svc_password}"
            in hist)
    assert world.api_key in world.read_file("/opt/lis/config.yaml")
    assert 'VERSION_ID="22.04"' in world.read_file("/etc/os-release")
    hosts = world.read_file("/etc/hosts")
    for h in ("lum-backup01", "lis-api.lum.meridian.local", "ehr-aur01", "ehr-riv01", "ehr-nor01", "ehr-eas01",
              "ehr-wes01", "jump-eas"):
        assert h in hosts
    assert "n.okafor:x:1001" in world.read_file("/etc/passwd")
    assert "sshd" in world.read_file("/var/log/auth.log")
    assert world.hostname() == "jump-eas"
    assert set(world.stat("/home/n.okafor").children) >= {".bash_history", ".bashrc", "Documents"}
    assert world.stat("/nope") is None
    with pytest.raises(FileNotFoundError):
        world.read_file("/nope")
    with pytest.raises(IsADirectoryError):
        world.read_file("/mnt/backups")
    with pytest.raises(PermissionError):
        world.read_file("/etc/shadow")


# --------------------------------------------------------------------------- overlay


def test_overlay_isolation():
    a = ShadowWorld("sess-overlay-a", key=KEY)
    b = ShadowWorld("sess-overlay-b", key=KEY)
    a.write_file("/tmp/loot.txt", "stolen")
    a.write_file("~/notes/plan.md", "step 1")
    assert a.read_file("/tmp/loot.txt") == "stolen"
    assert "loot.txt" in a.stat("/tmp").children
    assert a.stat("/home/n.okafor/notes").kind == "dir"
    assert a.read_file("/home/n.okafor/notes/plan.md") == "step 1"
    assert b.stat("/tmp/loot.txt") is None
    a.write_file("/home/n.okafor/.bashrc", "pwned")
    assert a.read_file("/home/n.okafor/.bashrc") == "pwned"
    assert b.read_file("/home/n.okafor/.bashrc") != "pwned"
    with pytest.raises(PermissionError):
        a.write_file("/etc/passwd", "root::0:0::/:/bin/sh")

    mrn = a.list_patients(None, 5, 1)[0].mrn
    base = a.observations(mrn)
    hb = next(o for o in base if o.code == "718-7")
    tampered = Observation(**{**vars(hb), "value": 4.1})
    a.put_observation(tampered)
    new = a.put_observation(Observation("", mrn, "2345-7", "Glucose", 31.0, "mg/dL", "70-99", "", "lum"))
    assert new.obs_id and new.issued
    got = a.observations(mrn)
    assert next(o for o in got if o.obs_id == hb.obs_id).value == 4.1
    assert any(o.obs_id == new.obs_id for o in got)
    assert len(got) == len(base) + 1
    assert next(o for o in ShadowWorld("sess-overlay-a", key=KEY).observations(mrn)
                if o.obs_id == hb.obs_id).value == hb.value


# --------------------------------------------------------------------------- honeytokens


async def test_honeytokens_minted_and_touched_once():
    events = []

    async def sink(ev):
        events.append(ev)

    w = ShadowWorld("sess-ht", key=KEY, sink=sink, run_id="run-42")
    await w.flush()
    minted = [e for e in events if e.type == "honeytoken.minted"]
    assert sorted(e.data["kind"] for e in minted) == ["api_key", "credential", "file", "mrn", "url"]
    assert all(e.run_id == "run-42" and e.session_id == "sess-ht" and e.tier == "shadow" and e.actor == "defender"
               and e.hospital_id == "eas" for e in minted)

    for _ in range(3):
        w.read_file("/home/n.okafor/.bash_history")
        w.get_patient(w.honeytokens[w.tok_mrn].value)
        w.read_file(w.latest_dump)
        w.dump_rows(w.latest_dump, 5000)
        w.read_file("/opt/lis/config.yaml")
        w.read_file("/mnt/backups/research_cohort_q4/README.md")
    await w.flush()
    touched = [e for e in events if e.type == "honeytoken.touched"]
    assert sorted(e.data["kind"] for e in touched) == ["api_key", "credential", "file", "mrn", "url"]
    assert len({e.data["token_id"] for e in touched}) == 5
    assert w.touched_honeytokens == set(w.honeytokens)
    assert [t.kind for t in w.touched_since(3)] == [t.kind for t in w.touched_since(0)][3:]


def test_honeytoken_events_queue_without_loop_and_untouched_reads():
    async def sink(ev):  # never awaited here: no running loop
        raise AssertionError

    w = ShadowWorld("sess-ht-sync", key=KEY, sink=sink)
    assert len(w.drain_events()) == 5
    w.read_file("/etc/hosts")
    w.list_patients(None, 0, 300)
    w.stat("/home/n.okafor/.bash_history")
    assert w.touched_honeytokens == set() and w.drain_events() == []
    w.read_file("/home/n.okafor/.bash_history")
    w.read_file("/home/n.okafor/.bash_history")
    ev = w.drain_events()
    assert [e.type for e in ev] == ["honeytoken.touched"] and ev[0].data["kind"] == "credential"
    found = w.match_honeytokens(f"smbclient //lum-backup01/nightly -U svc_lisbackup%{w.svc_password}")
    assert [t.kind for t in found] == ["credential"]


def test_breadcrumbs():
    w = ShadowWorld("sess-bc", key=KEY)
    other = ShadowWorld("sess-bc-2", key=KEY)
    before = len(w.honeytokens)
    for kind in ("backup_share", "admin_credential", "research_dataset", "lab_service_account", "vpn_config"):
        path = w.plant_breadcrumb(kind)
        assert w.plant_breadcrumb(kind) == path
        st = w.stat(path)
        assert st is not None and st.kind == "file", kind
        assert w.read_file(path)
        parent, name = path.rsplit("/", 1)
        assert name in w.stat(parent).children
        assert other.stat(path) is None
    assert len(w.honeytokens) == before + 5
    arch = w.breadcrumbs["backup_share"]
    assert 0 < w.dump_row_count(arch) < w.total_patients()
    assert parse_patient_rows(w.read_file(arch)) == w.dump_rows(arch, PREVIEW_ROWS)
    link = w.breadcrumbs["research_dataset"]
    assert w.dump_rows(link, 3)[0] == w.get_patient(w.dump_rows(link, 1)[0].mrn)
    assert any(u.username == "it.breakglass" for u in w.portal_users())
    with pytest.raises(ValueError):
        w.plant_breadcrumb("nonsense")


def test_registry_caches_by_session():
    from mayajaal.shadow import registry

    registry.reset()
    a = registry.get_shadow_world(SessionContext(session_id="r1", run_id="run-1"))
    assert registry.get_shadow_world(SessionContext(session_id="r1")) is a
    assert registry.get_shadow_world(SessionContext(session_id="r2")) is not a
    assert a.run_id == "run-1"
    s = registry.get_static_world()
    assert s is registry.get_static_world() and s.static
    registry.reset()


# --------------------------------------------------------------------------- speed


def test_list_patients_1000_is_fast():
    w = ShadowWorld("sess-speed", key=KEY)
    t = time.perf_counter()
    pts = w.list_patients(None, 0, 1000)
    dt = time.perf_counter() - t
    assert len(pts) == 1000
    assert dt < 0.3, f"list_patients(1000) took {dt * 1000:.0f} ms"


# --------------------------------------------------------------------------- isolation from the real tier


def test_shadow_never_imports_real_or_reads_data():
    bad = re.compile(r"mayajaal\.real|from\s+mayajaal\s+import\s+real|import\s+real\b|data/real|backend/data|"
                     r"\.\./data|['\"]data['\"]")
    for src in SHADOW_DIR.rglob("*.py"):
        for i, line in enumerate(src.read_text().splitlines(), 1):
            assert not bad.search(line), f"{src.name}:{i}: {line.strip()}"


def test_shadow_runtime_does_not_load_real():
    code = (
        "import sys, asyncio\n"
        "from mayajaal.shadow import ShadowWorld\n"
        "w = ShadowWorld('x', key=b'k')\n"
        "w.read_file(w.latest_dump); w.list_patients(None, 0, 50); w.portal_users()\n"
        "for k in ('backup_share','research_dataset'): w.plant_breadcrumb(k)\n"
        "assert not any(m == 'mayajaal.real' or m.startswith('mayajaal.real.') for m in sys.modules), "
        "[m for m in sys.modules if 'real' in m]\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                       cwd=SHADOW_DIR.parents[1])
    assert r.returncode == 0, r.stderr


FINGERPRINT = (
    "import hashlib, json, dataclasses\n"
    "from mayajaal.shadow import ShadowWorld\n"
    "w = ShadowWorld('sess-xproc', key=bytes.fromhex('6d61796a61616c2d746573742d6b6579'))\n"
    "pts = w.list_patients(None, 0, 400)\n"
    "blob = json.dumps([dataclasses.asdict(p) for p in pts]"
    " + [dataclasses.asdict(o) for p in pts[:80] for o in w.observations(p.mrn)]"
    " + [dataclasses.asdict(u) for u in w.portal_users()], sort_keys=True)\n"
    "blob += w.read_file(w.latest_dump) + w.read_file('/mnt/backups/lis_results_export.csv')"
    " + w.read_file('~/Documents/handover_notes.txt') + w.read_file('/var/log/auth.log')\n"
    "print(hashlib.sha256(blob.encode()).hexdigest())\n"
)


def test_deterministic_across_processes_and_hash_seeds():
    import os

    outs = set()
    for seed in ("1", "2", "31337"):
        r = subprocess.run([sys.executable, "-c", FINGERPRINT], capture_output=True, text=True,
                           cwd=SHADOW_DIR.parents[1], env={**os.environ, "PYTHONHASHSEED": seed})
        assert r.returncode == 0, r.stderr
        outs.add(r.stdout.strip())
    assert len(outs) == 1
