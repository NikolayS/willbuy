"""Unit tests for aggregator helper functions.

These functions are exercised indirectly by test_main_e2e.py but benefit
from isolated unit tests that make the invariants explicit:
  - _build_visits_by_backstory: drops incomplete pairs (no single-variant visits)
  - _collect_findings: filters non-string entries, handles missing kinds
  - _bs_map_get: tolerates non-integer backstory IDs
"""

from __future__ import annotations

from aggregator.main import (
    _build_visits_by_backstory,
    _collect_findings,
    _bs_map_get,
)


# ── _build_visits_by_backstory ───────────────────────────────────────────────

def _visit(bs_id: str, variant: int, score: int, action: str = "leave") -> dict:
    return {
        "backstory_id": bs_id,
        "variant": variant,
        "output": {"will_to_buy": score, "next_action": action},
    }


def test_build_visits_paired_returns_complete_pair() -> None:
    visits = [
        _visit("bs1", 0, 4),
        _visit("bs1", 1, 7),
    ]
    result = _build_visits_by_backstory(visits)
    assert "bs1" in result
    assert result["bs1"][0]["score"] == 4
    assert result["bs1"][1]["score"] == 7


def test_build_visits_drops_incomplete_pairs() -> None:
    # bs1 has both A and B; bs2 has only A → bs2 must be dropped.
    visits = [
        _visit("bs1", 0, 3),
        _visit("bs1", 1, 8),
        _visit("bs2", 0, 5),   # no variant 1 partner
    ]
    result = _build_visits_by_backstory(visits)
    assert "bs1" in result
    assert "bs2" not in result


def test_build_visits_empty_input() -> None:
    assert _build_visits_by_backstory([]) == {}


def test_build_visits_all_unpaired() -> None:
    visits = [_visit("bs1", 0, 2), _visit("bs2", 1, 9)]
    assert _build_visits_by_backstory(visits) == {}


# ── _collect_findings ────────────────────────────────────────────────────────

def _finding_visit(kind: str, findings: list) -> dict:
    return {"backstory_id": "x", "variant": 0, "output": {kind: findings}}


def test_collect_findings_aggregates_strings() -> None:
    visits = [
        _finding_visit("unanswered_blockers", ["too expensive", "unclear pricing"]),
        _finding_visit("unanswered_blockers", ["needs SSO"]),
    ]
    result = _collect_findings(visits)
    assert result["unanswered_blockers"] == ["too expensive", "unclear pricing", "needs SSO"]


def test_collect_findings_filters_non_strings() -> None:
    # The aggregator defensively skips non-string entries (e.g., null from LLM).
    visits = [
        _finding_visit("objections", ["too complex", None, 42, "no API"]),
    ]
    result = _collect_findings(visits)
    assert result["objections"] == ["too complex", "no API"]


def test_collect_findings_handles_missing_kind() -> None:
    # Visit with no 'confusions' key → that category stays empty.
    visits = [{"backstory_id": "x", "variant": 0, "output": {"unanswered_blockers": ["a"]}}]
    result = _collect_findings(visits)
    assert result["confusions"] == []
    assert result["unanswered_blockers"] == ["a"]


def test_collect_findings_handles_null_list_for_kind() -> None:
    # Some LLM outputs return null instead of [] for empty lists.
    visits = [_finding_visit("questions", None)]
    result = _collect_findings(visits)
    assert result["questions"] == []


def test_collect_findings_empty_input() -> None:
    result = _collect_findings([])
    for v in result.values():
        assert v == []


# ── _bs_map_get ──────────────────────────────────────────────────────────────

def test_bs_map_get_integer_key() -> None:
    m = {1: {"name": "Alice"}, 2: {"name": "Bob"}}
    assert _bs_map_get(m, 1)["name"] == "Alice"


def test_bs_map_get_string_int_key() -> None:
    # Fixture backstory IDs may come in as strings (e.g., from JSON).
    m = {1: {"name": "Alice"}}
    assert _bs_map_get(m, "1")["name"] == "Alice"


def test_bs_map_get_missing_key_returns_empty_dict() -> None:
    m: dict[int, dict] = {}
    assert _bs_map_get(m, 99) == {}


def test_bs_map_get_invalid_id_returns_empty_dict() -> None:
    # Non-integer, non-numeric string → returns {} without raising.
    m = {1: {"name": "Alice"}}
    assert _bs_map_get(m, "bs-invalid") == {}
    assert _bs_map_get(m, None) == {}
