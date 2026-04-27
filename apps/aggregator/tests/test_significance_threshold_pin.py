"""Spec-pin for the p < 0.05 significance threshold (spec §2 #19).

Two places in the aggregator apply the p < 0.05 threshold:

  stats.py line ~164:
    disagreement = (paired_t_p < 0.05) ^ (wilcoxon_p < 0.05)
    The disagreement flag is set when exactly one of the two paired tests
    rejects H0 at the 5% significance level. Raising the threshold to 0.10
    would flag studies where tests only weakly disagree; lowering it to 0.01
    would miss real disagreements.

  main.py line ~270:
    if paired.n > 0 and conservative_p < 0.05:
    Controls whether the report headline verdict can be 'better' or 'worse'
    (vs. 'inconclusive'). Raising this threshold to e.g. 0.10 could declare
    significance on studies with only marginal evidence.

Both are literal float comparisons, not named constants. Renaming 0.05 to
0.10 or 0.01 compiles cleanly but changes the statistical regime of every
report generated after the change.
"""

from __future__ import annotations

import pathlib

_ROOT = pathlib.Path(__file__).parent.parent / "src" / "aggregator"
STATS_SRC = (_ROOT / "stats.py").read_text()
MAIN_SRC = (_ROOT / "main.py").read_text()


def test_disagreement_threshold_in_stats() -> None:
    """Disagreement rule uses p < 0.05 threshold (spec §2 #19)."""
    assert "< 0.05" in STATS_SRC


def test_verdict_significance_threshold_in_main() -> None:
    """Verdict significance check uses conservative_p < 0.05 (spec §2 #19)."""
    assert "conservative_p < 0.05" in MAIN_SRC


def test_threshold_value_is_0_05_not_0_01_or_0_10() -> None:
    """Exact value is 0.05 — neither more permissive (0.10) nor stricter (0.01)."""
    import re
    hits_stats = re.findall(r"< (\d+\.\d+)", STATS_SRC)
    hits_main = re.findall(r"< (\d+\.\d+)", MAIN_SRC)
    all_hits = hits_stats + hits_main
    # All significance thresholds must be 0.05.
    significance_thresholds = [v for v in all_hits if v in {"0.05", "0.01", "0.10", "0.1"}]
    assert all(v == "0.05" for v in significance_thresholds), (
        f"Expected only 0.05 significance thresholds; got {significance_thresholds}"
    )
