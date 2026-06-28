"""
Revluma MLflow Configuration
Remote tracking server: https://dagshub.com/yourusername/revluma-ml.mlflow
Set credentials in .env — never hardcode them here.
"""

import os
import mlflow

# Load .env from backend/ root (one level above python/)
try:
    from dotenv import load_dotenv
    _env_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../.env")
    )
    load_dotenv(_env_path)
except ImportError:
    pass

# Allow mlruns file store as fallback (MLflow 3.x requirement)
os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")

# Priority: MLFLOW_TRACKING_URI → MLFLOW_REMOTE_URL → local mlruns
_LOCAL_MLRUNS = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../mlruns")
)

MLFLOW_TRACKING_URI = (
    os.getenv("MLFLOW_TRACKING_URI")
    or os.getenv("MLFLOW_REMOTE_URL")
    or _LOCAL_MLRUNS
)

# Auth for DagsHub remote server
_USERNAME = os.getenv("MLFLOW_USERNAME")
_PASSWORD = os.getenv("MLFLOW_PASSWORD")

if _USERNAME and _PASSWORD:
    os.environ["MLFLOW_TRACKING_USERNAME"] = _USERNAME
    os.environ["MLFLOW_TRACKING_PASSWORD"] = _PASSWORD

EXPERIMENT_NAME = "Revluma-MVP"
IS_REMOTE = MLFLOW_TRACKING_URI.startswith("http")

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)


def get_tracking_info() -> dict:
    return {
        "tracking_uri"   : MLFLOW_TRACKING_URI,
        "is_remote"      : IS_REMOTE,
        "experiment_name": EXPERIMENT_NAME,
        "auth_enabled"   : bool(_USERNAME and _PASSWORD)
    }


def get_or_create_experiment() -> str:
    if IS_REMOTE:
        print(f"MLflow → Remote server : {MLFLOW_TRACKING_URI}")
    else:
        print(f"MLflow → Local mlruns  : {MLFLOW_TRACKING_URI}")

    experiment = mlflow.get_experiment_by_name(EXPERIMENT_NAME)

    if experiment is None:
        experiment_id = mlflow.create_experiment(EXPERIMENT_NAME)
        print(f"Created experiment '{EXPERIMENT_NAME}' (ID: {experiment_id})")
    else:
        experiment_id = experiment.experiment_id
        print(f"Using experiment '{EXPERIMENT_NAME}' (ID: {experiment_id})")

    mlflow.set_experiment(EXPERIMENT_NAME)
    return experiment_id
