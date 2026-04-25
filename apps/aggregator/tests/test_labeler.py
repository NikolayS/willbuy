"""Acceptance #5: label_cluster smoke test.

Spec §5.6: ONE LLM call per cluster, returns ≤8-word label. Records a
provider_attempts row. The Python-side `LLMProvider` shim mirrors the TS
adapter contract (spec §27): a callable `(prompt: str, *, kind: str) -> str`.
"""

from __future__ import annotations

from aggregator.labeler import label_cluster


class FakeLedger:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def record(self, row: dict) -> None:
        self.rows.append(row)


def test_label_cluster_invokes_llm_once_and_returns_trimmed() -> None:
    calls = {"n": 0}

    def llm_caller(prompt: str, *, kind: str) -> str:
        calls["n"] += 1
        assert kind == "cluster_label"
        # Provider may return whitespace/newlines; we trim.
        return "  concrete label\n"

    ledger = FakeLedger()
    out = label_cluster(
        ["pricing is unclear", "i can't find pricing", "where is pricing"],
        llm_caller=llm_caller,
        ledger=ledger,
    )
    assert out == "concrete label"
    assert calls["n"] == 1
    # Recorded provider_attempts row.
    assert len(ledger.rows) == 1
    assert ledger.rows[0]["kind"] == "cluster_label"
    assert ledger.rows[0]["status"] == "ok"


def test_label_cluster_truncates_to_eight_words() -> None:
    def llm_caller(prompt: str, *, kind: str) -> str:
        return "this is a very long label that exceeds the eight word cap clearly"

    ledger = FakeLedger()
    out = label_cluster(["a", "b", "c"], llm_caller=llm_caller, ledger=ledger)
    # ≤ 8 words.
    assert len(out.split()) <= 8


def test_label_cluster_records_failed_attempt_on_exception() -> None:
    def llm_caller(prompt: str, *, kind: str) -> str:
        raise RuntimeError("provider down")

    ledger = FakeLedger()
    try:
        label_cluster(["a", "b", "c"], llm_caller=llm_caller, ledger=ledger)
    except RuntimeError:
        pass
    assert len(ledger.rows) == 1
    assert ledger.rows[0]["status"] == "failed"
