"""Unit tests for _cluster_with_labels() in aggregator/main.py.

_cluster_with_labels orchestrates the clustering + LLM labeling pipeline:
  for kind, strings in findings.items():
    clusters = cluster_findings(strings)
    for cluster: label = label_cluster(cluster.members, ...)
                 out[kind] = [{"id": ..., "label": ..., "members": ..., "size": ...}]

Tests use unittest.mock.patch on cluster_findings and label_cluster so no
HDBSCAN, embeddings, or LLM calls are made.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import MagicMock, call, patch

from aggregator.main import _cluster_with_labels


@dataclass
class _FakeCluster:
    id: str
    members: list[str] = field(default_factory=list)


# ── Empty findings → empty output ─────────────────────────────────────────────

def test_empty_findings_returns_empty_dict() -> None:
    result = _cluster_with_labels({}, llm_caller=MagicMock(), ledger=MagicMock())
    assert result == {}


# ── Empty strings for a kind → cluster_findings returns [] ───────────────────

def test_empty_strings_produces_empty_list_for_kind() -> None:
    with patch("aggregator.main.cluster_findings", return_value=[]) as mock_cf, \
         patch("aggregator.main.label_cluster") as mock_lc:
        result = _cluster_with_labels(
            {"blockers": []},
            llm_caller=MagicMock(),
            ledger=MagicMock(),
        )
    assert result == {"blockers": []}
    mock_cf.assert_called_once_with([])
    mock_lc.assert_not_called()


# ── Single kind with one cluster ──────────────────────────────────────────────

def test_single_kind_single_cluster_shape() -> None:
    fake_cluster = _FakeCluster(id="c1", members=["pricing unclear", "no pricing page"])
    with patch("aggregator.main.cluster_findings", return_value=[fake_cluster]), \
         patch("aggregator.main.label_cluster", return_value="pricing confusion"):
        result = _cluster_with_labels(
            {"blockers": ["pricing unclear", "no pricing page"]},
            llm_caller=MagicMock(),
            ledger=MagicMock(),
        )

    assert "blockers" in result
    assert len(result["blockers"]) == 1
    row = result["blockers"][0]
    assert row["id"] == "c1"
    assert row["label"] == "pricing confusion"
    assert row["members"] == ["pricing unclear", "no pricing page"]
    assert row["size"] == 2


def test_cluster_size_reflects_member_count() -> None:
    fake = _FakeCluster(id="c2", members=["a", "b", "c", "d", "e"])
    with patch("aggregator.main.cluster_findings", return_value=[fake]), \
         patch("aggregator.main.label_cluster", return_value="label"):
        result = _cluster_with_labels(
            {"questions": ["a", "b", "c", "d", "e"]},
            llm_caller=MagicMock(),
            ledger=MagicMock(),
        )
    assert result["questions"][0]["size"] == 5


# ── Multiple clusters in one kind ─────────────────────────────────────────────

def test_multiple_clusters_in_one_kind() -> None:
    clusters = [
        _FakeCluster(id="c1", members=["m1", "m2"]),
        _FakeCluster(id="c2", members=["m3"]),
    ]
    labels = ["label one", "label two"]
    label_iter = iter(labels)

    with patch("aggregator.main.cluster_findings", return_value=clusters), \
         patch("aggregator.main.label_cluster", side_effect=lambda *a, **kw: next(label_iter)):
        result = _cluster_with_labels(
            {"objections": ["m1", "m2", "m3"]},
            llm_caller=MagicMock(),
            ledger=MagicMock(),
        )

    assert len(result["objections"]) == 2
    assert result["objections"][0]["label"] == "label one"
    assert result["objections"][1]["label"] == "label two"


# ── Multiple kinds → each processed independently ────────────────────────────

def test_multiple_kinds_each_processed_independently() -> None:
    def fake_cluster(strings: list[str]) -> list[_FakeCluster]:
        if strings:
            return [_FakeCluster(id=f"c-{strings[0][:3]}", members=strings)]
        return []

    with patch("aggregator.main.cluster_findings", side_effect=fake_cluster), \
         patch("aggregator.main.label_cluster", return_value="some-label"):
        result = _cluster_with_labels(
            {
                "blockers": ["price too high"],
                "objections": ["no free trial"],
                "confusions": [],
            },
            llm_caller=MagicMock(),
            ledger=MagicMock(),
        )

    assert "blockers" in result
    assert "objections" in result
    assert "confusions" in result
    assert len(result["blockers"]) == 1
    assert len(result["objections"]) == 1
    assert len(result["confusions"]) == 0


# ── llm_caller and ledger forwarded to label_cluster ─────────────────────────

def test_llm_caller_and_ledger_forwarded_to_label_cluster() -> None:
    fake_cluster = _FakeCluster(id="c1", members=["x"])
    mock_llm = MagicMock()
    mock_ledger = MagicMock()

    with patch("aggregator.main.cluster_findings", return_value=[fake_cluster]), \
         patch("aggregator.main.label_cluster", return_value="lbl") as mock_lc:
        _cluster_with_labels(
            {"questions": ["x"]},
            llm_caller=mock_llm,
            ledger=mock_ledger,
        )

    mock_lc.assert_called_once_with(
        ["x"],
        llm_caller=mock_llm,
        ledger=mock_ledger,
    )
