"""Investigator deep agent: read-only tools, and the full plan -> delegate -> report loop with a scripted model."""

from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from mayajaal.investigator import investigate, make_tools

RUNS = Path(__file__).resolve().parents[2] / "web" / "public" / "runs"


def load(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]


EVENTS = load(RUNS / "mayajaal.jsonl")
OTHERS = {p.stem: load(p) for p in RUNS.glob("*.jsonl") if p.stem != "mayajaal"}


def tools() -> dict:
    return {t.__name__: t for t in make_tools(EVENTS, OTHERS)}


def test_tools_are_read_only_views_of_the_event_log() -> None:
    t = tools()
    assert "First Sight at login" in t["defender_decisions"]()
    assert "[shadow]" in t["attacker_requests"](tier="shadow")
    assert "TAKEN ht-" in t["decoy_trackers"]()
    assert json.loads(t["data_protection"]())["scatter"][0]["verified"] is True
    assert t["attack_technique"]("t1078") == "Valid accounts"
    assert "static" in t["search_other_sessions"]("python-httpx")
    assert t["search_other_sessions"]("ab") == "Indicator too short to search."


class Scripted(GenericFakeChatModel):
    def bind_tools(self, tools, **kw):
        return self


def call(name: str, args: dict, i: int) -> AIMessage:
    return AIMessage("", tool_calls=[{"name": name, "args": args, "id": f"c{i}", "type": "tool_call"}])


def test_deep_agent_plans_delegates_and_writes_report() -> None:
    script = iter([
        call("write_file", {"file_path": "/plan.md", "content": "1. timeline 2. indicators 3. response"}, 1),
        call("task", {"subagent_type": "timeline-analyst", "description": "Reconstruct the session."}, 2),
        call("attack_timeline", {}, 3),                                          # inside the sub-agent
        call("write_file", {"file_path": "/findings/timeline.md", "content": "login -> decoy"}, 4),
        AIMessage("Timeline: caught at login, diverted at the admin portal."),     # sub-agent done
        call("write_file", {"file_path": "/report.md", "content": "# Case file\n\nSummary: contained."}, 5),
        AIMessage("Summary: a script used a stolen nurse login and only ever saw the decoy."),
    ])
    out = investigate(EVENTS, OTHERS, model=Scripted(messages=script))
    assert out["available"] and out["report"].startswith("# Case file")
    assert out["plan"].startswith("1. timeline")
    assert "/findings/timeline.md" in out["findings"]
    assert any(t["tool"] == "task" and t["subagent"] == "timeline-analyst" for t in out["trace"])
    assert out["summary"].startswith("Summary:")


def test_without_key_it_says_so(monkeypatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr("mayajaal.investigator.load_env_key", lambda: None)
    out = investigate(EVENTS, OTHERS)
    assert out == {"available": False, "reason": "Set ANTHROPIC_API_KEY to run the investigator."}
