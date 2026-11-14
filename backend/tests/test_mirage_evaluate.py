"""MIRAGE-lite offline evaluation: smoke test (small, fast) and honest labelling."""

from __future__ import annotations

import json

from mayajaal.mirage import evaluate as ev
from mayajaal.mirage.model import GOALS


def test_evaluate_smoke(tmp_path):
    out = tmp_path / "res.json"
    ev.main(["--seeds", "6", "--steps", "12", "--out", str(out)])
    data = json.loads(out.read_text())
    assert "not a measurement of real attackers" in data["label"]
    for variant in ev.VARIANTS:
        for g in GOALS:
            for s in ev.STRATEGIES:
                cell = data["results"][variant][g][s]
                assert 0 <= cell["accuracy_at_10"] <= 1 and 1 <= cell["mean_steps_to_0.8"] <= 12
        assert data["results"][variant]["exfil"]["none"]["breadcrumbs_per_session"] == 0


def test_common_random_numbers_and_breadcrumbs_only_when_diverted():
    for seed in range(5):
        r = ev.run_session("benign", seed, "mirage", "matched", 15)
        assert not r["diverted"] and not r["breadcrumbs"]
        a = ev.run_session("exfil", seed, "mirage", "matched", 15)
        assert a["diverted"] and a["breadcrumbs"]


def test_committed_results_file_is_labelled():
    data = json.loads(ev.OUT_PATH.read_text())
    assert data["label"] == ev.LABEL
    assert set(data["summary_attack_goals"]["matched"]) == set(ev.STRATEGIES)
