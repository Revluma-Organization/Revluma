"""
Rev Intelligence — Agent Base Class
Every specialist agent inherits from BaseAgent and returns an AgentResult.
Agents communicate structured intelligence to the Orchestrator.
They do not speak directly to the merchant.

FACTS  →  directly in the data
SIGNALS →  patterns computed from data
DIAGNOSIS →  inferences explaining signals
RECOMMENDATIONS →  specific actions backed by diagnosis
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class AgentResult:
    """
    The contract every specialist agent must return.
    Agents NEVER fabricate numbers. Every fact cites a data source.
    """
    agent: str                           # "revenue" | "retention" | "customer" | "marketing"
    status: str                          # "success" | "partial" | "no_data" | "error"
    confidence: float                    # 0.0 to 1.0
    facts: list[dict]                    # data-backed, directly queryable
    signals: list[dict]                  # patterns detected from data
    diagnosis: list[dict]                # inferences explaining the signals
    opportunities: list[dict]            # actionable improvements identified
    recommendations: list[dict]          # specific actions with expected outcomes
    data_sources: list[str]              # which tables/fields were used
    warnings: list[str]                  # missing data, stale fields, caveats
    generated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "status": self.status,
            "confidence": self.confidence,
            "facts": self.facts,
            "signals": self.signals,
            "diagnosis": self.diagnosis,
            "opportunities": self.opportunities,
            "recommendations": self.recommendations,
            "data_sources": self.data_sources,
            "warnings": self.warnings,
            "generated_at": self.generated_at,
        }

    @classmethod
    def no_data(cls, agent: str, reason: str) -> "AgentResult":
        return cls(
            agent=agent, status="no_data", confidence=0.0,
            facts=[], signals=[], diagnosis=[], opportunities=[],
            recommendations=[], data_sources=[],
            warnings=[reason],
        )

    @classmethod
    def error(cls, agent: str, error: str) -> "AgentResult":
        return cls(
            agent=agent, status="error", confidence=0.0,
            facts=[], signals=[], diagnosis=[], opportunities=[],
            recommendations=[], data_sources=[],
            warnings=[f"Agent failed: {error}"],
        )


class BaseAgent(ABC):
    """Abstract base for all specialist agents."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    def analyze(
        self,
        business_state,       # BusinessState instance
        memories: list[dict], # merchant_memories rows
        question: str,        # the merchant's original question
    ) -> AgentResult:
        """
        Analyse the business state and return structured findings.
        Must never raise — return AgentResult.error() on exception.
        Must never fabricate numbers not present in business_state.
        """
        ...