"""S4 - POST /internal/rfm-sync.

The endpoint is a thin wrapper over `src.jobs.rfm_sync.run`, so these tests
mock the job out entirely. What is being tested is the contract the Node
backend depends on: the auth gate, the request shape, the response shape, and
that whatever the job returns is passed through unaltered.

Importing `src.serving.api` pulls in `src.config.database`, which builds a
SQLAlchemy engine at import time (the known P0-3 defect). A placeholder
DATABASE_URL is therefore set before the import so this module is collectable
without a live database. `create_engine` does not connect, so nothing here
touches Postgres. Remove the placeholder once the engine is constructed lazily.
"""

import os
import typing
import unittest
from unittest.mock import patch

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg2://placeholder:placeholder@localhost:5432/placeholder")

from fastapi.testclient import TestClient          # noqa: E402

from src.serving import api                        # noqa: E402

VALID_KEY = "test-internal-key"
STORE_ID = "3f9a1c22-77bd-4f0e-9d1b-2c4a6e8f0b31"

EMPTY_RESULT = {
    "processed_count": 0,
    "failed_customer_ids": [],
    "segment_distribution": {
        "champion": 0, "loyal": 0, "at_risk": 0, "hibernating": 0, "lost": 0,
    },
}

BUSY_RESULT = {
    "processed_count": 1284,
    "failed_customer_ids": ["c-17", "c-402"],
    "segment_distribution": {
        "champion": 210, "loyal": 435, "at_risk": 301, "hibernating": 250,
        "lost": 88,
    },
}


class RfmSyncEndpointTestCase(unittest.TestCase):
    """Shared client with the shared secret configured."""

    def setUp(self) -> None:
        self.client = TestClient(api.app)
        self._key_patch = patch.object(api, "ML_INTERNAL_KEY", VALID_KEY)
        self._key_patch.start()
        self.addCleanup(self._key_patch.stop)

    def _post(self, body: dict, key: typing.Optional[str] = VALID_KEY):
        headers = {"x-internal-key": key} if key is not None else {}
        return self.client.post("/internal/rfm-sync", json=body, headers=headers)


class TestAuthentication(RfmSyncEndpointTestCase):

    def test_a_valid_key_is_accepted(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT):
            self.assertEqual(self._post({"store_id": STORE_ID}).status_code, 200)

    def test_a_missing_key_is_rejected(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            response = self._post({"store_id": STORE_ID}, key=None)
        self.assertEqual(response.status_code, 401)
        job.assert_not_called()   # the job must not run for an unauthenticated caller

    def test_a_wrong_key_is_rejected(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            response = self._post({"store_id": STORE_ID}, key="not-the-key")
        self.assertEqual(response.status_code, 401)
        job.assert_not_called()

    def test_an_unconfigured_server_fails_closed(self):
        # A blank ML_INTERNAL_KEY must deny, not wave everyone through.
        with patch.object(api, "ML_INTERNAL_KEY", ""), \
                patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            response = self._post({"store_id": STORE_ID})
        self.assertEqual(response.status_code, 500)
        job.assert_not_called()


class TestRequestValidation(RfmSyncEndpointTestCase):

    def test_normal_store_id_reaches_the_job(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            self._post({"store_id": STORE_ID})
        job.assert_called_once_with(STORE_ID)

    def test_a_missing_store_id_is_rejected(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            self.assertEqual(self._post({}).status_code, 422)
        job.assert_not_called()

    def test_an_empty_store_id_is_rejected(self):
        # An empty string would make the job scan nothing and report success.
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            self.assertEqual(self._post({"store_id": ""}).status_code, 422)
        job.assert_not_called()

    def test_a_null_store_id_is_rejected(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job:
            self.assertEqual(self._post({"store_id": None}).status_code, 422)
        job.assert_not_called()

    def test_unexpected_extra_fields_do_not_break_the_call(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT):
            response = self._post({"store_id": STORE_ID, "triggered_by": "node"})
        self.assertEqual(response.status_code, 200)


class TestResponseContract(RfmSyncEndpointTestCase):

    def test_a_busy_store_is_reported_in_full(self):
        with patch.object(api, "_run_rfm_sync", return_value=BUSY_RESULT):
            body = self._post({"store_id": STORE_ID}).json()
        self.assertEqual(body["processed_count"], 1284)
        self.assertEqual(body["failed_customer_ids"], ["c-17", "c-402"])
        self.assertEqual(body["segment_distribution"]["champion"], 210)

    def test_a_store_with_nothing_to_do_returns_zeroes_not_an_error(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT):
            response = self._post({"store_id": STORE_ID})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["processed_count"], 0)

    def test_every_segment_in_the_job_contract_survives_serialisation(self):
        # These five keys are what the dashboard reads. A silent rename here
        # would leave it rendering zeroes.
        with patch.object(api, "_run_rfm_sync", return_value=BUSY_RESULT):
            distribution = self._post({"store_id": STORE_ID}).json()["segment_distribution"]
        for segment in ("champion", "loyal", "at_risk", "hibernating", "lost"):
            self.assertIn(segment, distribution)

    def test_partial_failures_are_reported_rather_than_swallowed(self):
        result = {**EMPTY_RESULT, "failed_customer_ids": ["c-1", "c-2", "c-3"]}
        with patch.object(api, "_run_rfm_sync", return_value=result):
            body = self._post({"store_id": STORE_ID}).json()
        self.assertEqual(len(body["failed_customer_ids"]), 3)


class TestJobIsNotRunOnTheEventLoop(RfmSyncEndpointTestCase):
    """`rfm_sync.run` opens a real connection and loops over every customer in
    the store. Run inline on the event loop it would stall every other request
    in flight, so it must go through the thread-pool helper."""

    def test_the_job_is_offloaded_to_the_thread_pool(self):
        with patch.object(api, "_run_rfm_sync", return_value=EMPTY_RESULT) as job, \
                patch.object(api, "_run_inference",
                             wraps=api._run_inference) as offload:
            self._post({"store_id": STORE_ID})
            offloaded_fn = offload.call_args[0][0]
        offload.assert_called_once()
        # The job itself is what got handed to the executor, not a wrapper
        # that would still block the loop.
        self.assertIs(offloaded_fn, job)


if __name__ == "__main__":
    unittest.main()
