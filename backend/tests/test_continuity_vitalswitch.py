from mayajaal.continuity import vitalswitch as vs


def _net(**status):
    net = vs.LabNetwork.from_world()
    for lab, st in status.items():
        net.set_status(lab, st)
    return net


def test_transport_times():
    net = vs.LabNetwork.from_world()
    assert net.transport_min("aur", "aur") == 0
    # aur (50,52) -> lum (70,22): distance ~36.06
    assert abs(net.transport_min("aur", "lum") - (12 + 0.4 * 36.0555)) < 0.01


def test_never_assigns_to_quarantined_or_down_labs():
    orders = vs.synnovis_orders(60, seed=5)
    net = _net(lum="quarantined", aur="down")
    for plan in (vs.plan_vitalswitch(orders, net), vs.plan_nearest(orders, net)):
        assert len(plan) == len(orders)
        assert all(a.lab_id not in {"lum", "aur"} for a in plan)
    # a compromised lab is not used either
    plan = vs.plan_vitalswitch(orders, _net(lum="compromised"))
    assert all(a.lab_id != "lum" for a in plan)


def test_vitalswitch_never_late():
    orders = vs.synnovis_orders()
    for a in vs.plan_vitalswitch(orders, vs.outage_network()):
        if a.status == "completed":
            assert a.completion_min <= a.order.deadline_min
        else:
            assert a.status == "unservable" and a.lab_id is None


def _single_lab_net(capacity_per_hr):
    """Only Eastbank's lab is usable, with an exact capacity."""
    net = vs.LabNetwork.from_world()
    for lab in net.labs.values():
        if lab.id != "eas":
            lab.status = "quarantined"
    net.labs["eas"].capacity_per_hr = capacity_per_hr
    return net


def test_stat_prioritised_over_routine_under_scarcity():
    # One usable lab, 3 tests/hour → 20-min slots. Two routine orders arrive first, then a STAT.
    net = _single_lab_net(3.0)
    r1 = vs.LabOrder.make("R1", "routine", "Lipid panel", "eas", 0.0)
    r2 = vs.LabOrder.make("R2", "routine", "HbA1c", "eas", 0.0)
    stat = vs.LabOrder.make("S1", "stat", "Hemoglobin", "eas", 0.5)   # deadline 60.5
    plan = {a.order.order_id: a for a in vs.plan_vitalswitch([r1, r2, stat], net, epoch_min=2.0)}
    # decided at minute 2: STAT takes slot 1 (20-40) → done 48; routine follow
    assert plan["S1"].status == "completed" and plan["S1"].completion_min <= 60.5
    assert plan["R1"].status == plan["R2"].status == "completed"  # routine still fits in 24 h
    assert min(plan["R1"].completion_min, plan["R2"].completion_min) > plan["S1"].completion_min
    # FIFO nearest-lab gives slots 0 and 1 to the routines → STAT lands in slot 2 → 68 min, late
    naive = {a.order.order_id: a for a in vs.plan_nearest([r1, r2, stat], net)}
    assert naive["S1"].status == "late"


def test_unservable_when_capacity_truly_lacks():
    net = _single_lab_net(3.0)  # 20-min slots
    stats = [vs.LabOrder.make(f"S{i}", "stat", "Potassium", "eas", 0.0) for i in range(4)]
    plan = vs.plan_vitalswitch(stats, net, epoch_min=2.0)
    # decided at 2: slot 1 → 40+12=52 ok; slot 2 → 60+12=72 > 60 → nothing can do the rest in time
    assert sum(a.status == "completed" for a in plan) == 1
    assert sum(a.status == "unservable" for a in plan) == 3
    # nothing usable at all → everything unservable
    none = vs.LabNetwork.from_world()
    for lab in none.labs.values():
        lab.status = "down"
    assert all(a.status == "unservable" for a in vs.plan_vitalswitch(stats, none))


def test_policy_ordering_on_scenario_stream():
    orders = vs.synnovis_orders()
    assert len(orders) == 40
    cmp = vs.compare_policies(orders)
    p = cmp["policies"]
    vsw, near, wait = (p[k]["stat_on_time_pct"] for k in ("vitalswitch", "nearest", "no_reroute"))
    assert vsw >= near >= wait
    assert vsw > near  # VitalSwitch should beat naive nearest-lab on this stream
    for u in ("urgent", "routine"):
        assert p["vitalswitch"][f"{u}_on_time_pct"] >= p["no_reroute"][f"{u}_on_time_pct"]


def test_policy_ordering_holds_across_seeds():
    for seed in range(1, 9):
        p = vs.compare_policies(vs.synnovis_orders(seed=seed))["policies"]
        assert p["vitalswitch"]["stat_on_time_pct"] >= p["nearest"]["stat_on_time_pct"] >= p["no_reroute"]["stat_on_time_pct"]


def test_order_stream_deterministic():
    assert vs.synnovis_orders(seed=3) == vs.synnovis_orders(seed=3)
    o = vs.synnovis_orders()[0]
    assert o.deadline_min - o.created_min == vs.DEADLINE_MIN[o.urgency]
