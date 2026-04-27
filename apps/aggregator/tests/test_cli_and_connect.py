"""test_cli_and_connect.py — unit tests for cli() and _connect_from_env().

These entry-point helpers are the startup boundary of the aggregator process.
Tests use monkeypatching so no real Postgres or LLM binary is needed.

Tests:
  _connect_from_env:
    1. Raises SystemExit with a message when DATABASE_URL is unset.
    2. Raises SystemExit with the right message (not a generic RuntimeError).

  cli():
    3. Exits non-zero (SystemExit) when DATABASE_URL is unset and --study-id given.
    4. Calls run_study with the study_id from --study-id flag.
    5. Returns 0 on success (run_study returns normally).
    6. argparse error on missing --study-id (SystemExit 2).
"""

from __future__ import annotations

import os
import pytest
from unittest.mock import MagicMock, patch

from aggregator.main import _connect_from_env, cli


# ---------------------------------------------------------------------------
# _connect_from_env
# ---------------------------------------------------------------------------


def test_connect_from_env_raises_system_exit_when_database_url_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DATABASE_URL absent → SystemExit (not a plain RuntimeError)."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        _connect_from_env()


def test_connect_from_env_exit_message_mentions_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The SystemExit message must mention DATABASE_URL so operators know what to set."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit) as exc_info:
        _connect_from_env()
    assert "DATABASE_URL" in str(exc_info.value)


# ---------------------------------------------------------------------------
# cli()
# ---------------------------------------------------------------------------


def test_cli_exits_when_database_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """cli() calls _connect_from_env() which exits when DATABASE_URL is unset."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        cli(["--study-id", "42"])


def test_cli_calls_run_study_with_study_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """cli() passes the --study-id value through to run_study()."""
    fake_conn = MagicMock()
    monkeypatch.setenv("DATABASE_URL", "postgres://fake")

    with patch("aggregator.main._connect_from_env", return_value=fake_conn), \
         patch("aggregator.main.run_study") as mock_run_study, \
         patch("aggregator.main._make_cli_llm_caller", return_value=MagicMock()):
        result = cli(["--study-id", "123"])

    assert result == 0
    mock_run_study.assert_called_once()
    call_kwargs = mock_run_study.call_args
    assert call_kwargs.kwargs["study_id"] == "123"


def test_cli_returns_zero_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """cli() returns 0 when run_study completes without error."""
    fake_conn = MagicMock()
    monkeypatch.setenv("DATABASE_URL", "postgres://fake")

    with patch("aggregator.main._connect_from_env", return_value=fake_conn), \
         patch("aggregator.main.run_study"), \
         patch("aggregator.main._make_cli_llm_caller", return_value=MagicMock()):
        result = cli(["--study-id", "99"])

    assert result == 0
    fake_conn.close.assert_called_once()


def test_cli_argparse_error_on_missing_study_id() -> None:
    """cli() raises SystemExit(2) when --study-id is missing (argparse error)."""
    with pytest.raises(SystemExit) as exc_info:
        cli([])
    assert exc_info.value.code == 2
