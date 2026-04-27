"""Spec-pins for constants in aggregator/main.py and aggregator/cluster.py.

FINDING_KINDS (main.py, spec §17 + §5.6 + §2 #15):
  4-tuple of finding kinds that are clustered. Removing any kind stops that
  class of findings from reaching the theme board. Adding one without
  updating CLUSTER_TO_THEME causes a KeyError at aggregation time.

VARIANT_LABEL (main.py):
  Maps variant_idx → display label (0→"A", 1→"B"). Swapping the values
  silently reverses the A/B labeling in every report.

VALID_NEXT_ACTIONS (main.py):
  8-entry list of allowed next_action values. Removing an action from
  validation causes visits with that action to be silently dropped.

VALID_TIERS (main.py):
  6-entry list of tier strings. Removing "none" or "hobby" would cause
  validation failures for free-tier visitors.

VALID_ROLES (main.py):
  8-entry frozenset of RoleArchetype strings. The coerce logic falls back
  to "ic_engineer" for unknown roles — removing a valid role from the set
  would silently downgrade matching visitors.

CLUSTER_TO_THEME (main.py):
  Maps finding_kind → theme_board key. Must be a bijection with
  FINDING_KINDS — each finding_kind must have exactly one theme key.

_EMBED_MODEL_NAME (cluster.py, spec §17):
  Pinned embedding model name "BAAI/bge-small-en-v1.5". Changing it
  without re-computing all stored embeddings causes stale-embedding
  mismatch and breaks §17 determinism guarantee.
"""

import pytest

from aggregator.main import (
    FINDING_KINDS,
    VARIANT_LABEL,
    VALID_NEXT_ACTIONS,
    VALID_TIERS,
    VALID_ROLES,
    CLUSTER_TO_THEME,
)
from aggregator.cluster import _EMBED_MODEL_NAME


class TestFindingKinds:
    def test_has_exactly_4_entries(self):
        assert len(FINDING_KINDS) == 4

    def test_contains_objections(self):
        assert "objections" in FINDING_KINDS

    def test_contains_confusions(self):
        assert "confusions" in FINDING_KINDS

    def test_contains_unanswered_blockers(self):
        assert "unanswered_blockers" in FINDING_KINDS

    def test_contains_questions(self):
        assert "questions" in FINDING_KINDS

    def test_all_finding_kinds_have_a_cluster_to_theme_mapping(self):
        """FINDING_KINDS and CLUSTER_TO_THEME must stay in sync."""
        for kind in FINDING_KINDS:
            assert kind in CLUSTER_TO_THEME, (
                f"FINDING_KIND '{kind}' has no entry in CLUSTER_TO_THEME"
            )


class TestVariantLabel:
    def test_has_exactly_2_entries(self):
        assert len(VARIANT_LABEL) == 2

    def test_variant_0_is_A(self):
        assert VARIANT_LABEL[0] == "A"

    def test_variant_1_is_B(self):
        assert VARIANT_LABEL[1] == "B"


class TestValidNextActions:
    def test_has_exactly_8_entries(self):
        assert len(VALID_NEXT_ACTIONS) == 8

    def test_contains_purchase_paid_today(self):
        assert "purchase_paid_today" in VALID_NEXT_ACTIONS

    def test_contains_leave(self):
        assert "leave" in VALID_NEXT_ACTIONS

    def test_contains_all_converted_action_set(self):
        """The 4 converted actions (CONVERTED_ACTIONS in stats.py) must be present."""
        converted = {"purchase_paid_today", "contact_sales", "book_demo", "start_paid_trial"}
        for action in converted:
            assert action in VALID_NEXT_ACTIONS, (
                f"Converted action '{action}' missing from VALID_NEXT_ACTIONS"
            )


class TestValidTiers:
    def test_has_exactly_6_entries(self):
        assert len(VALID_TIERS) == 6

    def test_contains_none(self):
        assert "none" in VALID_TIERS

    def test_contains_hobby(self):
        assert "hobby" in VALID_TIERS

    def test_contains_enterprise(self):
        assert "enterprise" in VALID_TIERS

    def test_order_ascending_by_intent(self):
        """none must appear before enterprise (ascending commercial intent)."""
        assert VALID_TIERS.index("none") < VALID_TIERS.index("enterprise")


class TestValidRoles:
    def test_has_exactly_8_entries(self):
        assert len(VALID_ROLES) == 8

    def test_contains_ic_engineer(self):
        assert "ic_engineer" in VALID_ROLES

    def test_contains_founder(self):
        assert "founder" in VALID_ROLES

    def test_contains_cto(self):
        assert "cto" in VALID_ROLES

    def test_default_fallback_role_is_in_set(self):
        """The coerce fallback 'ic_engineer' must be a valid role."""
        assert "ic_engineer" in VALID_ROLES


class TestClusterToTheme:
    def test_has_exactly_4_entries(self):
        assert len(CLUSTER_TO_THEME) == 4

    def test_unanswered_blockers_maps_to_blockers(self):
        assert CLUSTER_TO_THEME["unanswered_blockers"] == "blockers"

    def test_objections_maps_to_objections(self):
        assert CLUSTER_TO_THEME["objections"] == "objections"

    def test_confusions_maps_to_confusions(self):
        assert CLUSTER_TO_THEME["confusions"] == "confusions"

    def test_questions_maps_to_questions(self):
        assert CLUSTER_TO_THEME["questions"] == "questions"

    def test_values_match_finding_kinds_keys(self):
        """CLUSTER_TO_THEME keys must exactly equal FINDING_KINDS."""
        assert set(CLUSTER_TO_THEME.keys()) == set(FINDING_KINDS)


class TestEmbedModelName:
    def test_is_bge_small_en(self):
        assert _EMBED_MODEL_NAME == "BAAI/bge-small-en-v1.5"

    def test_has_no_whitespace(self):
        assert " " not in _EMBED_MODEL_NAME

    def test_starts_with_BAAI_prefix(self):
        assert _EMBED_MODEL_NAME.startswith("BAAI/")
