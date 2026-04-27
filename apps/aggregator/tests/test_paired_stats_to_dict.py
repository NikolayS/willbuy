"""Unit tests for PairedStats.to_dict() — the serialization path used when
writing paired_delta_json to the reports table.

PairedStats is a frozen dataclass; to_dict() delegates to asdict() from
the dataclasses module. This test pins that all expected fields are present
and have the correct types in the output dict (spec §5.18 headline element).
"""

from __future__ import annotations

from aggregator.stats import PairedStats


def _make_stats(**kwargs) -> PairedStats:
    defaults = dict(
        n=5,
        mean_delta=0.4,
        ci_low=-0.1,
        ci_high=0.9,
        paired_t_p=0.03,
        wilcoxon_p=0.04,
        mcnemar_p=0.07,
        disagreement=False,
        conservative_p=0.04,
    )
    defaults.update(kwargs)
    return PairedStats(**defaults)


def test_to_dict_has_all_required_keys() -> None:
    d = _make_stats().to_dict()
    required = {
        "n", "mean_delta", "ci_low", "ci_high",
        "paired_t_p", "wilcoxon_p", "mcnemar_p",
        "disagreement", "conservative_p",
    }
    assert set(d.keys()) == required


def test_to_dict_values_match_constructor_args() -> None:
    stats = _make_stats(n=10, mean_delta=1.5, paired_t_p=0.01)
    d = stats.to_dict()
    assert d["n"] == 10
    assert d["mean_delta"] == 1.5
    assert d["paired_t_p"] == 0.01


def test_to_dict_disagreement_bool_is_preserved() -> None:
    d_true = _make_stats(disagreement=True).to_dict()
    d_false = _make_stats(disagreement=False).to_dict()
    assert d_true["disagreement"] is True
    assert d_false["disagreement"] is False


def test_to_dict_returns_plain_dict_not_dataclass() -> None:
    d = _make_stats().to_dict()
    assert isinstance(d, dict)
    assert not isinstance(d, PairedStats)
