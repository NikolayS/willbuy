"""Direct unit tests for _mcnemar_two_sided() and CONVERTED_ACTIONS (spec §2 #19, amendment A1).

_mcnemar_two_sided is tested indirectly via paired_delta() in test_stats.py,
but its edge cases (n=0, balanced discordant, capped result) are not
directly verified there. These tests lock in the exact boundary behavior.

CONVERTED_ACTIONS: the amendment A1 binary-conversion set is tested to ensure
all four spec-required actions are present and that boundary actions are excluded.
"""

from __future__ import annotations

import math

import pytest

from aggregator.stats import CONVERTED_ACTIONS, _mcnemar_two_sided


# ── CONVERTED_ACTIONS — amendment A1 binary conversion set ───────────────────

class TestConvertedActions:
    def test_all_four_spec_required_actions_present(self) -> None:
        """Amendment A1 lists exactly these four as 'converted'."""
        assert "purchase_paid_today" in CONVERTED_ACTIONS
        assert "contact_sales" in CONVERTED_ACTIONS
        assert "book_demo" in CONVERTED_ACTIONS
        assert "start_paid_trial" in CONVERTED_ACTIONS

    def test_leave_is_not_converted(self) -> None:
        assert "leave" not in CONVERTED_ACTIONS

    def test_ask_teammate_is_not_converted(self) -> None:
        assert "ask_teammate" not in CONVERTED_ACTIONS

    def test_bookmark_compare_later_is_not_converted(self) -> None:
        # Even the bumped bookmark_compare_later (0.3 score) is still 0 in
        # the McNemar binary collapse per amendment A1.
        assert "bookmark_compare_later" not in CONVERTED_ACTIONS

    def test_start_free_hobby_is_not_converted(self) -> None:
        assert "start_free_hobby" not in CONVERTED_ACTIONS

    def test_set_is_frozenset(self) -> None:
        assert isinstance(CONVERTED_ACTIONS, frozenset)


# ── _mcnemar_two_sided — edge cases ───────────────────────────────────────────

class TestMcnemarTwoSided:
    def test_n_zero_returns_1(self) -> None:
        """n = b + c = 0 → no evidence against H0 → p = 1.0."""
        assert _mcnemar_two_sided(0, 0) == 1.0

    def test_perfectly_balanced_discordant(self) -> None:
        """b = c → balanced, no evidence against H0 → p close to 1."""
        p = _mcnemar_two_sided(4, 4)
        # 2 * Bin.cdf(4, 8, 0.5) — symmetric → 1.0 after cap.
        assert p == pytest.approx(1.0, abs=1e-9)

    def test_all_discordant_one_direction_gives_small_p(self) -> None:
        """b=8, c=0: all discordant in one direction → p ≈ 0.0078125."""
        p = _mcnemar_two_sided(8, 0)
        assert pytest.approx(p, abs=1e-7) == 0.0078125

    def test_symmetric_b_c_order(self) -> None:
        """Result must be symmetric: _mcnemar(b, c) == _mcnemar(c, b)."""
        assert _mcnemar_two_sided(3, 5) == pytest.approx(
            _mcnemar_two_sided(5, 3), abs=1e-10
        )

    def test_result_is_capped_at_1(self) -> None:
        """Computed p = 2 * Bin.cdf(k, n, 0.5) is capped at 1.0 per min(p, 1.0)."""
        # For perfectly balanced case the raw formula would give exactly 1 or
        # slightly above due to FP; the min() cap ensures ≤ 1.
        p = _mcnemar_two_sided(5, 5)
        assert p <= 1.0

    def test_result_is_non_negative(self) -> None:
        """Probability must be ≥ 0."""
        for b, c in [(0, 0), (1, 0), (0, 1), (3, 7), (10, 2)]:
            assert _mcnemar_two_sided(b, c) >= 0.0

    def test_result_is_a_float(self) -> None:
        assert isinstance(_mcnemar_two_sided(3, 2), float)

    def test_known_value_b8_c0(self) -> None:
        """Gold: 2 * Bin.cdf(0, 8, 0.5) = 2 * (0.5)^8 = 0.0078125 (exact)."""
        assert math.isclose(_mcnemar_two_sided(8, 0), 0.0078125)
