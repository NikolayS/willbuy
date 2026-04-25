"""Acceptance #1: cluster_findings produces deterministic output across two runs.

Spec §5.7: lowercase + collapse whitespace + dedupe + lex-sort findings;
embed via fastembed (L2-normalize); HDBSCAN with pinned params; tie-breaks by
sorted input order. Spec §17: determinism within byte-identical image digest.
"""

from __future__ import annotations

from aggregator.cluster import cluster_findings, normalize_findings


# 30 findings with intentional duplicates, mixed case, and multiple
# whitespace runs. After normalization+dedup+lex-sort we expect a stable
# canonical input order; HDBSCAN over the (deterministic) embeddings must
# return the same labels twice in a row.
SAMPLE_FINDINGS: list[str] = [
    "Pricing is unclear",
    "pricing is unclear  ",
    "PRICING IS UNCLEAR",
    "Cannot find the enterprise tier",
    "cannot find the enterprise tier",
    "I cannot find the enterprise tier",
    "Where is the enterprise tier?",
    "What does Scale tier include?",
    "what does scale tier include",
    "Scale tier features are not listed",
    "Free tier limits are not documented",
    "free tier limits are not documented",
    "Limits on the free tier are missing",
    "Will my data be encrypted at rest?",
    "Is data encrypted at rest?",
    "Encryption-at-rest is not mentioned",
    "Where is the SOC2 report?",
    "How do I get the SOC2 report?",
    "SOC2 compliance is not visible",
    "Is there a SLA on uptime?",
    "What is the uptime SLA?",
    "Uptime guarantee is missing",
    "Can I deploy on-prem?",
    "Self-hosted deployment is not mentioned",
    "Do you support on-prem deployments?",
    "How do I cancel?",
    "Cancellation policy is unclear",
    "What if I want to cancel?",
    "totally unrelated mango lassi recipe",
    "completely unrelated topic about cats",
]


def test_normalize_lower_collapse_dedupe_lexsort() -> None:
    out = normalize_findings(["  Hello   World  ", "hello world", "alpha"])
    assert out == ["alpha", "hello world"]


def test_cluster_findings_deterministic_repeated_runs() -> None:
    """Acceptance #1 — same input → byte-identical clusters."""
    a = cluster_findings(SAMPLE_FINDINGS)
    b = cluster_findings(SAMPLE_FINDINGS)
    # Same number of clusters, same member sets in same order.
    assert len(a) == len(b)
    for ca, cb in zip(a, b):
        assert ca.id == cb.id
        assert ca.members == cb.members
        assert ca.member_indices == cb.member_indices


def test_cluster_findings_returns_lex_sorted_inputs_in_member_indices() -> None:
    """member_indices reference positions in the lex-sorted normalized input."""
    clusters = cluster_findings(SAMPLE_FINDINGS)
    # Every member_index is a valid index into the normalized inputs.
    normalized = normalize_findings(SAMPLE_FINDINGS)
    for c in clusters:
        for idx in c.member_indices:
            assert 0 <= idx < len(normalized)
        # Members are listed in ascending member_indices (tie-break by sort order).
        assert list(c.member_indices) == sorted(c.member_indices)


def test_cluster_findings_handles_empty_and_tiny_inputs() -> None:
    assert cluster_findings([]) == []
    # 2 inputs cannot meet min_cluster_size=3 → all noise → 0 clusters.
    assert cluster_findings(["alpha", "beta"]) == []
