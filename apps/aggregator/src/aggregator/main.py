"""Aggregator CLI + study-finalize entry point.

Usage:
  aggregator --study-id <id>

Reads visits + studies from the DB at $DATABASE_URL, computes the report payload
(clusters + paired stats + cluster labels), writes a `reports` row keyed by
study_id, and flips `studies.status` to 'ready'. One short-lived connection
per finalize per spec §5.11. Exactly one writer is enforced upstream by
SELECT ... FOR UPDATE SKIP LOCKED on `studies.status='aggregating'`; this
function trusts that the caller (API service) has already acquired the row.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from collections import defaultdict
from typing import Any

from . import db
from .cluster import cluster_findings
from .labeler import label_cluster, LLMCaller
from .stats import paired_delta


# Finding kinds that we cluster. Spec §17 + §5.6 + §2 #15.
FINDING_KINDS: tuple[str, ...] = (
    "objections",
    "confusions",
    "unanswered_blockers",
    "questions",
)


class _PgLedger:
    """Records provider_attempts rows. Inserts on each `record(...)` call."""

    def __init__(self, conn: Any, study_id: str) -> None:
        self._conn = conn
        self._study_id = study_id

    def record(self, row: dict) -> None:
        db.execute(
            self._conn,
            "INSERT INTO provider_attempts(study_id, kind, status, duration_ms) VALUES (%s, %s, %s, %s)",
            (
                self._study_id,
                row["kind"],
                row["status"],
                row.get("duration_ms"),
            ),
        )


class _NoOpLedger:
    """No-op ledger for the CLI path.

    provider_attempts requires account_id (NOT NULL) which the CLI path
    doesn't have. The API service wires the real ledger; the CLI aggregator
    skips ledger writes (issue #178).
    """

    def record(self, row: dict) -> None:
        pass


def _read_visits(conn: Any, study_id: str) -> list[dict]:
    rows = db.fetchall(
        conn,
        "SELECT id, variant_idx, backstory_id, status, parsed FROM visits WHERE study_id=%s",
        (study_id,),
    )
    out: list[dict] = []
    for row in rows:
        _id, variant_idx, backstory_id, status, parsed_col = row
        if status != "ok":
            continue
        if isinstance(parsed_col, dict):
            parsed = parsed_col
        else:
            try:
                parsed = json.loads(parsed_col)
            except (TypeError, ValueError):
                continue
        out.append(
            {
                "id": _id,
                "variant": variant_idx,
                "backstory_id": backstory_id,
                "output": parsed,
            },
        )
    return out


def _build_visits_by_backstory(visits: list[dict]) -> dict[str, dict[str, dict]]:
    pairs: dict[str, dict[str, dict]] = defaultdict(dict)
    for v in visits:
        out = v["output"]
        pairs[v["backstory_id"]][v["variant"]] = {
            "score": out.get("will_to_buy"),
            "next_action": out.get("next_action"),
        }
    # Drop incomplete pairs.
    return {k: v for k, v in pairs.items() if 0 in v and 1 in v}


def _collect_findings(visits: list[dict]) -> dict[str, list[str]]:
    findings: dict[str, list[str]] = {kind: [] for kind in FINDING_KINDS}
    for v in visits:
        out = v["output"]
        for kind in FINDING_KINDS:
            for s in out.get(kind, []) or []:
                if isinstance(s, str):
                    findings[kind].append(s)
    return findings


def _cluster_with_labels(
    findings: dict[str, list[str]],
    *,
    llm_caller: LLMCaller,
    ledger: _PgLedger | Any,
) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for kind, strings in findings.items():
        clusters = cluster_findings(strings)
        labeled: list[dict] = []
        for c in clusters:
            label = label_cluster(c.members, llm_caller=llm_caller, ledger=ledger)
            labeled.append(
                {
                    "id": c.id,
                    "label": label,
                    "members": c.members,
                    "size": len(c.members),
                },
            )
        out[kind] = labeled
    return out


def run_study(
    *,
    study_id: str,
    conn: Any,
    llm_caller: LLMCaller,
    ledger: Any = None,
) -> None:
    """Finalize a study: cluster findings, label, compute paired stats, write report.

    Single-writer / lock acquisition is the API caller's responsibility per
    spec §5.11. This function assumes the caller already holds the row lock.
    """
    visits = _read_visits(conn, study_id)
    paired_input = _build_visits_by_backstory(visits)
    paired = paired_delta(paired_input)

    findings = _collect_findings(visits)
    if ledger is None:
        ledger = _PgLedger(conn, study_id)
    clusters = _cluster_with_labels(findings, llm_caller=llm_caller, ledger=ledger)

    payload = {
        "paired_delta": paired.to_dict(),
        "clusters": clusters,
    }

    scores = [v["output"].get("will_to_buy") for v in visits if v["output"].get("will_to_buy") is not None]
    conv_score = float(sum(scores) / len(scores)) if scores else 0.0

    share_token_hash = secrets.token_hex(16)

    db.execute(
        conn,
        "INSERT INTO reports(study_id, conv_score, share_token_hash, paired_delta_json, clusters_json) VALUES (%s, %s, %s, %s, %s)",
        (study_id, conv_score, share_token_hash, json.dumps(payload), json.dumps(clusters)),
    )
    db.execute(
        conn,
        "UPDATE studies SET status=%s WHERE id=%s",
        ("ready", study_id),
    )
    db.commit(conn)


def _connect_from_env() -> Any:
    """Open a psycopg connection from $DATABASE_URL.

    psycopg is imported lazily so unit tests that pass `conn=` directly do not
    require the package at import time.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required when invoking aggregator from CLI")
    import psycopg  # noqa: WPS433 — lazy.

    return psycopg.connect(url)


def _stub_llm_caller(prompt: str, *, kind: str) -> str:  # pragma: no cover
    """Fallback when no LLM provider is wired (offline smoke runs).

    Production uses the TS LLMProvider via subprocess (spec §27); that wiring
    lands in S2-6 (API service) — the API spawns the aggregator and passes
    the LLM endpoint through env. Until then, we return a placeholder so the
    pipeline shape is exercisable end-to-end.
    """
    return "unlabeled cluster"


def cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="aggregator")
    parser.add_argument("--study-id", required=True)
    args = parser.parse_args(argv)

    conn = _connect_from_env()
    try:
        run_study(study_id=args.study_id, conn=conn, llm_caller=_stub_llm_caller, ledger=_NoOpLedger())
    finally:
        conn.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(cli())
