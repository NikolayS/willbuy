"""Acceptance #1: cluster_findings produces deterministic output across two runs.

Spec §5.7: lowercase + collapse whitespace + dedupe + lex-sort findings;
embed via fastembed (L2-normalize); HDBSCAN with pinned params; tie-breaks by
sorted input order. Spec §17: determinism within byte-identical image digest.
"""

from __future__ import annotations

import pytest

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


# ---------------------------------------------------------------------------
# B5 regression: hdbscan 0.8.33 + metric='euclidean' + random_state=42 raises
#   TypeError: __init__() got an unexpected keyword argument 'random_state'
# because the euclidean path routes through sklearn's KDTree which does not
# accept random_state. The cosine path routes through _hdbscan_generic and
# DOES accept random_state. Fix: use metric='cosine' (spec §17 verbatim).
# ---------------------------------------------------------------------------


def test_hdbscan_metric_is_cosine_not_euclidean() -> None:
    """B5 — HDBSCAN must be called with metric='cosine', not 'euclidean'.

    hdbscan 0.8.33 routes metric='euclidean' through sklearn KDTree which
    does not accept random_state=42, raising TypeError. The cosine path
    (_hdbscan_generic) does accept it.

    B7 fix: use AST inspection rather than a string search so that comments
    or docstrings mentioning 'euclidean' do not trigger a false positive.
    We walk the AST and find the actual ``metric`` keyword argument in the
    ``HDBSCAN(...)`` constructor call.
    """
    import ast
    import inspect
    import aggregator.cluster as cluster_mod

    src = inspect.getsource(cluster_mod)
    tree = ast.parse(src)
    found_metric = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = (
                func.attr if isinstance(func, ast.Attribute)
                else func.id if isinstance(func, ast.Name)
                else None
            )
            if name == "HDBSCAN":
                for kw in node.keywords:
                    if kw.arg == "metric":
                        if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                            found_metric = kw.value.value
    assert found_metric == "cosine", (
        f"expected metric='cosine' in HDBSCAN call, got {found_metric!r} — "
        "hdbscan 0.8.33 routes metric='euclidean' through KDTree which rejects "
        "random_state=42 (see amendment A2 follow-on 2026-04-25 and B5 fix)"
    )


def test_hdbscan_no_typeerror_with_random_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """B5 integration — cluster_findings must not raise TypeError with random_state=42.

    Runs cluster_findings end-to-end with a synthetic embed that returns
    pre-baked L2-normalized vectors, exercising the real HDBSCAN call.
    If metric='euclidean' is still in use, hdbscan 0.8.33 will raise:
      TypeError: __init__() got an unexpected keyword argument 'random_state'
    """
    import numpy as np
    import aggregator.cluster as cluster_mod

    # 9 synthetic L2-normalized 2-D vectors: three tight groups of 3.
    rng = np.random.default_rng(0)
    base = np.array([
        [1.0, 0.0],
        [0.0, 1.0],
        [-1.0, 0.0],
    ], dtype=np.float32)
    vectors = np.vstack([
        base + rng.standard_normal((3, 2)).astype(np.float32) * 0.05
        for _ in range(3)
    ])
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vectors = vectors / norms

    strings = [f"item_{i}" for i in range(len(vectors))]
    call_count = {"n": 0}

    def fake_embed(strs: object) -> np.ndarray:
        call_count["n"] += 1
        return vectors

    # monkeypatch _embed so we avoid fastembed network/disk access.
    monkeypatch.setattr(cluster_mod, "_embed", fake_embed)

    # Must not raise TypeError regardless of hdbscan version.
    try:
        result = cluster_mod.cluster_findings(strings)
    except TypeError as exc:
        pytest.fail(
            f"cluster_findings raised TypeError — likely metric='euclidean' "
            f"+ random_state=42 incompatible with hdbscan 0.8.33 KDTree path: {exc}"
        )
