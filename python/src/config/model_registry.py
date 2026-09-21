"""Safe MLflow model resolution for production and controlled beta serving."""

from __future__ import annotations

import logging
import os
from typing import Any

import mlflow.sklearn

from . import mlflow_config as _mlflow_config  # Initialize remote URI and auth.


logger = logging.getLogger("rev.config.model_registry")

_VALID_RELEASE_CHANNELS = {"production", "beta"}
_loaded_model_channels: dict[str, str] = {}


def configured_release_channel() -> str:
    """Return the allowed serving channel; invalid values fail closed."""
    channel = os.getenv("MODEL_RELEASE_CHANNEL", "production").strip().lower()
    return channel if channel in _VALID_RELEASE_CHANNELS else "production"


def candidate_model_uris(model_name: str) -> list[tuple[str, str]]:
    """Resolve the production alias first and beta only when explicitly enabled."""
    candidates = [("production", f"models:/{model_name}@production")]
    if configured_release_channel() == "beta":
        candidates.append(("beta", f"models:/{model_name}@beta"))
    return candidates


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
    return None


def get_loaded_model_channel(model_name: str) -> str | None:
    """Return the provenance of a model loaded in this process."""
    return _loaded_model_channels.get(model_name)
