"""Verify database connectivity without exposing schema or row data."""

import sys
from pathlib import Path

from sqlalchemy import text

python_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(python_root))

from src.config.database import engine


def main() -> int:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            table_count = connection.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )
            ).scalar()
        print(f"Database connection established; public table count: {table_count}.")
        return 0
    except Exception as exc:
        print(f"Database connection failed ({type(exc).__name__}).")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
