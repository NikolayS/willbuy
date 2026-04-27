"""Tests for the label_cluster prompt construction (spec §5.6, §5.7).

The _PROMPT_TEMPLATE is a module-level private constant; this file tests
the observable prompt shape by injecting a capturing LLM caller.

Key contracts:
  - The prompt contains the member strings passed to label_cluster.
  - The prompt contains the word "Label:" (the LLM instruction cue).
  - Each phrase appears as a list item prefixed with "- ".
"""

from __future__ import annotations

from aggregator.labeler import label_cluster


class FakeLedger:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def record(self, row: dict) -> None:
        self.rows.append(row)


def test_label_cluster_prompt_contains_all_phrases() -> None:
    captured: list[str] = []

    def llm_caller(prompt: str, *, kind: str) -> str:
        captured.append(prompt)
        return "test label"

    phrases = ["pricing unclear", "can't find pricing", "where is pricing"]
    label_cluster(phrases, llm_caller=llm_caller, ledger=FakeLedger())

    assert len(captured) == 1
    prompt = captured[0]
    for phrase in phrases:
        assert phrase in prompt, f"phrase not in prompt: {phrase!r}"


def test_label_cluster_prompt_formats_phrases_as_list_items() -> None:
    """Each phrase is prefixed with '- ' in the prompt."""
    captured: list[str] = []

    def llm_caller(prompt: str, *, kind: str) -> str:
        captured.append(prompt)
        return "test label"

    label_cluster(["alpha", "beta"], llm_caller=llm_caller, ledger=FakeLedger())
    prompt = captured[0]
    assert "- alpha" in prompt
    assert "- beta" in prompt


def test_label_cluster_prompt_contains_label_cue() -> None:
    """The prompt ends with 'Label:' to cue the LLM."""
    captured: list[str] = []

    def llm_caller(prompt: str, *, kind: str) -> str:
        captured.append(prompt)
        return "some label"

    label_cluster(["x"], llm_caller=llm_caller, ledger=FakeLedger())
    assert "Label:" in captured[0]


def test_label_cluster_kind_is_cluster_label() -> None:
    """The kind kwarg passed to llm_caller is always 'cluster_label'."""
    kinds: list[str] = []

    def llm_caller(prompt: str, *, kind: str) -> str:
        kinds.append(kind)
        return "ok"

    label_cluster(["a"], llm_caller=llm_caller, ledger=FakeLedger())
    assert kinds == ["cluster_label"]
