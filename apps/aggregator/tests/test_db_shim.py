"""test_db_shim.py — unit tests for aggregator/db.py (issue #TBD).

The db module is a thin shim that normalises %s→? placeholders and wraps
psycopg/sqlite3 cursor results. Tests use sqlite3 (stdlib, no Docker)
to exercise both the sqlite path and verify the shim contract.

Tests:
  1. _is_sqlite returns True for sqlite3 connection, False for a mock.
  2. execute() swaps %s placeholders for sqlite connections.
  3. execute() leaves %s placeholders for non-sqlite connections.
  4. fetchall() returns list[tuple] from a query with multiple rows.
  5. fetchone() returns the first matching row (or None when missing).
  6. commit() is callable and does not raise.
"""

from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock, call

import pytest

from aggregator.db import _is_sqlite, commit, execute, fetchall, fetchone


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_sqlite() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)")
    return conn


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_is_sqlite_true_for_sqlite3_connection():
    conn = make_sqlite()
    assert _is_sqlite(conn) is True


def test_is_sqlite_false_for_non_sqlite_object():
    mock_conn = MagicMock()
    mock_conn.__class__.__module__ = "psycopg.something"
    assert _is_sqlite(mock_conn) is False


def test_execute_swaps_placeholder_for_sqlite():
    conn = make_sqlite()
    conn.execute("INSERT INTO t VALUES (1, 'hello')")
    cur = execute(conn, "SELECT val FROM t WHERE id = %s", (1,))
    row = cur.fetchone()
    assert row == ("hello",)


def test_execute_does_not_swap_for_non_sqlite():
    # Use a mock that records the sql passed to cursor.execute().
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = [("row",)]
    mock_conn = MagicMock()
    mock_conn.__class__.__module__ = "psycopg.connection"
    mock_conn.cursor.return_value = mock_cursor

    execute(mock_conn, "SELECT %s", ("x",))
    # %s must NOT be converted to ? for psycopg connections.
    mock_cursor.execute.assert_called_once_with("SELECT %s", ("x",))


def test_fetchall_returns_list_of_tuples():
    conn = make_sqlite()
    conn.execute("INSERT INTO t VALUES (1, 'a')")
    conn.execute("INSERT INTO t VALUES (2, 'b')")
    rows = fetchall(conn, "SELECT id, val FROM t ORDER BY id")
    assert rows == [(1, "a"), (2, "b")]


def test_fetchall_returns_empty_list_when_no_rows():
    conn = make_sqlite()
    rows = fetchall(conn, "SELECT id, val FROM t WHERE id = %s", (99,))
    assert rows == []


def test_fetchone_returns_first_row():
    conn = make_sqlite()
    conn.execute("INSERT INTO t VALUES (1, 'first')")
    conn.execute("INSERT INTO t VALUES (2, 'second')")
    row = fetchone(conn, "SELECT val FROM t WHERE id = %s", (1,))
    assert row == ("first",)


def test_fetchone_returns_none_when_not_found():
    conn = make_sqlite()
    row = fetchone(conn, "SELECT val FROM t WHERE id = %s", (99,))
    assert row is None


def test_commit_calls_through_to_connection():
    mock_conn = MagicMock()
    mock_conn.__class__.__module__ = "psycopg.connection"
    commit(mock_conn)
    mock_conn.commit.assert_called_once_with()
