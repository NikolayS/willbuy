"""Acceptance #6: end-to-end. 30 visit fixtures, stub LLM, sqlite-backed.

Verifies main.run_study() reads visits, computes report payload, writes a
reports row, sets studies.status='ready', and the JSON contains clusters.

We use sqlite for the test DB to keep CI hermetic — main.run_study must
accept a connection-factory injection so production can hand it a psycopg
connection without sqlite ever being imported in prod paths.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from aggregator.main import run_study


SCHEMA_SQL = """
CREATE TABLE studies (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL,
  variant TEXT NOT NULL,            -- 'A' or 'B'
  backstory_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- 'ok' or 'failed'
  output_json TEXT NOT NULL         -- VisitorOutput as JSON
);
CREATE TABLE reports (
  study_id TEXT PRIMARY KEY,
  paired_delta_json TEXT NOT NULL
);
CREATE TABLE provider_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


def _seed(conn: sqlite3.Connection, study_id: str) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.execute("INSERT INTO studies(id, status) VALUES (?, ?)", (study_id, "aggregating"))
    # 15 backstories × 2 variants = 30 ok visits.
    for i in range(15):
        backstory = f"persona_{i:02d}"
        a_score = 4 + (i % 3)
        b_score = a_score + 2 if i % 2 == 0 else a_score + 1
        a_action = "leave" if i % 4 != 0 else "ask_teammate"
        b_action = "contact_sales" if i % 2 == 0 else "purchase_paid_today"
        for variant, score, action, objections in [
            (
                "A",
                a_score,
                a_action,
                [f"pricing is unclear for persona {i}", "where is enterprise tier"],
            ),
            (
                "B",
                b_score,
                b_action,
                [f"pricing is now clearer for persona {i}", "scale tier features listed"],
            ),
        ]:
            output = {
                "first_impression": f"page looks ok for {backstory}",
                "will_to_buy": score,
                "questions": ["what is included in scale tier"],
                "confusions": ["free tier limits unclear"],
                "objections": objections,
                "unanswered_blockers": ["soc2 report missing"],
                "next_action": action,
                "confidence": 7,
                "reasoning": f"persona {i} reasoning text",
            }
            conn.execute(
                "INSERT INTO visits(id, study_id, variant, backstory_id, status, output_json) VALUES (?,?,?,?,?,?)",
                (
                    f"v_{i:02d}_{variant}",
                    study_id,
                    variant,
                    backstory,
                    "ok",
                    json.dumps(output),
                ),
            )
    conn.commit()


def test_e2e_run_study_writes_report_and_clusters(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = sqlite3.connect(db_path)
    _seed(conn, "study_e2e_001")

    def llm_caller(prompt: str, *, kind: str) -> str:
        # Stub LLM: returns a short label derived from the prompt to keep things
        # deterministic for the test.
        return "stub label"

    run_study(
        study_id="study_e2e_001",
        conn=conn,
        llm_caller=llm_caller,
    )

    cur = conn.execute("SELECT status FROM studies WHERE id=?", ("study_e2e_001",))
    row = cur.fetchone()
    assert row[0] == "ready"

    cur = conn.execute(
        "SELECT paired_delta_json FROM reports WHERE study_id=?",
        ("study_e2e_001",),
    )
    payload = json.loads(cur.fetchone()[0])

    # Paired stats present.
    assert "paired_delta" in payload
    pd = payload["paired_delta"]
    assert "mean_delta" in pd
    assert "paired_t_p" in pd
    assert "wilcoxon_p" in pd
    assert "mcnemar_p" in pd
    assert "disagreement" in pd
    assert pd["n"] == 15

    # Clusters present (objections sample is duplicated enough across personas
    # that we expect at least ONE non-noise cluster from the embedding pass).
    assert "clusters" in payload
    assert isinstance(payload["clusters"], dict)
    # At least one of the four finding kinds yields a cluster list.
    total_clusters = sum(len(v) for v in payload["clusters"].values())
    assert total_clusters >= 1

    # provider_attempts has at least one cluster_label row (only one per cluster).
    cur = conn.execute(
        "SELECT COUNT(*) FROM provider_attempts WHERE study_id=? AND kind='cluster_label'",
        ("study_e2e_001",),
    )
    n_label_rows = cur.fetchone()[0]
    assert n_label_rows == total_clusters
