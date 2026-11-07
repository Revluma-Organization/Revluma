"""Pydantic boundary schema for the canonical Rev evidence contract.

Node has a matching Joi runtime schema in ``revEvidenceContract.js``.  The
contract version and semantic enums are deliberately identical; tests exercise
both sides rather than relying on static type annotations.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EVIDENCE_SCHEMA_VERSION = "rev-evidence-v2"
CLASSIFICATIONS = ("verified_fact", "deterministic_calculation", "analytical_finding", "hypothesis", "unknown")
STATUSES = (
    "available", "verified_zero", "partial", "not_synchronized", "stale", "unauthorized",
    "unsupported", "consent_unavailable", "pending", "retrieval_failed", "storage_failure",
    "invalid", "contradictory", "period_unavailable", "unavailable",
)
COVERAGE_STATUSES = (
    "complete", "partial", "not_synchronized", "synchronizing", "unsupported",
    "missing_authorization", "consent_unavailable", "retrieval_failed", "unknown",
    "invalid", "contradictory", "period_unavailable",
)
FRESHNESS_STATES = ("fresh", "aging", "stale", "never_synchronized", "synchronizing", "unknown")
NUMERIC_STATUSES = {"available", "verified_zero", "partial", "stale"}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class SourceReference(StrictModel):
    source_id: str = Field(min_length=1, max_length=2048)
    resource: str = Field(min_length=1, max_length=120)
    sync_run_id: str | None = Field(default=None, max_length=100)


class Source(StrictModel):
    system: str = Field(min_length=1, max_length=80)
    resource: str = Field(min_length=1, max_length=120)
    references: list[SourceReference] = Field(max_length=100)


class Period(StrictModel):
    start: datetime
    end: datetime
    timezone: str = Field(min_length=1, max_length=80)
    semantics: Literal["[start, end)"]

    @field_validator("start", "end")
    @classmethod
    def aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reporting timestamps must be timezone-aware")
        return value

    @field_validator("timezone")
    @classmethod
    def real_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("unknown reporting timezone") from exc
        return value

    @model_validator(mode="after")
    def half_open(self):
        if self.end <= self.start:
            raise ValueError("reporting period end must be after start")
        return self


class Coverage(StrictModel):
    status: Literal[tuple(COVERAGE_STATUSES)]  # type: ignore[valid-type]
    period_status: Literal["covered", "partial", "current_snapshot", "unavailable", "not_applicable"]
    complete: bool
    source: str = Field(min_length=1, max_length=160)
    note: str = Field(max_length=1000)


class Freshness(StrictModel):
    state: Literal[tuple(FRESHNESS_STATES)]  # type: ignore[valid-type]
    as_of: datetime | None
    age_seconds: float | None = Field(ge=0)
    policy: str = Field(min_length=1, max_length=100)
    note: str = Field(max_length=600)


class Provenance(StrictModel):
    retrieval: Literal["direct", "snapshot", "aggregate", "calculation", "analytical_logic", "none"]
    transformation: str = Field(min_length=1, max_length=1000)
    calculation_version: str | None = Field(max_length=120)
    lineage: list[str] = Field(max_length=40)
    reproducible: bool


class Measurement(StrictModel):
    amount: str | None = Field(pattern=r"^-?\d+(?:\.\d+)?$")
    currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    interpretation: Literal["gross", "net", "affected", "estimated_opportunity", "recoverable", "not_applicable"]
    tax: Literal["included", "excluded", "unknown", "not_applicable"]
    shipping: Literal["included", "excluded", "unknown", "not_applicable"]
    discounts: Literal["included", "excluded", "deducted", "unknown", "not_applicable"]
    refunds: Literal["included", "excluded", "deducted", "unknown", "not_applicable"]
    cancellations: Literal["included", "excluded", "unknown", "not_applicable"]
    numerator: str | None = Field(max_length=500)
    denominator: str | None = Field(max_length=500)
    formula: str | None = Field(max_length=1000)


class Confidence(StrictModel):
    level: Literal["high", "medium", "low", "none"]
    score: float = Field(ge=0, le=1)
    basis: str = Field(min_length=1, max_length=800)


class EvidenceItem(StrictModel):
    id: str = Field(pattern=r"^ev-[a-f0-9]{24}$")
    schema_version: Literal["rev-evidence-v2"]
    organization_id: str = Field(min_length=1, max_length=64)
    store_id: str | None = Field(max_length=64)
    store_ids: list[str] = Field(min_length=1, max_length=100)
    evidence_type: str = Field(min_length=1, max_length=80)
    domain: str = Field(min_length=1, max_length=80)
    classification: Literal[tuple(CLASSIFICATIONS)]  # type: ignore[valid-type]
    status: Literal[tuple(STATUSES)]  # type: ignore[valid-type]
    metric: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=300)
    value: Any
    unit: Literal["currency", "count", "ratio", "record", "reference"]
    currency: str | None = Field(pattern=r"^[A-Z]{3}$")
    definition: str = Field(min_length=1, max_length=1600)
    period: Period
    source: Source
    retrieved_at: datetime
    computed_at: datetime | None
    coverage: Coverage
    freshness: Freshness
    provenance: Provenance
    measurement: Measurement | None
    confidence: Confidence
    store_scope: Literal["store", "organization"]
    limitations: list[str] = Field(max_length=30)

    @field_validator("retrieved_at", "computed_at")
    @classmethod
    def aware_timestamps(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("evidence timestamps must be timezone-aware")
        return value

    @model_validator(mode="after")
    def semantics(self):
        if len(set(self.store_ids)) != len(self.store_ids):
            raise ValueError("duplicate store scope")
        if self.store_id is not None and (len(self.store_ids) != 1 or self.store_ids[0] != self.store_id):
            raise ValueError("store identity mismatch")
        if self.classification == "unknown" and self.value is not None:
            raise ValueError("unknown evidence cannot carry a value")
        if self.classification == "hypothesis" and self.status == "available":
            raise ValueError("a hypothesis cannot be an established available fact")
        if self.unit == "currency" and self.status in NUMERIC_STATUSES:
            if not self.currency or not isinstance(self.value, str):
                raise ValueError("monetary evidence requires a decimal string and currency")
            if self.measurement is None or self.measurement.currency != self.currency or self.measurement.amount != self.value:
                raise ValueError("monetary measurement semantics are missing or inconsistent")
            if self.status == "available" and float(self.value) == 0 and (
                not self.coverage.complete or self.coverage.status != "complete"
            ):
                raise ValueError("monetary zero cannot be asserted without complete coverage")
        if self.status == "verified_zero" and (
            self.value != 0 or not self.coverage.complete or self.coverage.status != "complete"
        ):
            raise ValueError("verified zero requires complete coverage")
        if self.status == "available" and self.value == 0 and (
            not self.coverage.complete or self.coverage.status != "complete"
        ):
            raise ValueError("zero cannot be asserted without complete coverage")
        return self


def validate_context_evidence(context: dict, organization_id: str) -> list[dict]:
    """Validate Node-supplied evidence without trusting its tenant claims."""
    if not isinstance(context, dict):
        raise ValueError("merchant_context must be an object")
    if context.get("schema_version") != "rev-merchant-context-v3":
        raise ValueError("merchant context schema mismatch")
    if context.get("organization_id") != organization_id:
        raise ValueError("merchant context organization mismatch")
    items = context.get("evidence") or []
    if not isinstance(items, list) or len(items) > 24:
        raise ValueError("invalid merchant evidence collection")
    validated: list[dict] = []
    seen: set[str] = set()
    for raw in items:
        item = EvidenceItem.model_validate(raw)
        if item.organization_id != organization_id:
            raise ValueError("cross-tenant merchant evidence")
        if item.id in seen:
            raise ValueError("duplicate merchant evidence id")
        seen.add(item.id)
        validated.append(item.model_dump(mode="json"))
    return validated


def validate_item(raw: dict) -> dict:
    return EvidenceItem.model_validate(raw).model_dump(mode="json")
