# Revluma ML Backend — Week 1 Infrastructure
**Author:** Irenikase samuel temitope (AI/ML Engineer 2)  
**Date:** June 2026  
**Status:** Complete — skeleton only

---

## 1. Project Structure

```
backend/
├── .env                          ← credentials (never committed to git)
└── python/
    ├── .gitignore
    ├── mlruns/                   ← local MLflow fallback (ignored by git)
    ├── scripts/
    │   ├── test_mlflow.py        ← verifies MLflow connection
    │   └── setup_mlflow_server.sh
    └── src/
        ├── config/
        │   └── mlflow_config.py  ← MLflow setup, local + remote
        ├── features/
        │   ├── pipeline.py       ← 16-feature engineering pipeline skeleton
        │   └── event_processor.py← raw pixel event processor skeleton
        ├── models/
        │   ├── abandonment/      ← M1: Logistic Regression
        │   ├── sensitivity/      ← M2: Gradient Boosting (PSS/CSS)
        │   ├── churn/            ← M4: Gradient Boosting
        │   ├── timing/           ← M3: Gradient Boosting
        │   └── offer_value/      ← M5: Gradient Boosting
        │       (each has train.py, predict.py, README.md)
        └── serving/
            └── api.py            ← FastAPI prediction endpoints
```

---

## 2. MLflow Experiment Tracking

### What MLflow does
MLflow is the experiment tracking system for all model training. Every time a model is trained in Week 4+, MLflow automatically records the parameters used, the metrics achieved, and saves the trained model as an artifact. This lets the team compare runs and roll back to better models.

### Configuration
File: `python/src/config/mlflow_config.py`

The config uses a priority system for where to send experiment data:
```
1st — MLFLOW_TRACKING_URI  (system env var — CI/CD, production)
2nd — local mlruns/        (fallback when no remote configured)
```

Credentials are loaded from `python/.env` (3 levels up from the config file via `../../../.env`).

### Remote Tracking Server
- **Provider:** DagsHub (free hosted MLflow)
- **URL:** `https://dagshub.com/srdataml/revluma_ml.mlflow`
- **Experiment name:** `Revluma-MVP`
- **Auth:** Token-based via `MLFLOW_TRACKING_USERNAME` + `MLFLOW_TRACKING_PASSWORD`

### Environment Variables (in python/.env)
```
MLFLOW_TRACKING_URI=https://dagshub.com/srdataml/revluma_ml.mlflow
MLFLOW_TRACKING_USERNAME=srdataml
MLFLOW_TRACKING_PASSWORD=<dagshub_token>
MLFLOW_ALLOW_FILE_STORE=true
```
### How to verify the connection
```bash
cd python
python scripts/test_mlflow.py
```

Expected output:
```
MLflow → Remote server : https://dagshub.com/srdataml/revluma_ml.mlflow
MLflow test passed ✅
```

---

Actions Taken
Folder Structure
Created python/src/config/, src/features/, src/serving/, src/models/abandonment/, src/models/sensitivity/, src/models/churn/, src/models/timing/, src/models/offer_value/, and scripts/.
Feature Engineering Pipeline
src/features/pipeline.py created. 19 functions declared, logic yet to be implemented:

calculate_scroll_depth — yet to declare logic
calculate_tab_switch_count — yet to declare logic
calculate_time_on_checkout_step — yet to declare logic
calculate_cursor_hesitation — yet to declare logic
calculate_checkout_step_reached — yet to declare logic
calculate_past_orders_total — yet to declare logic
calculate_coupon_usage_pct — yet to declare logic
calculate_days_since_last_purchase — yet to declare logic
calculate_avg_order_value — yet to declare logic
calculate_purchase_frequency_trend — yet to declare logic
calculate_visited_coupon_page — yet to declare logic
calculate_searched_discount_terms — yet to declare logic
calculate_abandoned_at_shipping_reveal — yet to declare logic
calculate_failed_payment_attempt — yet to declare logic
calculate_local_hour_of_session — yet to declare logic
calculate_day_of_week_session — yet to declare logic
calculate_pss_score — yet to declare logic
calculate_css_score — yet to declare logic
calculate_rfm_scores — yet to declare logic
compute_feature_vector — yet to declare logic

Event Processor
src/features/event_processor.py created. 6 functions declared, logic yet to be implemented:

parse_raw_event — yet to declare logic
filter_events_by_type — yet to declare logic
extract_session_timeline — yet to declare logic
detect_platform — yet to declare logic
normalize_checkout_step — yet to declare logic
group_events_by_session — yet to declare logic

Model Files
All 5 model directories created. Per directory:

train.py created — load_training_data, build_model, train functions declared, logic yet to declare
predict.py created — load_model, predict functions declared, logic yet to declare
README.md created

FastAPI Serving Layer
src/serving/api.py created:

GET /health — created, logic declared
POST /predict/abandonment-probability — created, logic yet to declare
POST /predict/shopper-sensitivity — created, logic yet to declare
POST /predict/churn-risk — created, logic yet to declare
POST /predict/send-time — created, logic yet to declare

MLflow Configuration
src/config/mlflow_config.py created:

get_tracking_info — created, logic declared
get_or_create_experiment — created, logic declared
Remote server connected to DagsHub: https://dagshub.com/srdataml/revluma_ml.mlflow
Experiment Revluma-MVP created and confirmed logging remotely

MLflow Test Script
scripts/test_mlflow.py created — confirms remote connection, logic declared and working
Environment Setup

python/.env created — credentials configured, never committed to git
python/.gitignore created — protects .env, mlruns/, __pycache__/, venv/

