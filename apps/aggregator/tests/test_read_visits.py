"""Unit tests for _read_visits() in aggregator/main.py.

_read_visits fetches visits from the DB and filters them to ok-status
rows, returning parsed JSON payloads. Branches:
  1. Empty result set → empty list.
  2. Rows with status != 'ok' are silently skipped.
  3. parsed column already a dict → used directly.
  4. parsed column is a JSON string → parsed.
  5. parsed column is invalid JSON / None → row silently skipped.

Tests use unittest.mock.patch on db.fetchall — no real DB needed.
"""

from __future__ import annotations

import json
from unittest.mock import patch

from aggregator.main import _read_visits


# ── Branch 1: empty result set ────────────────────────────────────────────────

def test_empty_rows_returns_empty_list() -> None:
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = []
        result = _read_visits(object(), "study_1")
    assert result == []


# ── Branch 2: non-ok status rows are skipped ─────────────────────────────────

def test_failed_status_rows_are_skipped() -> None:
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (1, 0, "bs_1", "failed", {"score": 5, "next_action": "leave"}),
        ]
        result = _read_visits(object(), "study_1")
    assert result == []


def test_indeterminate_status_skipped() -> None:
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (2, 1, "bs_2", "indeterminate", {"score": 5}),
        ]
        result = _read_visits(object(), "study_1")
    assert result == []


def test_only_ok_rows_included() -> None:
    payload = {"score": 7, "next_action": "contact_sales"}
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (10, 0, "bs_10", "ok", payload),
            (11, 0, "bs_11", "failed", payload),
            (12, 1, "bs_10", "ok", payload),
        ]
        result = _read_visits(object(), "study_1")
    assert len(result) == 2
    assert all(r["output"] == payload for r in result)


# ── Branch 3: dict parsed used directly ──────────────────────────────────────

def test_dict_parsed_used_directly() -> None:
    payload = {"score": 8, "next_action": "book_demo"}
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (1, 0, "bs_1", "ok", payload),
        ]
        result = _read_visits(object(), "study_1")
    assert len(result) == 1
    assert result[0]["output"] is payload


def test_dict_payload_fields_accessible() -> None:
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (5, 1, "bs_5", "ok", {"score": 3, "next_action": "leave"}),
        ]
        result = _read_visits(object(), "study_1")
    row = result[0]
    assert row["id"] == 5
    assert row["variant"] == 1
    assert row["backstory_id"] == "bs_5"
    assert row["output"]["score"] == 3


# ── Branch 4: JSON string parsed ─────────────────────────────────────────────

def test_json_string_parsed_correctly() -> None:
    payload = {"score": 6, "next_action": "ask_teammate"}
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (20, 0, "bs_20", "ok", json.dumps(payload)),
        ]
        result = _read_visits(object(), "study_1")
    assert len(result) == 1
    assert result[0]["output"] == payload


# ── Branch 5: invalid JSON / None → row skipped ───────────────────────────────

def test_invalid_json_string_row_skipped() -> None:
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (30, 0, "bs_30", "ok", "not valid json {{{"),
        ]
        result = _read_visits(object(), "study_1")
    assert result == []


def test_none_parsed_row_skipped() -> None:
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (31, 0, "bs_31", "ok", None),
        ]
        result = _read_visits(object(), "study_1")
    assert result == []


# ── Mixed rows ────────────────────────────────────────────────────────────────

def test_mixed_rows_only_valid_ok_included() -> None:
    """ok+dict, ok+json_str, failed, ok+invalid_json → two rows."""
    with patch("aggregator.main.db") as mock_db:
        mock_db.fetchall.return_value = [
            (1, 0, "bs_1", "ok", {"score": 5}),
            (2, 1, "bs_1", "ok", json.dumps({"score": 6})),
            (3, 0, "bs_2", "failed", {"score": 5}),
            (4, 1, "bs_2", "ok", "bad json"),
        ]
        result = _read_visits(object(), "study_1")
    assert len(result) == 2
    assert result[0]["id"] == 1
    assert result[1]["id"] == 2
