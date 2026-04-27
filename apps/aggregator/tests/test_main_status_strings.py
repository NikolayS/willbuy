"""Spec-pin for the critical status SQL strings in aggregator/main.py (spec §5.11).

Two inline string literals control the aggregator's interaction with the
study state machine:

  status != "ok"        — visit filter in _collect_raw_data; visits with
                          status != 'ok' are skipped (failed/indeterminate
                          visits don't contribute to the report).

  ("ready", study_id)  — written to studies.status when finalize_study
                          succeeds. Must match the DB CHECK constraint and
                          the value the API finalize-lock expects.

Both are plain Python string literals, not named constants. A rename (e.g.
"ok" → "success") would compile cleanly but break the visit-filter logic at
runtime — all visits would be skipped and reports would have zero clusters.
"""

from __future__ import annotations

import pathlib


SRC = (pathlib.Path(__file__).parent.parent / "src" / "aggregator" / "main.py").read_text()


def test_visit_ok_status_filter_present() -> None:
    """_collect_raw_data skips visits where status != 'ok'."""
    assert '!= "ok"' in SRC or "!= 'ok'" in SRC, (
        "main.py must compare visit status to the literal 'ok' to filter non-ok visits"
    )


def test_study_ready_status_written() -> None:
    """finalize_study writes status='ready' to studies on success."""
    assert '"ready"' in SRC or "'ready'" in SRC, (
        "main.py must write the literal 'ready' to studies.status on successful aggregation"
    )


def test_aggregating_status_referenced() -> None:
    """The module docstring/comment documents the 'aggregating' precondition."""
    assert "aggregating" in SRC, (
        "main.py must reference 'aggregating' — the study status the lock expects"
    )


def test_ready_written_after_ok_filter() -> None:
    """The 'ready' write occurs after the 'ok' visit filter in the file."""
    ok_idx = SRC.find('"ok"')
    if ok_idx == -1:
        ok_idx = SRC.find("'ok'")
    ready_idx = SRC.rfind('"ready"')  # use rfind to get the UPDATE assignment
    if ready_idx == -1:
        ready_idx = SRC.rfind("'ready'")
    assert ok_idx > -1
    assert ready_idx > ok_idx
