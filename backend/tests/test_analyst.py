"""Incident brief: facts and playbook from a recorded run; the optional model layer via a fake client."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from mayajaal.analyst import AnalystView, brief, facts

RUNS = Path(__file__).resolve().parents[2] / "web" / "public" / "runs"


def load(name: str) -> list[dict]:
    return [json.loads(line) for line in (RUNS / name).read_text().splitlines() if line.strip()]


def test_facts_from_recorded_mayajaal_run() -> None:
    f = facts(load("mayajaal.jsonl"))
    assert f["attacker_seen"] and f["requests"]["real_data_served"] == 0
    assert f["detected"]["by"] and f["diverted"]["after_s"] is not None
    assert f["trackers_taken"] and f["real_secrets_leaked"] == 0
    assert f["stolen_login"]["user"] == "n.okafor"


def test_rule_brief_without_key(monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("mayajaal.investigator.load_env_key", lambda: None)
    b = brief(load("mayajaal.jsonl"))
    assert b["source"] == "rules" and b["analyst"] is None
    assert b["actor_guess"]["type"] == "script"
    assert b["playbook"][0]["do"].startswith("Leave the attacker's session running")
    assert any("HIPAA" in s["do"] and "no real patient data" in s["do"] for s in b["playbook"])


def test_baseline_brief_flags_real_exposure(monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("mayajaal.investigator.load_env_key", lambda: None)
    b = brief(load("baseline.jsonl"))
    assert b["facts"]["requests"]["real_data_served"] > 0
    assert any("Start a HIPAA breach risk assessment" in s["do"] for s in b["playbook"])


class FakeClient:
    def __init__(self) -> None:
        self.seen: dict = {}
        self.messages = SimpleNamespace(parse=self.parse)

    def parse(self, **kw):
        self.seen = kw
        view = AnalystView(summary="A script used a stolen nurse login. It only saw the decoy.",
                           actor_type="script", actor_reasoning="fixed rhythm", likely_goal="steal records",
                           next_moves=["try the VPN file"], priority_steps=[], caveats=["one session only"])
        return SimpleNamespace(parsed_output=view)


def test_model_layer_marks_trail_untrusted_and_has_no_tools() -> None:
    fake = FakeClient()
    b = brief(load("mayajaal.jsonl"), client=fake)
    assert b["source"].startswith("rules + ") and b["analyst"]["actor_type"] == "script"
    content = fake.seen["messages"][0]["content"]
    assert "<untrusted>" in content and "/portal/backups" in content.split("<untrusted>")[1]
    assert "tools" not in fake.seen and fake.seen["output_format"] is AnalystView


def test_model_failure_falls_back_to_rules() -> None:
    class Broken:
        messages = SimpleNamespace(parse=lambda **kw: (_ for _ in ()).throw(TimeoutError()))
    b = brief(load("mayajaal.jsonl"), client=Broken())
    assert b["source"] == "rules" and b["analyst_error"] == "TimeoutError" and b["playbook"]


def test_forensic_report_has_brief_indicators_and_timeline(monkeypatch) -> None:
    from mayajaal.analyst import report_markdown
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("mayajaal.investigator.load_env_key", lambda: None)
    md = report_markdown(load("mayajaal.jsonl"))
    assert md.startswith("# MayaJaal forensic report")
    assert "rule-based brief" in md and "## Indicators" in md and "## Timeline" in md
    assert "First Sight at login" in md and "SCATTER" in md and "TRACKER TAKEN" in md
    assert "0 returned real patient data" in md
