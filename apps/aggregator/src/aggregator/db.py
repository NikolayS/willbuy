"""Tiny DB shim that abstracts over psycopg vs sqlite3.

The aggregator's read+write surface against the DB is small enough that we
do not pull in an ORM. We need:
  - SELECT visits / studies for a given study_id
  - INSERT into reports + provider_attempts
  - UPDATE studies set status

Both psycopg connections and sqlite3 connections expose `.execute(sql, params)`,
`.commit()`, and a `cursor.fetchone()/fetchall()` API close enough for our needs;
the only divergence we must paper over is parameter style: psycopg uses `%s`
placeholders, sqlite uses `?`. Detect by class name, not by import (sqlite3 is
in stdlib but psycopg may not be installed in test envs).
"""

from __future__ import annotations

from typing import Any, Iterable


def _is_sqlite(conn: Any) -> bool:
    return type(conn).__module__.startswith("sqlite3")


def execute(conn: Any, sql: str, params: Iterable[Any] = ()) -> Any:
    """Execute a query, swapping placeholders to match the driver."""
    if _is_sqlite(conn):
        sql = sql.replace("%s", "?")
        return conn.execute(sql, tuple(params))
    cur = conn.cursor()
    cur.execute(sql, tuple(params))
    return cur


def fetchall(conn: Any, sql: str, params: Iterable[Any] = ()) -> list[tuple]:
    cur = execute(conn, sql, params)
    return list(cur.fetchall())


def fetchone(conn: Any, sql: str, params: Iterable[Any] = ()) -> tuple | None:
    cur = execute(conn, sql, params)
    return cur.fetchone()


def commit(conn: Any) -> None:
    conn.commit()
