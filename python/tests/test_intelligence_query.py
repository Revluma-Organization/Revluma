from src.intelligence.query import safe_query


class FakeSavepoint:
    def __init__(self):
        self.exit_args = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.exit_args = (exc_type, exc, traceback)
        return False


class FakeDB:
    def __init__(self, result=None, error=None):
        self.savepoint = FakeSavepoint()
        self.result = result if result is not None else [{"id": 1}]
        self.error = error
        self.rollback_calls = 0

    def begin_nested(self):
        return self.savepoint

    def execute(self, statement, params):
        if self.error:
            raise self.error
        return self.result

    def rollback(self):
        self.rollback_calls += 1


def test_safe_query_releases_successful_savepoint():
    db = FakeDB(result=[{"id": 1}])

    rows, error = safe_query(db, "SELECT 1")

    assert rows == [{"id": 1}]
    assert error is None
    assert db.savepoint.exit_args == (None, None, None)


def test_safe_query_rolls_back_failed_savepoint():
    failure = RuntimeError("query failed")
    db = FakeDB(error=failure)

    rows, error = safe_query(db, "SELECT broken")

    assert rows == []
    assert error == "query_failed"
    assert db.savepoint.exit_args[0] is RuntimeError
    assert db.savepoint.exit_args[1] is failure
