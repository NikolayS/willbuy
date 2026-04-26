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

from aggregator.main import run_study, _coerce_role


SCHEMA_SQL = """
CREATE TABLE studies (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL,
  variant_idx INTEGER NOT NULL,     -- 0 (control) or 1 (treatment)
  backstory_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- 'ok' or 'failed'
  parsed TEXT NOT NULL              -- VisitorOutput as JSON string (sqlite; psycopg returns dict)
);
CREATE TABLE reports (
  study_id TEXT PRIMARY KEY,
  conv_score REAL NOT NULL DEFAULT 0,
  share_token_hash TEXT NOT NULL DEFAULT '',
  paired_delta_json TEXT NOT NULL,
  clusters_json TEXT,
  report_json TEXT
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
        for variant_idx, score, action, objections in [
            (
                0,
                a_score,
                a_action,
                [f"pricing is unclear for persona {i}", "where is enterprise tier"],
            ),
            (
                1,
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
                "INSERT INTO visits(id, study_id, variant_idx, backstory_id, status, parsed) VALUES (?,?,?,?,?,?)",
                (
                    f"v_{i:02d}_{variant_idx}",
                    study_id,
                    variant_idx,
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
        "SELECT paired_delta_json, conv_score, share_token_hash, report_json FROM reports WHERE study_id=?",
        ("study_e2e_001",),
    )
    report_row = cur.fetchone()
    payload = json.loads(report_row[0])
    assert isinstance(report_row[1], float)
    assert isinstance(report_row[2], str) and len(report_row[2]) > 0
    # report_json is non-NULL and valid JSON.
    assert report_row[3] is not None
    rj = json.loads(report_row[3])

    # Paired stats present (paired_delta_json now stores paired.to_dict() directly).
    assert "mean_delta" in payload
    assert "paired_t_p" in payload
    assert "wilcoxon_p" in payload
    assert "mcnemar_p" in payload
    assert "disagreement" in payload
    assert payload["n"] == 15

    # Clusters present in clusters_json (separate column).
    cur2 = conn.execute(
        "SELECT clusters_json FROM reports WHERE study_id=?",
        ("study_e2e_001",),
    )
    clusters_payload = json.loads(cur2.fetchone()[0])
    assert isinstance(clusters_payload, dict)
    # At least one of the four finding kinds yields a cluster list.
    total_clusters = sum(len(v) for v in clusters_payload.values())
    assert total_clusters >= 1

    # provider_attempts has at least one cluster_label row (only one per cluster).
    cur = conn.execute(
        "SELECT COUNT(*) FROM provider_attempts WHERE study_id=? AND kind='cluster_label'",
        ("study_e2e_001",),
    )
    n_label_rows = cur.fetchone()[0]
    assert n_label_rows == total_clusters

    # report_json slug matches study_id (the URL route key), not the share_token_hash.
    assert rj["meta"]["slug"] == "study_e2e_001"
    # histograms has at least 1 entry (both variants present in seed data).
    assert isinstance(rj["histograms"], list)
    assert len(rj["histograms"]) >= 1
    # theme_board has all four required keys.
    assert set(rj["theme_board"].keys()) == {"blockers", "objections", "confusions", "questions"}


def _seed_with_unknown_role(conn: sqlite3.Connection, study_id: str) -> None:
    """Seed a minimal study with one backstory whose role_archetype is unknown."""
    conn.executescript(SCHEMA_SQL)
    conn.execute("INSERT INTO studies(id, status) VALUES (?, ?)", (study_id, "aggregating"))
    conn.execute(
        "INSERT INTO visits(id, study_id, variant_idx, backstory_id, status, parsed) VALUES (?,?,?,?,?,?)",
        (
            "v_role_00",
            study_id,
            0,
            "bs_unknown_role",
            "ok",
            json.dumps({
                "first_impression": "looks interesting",
                "will_to_buy": 6,
                "questions": [],
                "confusions": [],
                "objections": ["price too high"],
                "unanswered_blockers": [],
                "next_action": "contact_sales",
                "confidence": 7,
                "reasoning": "solid product",
                "role_archetype": "unknown_role",
            }),
        ),
    )
    conn.execute(
        "INSERT INTO visits(id, study_id, variant_idx, backstory_id, status, parsed) VALUES (?,?,?,?,?,?)",
        (
            "v_role_01",
            study_id,
            1,
            "bs_unknown_role",
            "ok",
            json.dumps({
                "first_impression": "variant B looks better",
                "will_to_buy": 8,
                "questions": [],
                "confusions": [],
                "objections": [],
                "unanswered_blockers": [],
                "next_action": "purchase_paid_today",
                "confidence": 8,
                "reasoning": "great deal",
                "role_archetype": "unknown_role",
            }),
        ),
    )
    # Insert a backstory row with an unknown role_archetype so _read_backstories
    # picks it up.  We simulate via the backstories table.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS backstories (id TEXT PRIMARY KEY, payload TEXT)"
    )
    conn.execute(
        "INSERT INTO backstories(id, payload) VALUES (?, ?)",
        (
            "bs_unknown_role",
            json.dumps({"name": "Unknown Role Persona", "role_archetype": "unknown_role"}),
        ),
    )
    conn.commit()


def test_unknown_role_archetype_coerced_to_ic_engineer(tmp_path: Path) -> None:
    """Backstory with role_archetype='unknown_role' must produce 'ic_engineer' in report."""
    # Unit-level sanity check on the coercion helper itself.
    assert _coerce_role("unknown_role") == "ic_engineer"
    assert _coerce_role(None) == "ic_engineer"
    assert _coerce_role("ic_engineer") == "ic_engineer"
    assert _coerce_role("cto") == "cto"

    db_path = tmp_path / "role_test.sqlite"
    conn = sqlite3.connect(db_path)
    _seed_with_unknown_role(conn, "study_role_001")

    def llm_caller(prompt: str, *, kind: str) -> str:
        return "stub label"

    run_study(study_id="study_role_001", conn=conn, llm_caller=llm_caller)

    cur = conn.execute(
        "SELECT report_json FROM reports WHERE study_id=?", ("study_role_001",)
    )
    rj = json.loads(cur.fetchone()[0])

    # Both paired_dots and personas must have role='ic_engineer', not 'unknown_role'.
    roles_in_dots = [d["role"] for d in rj.get("paired_dots", [])]
    roles_in_personas = [p["role"] for p in rj.get("personas", [])]

    assert all(r == "ic_engineer" for r in roles_in_dots), (
        f"paired_dots contained unexpected roles: {roles_in_dots}"
    )
    assert all(r == "ic_engineer" for r in roles_in_personas), (
        f"personas contained unexpected roles: {roles_in_personas}"
    )
