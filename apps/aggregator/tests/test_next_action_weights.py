"""test_next_action_weights.py — spec-pin for _NEXT_ACTION_WEIGHTS.

_NEXT_ACTION_WEIGHTS mirrors NEXT_ACTION_WEIGHTS from packages/shared/src/scoring.ts.
A divergence between the Python and TypeScript weights would cause
the aggregator's conv_score values to differ from what the visitor-worker's
scoring produces — silently breaking cross-language consistency.

Tests:
  1.  purchase_paid_today → 1.0
  2.  contact_sales → 0.8
  3.  book_demo → 0.8
  4.  start_paid_trial → 0.6
  5.  bookmark_compare_later → 0.0 (base weight; bump handled by _score_visit)
  6.  start_free_hobby → 0.0 (base weight; bump handled by _score_visit)
  7.  ask_teammate → 0.2
  8.  leave → 0.0
  9.  Exactly 8 entries (all next_action values covered).
"""

from __future__ import annotations

from aggregator.main import _NEXT_ACTION_WEIGHTS


def test_purchase_paid_today_weight():
    assert _NEXT_ACTION_WEIGHTS["purchase_paid_today"] == 1.0


def test_contact_sales_weight():
    assert _NEXT_ACTION_WEIGHTS["contact_sales"] == 0.8


def test_book_demo_weight():
    assert _NEXT_ACTION_WEIGHTS["book_demo"] == 0.8


def test_start_paid_trial_weight():
    assert _NEXT_ACTION_WEIGHTS["start_paid_trial"] == 0.6


def test_bookmark_compare_later_base_weight():
    # Base weight is 0.0; _score_visit bumps to 0.3 when tier is paid.
    assert _NEXT_ACTION_WEIGHTS["bookmark_compare_later"] == 0.0


def test_start_free_hobby_base_weight():
    # Base weight is 0.0; _score_visit bumps to 0.2 when considered tier is paid.
    assert _NEXT_ACTION_WEIGHTS["start_free_hobby"] == 0.0


def test_ask_teammate_weight():
    assert _NEXT_ACTION_WEIGHTS["ask_teammate"] == 0.2


def test_leave_weight():
    assert _NEXT_ACTION_WEIGHTS["leave"] == 0.0


def test_exactly_eight_entries():
    assert len(_NEXT_ACTION_WEIGHTS) == 8
