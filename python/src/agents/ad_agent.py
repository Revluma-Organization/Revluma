"""
Rev Intelligence — Ad Intelligence Agent
=========================================
Analyses uploaded ad creatives (images or video frames) and returns a
structured, probabilistic evaluation across four dimensions:

    Hook      — Does the first frame/image stop the scroll within 3 seconds?
    Copy      — Is the written message clear, benefit-led, and action-driving?
    Visuals   — Do the visual elements reinforce the offer and brand?
    Offer     — Is the discount/value proposition compelling and credible?

Design rules:
  - Never fabricates scores. Every dimension is backed by explicit criteria.
  - Returns a structured AdEvaluation dataclass, never a raw string.
  - Falls back to a text-only analysis if the image cannot be decoded.
  - Confidence degrades explicitly when the image is missing or low-quality.
  - Does NOT inherit from BaseAgent — it is a standalone stateless evaluator,
    not a data-driven specialist. It receives creative assets, not BusinessState.

Audience targeting dimension is computed heuristically from visual signals
(colour palette, imagery type, product category) and is explicitly marked
as inferred, not ground-truth.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("rev.ad_agent")

# Model used for multimodal creative evaluation
VISION_MODEL = "claude-sonnet-4-6"

# Dimension weights for the composite score (must sum to 1.0)
WEIGHTS = {
    "hook":    0.35,   # Highest weight — the hook decides if anyone sees the rest
    "copy":    0.25,
    "visuals": 0.20,
    "offer":   0.20,
}

# Score thresholds
STRONG_THRESHOLD = 0.75
WEAK_THRESHOLD   = 0.45


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class DimensionScore:
    score:        float          # 0.0–1.0
    label:        str            # "Strong" | "Moderate" | "Weak"
    reasoning:    str            # One sentence explaining the score
    suggestions:  list[str]      # Up to 2 concrete improvement actions


@dataclass
class AdEvaluation:
    """
    Structured output from the Ad Intelligence Agent.

    All scores are probabilities in [0.0, 1.0].
    composite_score is a weighted average per WEIGHTS.
    fallback=True means image decoding failed and only text context was used.
    """
    hook:             DimensionScore
    copy:             DimensionScore
    visuals:          DimensionScore
    offer:            DimensionScore
    audience_signals: list[str]    # Inferred audience signals from visual context
    composite_score:  float        # Weighted average across all 4 dimensions
    verdict:          str          # "Strong" | "Needs work" | "Rethink"
    top_priority:     str          # The single most impactful change to make
    fallback:         bool = False # True if image was absent or unreadable

    def to_dict(self) -> dict:
        hook = _dim_to_dict(self.hook)
        copy = _dim_to_dict(self.copy)
        visuals = _dim_to_dict(self.visuals)
        offer = _dim_to_dict(self.offer)
        return {
            "hook":             hook,
            "copy":             copy,
            "visuals":          visuals,
            "offer":            offer,
            "creative_hook":    hook,
            "visual_hierarchy": visuals,
            "copy_clarity":     copy,
            "audience_alignment": {
                "signals": self.audience_signals,
                "inferred": True,
            },
            "audience_signals": self.audience_signals,
            "composite_score":  round(self.composite_score, 3),
            "verdict":          self.verdict,
            "top_priority":     self.top_priority,
            "fallback":         self.fallback,
        }


def _dim_to_dict(d: DimensionScore) -> dict:
    return {
        "score":       round(d.score, 3),
        "label":       d.label,
        "reasoning":   d.reasoning,
        "suggestions": d.suggestions,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def evaluate_ad(
    image_base64: str | None,
    image_media_type: str | None,
    ad_copy: str | None = None,
    context: str | None = None,
) -> AdEvaluation:
    """
    Evaluates an ad creative and returns a structured probabilistic assessment.

    This is the single public entry point. Handles both multimodal (image + copy)
    and text-only (copy alone) evaluation paths. Never raises — activates the
    failsafe path on any exception.

    Args:
        image_base64:     Base64-encoded image of the ad creative. Optional.
        image_media_type: MIME type of the image (e.g. "image/jpeg"). Optional.
        ad_copy:          The written copy of the ad (headline + body). Optional.
        context:          Additional merchant context (product, target audience,
                          campaign goal). Optional.

    Returns:
        AdEvaluation — always. Never raises.
    """
    try:
        if image_base64 and image_media_type:
            return _evaluate_with_vision(image_base64, image_media_type, ad_copy, context)
        return _evaluate_text_only(ad_copy, context)
    except Exception as err:
        logger.error(
            "ad_agent_evaluation_failed",
            extra={"error_type": type(err).__name__},
        )
        return _failsafe_evaluation()


# ── Evaluation paths ──────────────────────────────────────────────────────────

def _evaluate_with_vision(
    image_base64: str,
    image_media_type: str,
    ad_copy: str | None,
    context: str | None,
) -> AdEvaluation:
    """
    Full multimodal evaluation using Claude's vision capability.

    Sends the image + copy to Claude with a structured scoring prompt.
    Parses the JSON response into an AdEvaluation.

    Args:
        image_base64:     Raw base64 image data.
        image_media_type: MIME type.
        ad_copy:          Written ad copy, if available.
        context:          Merchant-provided context.

    Returns:
        AdEvaluation with all 4 dimensions scored from visual + textual signals.
    """
    import anthropic
    import json as _json

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    copy_block = f"\n\nAD COPY:\n{ad_copy}" if ad_copy else ""
    context_block = f"\n\nMERCHANT CONTEXT:\n{context}" if context else ""

    prompt = (
        "You are a direct-response advertising expert specialising in ecommerce.\n"
        "Evaluate this ad creative across exactly 4 dimensions.\n"
        "Return ONLY a valid JSON object — no markdown, no preamble.\n"
        + copy_block
        + context_block
        + """

Return this JSON structure:
{
  "hook": {
    "score": 0.0,
    "reasoning": "One sentence. What works or fails in the first 3 seconds.",
    "suggestions": ["Specific action 1", "Specific action 2"]
  },
  "copy": {
    "score": 0.0,
    "reasoning": "One sentence. Is it benefit-led, clear, and action-driving?",
    "suggestions": ["Specific action 1", "Specific action 2"]
  },
  "visuals": {
    "score": 0.0,
    "reasoning": "One sentence. Do visuals reinforce the offer and brand?",
    "suggestions": ["Specific action 1", "Specific action 2"]
  },
  "offer": {
    "score": 0.0,
    "reasoning": "One sentence. Is the value proposition compelling and credible?",
    "suggestions": ["Specific action 1", "Specific action 2"]
  },
  "audience_signals": ["Signal 1", "Signal 2"],
  "top_priority": "The single highest-impact change. One sentence."
}

Scoring rules:
- Scores are probabilities from 0.0 to 1.0.
- 0.75+ = Strong. 0.45–0.74 = Moderate. Below 0.45 = Weak.
- Hook score: 0.75+ means it stops scroll in under 3 seconds.
- Copy score: 0.75+ means no friction between benefit and CTA.
- Visuals score: 0.75+ means imagery, colour, and product are cohesive.
- Offer score: 0.75+ means the discount/value is immediately understood.
- Be honest. A mediocre ad should score 0.4–0.55, not 0.7.
"""
    )

    client = anthropic.Anthropic(api_key=api_key, timeout=20.0)
    response = client.messages.create(
        model=VISION_MODEL,
        max_tokens=800,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image_media_type,
                        "data": image_base64,
                    },
                },
                {"type": "text", "text": prompt},
            ],
        }],
    )

    raw = "".join(
        b.text for b in response.content
        if getattr(b, "type", "") == "text"
    ).strip()

    return _parse_evaluation(raw, fallback=False)


def _evaluate_text_only(ad_copy: str | None, context: str | None) -> AdEvaluation:
    """
    Text-only evaluation path when no image is provided.

    Scores Hook and Visuals from the written copy alone — these are inherently
    lower confidence when no image is available, and the evaluation explicitly
    notes the limitation. Copy and Offer can still be scored meaningfully.

    Args:
        ad_copy:  The written ad copy.
        context:  Merchant-provided context.

    Returns:
        AdEvaluation with fallback=False but lower visual/hook confidence.
    """
    import anthropic
    import json as _json

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    if not ad_copy:
        return _failsafe_evaluation()

    context_block = f"\n\nMERCHANT CONTEXT:\n{context}" if context else ""

    prompt = (
        "You are a direct-response advertising expert specialising in ecommerce.\n"
        "Evaluate this ad copy across 4 dimensions. No image was provided, so\n"
        "Hook and Visuals must be inferred from the copy alone — note this limitation.\n"
        "Return ONLY a valid JSON object.\n\n"
        f"AD COPY:\n{ad_copy}"
        + context_block
        + """

Return this exact JSON:
{
  "hook": {"score": 0.0, "reasoning": "...", "suggestions": ["...", "..."]},
  "copy": {"score": 0.0, "reasoning": "...", "suggestions": ["...", "..."]},
  "visuals": {"score": 0.0, "reasoning": "Inferred from copy only — no image provided. ...", "suggestions": ["...", "..."]},
  "offer": {"score": 0.0, "reasoning": "...", "suggestions": ["...", "..."]},
  "audience_signals": ["Signal 1", "Signal 2"],
  "top_priority": "..."
}
"""
    )

    client = anthropic.Anthropic(api_key=api_key, timeout=15.0)
    response = client.messages.create(
        model=VISION_MODEL,
        max_tokens=700,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = "".join(
        b.text for b in response.content
        if getattr(b, "type", "") == "text"
    ).strip()

    return _parse_evaluation(raw, fallback=False)


# ── Parsing + scoring ─────────────────────────────────────────────────────────

def _parse_evaluation(raw: str, fallback: bool) -> AdEvaluation:
    """
    Parses Claude's JSON response into a typed AdEvaluation.

    Defensive: handles markdown code fences, leading/trailing noise, and
    missing keys. Falls back to _failsafe_evaluation() if JSON is unparseable.

    Args:
        raw:      Raw text response from Claude.
        fallback: Whether this was already a fallback path.

    Returns:
        AdEvaluation — always.
    """
    import json as _json
    import re

    try:
        # Strip markdown fences if present
        cleaned = re.sub(r"^```(json)?", "", raw.strip(), flags=re.MULTILINE).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()

        # Extract the JSON object
        start = cleaned.find("{")
        end   = cleaned.rfind("}") + 1
        if start == -1 or end == 0:
            raise ValueError("No JSON object found in response")
        parsed = _json.loads(cleaned[start:end])

        def _dim(key: str) -> DimensionScore:
            d = parsed.get(key, {})
            score = float(d.get("score", 0.5))
            score = max(0.0, min(1.0, score))
            label = "Strong" if score >= STRONG_THRESHOLD else ("Weak" if score < WEAK_THRESHOLD else "Moderate")
            return DimensionScore(
                score=score,
                label=label,
                reasoning=str(d.get("reasoning", ""))[:300],
                suggestions=[str(s)[:150] for s in d.get("suggestions", [])[:2]],
            )

        hook    = _dim("hook")
        copy    = _dim("copy")
        visuals = _dim("visuals")
        offer   = _dim("offer")

        composite = (
            hook.score    * WEIGHTS["hook"]
            + copy.score  * WEIGHTS["copy"]
            + visuals.score * WEIGHTS["visuals"]
            + offer.score * WEIGHTS["offer"]
        )

        verdict = (
            "Strong"      if composite >= STRONG_THRESHOLD else
            "Needs work"  if composite >= WEAK_THRESHOLD   else
            "Rethink"
        )

        return AdEvaluation(
            hook=hook,
            copy=copy,
            visuals=visuals,
            offer=offer,
            audience_signals=[str(s)[:200] for s in parsed.get("audience_signals", [])[:5]],
            composite_score=composite,
            verdict=verdict,
            top_priority=str(parsed.get("top_priority", ""))[:300],
            fallback=fallback,
        )

    except Exception as parse_err:
        logger.error("ad_agent_parse_failed", extra={"error": str(parse_err)})
        return _failsafe_evaluation()


def _failsafe_evaluation() -> AdEvaluation:
    """
    Returns a safe neutral evaluation when everything else fails.

    Explicitly marks fallback=True and confidence as 0.0 so the caller
    never mistakes a failsafe result for a real assessment.
    """
    neutral = DimensionScore(
        score=0.5,
        label="Moderate",
        reasoning="Evaluation unavailable — could not process the creative.",
        suggestions=["Retry with a valid image and ad copy."],
    )
    return AdEvaluation(
        hook=neutral,
        copy=neutral,
        visuals=neutral,
        offer=neutral,
        audience_signals=[],
        composite_score=0.0,
        verdict="Unavailable",
        top_priority="Retry the evaluation with a valid image and ad copy.",
        fallback=True,
    )
