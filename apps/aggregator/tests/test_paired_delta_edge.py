"""Edge-case tests for paired_delta() — n=0 paths and incomplete pairs.

The existing test_stats.py only exercises the happy path with valid paired
data. This file covers:
  - Empty input → zero-stats result with p=1.0
  - Input with only unpaired backstories → same as empty
  - Input missing a score field → pair skipped
"""

from __future__ import annotations

import pytest
from aggregator.stats import paired_delta, PairedStats


def _pair(a_score: float, b_score: float, action: str = "leave") -> dict:
    return {
        0: {"score": a_score, "next_action": action},
        1: {"score": b_score, "next_action": action},
    }


def _half_pair_a(score: float) -> dict:
    """Only variant 0 present — no complete pair."""
    return {0: {"score": score, "next_action": "leave"}}


# ---------------------------------------------------------------------------
# n=0 paths
# ---------------------------------------------------------------------------

def test_paired_delta_empty_input_returns_zero_stats() -> None:
    out = paired_delta({})
    assert out.n == 0
    assert out.mean_delta == 0.0
    assert out.ci_low == 0.0
    assert out.ci_high == 0.0
    assert out.paired_t_p == 1.0
    assert out.wilcoxon_p == 1.0
    assert out.mcnemar_p == 1.0
    assert out.disagreement is False
    assert out.conservative_p == 1.0


def test_paired_delta_only_incomplete_pairs_returns_zero_stats() -> None:
    # All backstories have only variant 0 — no complete pair.
    data = {
        "bs1": _half_pair_a(7.0),
        "bs2": _half_pair_a(5.0),
    }
    out = paired_delta(data)
    assert out.n == 0
    assert out.mean_delta == 0.0


def test_paired_delta_missing_score_field_skips_pair() -> None:
    # Backstory bs1 has a complete pair but variant 1 has no 'score'.
    data = {
        "bs1": {
            0: {"score": 7.0, "next_action": "leave"},
            1: {"next_action": "leave"},  # no score
        },
        "bs2": _pair(5.0, 8.0),
    }
    out = paired_delta(data)
    # Only bs2 contributes.
    assert out.n == 1
    assert pytest.approx(out.mean_delta, abs=1e-6) == 3.0


# ---------------------------------------------------------------------------
# Single pair — degenerate statistics but no crash
# ---------------------------------------------------------------------------

def test_paired_delta_single_pair_n_equals_one() -> None:
    data = {"bs1": _pair(4.0, 7.0)}
    out = paired_delta(data)
    assert out.n == 1
    # mean_delta = 7 - 4 = 3.0
    assert pytest.approx(out.mean_delta, abs=1e-6) == 3.0
