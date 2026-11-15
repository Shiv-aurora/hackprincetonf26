"""MIRAGE: the defender's intent model, the lure planners and their offline evaluation.

    mirage.intent             IntentFilter, features_from_request, make_lane_adjuster, intent_event
                              (gateway side; also runs the lure planner and scores take / ignore)
    mirage.planner            Planner (one-step info gain), StealthPlanner (MIRAGE-S: info gain against
                              attacker suspicion, 2-lure lookahead), header parsing. Never imports real.
    mirage.suspicion          SuspicionModel, LureState: the attacker's own belief that this is a decoy
    mirage.shadow_hook        make_planner_middleware (shadow process: plants what the gateway asks for)
    mirage.evaluate           original offline simulation:  python -m mayajaal.mirage.evaluate
    mirage.evaluate_planners  all planners, paired seeds, CIs: python -m mayajaal.mirage.evaluate_planners

This package __init__ deliberately imports nothing, so the shadow process can import the planner
without pulling in gateway-side code.
"""
