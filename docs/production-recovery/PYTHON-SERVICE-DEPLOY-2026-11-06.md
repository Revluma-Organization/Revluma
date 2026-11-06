# Python Service Deploy Failure — 2026-11-06 (Render `revluma-python-…`)

**Symptom (reported):** push-triggered Render deploy of the Python ML serving service. pip install completed at 14:41:49Z; build uploaded at 14:42:11Z. uvicorn never logged a single line; Render reported `Port scan timeout reached, no open ports detected` at 14:57:15Z and `Timed Out` at 15:00:13Z.

## Root cause

uvicorn binds the listening socket **only after ASGI lifespan startup completes** (`uvicorn/server.py` startup: `await self.lifespan.startup()` precedes `loop.create_server(...)`). The service's lifespan calls `_preload_models()`, which resolves model aliases against the remote MLflow tracking server synchronously and with no time budget. From 2026-11-04 (last verified healthy) to 2026-11-06, the tracking-server path from the instance became effectively unreachable/degraded (consistent with the silent stall and with retry loops in the logs). Every registry call can block for up to the upstream default (`MLFLOW_HTTP_REQUEST_TIMEOUT=120`), multiplied across 7 models × 2 candidates, so the lifespan never returns, the port never binds, and Render's port scan times out — matching the reported symptom exactly, including zero application output.

Import itself was verified clean (`IMPORT_OK app version: 0.6.0` in 2.8s against the pinned environment).

## Fix (this branch)

- `python/src/serving/api.py` — `_preload_models()` is now bounded: every model load runs through `_preload_with_timeout()` (threadpool + `future.result(timeout=ML_MODEL_PRELOAD_TIMEOUT_SECONDS)`, default **20s**, env-tunable). Findings on timeout/exception degrade to the documented `fallback` contract — never a crash, never a stalled lifespan. Registry version refresh is bounded the same way. Startup logs now emit `startup_begin`, per-model elapsed/status lines, and a `model preload finished in Xs` summary — a failure is never silent again.
- `python/src/config/mlflow_config.py` — `MLFLOW_HTTP_REQUEST_TIMEOUT` defaults to **10s** (was upstream default 120s); still env-overridable.
- `python/tests/test_model_preload.py` — pins the ceiling: slow/broken/raising loaders degrade to fallback within the budget.
- Deployment behavior verified locally: with `MLFLOW_TRACKING_URI=http://203.0.113.100:9/` (blackholed) the app binds `0.0.0.0:8123` and `/health` returns HTTP 200 `model_status=fallback_only` in ~18s including interpreter start.

## What this does NOT fix (explicitly)

Whether the deployed registry is reachable from Render at all — and whether models can load there. If the remote tracking server is down/unreachable, the service will now **serve with `fallback_only` models** (honest, visible at `/health`) instead of hanging and failing the deploy. Restoring registry reachability (or baking model artifacts into the image) is a separate, operational decision for the operator; it is not resolvable from code. The Node `/ready` `python_ready` signal will then report readiness with `fallback_only` model status — that is the honest state, not a green certificate.

## Prevention

Any future lifespan/startup work touching the network must stay under a documented budget enforced in code (threadpool timeout or env-bound http client) and must emit explicit pass/fail logs. A test pinning that ceiling is mandatory for the serving app.
