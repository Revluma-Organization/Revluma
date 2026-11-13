"""Centralised model transport. Merchant data is never logged or sent to fallback providers."""
import logging
import os
import re
import time

import httpx

logger = logging.getLogger("rev.model_gateway")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_FAST_MODEL = os.environ.get("GEMINI_FAST_MODEL", "gemini-2.5-flash-lite")


class ModelProviderError(RuntimeError):
    def __init__(self, provider, status=None, *, category=None):
        self.provider = provider
        self.status = status
        if category is None:
            category = ("rate_limited" if status == 429 else
                        "authorization_failed" if status in {401, 403} else
                        "provider_unavailable" if status in {404, 500, 502, 503, 504, "missing_key"} else
                        "connection_failed" if status == "network" else
                        "timeout" if status == "timeout_budget_exhausted" else
                        "malformed_output" if status in {"invalid_response", "empty_text", "truncated"} else
                        "invalid_request" if status in {"unsupported_provider"} or isinstance(status, int) and 400 <= status < 500 else
                        "internal_error")
        self.category = category
        super().__init__(f"{provider} request failed (HTTP {status or 'unknown'})")


def generate(prompt, *, role="fast", max_tokens=500, timeout=30.0,
             image_base64=None, image_media_type=None, web_search=False,
             correlation_id=None):
    provider = os.getenv("AI_PROVIDER", "anthropic").strip().lower()
    if provider == "gemini":
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise ModelProviderError("gemini", "missing_key")
        primary_model = GEMINI_FAST_MODEL if role == "fast" else GEMINI_MODEL
        if web_search:
            primary_model = GEMINI_MODEL
        # Only retry transient failures with the SAME approved Gemini provider.
        # No cross-provider transfer of merchant information is permitted.
        fallback_model = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash").strip()
        models = [primary_model]
        if fallback_model and fallback_model != primary_model:
            models.append(fallback_model)
        parts = [{"text": prompt}]
        if image_base64 and image_media_type:
            parts.append({"inline_data": {"mime_type": image_media_type, "data": image_base64}})
        started = time.monotonic()
        deadline = started + max(0.1, float(timeout))
        last_error = None
        for attempt, model in enumerate(models):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            # Reserve time for the fallback attempt instead of spending the
            # entire Node request budget on a single slow model.
            attempt_timeout = max(0.1, remaining / 2) if attempt == 0 and len(models) > 1 else remaining
            logger.info("model_provider_request_start provider=gemini model=%s role=%s grounded=%s timeout_seconds=%.2f attempt=%d correlation_id=%s",
                        model, role, web_search, attempt_timeout, attempt + 1, correlation_id)
            payload = {"contents": [{"role": "user", "parts": parts}],
                       "generationConfig": {"maxOutputTokens": max_tokens}}
            if model.startswith("gemini-2.5-"):
                payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
            if web_search:
                payload["tools"] = [{"google_search": {}}]
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            try:
                transport_timeout = httpx.Timeout(attempt_timeout, connect=min(5.0, attempt_timeout))
                with httpx.Client(timeout=transport_timeout) as client:
                    response = client.post(url, headers={"x-goog-api-key": key}, json=payload)
            except httpx.HTTPError as exc:
                logger.warning("model_provider_network_error provider=gemini error_type=%s model=%s attempt=%d correlation_id=%s",
                               type(exc).__name__, model, attempt + 1, correlation_id)
                last_error = ModelProviderError("gemini", "timeout_budget_exhausted" if isinstance(exc, httpx.TimeoutException) else "network")
                continue
            if response.status_code >= 400:
                logger.warning("model_provider_http_error provider=gemini status=%s model=%s attempt=%d correlation_id=%s",
                               response.status_code, model, attempt + 1, correlation_id)
                last_error = ModelProviderError("gemini", response.status_code)
                # Quota, auth, permission, malformed request, and unknown
                # model errors are not transient; fail closed immediately.
                if response.status_code not in (404, 500, 502, 503, 504):
                    raise last_error
                continue
            try:
                data = response.json()
                candidates = data.get("candidates") or []
                output = "".join(p.get("text", "") for p in
                                 (candidates[0].get("content", {}).get("parts", []) if candidates else []))
            except (ValueError, TypeError, AttributeError, KeyError) as exc:
                raise ModelProviderError("gemini", "invalid_response") from exc
            if not output.strip():
                raise ModelProviderError("gemini", "empty_text")
            finish_reason = str((candidates[0] if candidates else {}).get("finishReason") or "").upper()
            if finish_reason in {"MAX_TOKENS", "LENGTH", "TRUNCATED"}:
                raise ModelProviderError("gemini", "truncated")
            if web_search:
                sources = []
                for chunk in (candidates[0].get("groundingMetadata") or {}).get("groundingChunks", []):
                    uri = (chunk.get("web") or {}).get("uri", "")
                    if uri.startswith("https://") and uri not in sources:
                        sources.append(uri)
                # Real newlines, not escaped ones: this text is rendered to the
                # merchant, where a literal backslash-n is visible corruption.
                if sources:
                    output += "\n\nSources:\n" + "\n".join(
                        "- " + uri for uri in sources[:5])
                else:
                    output += "\n\n(Web search returned no verifiable sources.)"
            logger.info("model_provider_request_success provider=gemini model=%s elapsed_ms=%d attempt=%d correlation_id=%s",
                        model, int((time.monotonic() - started) * 1000), attempt + 1, correlation_id)
            return output.strip()
        raise last_error or ModelProviderError("gemini", "timeout_budget_exhausted")
    if provider == "anthropic":
        import anthropic
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ModelProviderError("anthropic", "missing_key")
        model_env = "ANTHROPIC_FAST_MODEL" if role == "fast" else "ANTHROPIC_DEEP_MODEL"
        default_model = "claude-haiku-4-5-20251001" if role == "fast" else "claude-sonnet-4-6"
        model = os.getenv(model_env, default_model).strip()
        # Treat model names as deployment configuration, not prompt text. Bound
        # and validate them so malformed values cannot inject log lines or URLs.
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,120}", model):
            raise ModelProviderError("configuration", "unsupported_provider")
        blocks = [{"type": "text", "text": prompt}]
        if image_base64 and image_media_type:
            blocks.insert(0, {"type": "image", "source": {
                "type": "base64", "media_type": image_media_type, "data": image_base64}})
        started = time.monotonic()
        logger.info("model_provider_request_start provider=anthropic model=%s role=%s timeout_seconds=%.2f correlation_id=%s",
                    model, role, timeout, correlation_id)
        try:
            client = anthropic.Anthropic(api_key=key, timeout=httpx.Timeout(timeout, connect=min(5.0, timeout)))
            result = client.messages.create(model=model, max_tokens=max_tokens,
                                            messages=[{"role": "user", "content": blocks}])
            output = "".join(b.text for b in result.content
                             if getattr(b, "type", "") == "text").strip()
        except ModelProviderError:
            raise
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            error_name = type(exc).__name__.lower()
            if isinstance(exc, httpx.TimeoutException) or "timeout" in error_name:
                status = "timeout_budget_exhausted"
            elif isinstance(exc, httpx.NetworkError) or "connection" in error_name:
                status = "network"
            error = ModelProviderError("anthropic", status)
            logger.warning("model_provider_request_failed provider=anthropic model=%s role=%s status=%s category=%s error_type=%s elapsed_ms=%d correlation_id=%s",
                           model, role, error.status, error.category, type(exc).__name__,
                           int((time.monotonic() - started) * 1000), correlation_id)
            raise error from exc
        if not output:
            error = ModelProviderError("anthropic", "empty_text")
            logger.warning("model_provider_request_failed provider=anthropic model=%s role=%s status=%s category=%s elapsed_ms=%d correlation_id=%s",
                           model, role, error.status, error.category,
                           int((time.monotonic() - started) * 1000), correlation_id)
            raise error
        if getattr(result, "stop_reason", None) == "max_tokens":
            error = ModelProviderError("anthropic", "truncated")
            logger.warning("model_provider_request_failed provider=anthropic model=%s role=%s status=%s category=%s elapsed_ms=%d correlation_id=%s",
                           model, role, error.status, error.category,
                           int((time.monotonic() - started) * 1000), correlation_id)
            raise error
        logger.info("model_provider_request_success provider=anthropic model=%s role=%s elapsed_ms=%d correlation_id=%s",
                    model, role, int((time.monotonic() - started) * 1000), correlation_id)
        return output
    raise ModelProviderError("configuration", "unsupported_provider")
