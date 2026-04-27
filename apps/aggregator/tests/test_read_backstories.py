"""Unit tests for _read_backstories() in aggregator/main.py.

_read_backstories fetches backstory payloads from the DB by id list.
It has several defensive branches:
  1. Empty id list → return {} immediately (no DB call).
  2. DB exception (e.g. sqlite3 has no ANY(%s) operator) → return {}.
  3. Payload column already a dict → use directly.
  4. Payload column is a JSON string → parse it.
  5. JSON parse failure → use {} for that id.

All five branches are exercised with unittest.mock.patch so no real DB
or Docker is needed.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from aggregator.main import _read_backstories


# ── Branch 1: empty id list → {} immediately ─────────────────────────────────

def test_empty_id_list_returns_empty_dict() -> None:
    conn = MagicMock()
    result = _read_backstories(conn, [])
    assert result == {}


def test_empty_id_list_does_not_call_db() -> None:
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        _read_backstories(conn, [])
        mock_db.fetchall.assert_not_called()


# ── Branch 2: DB exception → {} ───────────────────────────────────────────────

def test_db_exception_returns_empty_dict() -> None:
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.side_effect = Exception("PG: operator ANY not supported in sqlite")
        result = _read_backstories(conn, [1, 2, 3])
    assert result == {}


def test_any_exception_type_is_caught() -> None:
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.side_effect = RuntimeError("connection lost")
        result = _read_backstories(conn, [42])
    assert result == {}


# ── Branch 3: payload is already a dict ───────────────────────────────────────

def test_dict_payload_used_directly() -> None:
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (1, {"name": "Alice", "role_archetype": "ic_engineer"}),
        ]
        result = _read_backstories(conn, [1])
    assert result[1] == {"name": "Alice", "role_archetype": "ic_engineer"}


def test_multiple_dict_payloads() -> None:
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (1, {"name": "Alice"}),
            (2, {"name": "Bob"}),
        ]
        result = _read_backstories(conn, [1, 2])
    assert result[1] == {"name": "Alice"}
    assert result[2] == {"name": "Bob"}


# ── Branch 4: payload is a JSON string ────────────────────────────────────────

def test_json_string_payload_is_parsed() -> None:
    conn = MagicMock()
    payload = json.dumps({"name": "Carol", "role_archetype": "cto"})
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [(3, payload)]
        result = _read_backstories(conn, [3])
    assert result[3] == {"name": "Carol", "role_archetype": "cto"}


def test_string_id_coerced_to_int_key() -> None:
    """bs_id from the DB may come as a string — int() coercion must work."""
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [("5", {"name": "Dave"})]
        result = _read_backstories(conn, [5])
    assert 5 in result
    assert result[5] == {"name": "Dave"}


# ── Branch 5: JSON parse failure → {} for that id ────────────────────────────

def test_invalid_json_string_uses_empty_dict() -> None:
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [(7, "not valid json{{{")]
        result = _read_backstories(conn, [7])
    assert result[7] == {}


def test_none_payload_uses_empty_dict() -> None:
    """None as payload is not a dict and json.loads(None) raises TypeError."""
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [(8, None)]
        result = _read_backstories(conn, [8])
    assert result[8] == {}


# ── Mixed rows ────────────────────────────────────────────────────────────────

def test_mixed_row_types_all_handled() -> None:
    """A mix of dict, JSON string, and invalid JSON in one call."""
    conn = MagicMock()
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (10, {"name": "dict"}),
            (11, json.dumps({"name": "json_str"})),
            (12, "bad json"),
        ]
        result = _read_backstories(conn, [10, 11, 12])
    assert result[10] == {"name": "dict"}
    assert result[11] == {"name": "json_str"}
    assert result[12] == {}
