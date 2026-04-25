"""Embedding-based clustering of finding strings.

Spec §17 + §5.7. Pipeline:

  1. lowercase + collapse whitespace + dedupe + lex-sort.
  2. embed via fastembed (BAAI/bge-small-en-v1.5), L2-normalize.
  3. HDBSCAN(min_cluster_size=3, min_samples=3, cluster_selection_method='eom',
     random_state=42, approx_min_span_tree=False) over cosine distance.
  4. Tie-breaks by sorted input order.
  5. Return clusters with member indices into the normalized list.

Determinism is guaranteed only inside a byte-identical Docker image digest
(spec §17). Pinned versions live in pyproject.toml.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np


# fastembed and hdbscan import lazily — they're heavy and we want the cluster
# module to be importable in test contexts that monkeypatch _embed.
_EMBED_MODEL_NAME = "BAAI/bge-small-en-v1.5"

# Keep BLAS thread counts pinned to 1 so HDBSCAN's MST is reproducible bitwise
# inside this image. Spec §17 mandates OpenBLAS-serial; this enforces single
# threads at the BLAS layer in case the runtime image links a multithreaded
# build. Setting before numpy/scipy are imported is ideal; fastembed pulls in
# numpy first, so we set on import.
for _var in (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "BLIS_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
):
    os.environ.setdefault(_var, "1")


_WS_RE = re.compile(r"\s+")


def normalize_findings(strings: Sequence[str]) -> list[str]:
    """Lowercase + collapse whitespace + strip + dedupe + lex-sort."""
    seen: set[str] = set()
    out: list[str] = []
    for s in strings:
        norm = _WS_RE.sub(" ", s.strip().lower())
        if norm and norm not in seen:
            seen.add(norm)
            out.append(norm)
    out.sort()
    return out


@dataclass(frozen=True)
class Cluster:
    """A non-noise HDBSCAN cluster.

    `id` is a stable 0-based integer assigned by lowest member_index; clusters
    are returned sorted by id. `members` are the normalized strings; `member_indices`
    are 0-based positions in the normalized lex-sorted input list.
    """

    id: int
    members: tuple[str, ...] = field(default_factory=tuple)
    member_indices: tuple[int, ...] = field(default_factory=tuple)


def _embed(strings: Sequence[str]) -> np.ndarray:
    """Embed strings via fastembed and L2-normalize.

    Returns a (N, D) float32 numpy array; rows L2-normalized so cosine distance
    reduces to 1 - dot product (HDBSCAN's metric='cosine' will do that itself,
    but we still normalize to make the embedding output deterministic at the
    representation level — float adds in different orders give different
    bitwise results).
    """
    from fastembed import TextEmbedding  # noqa: WPS433 — heavy import, kept local.

    # Single global model instance per process. fastembed caches model weights
    # under a fixed cache_dir; the Docker build pre-populates that dir so
    # runtime is offline.
    global _model
    try:
        model = _model  # type: ignore[name-defined]
    except NameError:
        model = TextEmbedding(model_name=_EMBED_MODEL_NAME)
        _model = model  # type: ignore[assignment]

    # fastembed returns a generator; materialize it.
    vectors = np.asarray(list(model.embed(list(strings))), dtype=np.float32)
    # L2-normalize each row. Avoid divide-by-zero on degenerate empty strings.
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


def cluster_findings(strings: Sequence[str]) -> list[Cluster]:
    """Cluster finding strings deterministically.

    Returns clusters sorted by their lowest member_index (= sort-order tiebreak).
    Noise points (HDBSCAN label == -1) are excluded.
    """
    normalized = normalize_findings(strings)
    if len(normalized) < 3:
        # Fewer than min_cluster_size — HDBSCAN cannot form a cluster.
        return []

    embeddings = _embed(normalized)

    import hdbscan  # noqa: WPS433 — heavy import, kept local.

    # Per spec §17 + §5.7.
    # random_state=42: required by spec §17 verbatim; technically a no-op for
    # the deterministic EOM selection path but present for explicit spec alignment.
    # metric='cosine': spec §17 verbatim. Amendment A2 documents why euclidean on
    # L2-normalized vectors is mathematically equivalent, BUT hdbscan 0.8.33 routes
    # metric='euclidean' through _hdbscan_prims_kdtree → sklearn KDTree.__init__,
    # which does NOT accept random_state as a kwarg (raises TypeError). The cosine
    # path routes through _hdbscan_generic which DOES accept it. Reverting to
    # 'cosine' until upstream fixes the kwarg forwarding; see A2 follow-on
    # 2026-04-25 in SPEC.willbuy.amendments.md (B5 fix).
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=3,
        min_samples=3,
        cluster_selection_method="eom",
        approx_min_span_tree=False,
        metric="cosine",  # spec §17 verbatim; see A2 + B5 fix for euclidean rationale
        random_state=42,
    )
    labels = clusterer.fit_predict(embeddings)

    # Build cluster groups, ordered by label encounter — HDBSCAN labels are
    # arbitrary integers; we re-id by the lowest member index in each cluster
    # to make output insensitive to HDBSCAN's internal label assignment order.
    by_label: dict[int, list[int]] = {}
    for idx, label in enumerate(labels):
        if label == -1:
            continue
        by_label.setdefault(int(label), []).append(idx)

    # Sort each group's members by index (sort-order tiebreak).
    groups = sorted(
        (sorted(idxs) for idxs in by_label.values()),
        key=lambda g: g[0],  # tie-break by lowest sorted-input index
    )

    return [
        Cluster(
            id=new_id,
            members=tuple(normalized[i] for i in group),
            member_indices=tuple(group),
        )
        for new_id, group in enumerate(groups)
    ]
