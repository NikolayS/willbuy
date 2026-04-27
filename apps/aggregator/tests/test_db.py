"""Unit tests for aggregator/db.py — placeholder-swap and dispatch logic.

The shim detects sqlite3 vs psycopg by class name and swaps %s→? for sqlite.
All tests use stdlib sqlite3 (no Docker) or a minimal unittest.mock for the
psycopg branch; no real DB needed.
"""

from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock, call

import pytest

from aggregator.db import commit, execute, fetchall, fetchone


# ────────────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def mem_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)")
    conn.execute("INSERT INTO items (val) VALUES ('hello')")
    conn.execute("INSERT INTO items (val) VALUES ('world')")
    conn.commit()
    return conn


def _mock_psycopg_conn(rows: list | None = None) -> MagicMock:
    """Minimal mock that looks like a psycopg connection."""
    cur = MagicMock()
    cur.fetchall.return_value = rows or []
    cur.fetchone.return_value = rows[0] if rows else None
    conn = MagicMock()
    conn.__class__.__module__ = "psycopg"
    conn.__class__.__name__ = "Connection"
    conn.cursor.return_value = cur
    return conn


# ────────────────────────────────────────────────────────────────────────────
# execute() — placeholder swapping
# ────────────────────────────────────────────────────────────────────────────

def test_execute_sqlite_swaps_placeholder(mem_db: sqlite3.Connection) -> None:
    cur = execute(mem_db, "SELECT val FROM items WHERE val = %s", ["hello"])
    rows = list(cur.fetchall())
    assert rows == [("hello",)]


def test_execute_sqlite_no_placeholder(mem_db: sqlite3.Connection) -> None:
    cur = execute(mem_db, "SELECT COUNT(*) FROM items")
    (cnt,) = cur.fetchone()
    assert cnt == 2


def test_execute_psycopg_does_not_swap_placeholder() -> None:
    conn = _mock_psycopg_conn()
    execute(conn, "SELECT val FROM items WHERE val = %s", ["hello"])
    cur = conn.cursor.return_value
    # psycopg path must NOT swap — %s must reach cur.execute unchanged.
    cur.execute.assert_called_once_with(
        "SELECT val FROM items WHERE val = %s", ("hello",)
    )


def test_execute_psycopg_returns_cursor() -> None:
    conn = _mock_psycopg_conn()
    result = execute(conn, "SELECT 1")
    assert result is conn.cursor.return_value


# ────────────────────────────────────────────────────────────────────────────
# fetchall()
# ────────────────────────────────────────────────────────────────────────────

def test_fetchall_sqlite_returns_list(mem_db: sqlite3.Connection) -> None:
    rows = fetchall(mem_db, "SELECT val FROM items ORDER BY id")
    assert rows == [("hello",), ("world",)]


def test_fetchall_sqlite_with_param(mem_db: sqlite3.Connection) -> None:
    rows = fetchall(mem_db, "SELECT val FROM items WHERE val = %s", ["world"])
    assert rows == [("world",)]


def test_fetchall_empty(mem_db: sqlite3.Connection) -> None:
    rows = fetchall(mem_db, "SELECT val FROM items WHERE val = %s", ["missing"])
    assert rows == []


# ────────────────────────────────────────────────────────────────────────────
# fetchone()
# ────────────────────────────────────────────────────────────────────────────

def test_fetchone_sqlite_returns_first_row(mem_db: sqlite3.Connection) -> None:
    row = fetchone(mem_db, "SELECT val FROM items ORDER BY id LIMIT 1")
    assert row == ("hello",)


def test_fetchone_sqlite_returns_none_when_missing(mem_db: sqlite3.Connection) -> None:
    row = fetchone(mem_db, "SELECT val FROM items WHERE val = %s", ["nope"])
    assert row is None


# ────────────────────────────────────────────────────────────────────────────
# commit()
# ────────────────────────────────────────────────────────────────────────────

def test_commit_calls_conn_commit() -> None:
    conn = MagicMock()
    commit(conn)
    conn.commit.assert_called_once()


def test_commit_sqlite_persists_write(mem_db: sqlite3.Connection) -> None:
    mem_db.execute("INSERT INTO items (val) VALUES ('new')")
    commit(mem_db)
    rows = fetchall(mem_db, "SELECT val FROM items WHERE val = %s", ["new"])
    assert rows == [("new",)]
