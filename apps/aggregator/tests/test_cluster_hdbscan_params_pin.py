"""Spec-pin for HDBSCAN parameters in aggregator/cluster.py (spec §17).

The spec §17 prescribes the clustering algorithm verbatim:
  HDBSCAN(min_cluster_size=3, min_samples=3, cluster_selection_method='eom',
          metric='precomputed', random_state=42)

Changing any of these parameters silently changes which findings are grouped
into themes and which are classified as noise:
  - min_cluster_size=3: raising drops small-but-real clusters from the report;
    lowering creates singleton clusters from noise.
  - min_samples=3: controls noise sensitivity (higher = more noise points).
  - cluster_selection_method='eom': 'leaf' would produce fewer, larger clusters.
  - metric='precomputed': we pre-compute the cosine distance matrix to work
    around HDBSCAN's metric='cosine' compatibility issues (see B5/B8 comments).
  - random_state=42: spec §17 verbatim; ensures reproducible cluster labels.
"""

from __future__ import annotations

import pathlib


SRC = (
    pathlib.Path(__file__).parent.parent / "src" / "aggregator" / "cluster.py"
).read_text()


def test_min_cluster_size_is_3() -> None:
    """Spec §17: HDBSCAN(min_cluster_size=3)."""
    assert "min_cluster_size=3" in SRC


def test_min_samples_is_3() -> None:
    """Spec §17: HDBSCAN(min_samples=3)."""
    assert "min_samples=3" in SRC


def test_cluster_selection_method_is_eom() -> None:
    """Spec §17: cluster_selection_method='eom' (excess-of-mass)."""
    assert 'cluster_selection_method="eom"' in SRC


def test_metric_is_precomputed() -> None:
    """Uses metric='precomputed' to supply our own cosine distance matrix (B5/B8 workaround)."""
    assert 'metric="precomputed"' in SRC


def test_random_state_is_42() -> None:
    """Spec §17 verbatim: random_state=42 for reproducible cluster labels."""
    assert "random_state=42" in SRC
