"""Spec-pins for _mcnemar_two_sided boundary cases (spec §2 #19).

_mcnemar_two_sided(b, c) computes the exact McNemar two-sided p-value on
discordant counts. The key boundary:
  - n = b + c = 0 → p = 1.0 (no discordant pairs; no evidence against H0)
  - All B-only conversions (c=0): p = 2 * Bin.cdf(0, n, 0.5) = 2^(1-n)

These cases arise when the paired-delta fixture has no mixed (A-converts, B-no)
pairs, making the boundary behavior load-bearing for the disagreement rule.
"""

from __future__ import annotations

import math
import pytest

from aggregator.stats import _mcnemar_two_sided


def test_zero_discordant_pairs_returns_one() -> None:
    """n=0: no evidence against H0 → p=1.0 (spec §2 #19)."""
    assert _mcnemar_two_sided(0, 0) == 1.0


def test_all_b_converts_8_pairs() -> None:
    """b=8, c=0 → n=8, k=0 → 2*Bin.cdf(0, 8, 0.5) = 2*(0.5^8) = 2/256 = 0.0078125."""
    p = _mcnemar_two_sided(8, 0)
    assert math.isclose(p, 0.0078125, abs_tol=1e-7)


def test_all_a_converts_8_pairs() -> None:
    """b=0, c=8 (symmetric, k=min(0,8)=0) → same as b=8, c=0."""
    assert math.isclose(_mcnemar_two_sided(0, 8), _mcnemar_two_sided(8, 0), abs_tol=1e-12)


def test_balanced_discordant_gives_p_one() -> None:
    """b=5, c=5 → n=10, k=5 → p ≥ 1.0 → capped at 1.0."""
    p = _mcnemar_two_sided(5, 5)
    assert p == 1.0


def test_p_is_always_in_0_1() -> None:
    """p is always a valid probability."""
    for b, c in [(0, 0), (1, 0), (0, 1), (3, 7), (10, 10), (100, 0)]:
        p = _mcnemar_two_sided(b, c)
        assert 0.0 <= p <= 1.0, f"p={p} out of [0,1] for b={b}, c={c}"
