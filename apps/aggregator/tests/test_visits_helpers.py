"""Unit tests for _build_visits_by_backstory and _collect_findings (aggregator.main).

These helpers are called by run_study() on every aggregation run. Their boundary
behaviors are load-bearing but not exercised by the e2e or score_visit tests:
- _build_visits_by_backstory silently drops incomplete pairs (backstory with
  only variant 0 or only variant 1). A regression here would cause paired_delta
  to receive fewer pairs than expected without any error.
- _collect_findings skips non-string entries and handles None-valued lists.
  A regression here would silently pass None items to the clustering step.
"""

from __future__ import annotations

import pytest

from aggregator.main import _build_visits_by_backstory, _collect_findings


# ── helpers ──────────────────────────────────────────────────────────────────

def _visit(backstory_id: str, variant: int, *, will_to_buy: int = 5, next_action: str = "leave", **extras) -> dict:
    output = {"will_to_buy": will_to_buy, "next_action": next_action, **extras}
    return {"backstory_id": backstory_id, "variant": variant, "output": output}


# ── _build_visits_by_backstory ────────────────────────────────────────────────

def test_complete_pair_is_retained() -> None:
    visits = [_visit("bs-1", 0), _visit("bs-1", 1)]
    result = _build_visits_by_backstory(visits)
    assert "bs-1" in result
    assert 0 in result["bs-1"] and 1 in result["bs-1"]


def test_incomplete_pair_only_variant_0_is_dropped() -> None:
    visits = [_visit("bs-a", 0)]
    result = _build_visits_by_backstory(visits)
    assert "bs-a" not in result


def test_incomplete_pair_only_variant_1_is_dropped() -> None:
    visits = [_visit("bs-b", 1)]
    result = _build_visits_by_backstory(visits)
    assert "bs-b" not in result


def test_mixed_complete_and_incomplete() -> None:
    visits = [
        _visit("complete", 0),
        _visit("complete", 1),
        _visit("only-zero", 0),
        _visit("only-one", 1),
    ]
    result = _build_visits_by_backstory(visits)
    assert set(result.keys()) == {"complete"}


def test_score_and_next_action_are_extracted() -> None:
    visits = [
        _visit("bs-x", 0, will_to_buy=3, next_action="leave"),
        _visit("bs-x", 1, will_to_buy=8, next_action="purchase_paid_today"),
    ]
    result = _build_visits_by_backstory(visits)
    assert result["bs-x"][0]["score"] == 3
    assert result["bs-x"][1]["score"] == 8
    assert result["bs-x"][0]["next_action"] == "leave"
    assert result["bs-x"][1]["next_action"] == "purchase_paid_today"


def test_empty_input_returns_empty_dict() -> None:
    assert _build_visits_by_backstory([]) == {}


# ── _collect_findings ────────────────────────────────────────────────────────

def _visit_with_findings(
    *,
    objections: list | None = None,
    confusions: list | None = None,
    unanswered_blockers: list | None = None,
    questions: list | None = None,
) -> dict:
    output: dict = {}
    if objections is not None:
        output["objections"] = objections
    if confusions is not None:
        output["confusions"] = confusions
    if unanswered_blockers is not None:
        output["unanswered_blockers"] = unanswered_blockers
    if questions is not None:
        output["questions"] = questions
    return {"backstory_id": "x", "variant": 0, "output": output}


def test_collect_findings_returns_all_four_kinds() -> None:
    result = _collect_findings([])
    assert set(result.keys()) == {"objections", "confusions", "unanswered_blockers", "questions"}


def test_collect_findings_aggregates_strings_across_visits() -> None:
    visits = [
        _visit_with_findings(objections=["too expensive"]),
        _visit_with_findings(objections=["no SOC 2"]),
    ]
    result = _collect_findings(visits)
    assert result["objections"] == ["too expensive", "no SOC 2"]


def test_collect_findings_skips_non_string_items() -> None:
    visits = [_visit_with_findings(confusions=[123, None, "real confusion", True])]
    result = _collect_findings(visits)
    assert result["confusions"] == ["real confusion"]


def test_collect_findings_handles_none_list_gracefully() -> None:
    visits = [{"backstory_id": "x", "variant": 0, "output": {"objections": None}}]
    result = _collect_findings(visits)
    assert result["objections"] == []


def test_collect_findings_handles_missing_key_gracefully() -> None:
    visits = [{"backstory_id": "x", "variant": 0, "output": {}}]
    result = _collect_findings(visits)
    for kind in ("objections", "confusions", "unanswered_blockers", "questions"):
        assert result[kind] == []
