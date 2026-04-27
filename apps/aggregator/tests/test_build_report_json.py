"""Unit tests for _build_report_json verdict logic, low_power flag,
and disagreement propagation.

The function is tested end-to-end via test_main_e2e.py but that test
cannot cheaply vary the stats object to probe all branches. These tests
use a minimal synthetic fixture so each invariant is clear.
"""

from __future__ import annotations

from aggregator.main import _build_report_json
from aggregator.stats import PairedStats

# ── Helpers ───────────────────────────────────────────────────────────────────

SIGNIFICANT_STATS = PairedStats(
    n=30,
    mean_delta=1.5,
    ci_low=0.2,
    ci_high=2.8,
    paired_t_p=0.01,
    wilcoxon_p=0.02,
    mcnemar_p=0.05,
    disagreement=False,
    conservative_p=0.02,
)

INCONCLUSIVE_STATS = PairedStats(
    n=30,
    mean_delta=0.3,
    ci_low=-0.5,
    ci_high=1.1,
    paired_t_p=0.4,
    wilcoxon_p=0.3,
    mcnemar_p=0.6,
    disagreement=False,
    conservative_p=0.4,
)

ZERO_N_STATS = PairedStats(
    n=0,
    mean_delta=0.0,
    ci_low=0.0,
    ci_high=0.0,
    paired_t_p=1.0,
    wilcoxon_p=1.0,
    mcnemar_p=1.0,
    disagreement=False,
    conservative_p=1.0,
)

DISAGREEMENT_STATS = PairedStats(
    n=25,
    mean_delta=0.8,
    ci_low=0.1,
    ci_high=1.5,
    paired_t_p=0.04,   # significant
    wilcoxon_p=0.09,   # not significant
    mcnemar_p=0.1,
    disagreement=True,
    conservative_p=0.09,
)


def _make_visit(variant: int, score: float = 5.0) -> dict:
    return {
        "backstory_id": "1",
        "variant": variant,
        "output": {
            "will_to_buy": score,
            "next_action": "leave",
            "unanswered_blockers": [],
            "objections": [],
            "confusions": [],
            "questions": [],
            "tier_picked": None,
        },
    }


MINIMAL_VISITS = [_make_visit(0) for _ in range(25)]  # 25 → not low_power
FEW_VISITS = [_make_visit(0) for _ in range(5)]        # 5 → low_power

EMPTY_CLUSTERS: dict = {
    "unanswered_blockers": [],
    "objections": [],
    "confusions": [],
    "questions": [],
}

EMPTY_BACKSTORY_MAP: dict = {}
EMPTY_VBB: dict = {}


def build(visits=None, paired=None):
    return _build_report_json(
        visits=visits or MINIMAL_VISITS,
        visits_by_backstory=EMPTY_VBB,
        paired=paired or SIGNIFICANT_STATS,
        clusters=EMPTY_CLUSTERS,
        backstory_map=EMPTY_BACKSTORY_MAP,
        share_token_hash="hash",
        study_id="42",
    )


# ── verdict ───────────────────────────────────────────────────────────────────

def test_verdict_better_when_significant_positive_delta() -> None:
    stats = PairedStats(
        n=30, mean_delta=1.5, ci_low=0.2, ci_high=2.8,
        paired_t_p=0.01, wilcoxon_p=0.02, mcnemar_p=0.05,
        disagreement=False, conservative_p=0.02,
    )
    result = build(paired=stats)
    assert result["headline"]["verdict"] == "better"


def test_verdict_worse_when_significant_negative_delta() -> None:
    stats = PairedStats(
        n=30, mean_delta=-1.5, ci_low=-2.8, ci_high=-0.2,
        paired_t_p=0.01, wilcoxon_p=0.02, mcnemar_p=0.05,
        disagreement=False, conservative_p=0.02,
    )
    result = build(paired=stats)
    assert result["headline"]["verdict"] == "worse"


def test_verdict_inconclusive_when_p_above_threshold() -> None:
    result = build(paired=INCONCLUSIVE_STATS)
    assert result["headline"]["verdict"] == "inconclusive"


def test_verdict_inconclusive_when_n_is_zero() -> None:
    result = build(paired=ZERO_N_STATS)
    assert result["headline"]["verdict"] == "inconclusive"


# ── low_power ─────────────────────────────────────────────────────────────────

def test_low_power_false_when_visits_ge_20() -> None:
    visits = [_make_visit(0) for _ in range(20)]
    result = _build_report_json(
        visits=visits,
        visits_by_backstory=EMPTY_VBB,
        paired=SIGNIFICANT_STATS,
        clusters=EMPTY_CLUSTERS,
        backstory_map=EMPTY_BACKSTORY_MAP,
        share_token_hash="h",
        study_id="1",
    )
    assert result["meta"]["low_power"] is False


def test_low_power_true_when_visits_lt_20() -> None:
    visits = [_make_visit(0) for _ in range(19)]
    result = _build_report_json(
        visits=visits,
        visits_by_backstory=EMPTY_VBB,
        paired=SIGNIFICANT_STATS,
        clusters=EMPTY_CLUSTERS,
        backstory_map=EMPTY_BACKSTORY_MAP,
        share_token_hash="h",
        study_id="1",
    )
    assert result["meta"]["low_power"] is True


# ── disagreement flag ─────────────────────────────────────────────────────────

def test_disagreement_propagated_to_headline() -> None:
    result = build(paired=DISAGREEMENT_STATS)
    assert result["headline"]["disagreement"] is True


def test_no_disagreement_when_stats_agree() -> None:
    result = build(paired=SIGNIFICANT_STATS)
    assert result["headline"]["disagreement"] is False


# ── meta.slug ─────────────────────────────────────────────────────────────────

def test_meta_slug_matches_study_id() -> None:
    result = _build_report_json(
        visits=MINIMAL_VISITS,
        visits_by_backstory=EMPTY_VBB,
        paired=SIGNIFICANT_STATS,
        clusters=EMPTY_CLUSTERS,
        backstory_map=EMPTY_BACKSTORY_MAP,
        share_token_hash="h",
        study_id="99",
    )
    assert result["meta"]["slug"] == "99"
