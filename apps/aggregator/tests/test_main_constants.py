"""Spec-pins for public constants in aggregator.main (spec §17, §5.6, §2 #15).

FINDING_KINDS, VARIANT_LABEL, VALID_NEXT_ACTIONS, VALID_TIERS, VALID_ROLES, and
CLUSTER_TO_THEME are load-bearing: removing a kind silently drops data from
reports; changing VARIANT_LABEL would mislabel A/B branches in the report JSON;
VALID_NEXT_ACTIONS must match the NextAction enum in packages/shared/src/scoring.ts.
"""

from __future__ import annotations

import pytest

from aggregator.main import (
    CLUSTER_TO_THEME,
    FINDING_KINDS,
    VALID_NEXT_ACTIONS,
    VALID_ROLES,
    VALID_TIERS,
    VARIANT_LABEL,
)


# ── FINDING_KINDS ─────────────────────────────────────────────────────────────

def test_finding_kinds_exact_set() -> None:
    """All four finding kinds must be present — removing one silently drops clusters."""
    assert set(FINDING_KINDS) == {"objections", "confusions", "unanswered_blockers", "questions"}


def test_finding_kinds_count() -> None:
    assert len(FINDING_KINDS) == 4


# ── VARIANT_LABEL ─────────────────────────────────────────────────────────────

def test_variant_label_0_is_A() -> None:
    assert VARIANT_LABEL[0] == "A"


def test_variant_label_1_is_B() -> None:
    assert VARIANT_LABEL[1] == "B"


def test_variant_label_only_two_entries() -> None:
    assert set(VARIANT_LABEL.keys()) == {0, 1}


# ── VALID_NEXT_ACTIONS ────────────────────────────────────────────────────────

_EXPECTED_NEXT_ACTIONS = {
    "purchase_paid_today",
    "contact_sales",
    "book_demo",
    "start_paid_trial",
    "bookmark_compare_later",
    "start_free_hobby",
    "ask_teammate",
    "leave",
}


def test_valid_next_actions_exact_set() -> None:
    """Must mirror NextAction enum in packages/shared/src/scoring.ts (amendment A1)."""
    assert set(VALID_NEXT_ACTIONS) == _EXPECTED_NEXT_ACTIONS


def test_valid_next_actions_count() -> None:
    assert len(VALID_NEXT_ACTIONS) == 8


# ── VALID_TIERS ───────────────────────────────────────────────────────────────

_EXPECTED_TIERS = {"none", "hobby", "express", "starter", "scale", "enterprise"}


def test_valid_tiers_exact_set() -> None:
    assert set(VALID_TIERS) == _EXPECTED_TIERS


def test_valid_tiers_count() -> None:
    assert len(VALID_TIERS) == 6


# ── VALID_ROLES ───────────────────────────────────────────────────────────────

_EXPECTED_ROLES = {
    "ic_engineer",
    "engineering_manager",
    "vp_engineering",
    "cto",
    "dba",
    "devops_sre",
    "founder",
    "product_manager",
}


def test_valid_roles_exact_set() -> None:
    assert VALID_ROLES == _EXPECTED_ROLES


def test_valid_roles_count() -> None:
    assert len(VALID_ROLES) == 8


# ── CLUSTER_TO_THEME ─────────────────────────────────────────────────────────

def test_cluster_to_theme_exact_mapping() -> None:
    """All four FINDING_KINDS must have a theme_board key mapping."""
    assert CLUSTER_TO_THEME == {
        "unanswered_blockers": "blockers",
        "objections": "objections",
        "confusions": "confusions",
        "questions": "questions",
    }


def test_cluster_to_theme_covers_all_finding_kinds() -> None:
    """CLUSTER_TO_THEME domain must equal FINDING_KINDS set."""
    assert set(CLUSTER_TO_THEME.keys()) == set(FINDING_KINDS)
