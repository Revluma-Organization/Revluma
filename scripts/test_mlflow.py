"""
MLflow Setup Verification Script
==================================
Usage:
    cd /path/to/revluma/backend/python
    python scripts/test_mlflow.py
"""

import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.config.mlflow_config import (
    get_or_create_experiment,
    get_tracking_info,
    MLFLOW_TRACKING_URI,
    EXPERIMENT_NAME
)
import mlflow

print("=" * 50)
print("  Revluma MLflow Configuration Check")
print("=" * 50)

info = get_tracking_info()
print(f"  Tracking URI  : {info['tracking_uri']}")
print(f"  Mode          : {'REMOTE SERVER' if info['is_remote'] else 'LOCAL SQLITE'}")
print(f"  Experiment    : {info['experiment_name']}")
print(f"  Auth enabled  : {info['auth_enabled']}")
print("=" * 50)
print()

experiment_id = get_or_create_experiment()

print("\nLogging test run...")

with mlflow.start_run() as run:
    mlflow.log_param("test_param", "week1")
    mlflow.log_metric("test_metric", 1.0)

    artifact_path = "test_artifact.txt"
    with open(artifact_path, "w") as f:
        f.write("Revluma MLflow test artifact — setup confirmed.\n")
        f.write(f"Tracking URI: {MLFLOW_TRACKING_URI}\n")
    mlflow.log_artifact(artifact_path)
    os.remove(artifact_path)

    run_id = run.info.run_id

print()
print("=" * 50)
print("  MLflow test passed ✅")
print(f"  Run ID : {run_id}")
print()
print("  To view your experiments in the browser:")
print(f"  mlflow ui --backend-store-uri {MLFLOW_TRACKING_URI}")
print("  Then open: http://localhost:5000")
print("=" * 50)
