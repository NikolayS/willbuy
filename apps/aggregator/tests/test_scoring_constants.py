"""Spec-pin for aggregator scoring constants.

These values must stay in sync with packages/shared/src/scoring.ts (amendment A1).
A silent divergence between Python and TypeScript scoring causes the aggregator
to produce scores the API cannot reproduce, breaking the cross-language contract.

Spec refs:
  §5.7        — score computation mirrors scoring.ts.
  Amendment A1 (2026-04-24) — _PAID_TIERS, _NEXT_ACTION_WEIGHTS, CONVERTED_ACTIONS.
  §2 #19      — McNemar binarization rule: converted ∈ CONVERTED_ACTIONS.
"""

from __future__ import annotations

# Access private constants via module import (Python private convention
# = leading underscore, not enforced by the runtime).
from aggregator.main import (
    _PAID_TIERS,          # type: ignore[attr-defined]
    _NEXT_ACTION_WEIGHTS, # type: ignore[attr-defined]
)
from aggregator.stats import CONVERTED_ACTIONS


# ---------------------------------------------------------------------------
# _PAID_TIERS — must mirror PAID_TIERS in scoring.ts
# ---------------------------------------------------------------------------

def test_paid_tiers_has_four_members() -> None:
    assert len(_PAID_TIERS) == 4


def test_paid_tiers_contains_expected_values() -> None:
    assert "express" in _PAID_TIERS
    assert "starter" in _PAID_TIERS
    assert "scale" in _PAID_TIERS
    assert "enterprise" in _PAID_TIERS


def test_paid_tiers_excludes_free_tiers() -> None:
    assert "none" not in _PAID_TIERS
    assert "hobby" not in _PAID_TIERS


# ---------------------------------------------------------------------------
# _NEXT_ACTION_WEIGHTS — must mirror NEXT_ACTION_WEIGHTS in scoring.ts
# ---------------------------------------------------------------------------

def test_next_action_weights_has_eight_entries() -> None:
    assert len(_NEXT_ACTION_WEIGHTS) == 8


def test_next_action_weights_exact_values() -> None:
    assert _NEXT_ACTION_WEIGHTS["purchase_paid_today"] == 1.0
    assert _NEXT_ACTION_WEIGHTS["contact_sales"] == 0.8
    assert _NEXT_ACTION_WEIGHTS["book_demo"] == 0.8
    assert _NEXT_ACTION_WEIGHTS["start_paid_trial"] == 0.6
    assert _NEXT_ACTION_WEIGHTS["bookmark_compare_later"] == 0.0
    assert _NEXT_ACTION_WEIGHTS["start_free_hobby"] == 0.0
    assert _NEXT_ACTION_WEIGHTS["ask_teammate"] == 0.2
    assert _NEXT_ACTION_WEIGHTS["leave"] == 0.0


# ---------------------------------------------------------------------------
# CONVERTED_ACTIONS — McNemar binarization (spec §2 #19, amendment A1)
# ---------------------------------------------------------------------------

def test_converted_actions_has_four_members() -> None:
    assert len(CONVERTED_ACTIONS) == 4


def test_converted_actions_contains_high_intent_actions() -> None:
    assert "purchase_paid_today" in CONVERTED_ACTIONS
    assert "contact_sales" in CONVERTED_ACTIONS
    assert "book_demo" in CONVERTED_ACTIONS
    assert "start_paid_trial" in CONVERTED_ACTIONS


def test_converted_actions_excludes_low_intent_actions() -> None:
    """bookmark_compare_later and start_free_hobby get score bumps but are NOT
    considered converted for McNemar purposes (amendment A1)."""
    assert "bookmark_compare_later" not in CONVERTED_ACTIONS
    assert "start_free_hobby" not in CONVERTED_ACTIONS
    assert "leave" not in CONVERTED_ACTIONS
    assert "ask_teammate" not in CONVERTED_ACTIONS
