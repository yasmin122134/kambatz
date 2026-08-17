#!/usr/bin/env python3
"""Apply SQL migration files when SUPABASE_DB_URL is set."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migration_email_auth.sql"


def main() -> int:
    db_url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        print("Set SUPABASE_DB_URL (postgres connection string) to run migrations.")
        return 1

    try:
        import psycopg2
    except ImportError:
        print("pip install psycopg2-binary")
        return 1

    sql = MIGRATION.read_text(encoding="utf-8")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.close()
    print("Applied", MIGRATION.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
