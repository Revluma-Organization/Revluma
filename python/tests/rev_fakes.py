"""Deterministic in-memory database double for Rev Intelligence tests.

The double records every statement and its parameters so tests can assert
organization scoping without a live PostgreSQL instance.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class FakeMappings:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return list(self._rows)

    def __iter__(self):
        return iter(self._rows)

    def __len__(self):
        return len(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        row = self.fetchone()
        if row is None:
            return None
        if isinstance(row, dict):
            return next(iter(row.values()), None)
        return row[0] if isinstance(row, (tuple, list)) else row


class FakeSavepoint:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@dataclass
class FakeDB:
    routes: list = field(default_factory=list)
    statements: list = field(default_factory=list)
    fail_patterns: tuple = ()
    commits: int = 0
    rollbacks: int = 0
    closed: bool = False
    # Models SQLAlchemy's autobegin: executing a statement opens a transaction
    # that stays open until commit/rollback/close. Tests assert on this to
    # prove reads do not hold a connection idle-in-transaction.
    transaction_open: bool = False

    def add(self, pattern: str, rows):
        self.routes.append((pattern, rows))
        return self

    def in_transaction(self) -> bool:
        return self.transaction_open

    def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append((sql, dict(params or {})))
        for pattern in self.fail_patterns:
            if pattern in sql:
                raise RuntimeError(f"simulated failure for {pattern}")
        self.transaction_open = True
        for pattern, rows in self.routes:
            if pattern in sql:
                value = rows(params or {}) if callable(rows) else rows
                return FakeMappings(value)
        return FakeMappings([])

    def begin_nested(self):
        self.transaction_open = True
        return FakeSavepoint()

    def commit(self):
        self.commits += 1
        self.transaction_open = False

    def rollback(self):
        self.rollbacks += 1
        self.transaction_open = False

    def close(self):
        self.closed = True
        self.transaction_open = False

    def scoped_organizations(self):
        orgs = set()
        for sql, params in self.statements:
            if "organization_id" in sql or ":org_id" in sql:
                if "org_id" in params:
                    orgs.add(str(params["org_id"]))
        return orgs
