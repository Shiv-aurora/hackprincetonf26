import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mayajaal.continuity.router import build_router
from mayajaal.continuity.scenario import build_timeline, format_comparison, run_synnovis, synnovis_comparison
from mayajaal.contracts import DATA_MODELS, Event


def _run(speed=10_000.0, run_id="test-synnovis"):
    events: list[Event] = []
    result = asyncio.run(run_synnovis(events.append, speed=speed, run_id=run_id))
    return events, result


def test_scenario_emits_valid_events_in_order():
    events, result = _run()
    assert result["run_id"] == "test-synnovis" and result["events"] == len(events)
    for ev in events:
        Event.model_validate(ev.model_dump()).validated()
        DATA_MODELS[ev.type].model_validate(ev.data)
        assert ev.run_id == "test-synnovis" and ev.actor == "system"
    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    assert all(a.ts <= b.ts for a, b in zip(events, events[1:]))

    types = [e.type for e in events]
    assert types[0] == "run.started" and types[-1] == "run.ended"
    start = events[0].data
    assert start["model"] == "scripted" and start["live"] is False and start["mission"] == "disrupt"
    assert start["attacker_label"] == "synnovis-replay"

    def idx(pred):
        return next(i for i, e in enumerate(events) if pred(e))

    compromised = idx(lambda e: e.type == "node.status" and e.hospital_id == "lum" and e.data["status"] == "compromised")
    captured = idx(lambda e: e.type == "keyshare.status" and e.data["state"] == "captured")
    quarantined = idx(lambda e: e.type == "node.status" and e.data["status"] == "quarantined")
    first_order = idx(lambda e: e.type == "lab.order")
    first_stats = idx(lambda e: e.type == "continuity.stats")
    assert first_stats < compromised < captured < quarantined < first_order
    assert events[captured].data["shares_captured_total"] == 1 and events[captured].hospital_id == "lum"

    # every order: queued, then exactly one of rerouted/unservable, then completed if rerouted
    orders: dict[str, list[dict]] = {}
    for e in events:
        if e.type == "lab.order":
            orders.setdefault(e.data["order_id"], []).append(e.data)
    assert 35 <= len(orders) <= 45
    for oid, seq in orders.items():
        statuses = [d["status"] for d in seq]
        assert statuses in (["queued", "rerouted", "completed"], ["queued", "unservable"]), (oid, statuses)
        for d in seq:
            assert d["to_hospital"] != "lum"
        if statuses[1] == "rerouted":
            assert seq[1]["to_hospital"] and seq[1]["eta_min"] > 0

    # stats recover from the shock to the final VitalSwitch number
    stats = [e.data for e in events if e.type == "continuity.stats"]
    shock = stats[1]["stat_on_time_pct"]
    final = stats[-1]["stat_on_time_pct"]
    assert final > shock
    vsw = result["comparison"]["policies"]["vitalswitch"]
    assert final == vsw["stat_on_time_pct"] and stats[-1]["unservable"] == vsw["unservable"]
    later = [s["stat_on_time_pct"] for s in stats[1:]]
    assert later == sorted(later)  # monotone recovery

    ended = events[-1].data
    assert ended["outcome"]["secrets_leaked"] == 0
    assert ended["outcome"]["mission_won"] == (final < 80)


def test_scenario_real_time_scaling():
    steps = build_timeline()
    assert 30 < steps[-1].at < 120  # about a minute at speed 1
    events, _ = _run(speed=steps[-1].at / 0.2)  # should take ~0.2 s
    assert events[-1].type == "run.ended" and events[-1].data["duration_s"] >= 0.15


def test_async_sink_supported():
    got = []

    async def sink(ev):
        got.append(ev)

    asyncio.run(run_synnovis(sink, speed=10_000))
    assert got and got[-1].type == "run.ended"


def test_comparison_shape_and_format():
    cmp = synnovis_comparison()
    assert set(cmp["policies"]) == {"no_reroute", "nearest", "vitalswitch"}
    assert cmp["orders"] == 40
    text = format_comparison(cmp)
    assert "VitalSwitch" in text and "nearest" in text


def test_router_compare_and_start():
    got: list[Event] = []

    async def sink(ev):
        got.append(ev)

    app = FastAPI()
    app.include_router(build_router(sink))
    with TestClient(app) as client:
        r = client.get("/scenario/compare")
        assert r.status_code == 200
        body = r.json()
        assert body["policies"]["vitalswitch"]["stat_on_time_pct"] >= body["policies"]["nearest"]["stat_on_time_pct"]

        r = client.post("/scenario/synnovis/start", json={"speed": 50})
        assert r.status_code == 200
        run_id = r.json()["run_id"]
        assert client.post("/scenario/synnovis/start", json={}).status_code == 409
        assert client.get("/scenario/synnovis/status").json() == {"running": True, "run_id": run_id}
