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
import statistics
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

VARIANT_LABEL: dict[int, str] = {0: "A", 1: "B"}

VALID_NEXT_ACTIONS: list[str] = [
    "purchase_paid_today",
    "contact_sales",
    "book_demo",
    "start_paid_trial",
    "bookmark_compare_later",
    "start_free_hobby",
    "ask_teammate",
    "leave",
]

VALID_TIERS: list[str] = ["none", "hobby", "express", "starter", "scale", "enterprise"]

# Maps cluster finding_kind → theme_board key.
CLUSTER_TO_THEME: dict[str, str] = {
    "unanswered_blockers": "blockers",
    "objections": "objections",
    "confusions": "confusions",
    "questions": "questions",
}


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


def _read_backstories(conn: Any, backstory_ids: list) -> dict[int, dict]:
    """Fetch backstory payloads for the given ids. Returns id → payload dict."""
    if not backstory_ids:
        return {}
    try:
        rows = db.fetchall(
            conn,
            "SELECT id, payload FROM backstories WHERE id = ANY(%s)",
            (backstory_ids,),
        )
    except Exception:
        # sqlite or backstories table absent — return empty map.
        return {}
    result: dict[int, dict] = {}
    for row in rows:
        bs_id, payload_col = row
        if isinstance(payload_col, dict):
            result[int(bs_id)] = payload_col
        else:
            try:
                result[int(bs_id)] = json.loads(payload_col)
            except (TypeError, ValueError):
                result[int(bs_id)] = {}
    return result


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


def _bs_map_get(backstory_map: dict[int, dict], bs_id: Any) -> dict:
    """Look up backstory payload tolerating non-integer IDs (e.g., test fixtures)."""
    try:
        return backstory_map.get(int(bs_id), {})
    except (TypeError, ValueError):
        return {}


def _build_report_json(
    *,
    visits: list[dict],
    visits_by_backstory: dict,
    paired: Any,
    clusters: dict[str, list[dict]],
    backstory_map: dict[int, dict],
    share_token_hash: str,
) -> dict:
    """Compute the full §5.18 Report visualization blob."""
    meta = {
        "slug": share_token_hash,
        "low_power": len(visits) < 20,
    }

    conservative_p = max(paired.paired_t_p, paired.wilcoxon_p)
    if paired.n > 0 and conservative_p < 0.05:
        verdict = "better" if paired.mean_delta > 0 else "worse"
    else:
        verdict = "inconclusive"
    headline = {
        "mean_delta": paired.mean_delta,
        "ci95_low": paired.ci_low,
        "ci95_high": paired.ci_high,
        "n_paired": paired.n,
        "paired_t_p": paired.paired_t_p,
        "wilcoxon_p": paired.wilcoxon_p,
        "mcnemar_p": paired.mcnemar_p,
        "verdict": verdict,
        "disagreement": paired.disagreement,
    }

    paired_dots = []
    for bs_id, pair in sorted(visits_by_backstory.items(), key=lambda x: str(x[0])):
        a_data = pair.get(0)
        b_data = pair.get(1)
        if a_data is None or b_data is None:
            continue
        score_a = float(a_data.get("score") or 0)
        score_b = float(b_data.get("score") or 0)
        if score_b > score_a:
            swing = "b_wins"
        elif score_b < score_a:
            swing = "a_wins"
        else:
            swing = "tie"
        bs_payload = _bs_map_get(backstory_map, bs_id)
        paired_dots.append({
            "backstory_id": str(bs_id),
            "backstory_name": bs_payload.get("name", str(bs_id)),
            "role": bs_payload.get("role_archetype", "ic_engineer"),
            "score_a": score_a,
            "score_b": score_b,
            "swing": swing,
        })

    visits_by_variant: dict[int, list[dict]] = defaultdict(list)
    for v in visits:
        visits_by_variant[v["variant"]].append(v)

    histograms = []
    for variant_idx in sorted(visits_by_variant.keys()):
        variant_visits = visits_by_variant[variant_idx]
        scores = [
            int(v["output"].get("will_to_buy") or 0)
            for v in variant_visits
            if v["output"].get("will_to_buy") is not None
        ]
        bins = [0] * 11
        for s in scores:
            bins[max(0, min(10, int(s)))] += 1
        mean_val = float(sum(scores) / len(scores)) if scores else 0.0
        median_val = float(statistics.median(scores)) if scores else 0.0
        histograms.append({
            "variant": VARIANT_LABEL.get(variant_idx, "A"),
            "bins": bins,
            "mean": mean_val,
            "median": median_val,
        })

    next_actions = []
    for variant_idx in sorted(visits_by_variant.keys()):
        variant_visits = visits_by_variant[variant_idx]
        counts = {a: 0 for a in VALID_NEXT_ACTIONS}
        for v in variant_visits:
            na = v["output"].get("next_action", "")
            if na in counts:
                counts[na] += 1
        next_actions.append({
            "variant": VARIANT_LABEL.get(variant_idx, "A"),
            "counts": counts,
        })

    tier_picked = []
    for variant_idx in sorted(visits_by_variant.keys()):
        variant_visits = visits_by_variant[variant_idx]
        counts = {t: 0 for t in VALID_TIERS}
        for v in variant_visits:
            tp = v["output"].get("tier_picked", "none") or "none"
            if tp not in counts:
                tp = "none"
            counts[tp] += 1
        tier_picked.append({
            "variant": VARIANT_LABEL.get(variant_idx, "A"),
            "counts": counts,
        })

    theme_board: dict[str, list] = {}
    for finding_kind, theme_key in CLUSTER_TO_THEME.items():
        theme_clusters = clusters.get(finding_kind, [])
        theme_board[theme_key] = [
            {
                "cluster_id": str(c["id"]),
                "label": c["label"],
                "count": c["size"],
            }
            for c in theme_clusters
        ]

    personas = []
    seen_bs: set = set()
    for v in visits:
        bs_id = v["backstory_id"]
        if bs_id in seen_bs:
            continue
        seen_bs.add(bs_id)
        bs_payload = _bs_map_get(backstory_map, bs_id)
        verdict_a = ""
        verdict_b = None
        score_a_raw: float | None = None
        score_b_raw: float | None = None
        for vv in visits:
            if vv["backstory_id"] != bs_id:
                continue
            out = vv["output"]
            if vv["variant"] == 0:
                if not verdict_a:
                    verdict_a = (out.get("first_impression") or out.get("reasoning") or "")[:400]
                if score_a_raw is None and out.get("will_to_buy") is not None:
                    score_a_raw = float(out["will_to_buy"])
            elif vv["variant"] == 1:
                if verdict_b is None:
                    verdict_b = (out.get("first_impression") or out.get("reasoning") or "")[:400]
                if score_b_raw is None and out.get("will_to_buy") is not None:
                    score_b_raw = float(out["will_to_buy"])
        personas.append({
            "backstory_id": str(bs_id),
            "backstory_name": bs_payload.get("name", str(bs_id)),
            "role": bs_payload.get("role_archetype", "ic_engineer"),
            "stage": str(bs_payload.get("stage", "")),
            "team_size": int(bs_payload.get("team_size", 2)),
            "stack": str(bs_payload.get("managed_postgres", "")),
            "current_pain": str(bs_payload.get("current_pain", "")),
            "entry_point": str(bs_payload.get("entry_point", "")),
            "score_a": score_a_raw if score_a_raw is not None else 0.0,
            "score_b": score_b_raw,
            "verdict_a": verdict_a,
            "verdict_b": verdict_b,
        })

    return {
        "meta": meta,
        "headline": headline,
        "paired_dots": paired_dots,
        "histograms": histograms,
        "next_actions": next_actions,
        "tier_picked": tier_picked,
        "theme_board": theme_board,
        "personas": personas,
    }


def run_study(
    *,
    study_id: str,
    conn: Any,
    llm_caller: LLMCaller,
) -> None:
    """Finalize a study: cluster findings, label, compute paired stats, write report.

    Single-writer / lock acquisition is the API caller's responsibility per
    spec §5.11. This function assumes the caller already holds the row lock.
    """
    visits = _read_visits(conn, study_id)
    bs_ids = list({v["backstory_id"] for v in visits})
    backstory_map = _read_backstories(conn, bs_ids)

    visits_by_backstory = _build_visits_by_backstory(visits)
    paired = paired_delta(visits_by_backstory)

    findings = _collect_findings(visits)
    ledger = _PgLedger(conn, study_id)
    clusters = _cluster_with_labels(findings, llm_caller=llm_caller, ledger=ledger)

    payload = {
        "paired_delta": paired.to_dict(),
        "clusters": clusters,
    }

    scores = [v["output"].get("will_to_buy") for v in visits if v["output"].get("will_to_buy") is not None]
    conv_score = float(sum(scores) / len(scores)) if scores else 0.0

    share_token_hash = secrets.token_hex(16)

    report_json = _build_report_json(
        visits=visits,
        visits_by_backstory=visits_by_backstory,
        paired=paired,
        clusters=clusters,
        backstory_map=backstory_map,
        share_token_hash=share_token_hash,
    )

    db.execute(
        conn,
        "INSERT INTO reports(study_id, conv_score, share_token_hash, paired_delta_json, clusters_json, report_json) VALUES (%s, %s, %s, %s, %s, %s)",
        (study_id, conv_score, share_token_hash, json.dumps(payload), json.dumps(clusters), json.dumps(report_json)),
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
        run_study(study_id=args.study_id, conn=conn, llm_caller=_stub_llm_caller)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(cli())
