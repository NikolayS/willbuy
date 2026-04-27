"""Spec-pins for _mcnemar_two_sided boundary cases (aggregator/stats.py).

Spec §2 #19 (amendment A1): McNemar two-sided p on discordant pairs.

_mcnemar_two_sided(b, c) where b = "only A converted", c = "only B converted":
  - n = b + c = 0 → returns 1.0 (no discordant pairs, no evidence against H0)
  - b == c → p ≈ 1.0 (perfectly balanced discordance → no preference)
  - b >> c → small p (strong evidence B is better)
  - b == 0, c > 0 → p = 2 × P(X ≤ 0) under Bin(c, 0.5) = 2 / 2^c

These boundary behaviors are implicitly covered via paired_delta() in
test_stats.py, but the private function's own contract is never directly
asserted. A refactor that changed the n==0 return from 1.0 to 0.0 would
silently pass the fixture test.
"""

import math
import pytest

from aggregator.stats import _mcnemar_two_sided


class TestMcNemarTwoSidedBoundary:
    def test_no_discordant_pairs_returns_1(self):
        """n = b + c = 0 → 1.0 (no evidence against H0 per spec §2 #19)."""
        assert _mcnemar_two_sided(0, 0) == pytest.approx(1.0)

    def test_all_b_wins_small_p(self):
        """b=0, c=10 → p = 2/2^10 ≈ 0.00195 (strong evidence B is better)."""
        p = _mcnemar_two_sided(0, 10)
        assert p < 0.01, f"expected small p, got {p}"

    def test_all_a_wins_small_p(self):
        """b=10, c=0 → same small p by symmetry."""
        p = _mcnemar_two_sided(10, 0)
        assert p < 0.01, f"expected small p, got {p}"

    def test_symmetry(self):
        """_mcnemar_two_sided is symmetric: f(b, c) == f(c, b)."""
        for b, c in [(3, 7), (1, 5), (4, 4), (0, 8)]:
            assert _mcnemar_two_sided(b, c) == pytest.approx(
                _mcnemar_two_sided(c, b), abs=1e-12
            )

    def test_balanced_discordance_is_high_p(self):
        """b = c → p near 1.0 (no preference between A and B)."""
        p = _mcnemar_two_sided(5, 5)
        assert p > 0.5, f"expected p > 0.5 for balanced discordance, got {p}"

    def test_p_capped_at_1(self):
        """Result must never exceed 1.0 (capped at 1.0 per implementation)."""
        for b, c in [(0, 0), (1, 1), (5, 5), (10, 10)]:
            assert _mcnemar_two_sided(b, c) <= 1.0

    def test_result_is_non_negative(self):
        """p-value must be ≥ 0."""
        for b, c in [(0, 0), (1, 0), (0, 1), (3, 7)]:
            assert _mcnemar_two_sided(b, c) >= 0.0

    def test_b1_c1_exact(self):
        """b=1, c=1: n=2, k=1 → 2 * binom.cdf(1, 2, 0.5) = 2 * 0.75 = 1.5 → capped 1.0."""
        assert _mcnemar_two_sided(1, 1) == pytest.approx(1.0)

    def test_b0_c1_exact(self):
        """b=0, c=1: n=1, k=0 → 2 * binom.cdf(0, 1, 0.5) = 2 * 0.5 = 1.0."""
        assert _mcnemar_two_sided(0, 1) == pytest.approx(1.0)

    def test_b0_c4_approx(self):
        """b=0, c=4: n=4, k=0 → 2 * (0.5^4) = 2/16 = 0.125."""
        assert _mcnemar_two_sided(0, 4) == pytest.approx(0.125, abs=1e-10)
