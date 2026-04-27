"""Tests for _send_ready_email, _send_failed_email, _lookup_owner_email."""

from __future__ import annotations

import json
import os
import sqlite3
from unittest.mock import MagicMock, patch

from aggregator.main import _send_ready_email, _send_failed_email, _lookup_owner_email

SCHEMA = """
CREATE TABLE studies (id TEXT PRIMARY KEY, status TEXT NOT NULL, account_id TEXT NOT NULL);
CREATE TABLE accounts (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL);
"""


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO accounts VALUES ('1', 'owner@example.com')")
    conn.execute("INSERT INTO studies VALUES ('42', 'ready', '1')")
    conn.commit()
    return conn


class TestLookupOwnerEmail:
    def test_returns_email_when_study_exists(self):
        conn = make_conn()
        assert _lookup_owner_email(conn, "42") == "owner@example.com"

    def test_returns_none_when_study_missing(self):
        conn = make_conn()
        assert _lookup_owner_email(conn, "999") is None


class TestSendReadyEmail:
    def test_skips_when_no_api_key(self, monkeypatch):
        monkeypatch.delenv("RESEND_API_KEY", raising=False)
        conn = make_conn()
        _send_ready_email("42", conn)  # must not raise

    def test_skips_when_placeholder_key(self, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "re_not_configured")
        conn = make_conn()
        _send_ready_email("42", conn)  # must not raise

    def test_calls_resend_api_when_key_set(self, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
        conn = make_conn()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__ = lambda s: s
            mock_open.return_value.__exit__ = MagicMock(return_value=False)
            _send_ready_email("42", conn)
        mock_open.assert_called_once()
        req = mock_open.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["to"] == ["owner@example.com"]
        assert "42" in body["subject"]
        assert "ready" in body["subject"].lower()

    def test_swallows_network_error(self, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
        conn = make_conn()
        with patch("urllib.request.urlopen", side_effect=OSError("timeout")):
            _send_ready_email("42", conn)  # must not raise


class TestSendFailedEmail:
    def test_skips_when_no_api_key(self, monkeypatch):
        monkeypatch.delenv("RESEND_API_KEY", raising=False)
        conn = make_conn()
        _send_failed_email("42", conn)  # must not raise

    def test_calls_resend_api_when_key_set(self, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
        conn = make_conn()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__ = lambda s: s
            mock_open.return_value.__exit__ = MagicMock(return_value=False)
            _send_failed_email("42", conn)
        mock_open.assert_called_once()
        req = mock_open.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["to"] == ["owner@example.com"]
        assert "42" in body["subject"]
        assert "fail" in body["subject"].lower()
