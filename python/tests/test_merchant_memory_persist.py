"""
Tests for the merchant memory and conversation-context persist contract.

merchant_memories had never held a row in production, and neither had
conversations.context_window — 0 of 122 conversations. persist_investigation_context
is the only writer of both, and nothing pinned its behaviour: whether Rev had
long-term memory at all was decided by a Python default that Node never sends,
an absent field in the request contract, and zero tests.

The defect these tests guard against is structural. Both writes shared one
transaction and one commit, so a failure in the memory INSERT also rolled back
the conversation context — the merchant lost contextual follow-ups and the
memory together, and the only trace was a warning that did not say which write
failed. They are now committed separately and each failure is reported at error
level with the stage named.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest

from src.agents.investigation import persist_investigation_context
from src.intelligence.evidence import STATUS_AVAILABLE, UNIT_CURRENCY

ORG = "1dc6aa19-9737-4770-a340-ff812a8b139a"
USER = "2dc6aa19-9737-4770-a340-ff812a8b139a"
CONVERSATION = "3dc6aa19-9737-4770-a340-ff812a8b139a"
MEMORY_KEY = "rev.last_verified_investigation"


class FakeDB:
    """Records executed statements; can be told to fail on a SQL substring."""

    def __init__(self, fail_on=None):
        self.executed = []
        self.commits = 0
        self.rollbacks = 0
        self.fail_on = fail_on

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.executed.append((sql, dict(params or {})))
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("injected failure")
        return None

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    @property
    def sql(self):
        return [sql for sql, _ in self.executed]

    def params_for(self, fragment):
        for sql, params in self.executed:
            if fragment in sql:
                return params
        raise AssertionError(f"no statement matching {fragment!r}")


def _item(identifier, status=STATUS_AVAILABLE, currency="USD", value="100.00"):
    return {
        "id": identifier,
        "status": status,
        "unit": UNIT_CURRENCY,
        "currency": currency,
        "value": value,
    }


def _result(items=None, unknowns=None):
    return {
        "investigation": {
            "id": "inv-0001",
            "intent": "revenue_investigation",
            "status": "complete",
            "period": {"label": "the last 7 days"},
            "segment": None,
        },
        "evidence": {
            "items": [_item("ev-0001")] if items is None else items,
        },
        "unknowns": unknowns if unknowns is not None else [],
    }


def _context(db):
    """The context_window the function wrote to conversations."""
    return json.loads(db.params_for("UPDATE conversations")["context"])


class TestBothWritesHappen:
    def test_verified_evidence_persists_context_and_memory(self):
        db = FakeDB()
        ok = persist_investigation_context(ORG, USER, CONVERSATION, db, _result())

        assert ok is True
        assert any("UPDATE conversations" in sql for sql in db.sql)
        assert any("INSERT INTO merchant_memories" in sql for sql in db.sql)
        assert db.commits == 2, "each write commits on its own"

    def test_the_memory_is_scoped_to_one_organization_and_one_key(self):
        db = FakeDB()
        persist_investigation_context(ORG, USER, CONVERSATION, db, _result())

        params = db.params_for("INSERT INTO merchant_memories")
        assert params["org_id"] == ORG
        assert params["user_id"] == USER
        assert params["conversation_id"] == CONVERSATION

        insert = next(sql for sql in db.sql if "INSERT INTO merchant_memories" in sql)
        assert f"'{MEMORY_KEY}'" in insert
        # Idempotent: a repeat investigation updates the same row.
        assert "ON CONFLICT (organization_id, memory_key)" in insert

    def test_the_context_update_is_tenant_scoped(self):
        db = FakeDB()
        persist_investigation_context(ORG, USER, CONVERSATION, db, _result())

        update = next(sql for sql in db.sql if "UPDATE conversations" in sql)
        assert "organization_id = :org_id::uuid" in update
        assert db.params_for("UPDATE conversations")["org_id"] == ORG

    def test_the_memory_expires_so_a_stale_context_is_not_trusted_forever(self):
        db = FakeDB()
        persist_investigation_context(ORG, USER, CONVERSATION, db, _result())

        insert = next(sql for sql in db.sql if "INSERT INTO merchant_memories" in sql)
        assert "expires_at" in insert
        assert "INTERVAL '30 days'" in insert
        # Inferred, not merchant-asserted: it must not outrank explicit memory.
        assert "'inferred'" in insert


class TestNoMemoryWithoutVerifiedEvidence:
    def test_unverified_evidence_keeps_context_but_writes_no_memory(self):
        db = FakeDB()
        result = _result(items=[_item("ev-0001", status="unavailable")])

        ok = persist_investigation_context(ORG, USER, CONVERSATION, db, result)

        assert ok is True
        assert any("UPDATE conversations" in sql for sql in db.sql)
        assert not any("INSERT INTO merchant_memories" in sql for sql in db.sql)
        assert db.commits == 1

    def test_no_evidence_at_all_writes_no_memory(self):
        db = FakeDB()
        ok = persist_investigation_context(ORG, USER, CONVERSATION, db, _result(items=[]))

        assert ok is True
        assert not any("INSERT INTO merchant_memories" in sql for sql in db.sql)

    def test_one_verified_item_among_degraded_ones_is_enough(self):
        db = FakeDB()
        result = _result(items=[
            _item("ev-0001", status="unavailable"),
            _item("ev-0002", status=STATUS_AVAILABLE),
        ])

        persist_investigation_context(ORG, USER, CONVERSATION, db, result)

        assert any("INSERT INTO merchant_memories" in sql for sql in db.sql)


class TestConversationIdIsRequired:
    def test_no_conversation_id_persists_nothing(self):
        db = FakeDB()
        assert persist_investigation_context(ORG, USER, None, db, _result()) is False
        assert db.executed == []
        assert db.commits == 0

    def test_empty_conversation_id_persists_nothing(self):
        db = FakeDB()
        assert persist_investigation_context(ORG, USER, "", db, _result()) is False
        assert db.executed == []


class TestFailuresAreContained:
    def test_a_memory_failure_does_not_lose_the_already_committed_context(self):
        """
        The regression this module exists for. Previously both writes shared one
        commit, so this failure rolled back the conversation context too and
        silently removed contextual follow-ups.
        """
        db = FakeDB(fail_on="INSERT INTO merchant_memories")

        ok = persist_investigation_context(ORG, USER, CONVERSATION, db, _result())

        assert ok is False
        assert db.commits == 1, "the context write must survive"
        assert db.rollbacks == 1
        assert any("UPDATE conversations" in sql for sql in db.sql)

    def test_a_context_failure_does_not_attempt_the_memory(self):
        db = FakeDB(fail_on="UPDATE conversations")

        ok = persist_investigation_context(ORG, USER, CONVERSATION, db, _result())

        assert ok is False
        assert db.commits == 0
        assert db.rollbacks == 1
        assert not any("INSERT INTO merchant_memories" in sql for sql in db.sql)

    def test_failures_are_logged_at_error_level_with_the_stage_named(self):
        """A warning that does not say which write failed is how this stayed invisible."""
        import logging

        db = FakeDB(fail_on="INSERT INTO merchant_memories")
        records = []

        class _Capture(logging.Handler):
            def emit(self, record):
                records.append(record)

        import src.agents.investigation as mod
        handler = _Capture()
        mod.logger.addHandler(handler)
        previous_level = mod.logger.level
        mod.logger.setLevel(logging.INFO)
        try:
            persist_investigation_context(ORG, USER, CONVERSATION, db, _result())
        finally:
            mod.logger.removeHandler(handler)
            mod.logger.setLevel(previous_level)

        memory_failures = [
            record for record in records
            if "rev_memory_persist_failed" in record.getMessage()
        ]
        assert memory_failures, "the memory failure must be logged"
        assert memory_failures[0].levelno == logging.ERROR
        assert "stage=merchant_memory" in memory_failures[0].getMessage()

    def test_a_skipped_memory_is_logged_so_silence_is_not_ambiguous(self):
        import logging
        import src.agents.investigation as mod

        records = []

        class _Capture(logging.Handler):
            def emit(self, record):
                records.append(record)

        handler = _Capture()
        mod.logger.addHandler(handler)
        previous_level = mod.logger.level
        mod.logger.setLevel(logging.INFO)
        try:
            db = FakeDB()
            persist_investigation_context(
                ORG, USER, CONVERSATION, db,
                _result(items=[_item("ev-0001", status="unavailable")]),
            )
        finally:
            mod.logger.removeHandler(handler)
            mod.logger.setLevel(previous_level)

        assert any(
            "rev_memory_skipped_no_verified_evidence" in record.getMessage()
            for record in records
        ), "a deliberate skip must be distinguishable from a failure"


class TestPersistedContextIsBounded:
    def test_evidence_ids_are_capped(self):
        db = FakeDB()
        items = [_item(f"ev-{index:04d}") for index in range(50)]

        persist_investigation_context(ORG, USER, CONVERSATION, db, _result(items=items))

        window = _context(db)
        assert len(window["last_investigation"]["evidence_ids"]) == 20

    def test_unresolved_items_are_capped(self):
        db = FakeDB()
        unknowns = [f"unknown-{index}" for index in range(30)]

        persist_investigation_context(
            ORG, USER, CONVERSATION, db, _result(unknowns=unknowns)
        )

        assert len(_context(db)["unresolved"]) == 5

    def test_summary_is_truncated(self):
        db = FakeDB()
        result = _result(
            items=[_item(f"ev-{index:04d}", currency=f"CUR{index}") for index in range(200)]
        )

        persist_investigation_context(ORG, USER, CONVERSATION, db, result)

        assert len(db.params_for("UPDATE conversations")["summary"]) <= 500

    def test_money_is_never_merged_across_currencies(self):
        db = FakeDB()
        result = _result(items=[
            _item("ev-0001", currency="USD", value="100.00"),
            _item("ev-0002", currency="NGN", value="5000.00"),
        ])

        persist_investigation_context(ORG, USER, CONVERSATION, db, result)

        window = _context(db)
        assert window["last_investigation"]["currencies"] == ["NGN", "USD"]

    def test_the_memory_holds_context_not_the_merchants_message(self):
        db = FakeDB()
        result = _result()
        result["investigation"]["segment"] = "a secret segment note"

        persist_investigation_context(ORG, USER, CONVERSATION, db, result)

        value = json.loads(db.params_for("INSERT INTO merchant_memories")["value"])
        assert value["intent"] == "revenue_investigation"
        assert value["status"] == "complete"
        assert set(value) <= {
            "id", "intent", "status", "period", "evidence_ids", "currencies", "segment",
        }
