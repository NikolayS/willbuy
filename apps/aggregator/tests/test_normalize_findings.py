"""Boundary and edge-case tests for normalize_findings() (spec §5.7, §17).

The existing test_cluster.py has one minimal smoke test. This file adds
boundary coverage: empty input, whitespace-only strings, all-duplicate
input, lex-sort correctness, and mixed-case + whitespace interaction.
"""

from __future__ import annotations

from aggregator.cluster import normalize_findings


def test_empty_input_returns_empty_list() -> None:
    assert normalize_findings([]) == []


def test_whitespace_only_strings_are_dropped() -> None:
    # Whitespace-only normalizes to "" which is falsy → dropped.
    result = normalize_findings(["   ", "\t", "\n", "  \n  "])
    assert result == []


def test_single_valid_string() -> None:
    assert normalize_findings(["Hello World"]) == ["hello world"]


def test_deduplication_case_insensitive() -> None:
    # All three normalize to the same string → only one survives.
    result = normalize_findings(["Pricing", "PRICING", "pricing"])
    assert result == ["pricing"]
    assert len(result) == 1


def test_deduplication_whitespace_insensitive() -> None:
    # Different whitespace collapses to same normalized form.
    result = normalize_findings(["hello  world", "hello world", " hello world "])
    assert result == ["hello world"]
    assert len(result) == 1


def test_lex_sort_order() -> None:
    result = normalize_findings(["zebra", "apple", "mango"])
    assert result == ["apple", "mango", "zebra"]


def test_lex_sort_after_lowercasing() -> None:
    # 'B' uppercase sorts before 'a' in ASCII, but after lowercasing both
    # become 'a' and 'b', so 'a' comes first.
    result = normalize_findings(["Banana", "apple", "Cherry"])
    assert result == ["apple", "banana", "cherry"]


def test_leading_trailing_whitespace_stripped() -> None:
    result = normalize_findings(["  hello  "])
    assert result == ["hello"]


def test_multiple_internal_spaces_collapsed() -> None:
    result = normalize_findings(["hello    world"])
    assert result == ["hello world"]


def test_tabs_and_newlines_collapsed_to_single_space() -> None:
    result = normalize_findings(["hello\t\nworld"])
    assert result == ["hello world"]


def test_preserves_order_of_first_occurrence_before_sort() -> None:
    # normalize_findings dedupes on first-seen basis, then sorts.
    # With no duplicates, the sort order should be lex, not insertion order.
    result = normalize_findings(["mango", "apple", "banana"])
    assert result == ["apple", "banana", "mango"]


def test_mixed_valid_and_whitespace_only() -> None:
    result = normalize_findings(["   ", "hello", "  ", "world"])
    assert result == ["hello", "world"]
