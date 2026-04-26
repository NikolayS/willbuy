"""Unit tests for _score_visit() — mirrors scoreVisit() in scoring.ts."""
import pytest
from aggregator.main import _score_visit


def _v(action: str, tier_today: str = "none", tier_considered: str = "none") -> dict:
    return {
        "next_action": action,
        "tier_picked_if_buying_today": tier_today,
        "highest_tier_willing_to_consider": tier_considered,
    }


def test_high_intent_actions():
    assert _score_visit(_v("purchase_paid_today")) == 1.0
    assert _score_visit(_v("contact_sales")) == 0.8
    assert _score_visit(_v("book_demo")) == 0.8
    assert _score_visit(_v("start_paid_trial")) == 0.6
    assert _score_visit(_v("ask_teammate")) == 0.2
    assert _score_visit(_v("leave")) == 0.0


def test_bookmark_bump():
    # No tier → 0.0
    assert _score_visit(_v("bookmark_compare_later")) == 0.0
    assert _score_visit(_v("bookmark_compare_later", tier_today="none")) == 0.0
    # Paid tier → 0.3
    for tier in ("express", "starter", "scale", "enterprise"):
        assert _score_visit(_v("bookmark_compare_later", tier_today=tier)) == 0.3
    # Hobby is not a paid tier
    assert _score_visit(_v("bookmark_compare_later", tier_today="hobby")) == 0.0


def test_free_hobby_bump():
    # No tier → 0.0
    assert _score_visit(_v("start_free_hobby")) == 0.0
    assert _score_visit(_v("start_free_hobby", tier_considered="none")) == 0.0
    # Paid considered tier → 0.2
    for tier in ("express", "starter", "scale", "enterprise"):
        assert _score_visit(_v("start_free_hobby", tier_considered=tier)) == 0.2
    # Hobby is not a paid tier
    assert _score_visit(_v("start_free_hobby", tier_considered="hobby")) == 0.0


def test_missing_tier_fields_default_to_none():
    # If the LLM omits tier fields entirely, score should be same as tier=none
    assert _score_visit({"next_action": "bookmark_compare_later"}) == 0.0
    assert _score_visit({"next_action": "start_free_hobby"}) == 0.0


def test_unknown_action_scores_zero():
    assert _score_visit(_v("unknown_action_xyz")) == 0.0
