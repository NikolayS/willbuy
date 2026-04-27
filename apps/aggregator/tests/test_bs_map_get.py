"""Spec-pins for _bs_map_get (aggregator/main.py).

_bs_map_get(backstory_map, bs_id) looks up a backstory payload by ID,
tolerating non-integer IDs (string IDs from test fixtures, None, etc.).

Contract:
- Integer key or string-of-integer key → returns the backstory dict
- Non-integer-parseable key (None, "abc") → returns {} (never raises)
- Missing key → returns {} (not KeyError)

This tolerance is required because test fixtures and some DB drivers
return backstory_id as a string or Decimal rather than a Python int.
A KeyError or TypeError here would silently drop visits from the report.
"""

import pytest

from aggregator.main import _bs_map_get


BS_MAP = {
    1: {"name": "Alice", "stage": "seed"},
    2: {"name": "Bob", "stage": "series_a"},
    42: {"name": "Carol", "stage": "series_b"},
}


class TestBsMapGet:
    def test_integer_key_found(self):
        assert _bs_map_get(BS_MAP, 1) == {"name": "Alice", "stage": "seed"}

    def test_integer_key_missing_returns_empty(self):
        assert _bs_map_get(BS_MAP, 99) == {}

    def test_string_integer_key_found(self):
        """DB drivers / fixtures may return bs_id as a string."""
        assert _bs_map_get(BS_MAP, "2") == {"name": "Bob", "stage": "series_a"}

    def test_string_integer_key_missing_returns_empty(self):
        assert _bs_map_get(BS_MAP, "999") == {}

    def test_none_key_returns_empty_not_error(self):
        """None should not raise TypeError — returns {} silently."""
        assert _bs_map_get(BS_MAP, None) == {}

    def test_non_integer_string_key_returns_empty(self):
        """'abc' cannot be int()-ed — returns {} without raising."""
        assert _bs_map_get(BS_MAP, "abc") == {}

    def test_float_string_key_returns_empty(self):
        """'1.5' cannot be int()-ed without ValueError — returns {}."""
        assert _bs_map_get(BS_MAP, "1.5") == {}

    def test_empty_map_returns_empty(self):
        assert _bs_map_get({}, 1) == {}

    def test_returns_dict_never_raises(self):
        """Guarantee: the function never raises regardless of input."""
        for bad_id in [None, "abc", [], {}, object(), float("nan")]:
            result = _bs_map_get(BS_MAP, bad_id)
            assert isinstance(result, dict)
