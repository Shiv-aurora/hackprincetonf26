"""MIRAGE-lite: the defender's intent model (gateway side) and breadcrumb planner (shadow side).

    mirage.intent       IntentFilter, features_from_request, make_lane_adjuster, intent_event
    mirage.planner      Planner, parse_posterior_header         (shadow process; never imports real)
    mirage.shadow_hook  make_planner_middleware                 (shadow process)
    mirage.evaluate     offline simulation: python -m mayajaal.mirage.evaluate

This package __init__ deliberately imports nothing, so the shadow process can import the planner
without pulling in gateway-side code.
"""
