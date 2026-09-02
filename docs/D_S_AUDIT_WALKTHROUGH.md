# Phase 2/3 and D/S Audit Walkthrough

Date: September 2, 2026

## Result

The Python implementation is internally consistent and its complete offline
test suite passes. Backend/database work remains a separate team handoff. All
new model runs use synthetic data, are tagged non-production, and cannot update
the deployable model registry.

Synthetic results prove that code paths, constraints, and metrics execute; they
do not prove real-world performance, production readiness, or demographic
fairness. Production promotion still requires sufficient representative real
data, assigned quality gates, subgroup review, drift monitoring, and a canary.

## Contract decisions

| Issue | Final contract |
|---|---|
| Event time | `timestamp` is canonical. Ingestion accepts database alias `created_at` and normalizes it. |
| User identity | Orchestration accepts `user_id` or compatibility input `customer_id`, then resolves one canonical `user_id`. Missing identity fails. |
| Cursor hesitation | `cursor_hesitation` is the canonical 0-10 score from longest focus/blur duration in seconds, capped at 10. `cursor_hesitation_count` is an M1 input alias only. |
| Exit intent | `EXIT_INTENT` supports `abandoned_at_shipping_reveal`; it is not converted into cursor hesitation. |
| M4 feature count | The assignment says 24 but names 21. The 21 named features are authoritative; no undocumented inputs were invented. |
| Business baseline | Business State uses a rolling 30-day baseline, with 90-day revenue context where specified. |
| M4 history | Real M4 training requires at least 90 days of customer history. |
| M5 discount | The hard maximum remains 25%; trust and low-sensitivity gates force zero discount. |

The shared pixel contract is in `docs/PIXEL_EVENT_SPEC.md`.

## D tasks

| Task | Status | Exact implementation |
|---|---|---|
| D1 Pixel contract | Python complete; backend adoption pending | `docs/PIXEL_EVENT_SPEC.md` |
| D2 Session features | Complete | `python/src/features/pipeline.py`; `python/tests/test_pipeline.py` |
| D3 M1 abandonment | Complete on synthetic data; real promotion pending | `python/src/models/abandonment/train.py`; `predict.py`; `python/tests/test_abandonment_model.py` |
| D4 M3 send time | Complete on synthetic data; sequence persistence pending | `python/src/models/timing/train.py`; `predict.py`; `README.md`; `python/tests/test_timing_model.py` |
| D5 Orchestrator | Complete | `python/src/agents/orchestrator.py`; `python/tests/test_orchestrator.py` |
| D6 Business State | Complete locally; production-scale benchmark pending | `python/src/intelligence/business_state.py`; related Business State tests |
| D7 Morning briefing | Python complete; 05:00 UTC backend schedule pending | `python/src/intelligence/morning_briefing.py`; `python/src/serving/api.py` |

## S tasks

| Task | Status | Exact implementation |
|---|---|---|
| S1 Customer history | Complete | `python/src/features/pipeline.py`; parameterized history/RFM queries and safe defaults |
| S2 Event processor | Complete | `python/src/features/event_processor.py`; `python/tests/test_event_processor.py` |
| S3 M4 churn | Complete on synthetic data; real promotion pending | `python/src/models/churn/train.py`; `predict.py`; `README.md`; `python/tests/test_churn_model.py` |
| S4 RFM sync | Python complete; backend post-sync trigger pending | `python/src/jobs/rfm_sync.py`; `python/tests/test_rfm_sync_endpoint.py` |
| S5 Retention/customer agents | Complete | `python/src/agents/retention_agent.py`; `customer_agent.py`; related tests |

## Phase 2 and Phase 3

| Workstream | Status | Location or dependency |
|---|---|---|
| Dynamic Business State | Python complete | Adaptive 15/5/1-minute cadence and 30-day baselines in `python/src/intelligence/business_state.py`; backend scheduler/persistence pending. |
| Historical ingestion | Python complete | `python/src/jobs/historical_ingestion.py`; backend initial-sync trigger and `order_items` persistence pending. |
| LLM judge | Runner complete; live score blocked | `python/tests/benchmarks/test_benchmark_llm_judge.py`; configured Anthropic account previously reported insufficient credit. No substitute scores were fabricated. |
| Fast feedback | Python complete; production worker pending | `python/src/learning/feedback_loop.py`; backend outcome queue, pause integration, and scheduled worker pending. |

## Model improvements and DagsHub evidence

All six runs were retrieved back from DagsHub with status `FINISHED`,
`data_source=synthetic`, `production_eligible=false`, and passed code-defined
quality gates.

| Model | Run ID | Verified holdout metrics |
|---|---|---|
| M1 Abandonment | `c49e6617f3b8424e9eb6952a18ce490e` | AUC 0.8465; precision 0.8883; recall 0.7581; F1 0.8180 |
| M2 Price sensitivity | `61932c03e85740f1b43516095390a00a` | AUC 0.8158; F1 0.7172; accuracy 0.7450 |
| M2 Convenience sensitivity | `54a727556168463ebe92aa70f04758f9` | AUC 0.7768; F1 0.7032; accuracy 0.6933 |
| M3 Send time | `04443569256943eb83efe9e5edacdb72` | CTR uplift 0.1604; calibration error 0.0172; selected CTR 0.4904 vs baseline 0.3300 |
| M4 Churn risk | `2899339dd38448558142af38c31928d6` | AUC 0.9230; macro-F1 0.8543; HIGH_RISK precision 0.9600 |
| M5 Offer value | `c169d4369d204e70a19e91836e65953d` | RMSE 2.0556; MAE 1.4107; R² 0.9172 |

Changes made:

- M1 now generates correlated checkout behavior with irreducible noise and
  isolated randomness while retaining the contract-required logistic model.
- M2 now uses probabilistic PSS/CSS outcomes, regularized shallow boosting,
  and AUC/F1 registration gates.
- M3 removed calibration-distorting class weights and uses regularized boosting
  with five-fold sigmoid calibration. Its assigned uplift and calibration gates
  now pass.
- M4 now produces internally consistent RFM, engagement, and sentiment signals
  while retaining the canonical 21-feature order and 90-day rule.
- M5 now produces correlated sensitivity/discount behavior and requires MAE/R²
  gates in addition to real-data volume.
- `python/tests/test_synthetic_model_quality.py` verifies reproducibility,
  ranges, directional relationships, class coverage, and hard constraints.

The parameter choices follow scikit-learn guidance on small learning rates,
enough boosting stages, stochastic subsampling, held-out evaluation, and
sigmoid calibration for smaller calibration cohorts. Final production tuning
must use representative real training data with a held-out chronological test
set; synthetic holdout results must not be used to choose a production winner.

## Other completed audit corrections

- Training-data loaders use real data exclusively when a database connection is
  supplied; they never silently fall back to synthetic data.
- Synthetic and undersized real runs cannot register deployable models.
- MLflow tracking URIs are credential-free; authentication uses environment
  variables and secrets are not logged.
- Internal API routes enforce internal authentication, request limits, and
  safe image validation.
- Orchestrator persistence, context limits, trigger modes, action allowlists,
  and tenant ownership checks are covered by tests.
- Feedback writes are atomic and idempotent; zero-send windows fail safely.
- RFM updates are transaction-safe and return sanitized summaries.

## Validation

- Complete offline Python suite: **452 passed**.
- New synthetic-quality suite: **5 passed**.
- Registration-guard suite: **4 passed**.
- DagsHub verification: six runs retrieved as `FINISHED`; no synthetic run was
  production eligible.
- Live LLM judge: not completed because the external Anthropic account lacked
  credit during the verified attempt.

## Remaining work

1. The Backend team follows `docs/BACKEND_D_S_IMPLEMENTATION_HANDOFF.md`.
2. The team provisions representative real labels and validates subgroup error,
   calibration, drift, and operational impact before model promotion.
3. The team runs the 100,000-order Business State benchmark on
   production-shaped infrastructure and records the under-90-second evidence.
4. The team funds/enables the Anthropic judge account and reruns the 20-scenario
   live benchmark.
5. The team reviews the broader evaluation datasets before treating them as
   approved ground truth.
