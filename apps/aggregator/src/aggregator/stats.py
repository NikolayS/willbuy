"""Paired statistics for the willbuy A/B report.

Spec §2 #19 + §5.7. Per backstory with both visits ok:
  delta_i = score_B_i - score_A_i
We report:
  - mean_delta and 95% CI (paired-t-based)
  - paired-t two-sided p
  - Wilcoxon signed-rank two-sided p
  - McNemar's two-sided p (binarized next_action per amendment A1)
  - disagreement: bool — paired-t and Wilcoxon disagree iff exactly one
    p < 0.05 and the other p ≥ 0.05.
  - conservative_p: max(paired_t_p, wilcoxon_p) — the value the ship-gate
    copy is required to use when disagreement is True.

The McNemar binarization rule (amendment A1, 2026-04-24): converted=1 IFF
next_action ∈ {purchase_paid_today, contact_sales, book_demo, start_paid_trial};
all other actions (including the bumped bookmark_compare_later and
start_free_hobby) are 0.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Mapping

import numpy as np
from scipy import stats as scipy_stats


# Mirror of amendment A1 (.samo/spec/willbuy/SPEC.willbuy.amendments.md).
CONVERTED_ACTIONS: frozenset[str] = frozenset(
    {
        "purchase_paid_today",
        "contact_sales",
        "book_demo",
        "start_paid_trial",
    },
)


@dataclass(frozen=True)
class PairedStats:
    n: int
    mean_delta: float
    ci_low: float
    ci_high: float
    paired_t_p: float
    wilcoxon_p: float
    mcnemar_p: float
    disagreement: bool
    conservative_p: float

    def to_dict(self) -> dict:
        return asdict(self)


def _mcnemar_two_sided(b: int, c: int) -> float:
    """Exact McNemar two-sided p on discordant counts (b, c).

    Uses the binomial PMF on n = b + c trials, parameter 0.5. For n == 0
    returns 1.0 (no evidence against H0).
    """
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    # Two-sided exact: 2 * P(X <= k) under Bin(n, 0.5), capped at 1.0.
    p = 2.0 * scipy_stats.binom.cdf(k, n, 0.5)
    return float(min(p, 1.0))


def paired_delta(visits_by_backstory: Mapping[str, Mapping[str, Mapping]]) -> PairedStats:
    """Compute paired statistics for a study.

    Input shape:
      {backstory_id: {"A": {"score": int, "next_action": str},
                      "B": {"score": int, "next_action": str}}}
    Only backstories with both A and B present (and both `score` numeric)
    are included; the caller is expected to have filtered on `status='ok'`
    upstream.
    """
    deltas: list[float] = []
    a_actions: list[str] = []
    b_actions: list[str] = []

    # Iterate backstories in lex-sorted order so the test fixture and
    # production paths produce identical floating-point sums.
    for backstory_id in sorted(visits_by_backstory.keys()):
        pair = visits_by_backstory[backstory_id]
        a = pair.get("A")
        b = pair.get("B")
        if a is None or b is None:
            continue
        a_score = a.get("score")
        b_score = b.get("score")
        if a_score is None or b_score is None:
            continue
        deltas.append(float(b_score) - float(a_score))
        a_actions.append(str(a.get("next_action", "")))
        b_actions.append(str(b.get("next_action", "")))

    n = len(deltas)
    if n == 0:
        return PairedStats(
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

    arr = np.asarray(deltas, dtype=np.float64)
    mean_delta = float(arr.mean())

    # Paired-t: scipy.stats.ttest_1samp(arr, 0.0). 95% CI via t-distribution.
    if n >= 2:
        # ddof=1 sample SD; std-error = sd / sqrt(n).
        sd = float(arr.std(ddof=1))
        se = sd / math.sqrt(n) if n > 0 else 0.0
        t_res = scipy_stats.ttest_1samp(arr, 0.0)
        paired_t_p = float(t_res.pvalue)
        if se > 0:
            tcrit = float(scipy_stats.t.ppf(0.975, df=n - 1))
            ci_low = mean_delta - tcrit * se
            ci_high = mean_delta + tcrit * se
        else:
            ci_low = ci_high = mean_delta
    else:
        # n == 1: no variance, no test. Report mean=delta and degenerate CI.
        paired_t_p = 1.0
        ci_low = ci_high = mean_delta

    # Wilcoxon signed-rank: undefined when all deltas are zero. scipy raises
    # ValueError for that; treat it as p=1.0 (no evidence against H0).
    if np.all(arr == 0):
        wilcoxon_p = 1.0
    else:
        try:
            # zero_method='wilcox' is scipy default; mode='auto' picks exact for
            # small n and approx otherwise — both deterministic given the input.
            w_res = scipy_stats.wilcoxon(arr, zero_method="wilcox", correction=False)
            wilcoxon_p = float(w_res.pvalue)
        except ValueError:
            wilcoxon_p = 1.0

    # McNemar: binary collapse per amendment A1, 2x2 on discordant pairs.
    b_count = 0  # converted only on B
    c_count = 0  # converted only on A
    for a_act, b_act in zip(a_actions, b_actions):
        a_conv = a_act in CONVERTED_ACTIONS
        b_conv = b_act in CONVERTED_ACTIONS
        if a_conv and not b_conv:
            c_count += 1
        elif b_conv and not a_conv:
            b_count += 1
    mcnemar_p = _mcnemar_two_sided(b_count, c_count)

    # Disagreement rule (spec §2 #19): one p<0.05 XOR the other p<0.05.
    disagreement = (paired_t_p < 0.05) ^ (wilcoxon_p < 0.05)
    conservative_p = max(paired_t_p, wilcoxon_p)

    return PairedStats(
        n=n,
        mean_delta=mean_delta,
        ci_low=ci_low,
        ci_high=ci_high,
        paired_t_p=paired_t_p,
        wilcoxon_p=wilcoxon_p,
        mcnemar_p=mcnemar_p,
        disagreement=disagreement,
        conservative_p=conservative_p,
    )
