"""Spec-pins for CONVERTED_ACTIONS (stats.py), _PAID_TIERS, and
_NEXT_ACTION_WEIGHTS (main.py).

CONVERTED_ACTIONS (amendment A1, 2026-04-24):
  McNemar binarization: converted=1 iff next_action is in this set.
  The 4 "converted" actions are purchase_paid_today, contact_sales, book_demo,
  start_paid_trial. Removing any one silently misclassifies conversions in the
  McNemar test. The 4 "not converted" actions (bookmark_compare_later, leave,
  ask_teammate, start_free_hobby) must NOT be in the set.

_PAID_TIERS (main.py):
  Used in bookmark_compare_later and start_free_hobby scoring to distinguish
  paid intent from free. Must exactly match VALID_TIERS minus "none" and
  "hobby". "hobby" is NOT paid. Mirrors the TypeScript ORDERED_TIERS slice.

_NEXT_ACTION_WEIGHTS (main.py):
  Mirrors scoreVisit() in packages/shared/src/scoring.ts (amendment A1).
  purchase_paid_today=1.0, leave=0.0 are the anchors. Changing any weight
  silently changes the conversion score for all future studies without
  surfacing in behavioral tests (which use _score_visit() outcomes, not the
  raw weights).
"""

import pytest

from aggregator.stats import CONVERTED_ACTIONS
from aggregator.main import _PAID_TIERS, _NEXT_ACTION_WEIGHTS


class TestConvertedActions:
    def test_has_exactly_4_entries(self):
        assert len(CONVERTED_ACTIONS) == 4

    def test_purchase_paid_today_is_converted(self):
        assert "purchase_paid_today" in CONVERTED_ACTIONS

    def test_contact_sales_is_converted(self):
        assert "contact_sales" in CONVERTED_ACTIONS

    def test_book_demo_is_converted(self):
        assert "book_demo" in CONVERTED_ACTIONS

    def test_start_paid_trial_is_converted(self):
        assert "start_paid_trial" in CONVERTED_ACTIONS

    # Negative: actions that must NOT count as converted.
    def test_leave_is_not_converted(self):
        assert "leave" not in CONVERTED_ACTIONS

    def test_bookmark_compare_later_is_not_converted(self):
        assert "bookmark_compare_later" not in CONVERTED_ACTIONS

    def test_ask_teammate_is_not_converted(self):
        assert "ask_teammate" not in CONVERTED_ACTIONS

    def test_start_free_hobby_is_not_converted(self):
        assert "start_free_hobby" not in CONVERTED_ACTIONS


class TestPaidTiers:
    def test_has_exactly_4_entries(self):
        assert len(_PAID_TIERS) == 4

    def test_express_is_paid(self):
        assert "express" in _PAID_TIERS

    def test_starter_is_paid(self):
        assert "starter" in _PAID_TIERS

    def test_scale_is_paid(self):
        assert "scale" in _PAID_TIERS

    def test_enterprise_is_paid(self):
        assert "enterprise" in _PAID_TIERS

    # Negative: hobby and none must NOT be paid.
    def test_hobby_is_not_paid(self):
        assert "hobby" not in _PAID_TIERS

    def test_none_is_not_paid(self):
        assert "none" not in _PAID_TIERS


class TestNextActionWeights:
    def test_has_exactly_8_entries(self):
        assert len(_NEXT_ACTION_WEIGHTS) == 8

    def test_purchase_paid_today_weight_is_1_0(self):
        assert _NEXT_ACTION_WEIGHTS["purchase_paid_today"] == pytest.approx(1.0)

    def test_contact_sales_weight_is_0_8(self):
        assert _NEXT_ACTION_WEIGHTS["contact_sales"] == pytest.approx(0.8)

    def test_book_demo_weight_is_0_8(self):
        assert _NEXT_ACTION_WEIGHTS["book_demo"] == pytest.approx(0.8)

    def test_start_paid_trial_weight_is_0_6(self):
        assert _NEXT_ACTION_WEIGHTS["start_paid_trial"] == pytest.approx(0.6)

    def test_ask_teammate_weight_is_0_2(self):
        assert _NEXT_ACTION_WEIGHTS["ask_teammate"] == pytest.approx(0.2)

    def test_bookmark_compare_later_weight_is_0_0(self):
        assert _NEXT_ACTION_WEIGHTS["bookmark_compare_later"] == pytest.approx(0.0)

    def test_start_free_hobby_weight_is_0_0(self):
        assert _NEXT_ACTION_WEIGHTS["start_free_hobby"] == pytest.approx(0.0)

    def test_leave_weight_is_0_0(self):
        assert _NEXT_ACTION_WEIGHTS["leave"] == pytest.approx(0.0)

    def test_highest_weight_is_purchase_paid_today(self):
        max_key = max(_NEXT_ACTION_WEIGHTS, key=lambda k: _NEXT_ACTION_WEIGHTS[k])
        assert max_key == "purchase_paid_today"

    def test_cross_language_consistency_converted_actions_have_nonzero_weights(self):
        """All CONVERTED_ACTIONS must have positive weights (amendment A1)."""
        for action in CONVERTED_ACTIONS:
            assert _NEXT_ACTION_WEIGHTS.get(action, 0.0) > 0.0, (
                f"CONVERTED_ACTIONS member '{action}' has zero weight in "
                f"_NEXT_ACTION_WEIGHTS — these must stay in sync"
            )
