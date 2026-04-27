"""Spec-pin for statistical test call parameters in aggregator/stats.py (spec §17).

paired_delta() applies two statistical tests to the paired will-to-buy score
differences, each with specific parameters from spec §17:

  Paired-t test (scipy.stats.ttest_1samp):
    - null hypothesis mean = 0.0 (tests whether the mean difference differs
      from zero; changing to 0.5 would test a different null hypothesis and
      would declare significance incorrectly on small differences).

  Wilcoxon signed-rank test (scipy.stats.wilcoxon):
    - zero_method="wilcox" — excludes zero-difference pairs from the ranking.
      'pratt' would include them in the sign assignment; 'zsplit' would split
      zeros. Each gives different p-values for tied/zero data.
    - correction=False — no continuity correction. Setting correction=True
      adds ±0.5 to the test statistic to adjust for continuity, producing
      slightly larger (more conservative) p-values.

Changing any of these parameters changes the reported p-values, which
changes verdict classifications ('better'/'worse' vs. 'inconclusive') and
disagreement flags. They are call-site arguments, not named constants.
"""

from __future__ import annotations

import pathlib


SRC = (
    pathlib.Path(__file__).parent.parent / "src" / "aggregator" / "stats.py"
).read_text()


def test_ttest_null_hypothesis_is_zero() -> None:
    """Paired-t tests H0: mean == 0.0 (no difference between A and B)."""
    assert "ttest_1samp(arr, 0.0)" in SRC


def test_wilcoxon_zero_method_is_wilcox() -> None:
    """Wilcoxon uses zero_method='wilcox' (excludes zero-difference pairs)."""
    assert 'zero_method="wilcox"' in SRC


def test_wilcoxon_correction_is_false() -> None:
    """No continuity correction — per spec §17 verbatim."""
    assert "correction=False" in SRC


def test_conservative_p_is_max_of_both_tests() -> None:
    """conservative_p = max(paired_t_p, wilcoxon_p) — most conservative value."""
    assert "max(paired_t_p, wilcoxon_p)" in SRC
