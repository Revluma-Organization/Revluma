"""Verify MLflow configuration by logging one disposable test artifact."""

import os
import sys
import tempfile

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import mlflow

from src.config.mlflow_config import get_or_create_experiment, get_tracking_info


def main() -> int:
    info = get_tracking_info()
    print(f"Tracking mode: {'remote' if info['is_remote'] else 'local'}")
    print(f"Experiment: {info['experiment_name']}")
    print(f"Authentication configured: {info['auth_enabled']}")

    get_or_create_experiment()
    with mlflow.start_run(run_name="configuration-check") as run:
        mlflow.set_tag("purpose", "configuration_check")
        mlflow.log_metric("configuration_ok", 1.0)
        with tempfile.TemporaryDirectory(prefix="revluma-mlflow-check-") as directory:
            artifact_path = os.path.join(directory, "configuration-check.txt")
            with open(artifact_path, "w", encoding="utf-8") as artifact:
                artifact.write("MLflow configuration check completed.\n")
            mlflow.log_artifact(artifact_path, "diagnostics")

    print(f"MLflow check completed; run ID: {run.info.run_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
