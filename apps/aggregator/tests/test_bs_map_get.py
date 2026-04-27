"""Unit tests for _bs_map_get — backstory map lookup with non-integer ID tolerance.

_bs_map_get wraps backstory_map.get(int(bs_id), {}) to handle the case where
backstory IDs are stored as strings in the visits table. A TypeError / ValueError
on the int() conversion returns {} rather than crashing the aggregation run.
"""

from __future__ import annotations

import pytest

from aggregator.main import _bs_map_get


SAMPLE_MAP: dict[int, dict] = {
    1: {"name": "Alice", "role_archetype": "ic_engineer"},
    2: {"name": "Bob", "role_archetype": "cto"},
    42: {"name": "Charlie", "role_archetype": "founder"},
}


def test_integer_key_found() -> None:
    assert _bs_map_get(SAMPLE_MAP, 1) == {"name": "Alice", "role_archetype": "ic_engineer"}


def test_string_integer_key_found() -> None:
    """String "1" is coerced to int 1 and found."""
    assert _bs_map_get(SAMPLE_MAP, "1") == {"name": "Alice", "role_archetype": "ic_engineer"}


def test_string_integer_key_not_found_returns_empty() -> None:
    assert _bs_map_get(SAMPLE_MAP, "99") == {}


def test_non_integer_string_returns_empty() -> None:
    """bs_id like 'abc' cannot be coerced → returns {} without raising."""
    assert _bs_map_get(SAMPLE_MAP, "abc") == {}


def test_none_returns_empty() -> None:
    """None cannot be coerced to int → returns {} without raising."""
    assert _bs_map_get(SAMPLE_MAP, None) == {}


def test_float_string_returns_empty() -> None:
    """'1.5' raises ValueError during int() conversion → returns {}."""
    assert _bs_map_get(SAMPLE_MAP, "1.5") == {}


def test_empty_map_returns_empty() -> None:
    assert _bs_map_get({}, 1) == {}


def test_large_valid_id() -> None:
    m = {9999: {"name": "Dave"}}
    assert _bs_map_get(m, "9999") == {"name": "Dave"}
