"""Stage 1 (H2): configuration for scripted evaluation/load runs.

Every scripted run that touches merchant-facing Rev endpoints must go through
this module so that:

* the target is explicit (base URL + organization id from the environment,
  never a hardcoded production target);
* the target organization is verified against a production blocklist before
  any request is built;
* every request carries a stable run identity (``X-Eval-Run`` header,
  ``User-Agent`` and the ``client_context`` body field the Node gateway
  persists into message metadata).

Nothing here executes requests; clients build their calls from
:meth:`EvalConfig.headers` and :meth:`EvalConfig.client_context`.
"""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.:-]{1,64}\Z")
_UUID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z"
)


class EvalConfigError(ValueError):
    """Raised when a scripted run is misconfigured or targets production."""


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    if value is None:
        return None
    value = value.strip()
    return value or None


@dataclass(frozen=True)
class EvalConfig:
    """Validated identity of one scripted evaluation run."""

    base_url: str
    organization_id: str
    run_id: str
    harness: str
    source: str = "eval"

    def headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        """HTTP headers identifying this run. Never carries secrets."""
        headers = {
            "User-Agent": f"revluma-{self.source}/{self.harness}/{self.run_id}",
            "X-Eval-Run": self.run_id,
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def client_context(self) -> dict[str, str]:
        """Body field the gateway persists into message metadata."""
        return {"source": self.source, "run_id": self.run_id, "harness": self.harness}

    def assert_not_production(self, production_org_ids: list[str]) -> None:
        """Refuse to run against a blocklisted production organization."""
        normalized = {str(org_id).strip().lower() for org_id in production_org_ids if str(org_id).strip()}
        if self.organization_id.lower() in normalized:
            raise EvalConfigError(
                f"Refusing scripted run {self.run_id}: organization "
                f"{self.organization_id} is a blocklisted production org. "
                "Use a dedicated sandbox organization."
            )


def load_eval_config(prefix: str = "REVLUMA_EVAL") -> EvalConfig:
    """Build an :class:`EvalConfig` from ``<prefix>_API_BASE`` and friends.

    Required: ``<prefix>_API_BASE`` (http/https URL), ``<prefix>_ORG_ID`` (UUID).
    Optional: ``<prefix>_RUN_ID`` (default ``run-<8 hex>``), ``<prefix>_HARNESS``
    (default ``lab``), ``<prefix>_SOURCE`` (``eval`` or ``load``).
    ``<prefix>_PROD_ORG_IDS`` (comma-separated UUIDs) is checked when present.
    """
    base_url = _env(f"{prefix}_API_BASE")
    if not base_url or not re.match(r"https?://", base_url):
        raise EvalConfigError(f"{prefix}_API_BASE must be an http(s) URL.")
    organization_id = _env(f"{prefix}_ORG_ID")
    if not organization_id or not _UUID_PATTERN.match(organization_id):
        raise EvalConfigError(f"{prefix}_ORG_ID must be a UUID.")
    run_id = _env(f"{prefix}_RUN_ID") or f"run-{uuid.uuid4().hex[:8]}"
    if not _TOKEN_PATTERN.match(run_id):
        raise EvalConfigError(f"{prefix}_RUN_ID must match [A-Za-z0-9_.:-]{{1,64}}.")
    harness = _env(f"{prefix}_HARNESS") or "lab"
    if not _TOKEN_PATTERN.match(harness):
        raise EvalConfigError(f"{prefix}_HARNESS must match [A-Za-z0-9_.:-]{{1,64}}.")
    source = (_env(f"{prefix}_SOURCE") or "eval").lower()
    if source not in {"eval", "load"}:
        raise EvalConfigError(f"{prefix}_SOURCE must be 'eval' or 'load'.")
    config = EvalConfig(
        base_url=base_url.rstrip("/"),
        organization_id=organization_id,
        run_id=run_id,
        harness=harness,
        source=source,
    )
    raw_blocklist = _env(f"{prefix}_PROD_ORG_IDS")
    if raw_blocklist:
        config.assert_not_production(raw_blocklist.split(","))
    return config
