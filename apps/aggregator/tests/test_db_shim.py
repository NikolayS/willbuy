"""Unit tests for the DB shim in db.py.

The shim abstracts over psycopg (production) and sqlite3 (test / CI without
a live Postgres). These tests verify the shim against sqlite3 so no network
or Postgres installation is needed.

Key contract:
  - _is_sqlite() returns True for sqlite3 connections, False for others.
  - execute() swaps %s → ? placeholders for sqlite3.
  - fetchall() / fetchone() work end-to-end with sqlite3.
"""

from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock

from aggregator.db import _is_sqlite, execute, fetchall, fetchone, commit


# ---------------------------------------------------------------------------
# _is_sqlite
# ---------------------------------------------------------------------------

def test_is_sqlite_true_for_sqlite3_connection() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        assert _is_sqlite(conn) is True
    finally:
        conn.close()


def test_is_sqlite_false_for_mock_connection() -> None:
    """Any non-sqlite3 connection (e.g. a mock psycopg) returns False."""
    mock_conn = MagicMock()
    # MagicMock.__module__ is 'unittest.mock', not 'sqlite3.*'
    assert _is_sqlite(mock_conn) is False


# ---------------------------------------------------------------------------
# execute() — placeholder swap + round-trip
# ---------------------------------------------------------------------------

def test_execute_swaps_percent_s_placeholder_for_sqlite() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE TABLE t (v INTEGER)")
        conn.execute("INSERT INTO t VALUES (42)")
        conn.commit()
        cur = execute(conn, "SELECT v FROM t WHERE v = %s", [42])
        rows = cur.fetchall()
        assert rows == [(42,)], f"unexpected rows: {rows}"
    finally:
        conn.close()


def test_execute_empty_params() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE TABLE t (v INTEGER)")
        conn.execute("INSERT INTO t VALUES (1)")
        conn.commit()
        cur = execute(conn, "SELECT COUNT(*) FROM t")
        row = cur.fetchone()
        assert row[0] == 1
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# fetchall() / fetchone()
# ---------------------------------------------------------------------------

def _setup_table(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE nums (n INTEGER)")
    conn.executemany("INSERT INTO nums VALUES (?)", [(1,), (2,), (3,)])
    conn.commit()


def test_fetchall_returns_all_rows() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        _setup_table(conn)
        rows = fetchall(conn, "SELECT n FROM nums ORDER BY n")
        assert rows == [(1,), (2,), (3,)]
    finally:
        conn.close()


def test_fetchall_empty_result() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        _setup_table(conn)
        rows = fetchall(conn, "SELECT n FROM nums WHERE n > %s", [100])
        assert rows == []
    finally:
        conn.close()


def test_fetchone_returns_first_row() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        _setup_table(conn)
        row = fetchone(conn, "SELECT n FROM nums ORDER BY n")
        assert row == (1,)
    finally:
        conn.close()


def test_fetchone_returns_none_when_empty() -> None:
    conn = sqlite3.connect(":memory:")
    try:
        _setup_table(conn)
        row = fetchone(conn, "SELECT n FROM nums WHERE n > %s", [999])
        assert row is None
    finally:
        conn.close()
