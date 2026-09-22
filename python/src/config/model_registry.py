"""Safe MLflow model resolution for production and controlled beta serving."""

from __future__ import annotations

import logging
import os
from typing import Any

import mlflow.sklearn
from mlflow.tracking import MlflowClient

from . import mlflow_config as _mlflow_config  # Initialize remote URI and auth.


logger = logging.getLogger("rev.config.model_registry")

_VALID_RELEASE_CHANNELS = {"production", "beta"}
_loaded_model_channels: dict[str, str] = {}
_loaded_model_versions: dict[str, str] = {}


def configured_release_channel() -> str:
    """Return the allowed serving channel; invalid values fail closed."""
    channel = os.getenv("MODEL_RELEASE_CHANNEL", "beta").strip().lower()
    return channel if channel in _VALID_RELEASE_CHANNELS else "production"


def candidate_model_uris(model_name: str) -> list[tuple[str, str]]:
    """Resolve only aliases allowed for the configured deployment channel.

    Controlled-beta deployments intentionally prefer the beta alias so a
    candidate receives canary traffic. If it is unavailable, the production
    alias remains the safe fallback. Production deployments never load beta.
    """
    if configured_release_channel() == "beta":
        return [
            ("beta", f"models:/{model_name}@beta"),
            ("production", f"models:/{model_name}@production"),
        ]
    return [("production", f"models:/{model_name}@production")]


def load_registered_model(model_name: str) -> Any:
    """Load the highest-priority allowed model without exposing registry errors."""
    for channel, model_uri in candidate_model_uris(model_name):
        try:
            model = mlflow.sklearn.load_model(model_uri)
            _loaded_model_channels[model_name] = channel
            logger.info(
                "registered_model_loaded",
                extra={"model": model_name, "release_channel": channel},
            )
            return model
        except Exception as exc:
            logger.warning(
                "registered_model_candidate_unavailable",
                extra={
                    "model": model_name,
                    "release_channel": channel,
                    "error_type": type(exc).__name__,
                },
            )
    _loaded_model_channels.pop(model_name, None)
    _loaded_model_versions.pop(model_name, None)
    return None


def get_loaded_model_channel(model_name: str) -> str | None:
    """Return the provenance of a model loaded in this process."""
    return _loaded_model_channels.get(model_name)


def get_loaded_model_version(model_name: str) -> str | None:
    """Return the immutable registry version loaded in this process."""
    return _loaded_model_versions.get(model_name)


def refresh_loaded_model_versions() -> None:
    """Resolve immutable versions once after startup or an intentional reload."""
    client = MlflowClient()
    for model_name, channel in tuple(_loaded_model_channels.items()):
        try:
            version = client.get_model_version_by_alias(model_name, channel)
            _loaded_model_versions[model_name] = str(version.version)
        except Exception as exc:
            _loaded_model_versions.pop(model_name, None)
            logger.warning(
                "registered_model_version_unavailable",
                extra={
                    "model": model_name,
                    "release_channel": channel,
                    "error_type": type(exc).__name__,
                },
            )


def clear_loaded_model_channels() -> None:
    """Clear provenance before an intentional hot reload."""
    _loaded_model_channels.clear()
    _loaded_model_versions.clear()
