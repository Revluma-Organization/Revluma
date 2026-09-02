"""
Revluma MLflow Configuration
Remote tracking is configured through environment variables.
Never hardcode or log tracking credentials.
"""

import os
import logging
from urllib.parse import unquote, urlsplit, urlunsplit
import mlflow

logger = logging.getLogger("rev.config.mlflow")

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

_RAW_TRACKING_URI = (
    os.getenv("MLFLOW_TRACKING_URI")
    or os.getenv("MLFLOW_REMOTE_URL")
    or _LOCAL_MLRUNS
)


def _sanitize_tracking_uri(uri: str) -> tuple[str, str | None, str | None]:
    """Remove URI userinfo so third-party errors cannot disclose credentials."""
    parsed = urlsplit(uri)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return uri, None, None

    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if parsed.port:
        host = f"{host}:{parsed.port}"

    clean_uri = urlunsplit((parsed.scheme, host, parsed.path, "", ""))
    username = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else None
    return clean_uri, username, password


MLFLOW_TRACKING_URI, _URI_USERNAME, _URI_PASSWORD = _sanitize_tracking_uri(
    _RAW_TRACKING_URI
)

# Auth for DagsHub remote server
_USERNAME = (
    os.getenv("MLFLOW_TRACKING_USERNAME")
    or os.getenv("MLFLOW_USERNAME")
    or _URI_USERNAME
)
_PASSWORD = (
    os.getenv("MLFLOW_TRACKING_PASSWORD")
    or os.getenv("MLFLOW_PASSWORD")
    or _URI_PASSWORD
)

if _USERNAME and _PASSWORD:
    os.environ["MLFLOW_TRACKING_USERNAME"] = _USERNAME
    os.environ["MLFLOW_TRACKING_PASSWORD"] = _PASSWORD

EXPERIMENT_NAME = "Revluma-MVP"
IS_REMOTE = MLFLOW_TRACKING_URI.startswith("http")

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)


def get_tracking_info() -> dict:
    """Returns MLflow tracking configuration details."""
    return {
        "tracking_uri"   : MLFLOW_TRACKING_URI,
        "is_remote"      : IS_REMOTE,
        "experiment_name": EXPERIMENT_NAME,
        "auth_enabled"   : bool(_USERNAME and _PASSWORD)
    }


def get_or_create_experiment() -> str:
    """Gets or creates the configured MLflow experiment."""
    if IS_REMOTE:
        logger.info("mlflow_remote_tracking_enabled")
    else:
        logger.info("mlflow_local_tracking_enabled")

    experiment = mlflow.get_experiment_by_name(EXPERIMENT_NAME)

    if experiment is None:
        experiment_id = mlflow.create_experiment(EXPERIMENT_NAME)
        logger.info(
            "mlflow_experiment_created",
            extra={"experiment_name": EXPERIMENT_NAME, "experiment_id": experiment_id},
        )
    else:
        experiment_id = experiment.experiment_id
        logger.info(
            "mlflow_experiment_selected",
            extra={"experiment_name": EXPERIMENT_NAME, "experiment_id": experiment_id},
        )

    mlflow.set_experiment(EXPERIMENT_NAME)
    return experiment_id


def get_run_url(run_id: str, experiment_id: str) -> str | None:
    """Build a credential-free run URL for remote tracking evidence."""
    if not IS_REMOTE or not run_id or not experiment_id:
        return None
    parsed = urlsplit(MLFLOW_TRACKING_URI)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    host = parsed.hostname
    if parsed.port:
        host = f"{host}:{parsed.port}"
    base = urlunsplit(
        (parsed.scheme, host, parsed.path.rstrip("/"), "", "")
    )
    if base.endswith(".mlflow"):
        base = base[:-7]
    return f"{base}/experiments/#/experiments/{experiment_id}/runs/{run_id}"
