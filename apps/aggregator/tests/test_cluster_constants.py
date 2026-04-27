"""Spec-pins for cluster.py constants (spec §17 determinism contract).

_EMBED_MODEL_NAME is the single most load-bearing constant for clustering
reproducibility. Changing it silently rewrites every cluster across every
report without any other test failing — even a minor version bump of the
BGE model changes embedding geometry and therefore all cluster assignments.

normalize_findings tests verify the spec §5.7 normalization contract:
lowercase + collapse whitespace + deduplicate + lex-sort.
These are pure-Python, runnable without numpy/fastembed/hdbscan.
"""

from __future__ import annotations

import pytest

from aggregator.cluster import _EMBED_MODEL_NAME, normalize_findings


# ── _EMBED_MODEL_NAME spec-pin (spec §17) ─────────────────────────────────────

def test_embed_model_name_is_bge_small_en_v1_5() -> None:
    """Pinned by spec §17 + pyproject.toml fastembed==0.3.6."""
    assert _EMBED_MODEL_NAME == "BAAI/bge-small-en-v1.5"


# ── normalize_findings contract tests (spec §5.7) ─────────────────────────────

def test_normalize_lowercases() -> None:
    result = normalize_findings(["PRICING IS UNCLEAR"])
    assert result == ["pricing is unclear"]


def test_normalize_collapses_whitespace() -> None:
    result = normalize_findings(["too   expensive  here"])
    assert result == ["too expensive here"]


def test_normalize_strips_leading_trailing_whitespace() -> None:
    result = normalize_findings(["  price too high  "])
    assert result == ["price too high"]


def test_normalize_deduplicates() -> None:
    result = normalize_findings(["price too high", "Price Too High", "PRICE TOO HIGH"])
    assert len(result) == 1
    assert result[0] == "price too high"


def test_normalize_lex_sorts() -> None:
    result = normalize_findings(["zero confidence", "api docs missing", "price too high"])
    assert result == sorted(result)


def test_normalize_filters_empty_strings() -> None:
    result = normalize_findings(["", "   ", "price too high"])
    assert result == ["price too high"]


def test_normalize_empty_input() -> None:
    assert normalize_findings([]) == []
