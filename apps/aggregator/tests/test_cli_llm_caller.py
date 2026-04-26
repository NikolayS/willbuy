"""Unit tests for _make_cli_llm_caller (issue #199 — cluster labeling).

Tests the fallback-to-stub when binary is missing, and the happy-path
when the binary is present (using a mock subprocess).
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch

from aggregator.main import _make_cli_llm_caller, _stub_llm_caller


def test_make_cli_llm_caller_falls_back_to_stub_when_binary_missing() -> None:
    """If llm_bin is not on PATH, fall back to _stub_llm_caller."""
    with patch("shutil.which", return_value=None):
        caller = _make_cli_llm_caller("nonexistent-binary")
    # Should return the stub function itself
    assert caller is _stub_llm_caller


def test_make_cli_llm_caller_calls_binary_via_stdin() -> None:
    """When the binary exists, the caller pipes prompt to stdin and returns stdout."""
    fake_result = MagicMock()
    fake_result.returncode = 0
    fake_result.stdout = "  Pricing tiers unclear  \n"

    with patch("shutil.which", return_value="/usr/bin/claude"), \
         patch("subprocess.run", return_value=fake_result) as mock_run:
        caller = _make_cli_llm_caller("claude")
        label = caller("- pricing confusing\n- too many tiers", kind="cluster_label")

    # Label should be stripped
    assert label == "Pricing tiers unclear"
    # subprocess.run should have been called with the prompt as stdin
    call_kwargs = mock_run.call_args
    assert call_kwargs.kwargs["input"] == "- pricing confusing\n- too many tiers"
    assert call_kwargs.args[0] == ["claude"]


def test_make_cli_llm_caller_raises_on_nonzero_exit() -> None:
    """Non-zero exit from the binary raises RuntimeError."""
    fake_result = MagicMock()
    fake_result.returncode = 1
    fake_result.stderr = "authentication failed"

    with patch("shutil.which", return_value="/usr/bin/claude"), \
         patch("subprocess.run", return_value=fake_result):
        caller = _make_cli_llm_caller("claude")
        with pytest.raises(RuntimeError, match="exited 1"):
            caller("some prompt", kind="cluster_label")
