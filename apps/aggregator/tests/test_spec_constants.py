"""
Spec-pin tests for aggregator constants that mirror TypeScript counterparts.

VALID_NEXT_ACTIONS must stay in sync with NextAction enum in
packages/shared/src/scoring.ts (amendment A1).

VALID_TIERS must mirror the Tier enum in packages/shared/src/report.ts.

CLUSTER_TO_THEME maps finding_kind → theme_board key (spec §5.18 #6).

FINDING_KINDS must match the four finding types in VisitorOutput
(spec §2 #15 / packages/shared/src/visitor.ts).

VARIANT_LABEL maps variant index 0→'A', 1→'B' (spec §5.18 §3).

VALID_ROLES mirrors RoleArchetype enum (spec §2 / amendment A1).

_PAID_TIERS mirrors PAID_TIERS in packages/shared/src/scoring.ts.

Any silent addition or removal from these constants would silently break
the cross-language contract between the aggregator and the TypeScript web
layer. These tests make that break visible in CI.
"""

import pytest
from aggregator.main import (
    VALID_NEXT_ACTIONS,
    VALID_TIERS,
    CLUSTER_TO_THEME,
    FINDING_KINDS,
    VARIANT_LABEL,
    VALID_ROLES,
    _PAID_TIERS,
)


# ── VALID_NEXT_ACTIONS ────────────────────────────────────────────────────────

class TestValidNextActions:
    def test_contains_all_eight_actions(self):
        expected = {
            "purchase_paid_today",
            "contact_sales",
            "book_demo",
            "start_paid_trial",
            "bookmark_compare_later",
            "start_free_hobby",
            "ask_teammate",
            "leave",
        }
        assert set(VALID_NEXT_ACTIONS) == expected

    def test_exactly_eight_actions(self):
        assert len(VALID_NEXT_ACTIONS) == 8

    def test_no_duplicates(self):
        assert len(VALID_NEXT_ACTIONS) == len(set(VALID_NEXT_ACTIONS))


# ── VALID_TIERS ───────────────────────────────────────────────────────────────

class TestValidTiers:
    def test_contains_all_six_tiers(self):
        expected = {"none", "hobby", "express", "starter", "scale", "enterprise"}
        assert set(VALID_TIERS) == expected

    def test_exactly_six_tiers(self):
        assert len(VALID_TIERS) == 6

    def test_no_duplicates(self):
        assert len(VALID_TIERS) == len(set(VALID_TIERS))


# ── _PAID_TIERS ───────────────────────────────────────────────────────────────

class TestPaidTiers:
    def test_contains_all_four_paid_tiers(self):
        assert "express" in _PAID_TIERS
        assert "starter" in _PAID_TIERS
        assert "scale" in _PAID_TIERS
        assert "enterprise" in _PAID_TIERS

    def test_exactly_four_members(self):
        assert len(_PAID_TIERS) == 4

    def test_excludes_free_tiers(self):
        assert "none" not in _PAID_TIERS
        assert "hobby" not in _PAID_TIERS

    def test_is_frozenset(self):
        assert isinstance(_PAID_TIERS, frozenset)


# ── CLUSTER_TO_THEME ──────────────────────────────────────────────────────────

class TestClusterToTheme:
    def test_four_mappings_present(self):
        assert len(CLUSTER_TO_THEME) == 4

    def test_all_finding_kinds_are_keys(self):
        assert set(FINDING_KINDS).issubset(set(CLUSTER_TO_THEME.keys()))

    def test_specific_mappings(self):
        assert CLUSTER_TO_THEME["unanswered_blockers"] == "blockers"
        assert CLUSTER_TO_THEME["objections"] == "objections"
        assert CLUSTER_TO_THEME["confusions"] == "confusions"
        assert CLUSTER_TO_THEME["questions"] == "questions"


# ── FINDING_KINDS ─────────────────────────────────────────────────────────────

class TestFindingKinds:
    def test_exactly_four_kinds(self):
        assert len(FINDING_KINDS) == 4

    def test_contains_expected_kinds(self):
        assert "objections" in FINDING_KINDS
        assert "confusions" in FINDING_KINDS
        assert "unanswered_blockers" in FINDING_KINDS
        assert "questions" in FINDING_KINDS

    def test_no_duplicates(self):
        assert len(FINDING_KINDS) == len(set(FINDING_KINDS))

    def test_is_tuple(self):
        assert isinstance(FINDING_KINDS, tuple)


# ── VARIANT_LABEL ─────────────────────────────────────────────────────────────

class TestVariantLabel:
    def test_zero_maps_to_A(self):
        assert VARIANT_LABEL[0] == "A"

    def test_one_maps_to_B(self):
        assert VARIANT_LABEL[1] == "B"

    def test_exactly_two_entries(self):
        assert len(VARIANT_LABEL) == 2


# ── VALID_ROLES ───────────────────────────────────────────────────────────────

class TestValidRoles:
    def test_contains_all_role_archetypes(self):
        expected = {
            "ic_engineer",
            "engineering_manager",
            "vp_engineering",
            "cto",
            "dba",
            "devops_sre",
            "founder",
            "product_manager",
        }
        assert VALID_ROLES == expected

    def test_exactly_eight_roles(self):
        assert len(VALID_ROLES) == 8

    def test_is_frozenset(self):
        assert isinstance(VALID_ROLES, frozenset)
