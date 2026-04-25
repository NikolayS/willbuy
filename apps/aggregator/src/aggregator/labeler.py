"""Cluster-label LLM call.

Spec §5.6: ONE LLM call per cluster, returns a ≤8-word label. Records a
provider_attempts row (kind='cluster_label') for observability and ledger
purposes (spec §27).

The Python-side `LLMProvider` shim is intentionally minimal — it is a callable
with signature `(prompt: str, *, kind: str) -> str`. The TS adapter contract
(spec §27) is the source of truth; this Python shim mirrors it for the one
call site (cluster labeling) the aggregator needs.
"""

from __future__ import annotations

import time
from typing import Callable, Protocol


class _LedgerLike(Protocol):
    def record(self, row: dict) -> None: ...


LLMCaller = Callable[..., str]


_PROMPT_TEMPLATE = (
    "You will be given a list of short phrases that all describe the same theme.\n"
    "Return a SHORT label (at most 8 words, no punctuation, no quotes) that\n"
    "summarizes the theme.\n"
    "\n"
    "Phrases:\n{phrases}\n\nLabel:"
)


def _truncate_to_eight_words(s: str) -> str:
    words = s.strip().split()
    return " ".join(words[:8])


def label_cluster(
    member_strings: list[str],
    *,
    llm_caller: LLMCaller,
    ledger: _LedgerLike,
) -> str:
    """Get a ≤8-word label for the cluster.

    Records exactly one provider_attempts row (status='ok' on success,
    status='failed' on exception). Re-raises exceptions after recording.
    """
    phrases = "\n".join(f"- {s}" for s in member_strings)
    prompt = _PROMPT_TEMPLATE.format(phrases=phrases)
    started = time.monotonic()
    try:
        raw = llm_caller(prompt, kind="cluster_label")
    except Exception:
        ledger.record(
            {
                "kind": "cluster_label",
                "status": "failed",
                "duration_ms": int((time.monotonic() - started) * 1000),
            },
        )
        raise
    label = _truncate_to_eight_words(raw)
    ledger.record(
        {
            "kind": "cluster_label",
            "status": "ok",
            "duration_ms": int((time.monotonic() - started) * 1000),
        },
    )
    return label
