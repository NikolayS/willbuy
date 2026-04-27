"""Spec-pins for _build_visits_by_backstory and _collect_findings (main.py).

_build_visits_by_backstory:
  Groups visits by backstory_id and variant (0=A, 1=B). Drops incomplete
  pairs (backstories with only one variant). The pairing contract is
  spec §2 #18 (paired A/B = exactly 2 URLs, one visit per variant).
  A bug here silently drops paired deltas from the report.

_collect_findings:
  Collects findings by kind across all visits. Skips non-string items.
  Uses FINDING_KINDS as the key set — keys not in FINDING_KINDS are ignored.
"""

import pytest

from aggregator.main import _build_visits_by_backstory, _collect_findings, FINDING_KINDS


def make_visit(backstory_id, variant, will_to_buy=7, next_action="leave", findings=None):
    output = {"will_to_buy": will_to_buy, "next_action": next_action}
    for kind in (findings or {}):
        output[kind] = findings[kind]
    return {"backstory_id": backstory_id, "variant": variant, "output": output}


class TestBuildVisitsByBackstory:
    def test_paired_visits_grouped_correctly(self):
        visits = [
            make_visit("bs1", 0, will_to_buy=5, next_action="leave"),
            make_visit("bs1", 1, will_to_buy=8, next_action="contact_sales"),
        ]
        result = _build_visits_by_backstory(visits)
        assert "bs1" in result
        assert result["bs1"][0]["score"] == 5
        assert result["bs1"][1]["score"] == 8
        assert result["bs1"][0]["next_action"] == "leave"
        assert result["bs1"][1]["next_action"] == "contact_sales"

    def test_incomplete_pair_is_dropped(self):
        """A backstory with only variant 0 (no variant 1) is excluded."""
        visits = [make_visit("bs_only_a", 0)]
        result = _build_visits_by_backstory(visits)
        assert "bs_only_a" not in result

    def test_only_variant_1_is_dropped(self):
        """A backstory with only variant 1 is also excluded."""
        visits = [make_visit("bs_only_b", 1)]
        result = _build_visits_by_backstory(visits)
        assert "bs_only_b" not in result

    def test_empty_visits_returns_empty(self):
        assert _build_visits_by_backstory([]) == {}

    def test_multiple_backstories(self):
        visits = [
            make_visit("bs1", 0, will_to_buy=3),
            make_visit("bs1", 1, will_to_buy=6),
            make_visit("bs2", 0, will_to_buy=5),
            make_visit("bs2", 1, will_to_buy=9),
            make_visit("bs3", 0),  # incomplete — no variant 1
        ]
        result = _build_visits_by_backstory(visits)
        assert set(result.keys()) == {"bs1", "bs2"}
        assert result["bs1"][0]["score"] == 3
        assert result["bs2"][1]["score"] == 9

    def test_last_write_wins_per_variant(self):
        """If two visits share the same (backstory_id, variant), the last one wins."""
        visits = [
            make_visit("bs1", 0, will_to_buy=3),
            make_visit("bs1", 0, will_to_buy=7),  # overwrites
            make_visit("bs1", 1, will_to_buy=9),
        ]
        result = _build_visits_by_backstory(visits)
        assert result["bs1"][0]["score"] == 7


class TestCollectFindings:
    def test_empty_visits_returns_empty_per_kind(self):
        result = _collect_findings([])
        assert set(result.keys()) == set(FINDING_KINDS)
        for kind in FINDING_KINDS:
            assert result[kind] == []

    def test_findings_collected_by_kind(self):
        visits = [
            make_visit("bs1", 0, findings={
                "questions": ["How is pricing calculated?"],
                "objections": ["Too expensive."],
            }),
            make_visit("bs2", 1, findings={
                "questions": ["Is there a trial?"],
                "confusions": ["I don't understand the tiers."],
            }),
        ]
        result = _collect_findings(visits)
        assert "How is pricing calculated?" in result["questions"]
        assert "Is there a trial?" in result["questions"]
        assert "Too expensive." in result["objections"]
        assert "I don't understand the tiers." in result["confusions"]
        assert result["unanswered_blockers"] == []

    def test_non_string_items_skipped(self):
        visits = [
            make_visit("bs1", 0, findings={
                "questions": ["Valid question", None, 42, {"key": "val"}],
            }),
        ]
        result = _collect_findings(visits)
        assert result["questions"] == ["Valid question"]

    def test_finding_kind_keys_match_FINDING_KINDS(self):
        result = _collect_findings([])
        assert set(result.keys()) == set(FINDING_KINDS)
