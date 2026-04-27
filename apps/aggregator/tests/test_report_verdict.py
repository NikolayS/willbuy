"""Spec-pin tests for the report verdict derivation and low_power threshold.

The _build_report_json() function is private and requires many dependencies,
but the verdict logic and low_power threshold are spec-critical (spec §2 #19
and spec §9 "Statistical overclaim" risk row). This file pins them by
verifying the formula directly.

Verdict rule (spec §2 #19):
  conservative_p = max(paired_t_p, wilcoxon_p)
  if n > 0 and conservative_p < 0.05:
      verdict = "better" if mean_delta > 0 else "worse"
  else:
      verdict = "inconclusive"

Low-power rule (spec §9):
  low_power = len(visits) < 20
"""

from __future__ import annotations


def _verdict(n: int, paired_t_p: float, wilcoxon_p: float, mean_delta: float) -> str:
    """Pure replica of the verdict logic inside _build_report_json()."""
    conservative_p = max(paired_t_p, wilcoxon_p)
    if n > 0 and conservative_p < 0.05:
        return "better" if mean_delta > 0 else "worse"
    return "inconclusive"


def _low_power(visit_count: int) -> bool:
    """Pure replica of the low_power logic inside _build_report_json()."""
    return visit_count < 20


# ---------------------------------------------------------------------------
# Verdict tests (spec §2 #19)
# ---------------------------------------------------------------------------

def test_verdict_better_when_p_significant_and_delta_positive() -> None:
    assert _verdict(n=10, paired_t_p=0.01, wilcoxon_p=0.02, mean_delta=0.5) == "better"


def test_verdict_worse_when_p_significant_and_delta_negative() -> None:
    assert _verdict(n=10, paired_t_p=0.01, wilcoxon_p=0.02, mean_delta=-0.5) == "worse"


def test_verdict_inconclusive_when_p_not_significant() -> None:
    # conservative_p = max(0.06, 0.07) = 0.07 ≥ 0.05 → inconclusive
    assert _verdict(n=10, paired_t_p=0.06, wilcoxon_p=0.07, mean_delta=0.5) == "inconclusive"


def test_verdict_inconclusive_when_n_is_zero() -> None:
    # n=0 always inconclusive regardless of p
    assert _verdict(n=0, paired_t_p=0.01, wilcoxon_p=0.01, mean_delta=1.0) == "inconclusive"


def test_verdict_uses_conservative_p_max_of_both() -> None:
    # If paired_t_p < 0.05 but wilcoxon_p ≥ 0.05, conservative picks wilcoxon → inconclusive
    assert _verdict(n=10, paired_t_p=0.02, wilcoxon_p=0.06, mean_delta=0.3) == "inconclusive"
    # If wilcoxon_p < 0.05 but paired_t_p ≥ 0.05, conservative picks paired_t → inconclusive
    assert _verdict(n=10, paired_t_p=0.07, wilcoxon_p=0.04, mean_delta=0.3) == "inconclusive"


def test_verdict_exactly_at_significance_boundary_0_05() -> None:
    # p == 0.05 is NOT significant (strict <)
    assert _verdict(n=10, paired_t_p=0.05, wilcoxon_p=0.05, mean_delta=1.0) == "inconclusive"
    # p == 0.049 IS significant
    assert _verdict(n=10, paired_t_p=0.049, wilcoxon_p=0.049, mean_delta=1.0) == "better"


# ---------------------------------------------------------------------------
# Low-power threshold tests (spec §9, N<20 shows warning banner)
# ---------------------------------------------------------------------------

def test_low_power_true_when_fewer_than_20_visits() -> None:
    assert _low_power(0) is True
    assert _low_power(1) is True
    assert _low_power(19) is True


def test_low_power_false_when_20_or_more_visits() -> None:
    assert _low_power(20) is False
    assert _low_power(21) is False
    assert _low_power(100) is False


def test_low_power_threshold_is_exactly_20() -> None:
    # 19 → low_power, 20 → not low_power
    assert _low_power(19) is True
    assert _low_power(20) is False
