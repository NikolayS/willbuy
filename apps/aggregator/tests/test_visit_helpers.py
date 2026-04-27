"""
Unit tests for pure aggregator helpers in main.py.

Functions under test:
  - _build_visits_by_backstory  (lines 172-181)
  - _collect_findings           (lines 184-192)
  - _bs_map_get                 (lines 245-250)

All three are pure functions — no DB, no LLM, no I/O.
"""

import pytest
from aggregator.main import (
    _build_visits_by_backstory,
    _collect_findings,
    _bs_map_get,
    FINDING_KINDS,
)


# ── _build_visits_by_backstory ─────────────────────────────────────────────────

def _visit(backstory_id, variant, will_to_buy=5, next_action="leave"):
    return {
        "backstory_id": backstory_id,
        "variant": variant,
        "output": {"will_to_buy": will_to_buy, "next_action": next_action},
    }


class TestBuildVisitsByBackstory:
    def test_empty_visits_returns_empty(self):
        assert _build_visits_by_backstory([]) == {}

    def test_single_visit_dropped_as_incomplete(self):
        # Only variant 0 present — no variant 1 → incomplete pair → dropped.
        result = _build_visits_by_backstory([_visit(1, variant=0)])
        assert result == {}

    def test_complete_pair_kept(self):
        visits = [
            _visit(1, variant=0, will_to_buy=7, next_action="contact_sales"),
            _visit(1, variant=1, will_to_buy=3, next_action="leave"),
        ]
        result = _build_visits_by_backstory(visits)
        assert "1" not in result  # keys are whatever backstory_id type is used
        # backstory_id in these visits is int 1 → dict key is int 1
        assert 1 in result
        assert result[1][0] == {"score": 7, "next_action": "contact_sales"}
        assert result[1][1] == {"score": 3, "next_action": "leave"}

    def test_two_solo_backstories_both_dropped(self):
        # Each backstory has only one variant.
        visits = [
            _visit(1, variant=0),
            _visit(2, variant=1),
        ]
        assert _build_visits_by_backstory(visits) == {}

    def test_mixed_complete_and_incomplete(self):
        visits = [
            _visit(1, variant=0),
            _visit(1, variant=1),  # complete
            _visit(2, variant=0),  # solo → dropped
        ]
        result = _build_visits_by_backstory(visits)
        assert 1 in result
        assert 2 not in result

    def test_score_and_next_action_extracted(self):
        visits = [
            _visit(42, variant=0, will_to_buy=9, next_action="purchase_paid_today"),
            _visit(42, variant=1, will_to_buy=0, next_action="leave"),
        ]
        result = _build_visits_by_backstory(visits)
        assert result[42][0]["score"] == 9
        assert result[42][0]["next_action"] == "purchase_paid_today"
        assert result[42][1]["score"] == 0


# ── _collect_findings ──────────────────────────────────────────────────────────

def _visit_with_findings(**kind_lists):
    output = {kind: [] for kind in FINDING_KINDS}
    output.update(kind_lists)
    return {"output": output}


class TestCollectFindings:
    def test_empty_visits_all_kinds_present_empty(self):
        result = _collect_findings([])
        assert set(result.keys()) == set(FINDING_KINDS)
        for kind in FINDING_KINDS:
            assert result[kind] == []

    def test_single_visit_findings_collected(self):
        v = _visit_with_findings(objections=["too expensive"])
        result = _collect_findings([v])
        assert "too expensive" in result["objections"]

    def test_non_string_entries_skipped(self):
        v = _visit_with_findings(confusions=[123, None, "real confusion"])
        result = _collect_findings([v])
        assert result["confusions"] == ["real confusion"]

    def test_none_list_treated_as_empty(self):
        # LLM may return None instead of [] for a kind.
        v = {"output": {"objections": None, "confusions": [], "unanswered_blockers": [], "questions": []}}
        result = _collect_findings([v])
        assert result["objections"] == []

    def test_missing_kind_key_treated_as_empty(self):
        v = {"output": {}}
        result = _collect_findings([v])
        for kind in FINDING_KINDS:
            assert result[kind] == []

    def test_multiple_visits_findings_aggregated(self):
        v1 = _visit_with_findings(questions=["what is pricing?"])
        v2 = _visit_with_findings(questions=["how does billing work?"])
        result = _collect_findings([v1, v2])
        assert len(result["questions"]) == 2
        assert "what is pricing?" in result["questions"]
        assert "how does billing work?" in result["questions"]

    def test_all_four_finding_kinds_collected(self):
        v = _visit_with_findings(
            objections=["obj1"],
            confusions=["conf1"],
            unanswered_blockers=["block1"],
            questions=["q1"],
        )
        result = _collect_findings([v])
        assert result["objections"] == ["obj1"]
        assert result["confusions"] == ["conf1"]
        assert result["unanswered_blockers"] == ["block1"]
        assert result["questions"] == ["q1"]


# ── _bs_map_get ───────────────────────────────────────────────────────────────

class TestBsMapGet:
    def test_integer_key_found(self):
        bm = {1: {"name": "Alice"}, 2: {"name": "Bob"}}
        assert _bs_map_get(bm, 1) == {"name": "Alice"}

    def test_integer_key_missing_returns_empty(self):
        bm = {1: {"name": "Alice"}}
        assert _bs_map_get(bm, 99) == {}

    def test_string_integer_key_coerced(self):
        bm = {42: {"name": "Charlie"}}
        assert _bs_map_get(bm, "42") == {"name": "Charlie"}

    def test_none_key_returns_empty(self):
        assert _bs_map_get({1: {}}, None) == {}

    def test_non_numeric_string_returns_empty(self):
        assert _bs_map_get({1: {}}, "hello") == {}

    def test_float_key_coerced_to_int(self):
        bm = {3: {"name": "Dana"}}
        assert _bs_map_get(bm, 3.9) == {"name": "Dana"}

    def test_empty_map_returns_empty(self):
        assert _bs_map_get({}, 1) == {}
