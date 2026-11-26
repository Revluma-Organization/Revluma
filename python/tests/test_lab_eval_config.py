"""Stage 1 (H2): scripted runs are explicitly configured, tagged, and kept off prod."""

import os
import re
import unittest

from src.lab.eval_config import EvalConfig, EvalConfigError, load_eval_config

ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PROD = "1dc6aa19-9737-4770-a340-ff812a8b139a"  # Splendor's Store (test-store org)


class EvalConfigTest(unittest.TestCase):
    def setUp(self):
        self._saved = dict(os.environ)
        for key in list(os.environ):
            if key.startswith("REVLUMA_EVAL"):
                del os.environ[key]

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)

    def _valid_env(self, **overrides):
        env = {
            "REVLUMA_EVAL_API_BASE": "https://revluma-staging.example/api/v1",
            "REVLUMA_EVAL_ORG_ID": ORG,
            "REVLUMA_EVAL_RUN_ID": "burst-replay-01",
            "REVLUMA_EVAL_HARNESS": "lab",
        }
        env.update(overrides)
        os.environ.update(env)

    def test_valid_config_builds_headers_and_client_context(self):
        self._valid_env()
        config = load_eval_config()
        self.assertEqual(config.organization_id, ORG)
        self.assertEqual(config.run_id, "burst-replay-01")
        headers = config.headers()
        self.assertEqual(headers["User-Agent"], "revluma-eval/lab/burst-replay-01")
        self.assertEqual(headers["X-Eval-Run"], "burst-replay-01")
        self.assertEqual(
            config.client_context(),
            {"source": "eval", "run_id": "burst-replay-01", "harness": "lab"},
        )

    def test_defaults_run_id_and_harness(self):
        self._valid_env()
        del os.environ["REVLUMA_EVAL_RUN_ID"]
        del os.environ["REVLUMA_EVAL_HARNESS"]
        config = load_eval_config()
        self.assertTrue(re.fullmatch(r"run-[0-9a-f]{8}", config.run_id))
        self.assertEqual(config.harness, "lab")

    def test_missing_base_or_org_refuses_to_configure(self):
        self._valid_env()
        del os.environ["REVLUMA_EVAL_API_BASE"]
        with self.assertRaises(EvalConfigError):
            load_eval_config()
        self._valid_env()
        del os.environ["REVLUMA_EVAL_ORG_ID"]
        with self.assertRaises(EvalConfigError):
            load_eval_config()

    def test_non_url_base_and_non_uuid_org_rejected(self):
        self._valid_env(REVLUMA_EVAL_API_BASE="not-a-url")
        with self.assertRaises(EvalConfigError):
            load_eval_config()
        self._valid_env(REVLUMA_EVAL_ORG_ID="prod")
        with self.assertRaises(EvalConfigError):
            load_eval_config()

    def test_bad_run_id_harness_source_rejected(self):
        self._valid_env(REVLUMA_EVAL_RUN_ID="has space")
        with self.assertRaises(EvalConfigError):
            load_eval_config()
        self._valid_env(REVLUMA_EVAL_HARNESS="a/b")
        with self.assertRaises(EvalConfigError):
            load_eval_config()
        self._valid_env(REVLUMA_EVAL_SOURCE="merchant")
        with self.assertRaises(EvalConfigError):
            load_eval_config()

    def test_blocklisted_production_org_is_refused(self):
        self._valid_env(
            REVLUMA_EVAL_ORG_ID=PROD,
            REVLUMA_EVAL_PROD_ORG_IDS=f"{PROD}, {ORG}",
        )
        with self.assertRaisesRegex(EvalConfigError, "blocklisted production org"):
            load_eval_config()

    def test_assert_not_production_matches_case_insensitively(self):
        self._valid_env()
        config = load_eval_config()
        config.assert_not_production([PROD])  # different org: allowed
        with self.assertRaises(EvalConfigError):
            config.assert_not_production([ORG.upper()])

    def test_client_context_matches_gateway_allowlist(self):
        # The Node gateway accepts source eval|load and 1-64 char tokens.
        self._valid_env(REVLUMA_EVAL_SOURCE="load")
        context = load_eval_config().client_context()
        self.assertIn(context["source"], {"eval", "load"})
        for field in ("run_id", "harness"):
            self.assertTrue(re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", context[field]))

    def test_sandbox_org_config_is_explicit_not_defaulted(self):
        # There is no implicit target: without REVLUMA_EVAL_ORG_ID nothing runs.
        os.environ["REVLUMA_EVAL_API_BASE"] = "https://x.example"
        with self.assertRaises(EvalConfigError):
            load_eval_config()


if __name__ == "__main__":
    unittest.main()
