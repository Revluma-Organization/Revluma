"""Privacy-bounded provider gateway with explicit roles and one bounded retry.

Cross-provider fallback is opt-in through ``AI_FALLBACK_PROVIDERS``. Only a
configured, credentialed, task-compatible provider may receive the same prompt.
Prompt content, credentials, customer records, and raw provider errors never enter
logs or operational metrics.
"""
from __future__ import annotations

import importlib.util
import logging
import os
import re
import time
from typing import Any

import httpx

logger = logging.getLogger("rev.model_gateway")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_FAST_MODEL = os.environ.get("GEMINI_FAST_MODEL", "gemini-2.5-flash-lite")
RETRYABLE_CATEGORIES = frozenset({"timeout", "rate_limited", "provider_unavailable", "connection_failed"})
MODEL_NAME = re.compile(r"[A-Za-z0-9._:-]{1,120}\Z")


class ModelProviderError(RuntimeError):
    """Provider-safe failure object. String form intentionally omits details."""

    def __init__(self, provider: str, status: Any = None, *, category: str | None = None,
                 model: str | None = None, attempts: int = 1, fallback_used: bool = False):
        self.provider = provider
        self.model = model
        self.status = status
        self.attempts = max(1, min(int(attempts), 2))
        self.fallback_used = bool(fallback_used)
        if category is None:
            category = ("rate_limited" if status == 429 else
                        "authorization_failed" if status in {401, 403} else
                        "provider_unavailable" if status in {500, 502, 503, 504, "missing_key"} else
                        "invalid_request" if status == 404 else
                        "connection_failed" if status == "network" else
                        "timeout" if status == "timeout_budget_exhausted" else
                        "malformed_output" if status in {"invalid_response", "empty_text", "truncated"} else
                        "unsupported_capability" if status == "unsupported_capability" else
                        "invalid_request" if status in {"unsupported_provider", "invalid_model"} or isinstance(status, int) and 400 <= status < 500 else
                        "internal_error")
        self.category = category
        super().__init__(f"{provider} request failed ({category})")


def _has_key(provider: str) -> bool:
    return bool(os.getenv({"anthropic": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY"}.get(provider, ""), "").strip())


def _sdk_available(provider: str) -> bool:
    if provider == "gemini":
        return True  # Gemini uses the already-required httpx transport.
    if provider != "anthropic":
        return False
    try:
        return importlib.util.find_spec("anthropic") is not None
    except (ImportError, ValueError):
        return "anthropic" in __import__("sys").modules


def _task_compatible(provider: str, *, web_search: bool) -> bool:
    # Grounded research is only implemented by Gemini. Do not silently erase
    # this response contract by sending the task to an ungrounded provider.
    return provider in {"anthropic", "gemini"} and (not web_search or provider == "gemini")


def _attempts(primary: str, role: str, *, web_search: bool) -> list[tuple[str, str]]:
    """Resolve a primary and at most one configured, task-compatible fallback."""
    candidates: list[tuple[str, str]] = []
    if _sdk_available(primary) and _has_key(primary) and _task_compatible(primary, web_search=web_search):
        candidates.append((primary, _model_for(primary, role)))
    fallback_providers = []
    for candidate in os.getenv("AI_FALLBACK_PROVIDERS", "").split(","):
        provider = candidate.strip().lower()
        if provider in {"anthropic", "gemini"} and provider != primary and provider not in fallback_providers:
            fallback_providers.append(provider)
    if fallback_providers:
        # Naming a fallback provider is explicit authorization for the prompt
        # to be processed there. Never infer cross-provider permission.
        for provider in fallback_providers:
            if _sdk_available(provider) and _has_key(provider) and _task_compatible(provider, web_search=web_search):
                candidates.append((provider, _model_for(provider, role)))
                break
    elif candidates:
        # Same-provider model failover preserves the data-processing boundary.
        env_name = "GEMINI_FALLBACK_MODEL" if primary == "gemini" else "ANTHROPIC_FALLBACK_MODEL"
        fallback_model = os.getenv(env_name, "gemini-2.5-flash" if primary == "gemini" else "").strip()
        if fallback_model and MODEL_NAME.fullmatch(fallback_model) and fallback_model != candidates[0][1]:
            candidates.append((primary, fallback_model))
    # A request gets at most two attempts, including the primary. Do not make
    # credentials/configuration discovery itself an unbounded retry mechanism.
    return candidates[:2]


def _model_for(provider: str, role: str) -> str:
    if role not in {"fast", "deep"}:
        raise ModelProviderError(provider, "unsupported_provider", category="invalid_request")
    if provider == "gemini":
        return (GEMINI_FAST_MODEL if role == "fast" else GEMINI_MODEL).strip()
    env_name = "ANTHROPIC_FAST_MODEL" if role == "fast" else "ANTHROPIC_DEEP_MODEL"
    default = "claude-haiku-4-5-20251001" if role == "fast" else "claude-sonnet-4-6"
    return os.getenv(env_name, default).strip()


def _gemini_request(model: str, prompt: str, *, role: str, max_tokens: int,
                    timeout: float, key: str, image_base64: str | None,
                    image_media_type: str | None, web_search: bool) -> str:
    parts = [{"text": prompt}]
    if image_base64 and image_media_type:
        parts.append({"inline_data": {"mime_type": image_media_type, "data": image_base64}})
    payload: dict[str, Any] = {"contents": [{"role": "user", "parts": parts}],
                               "generationConfig": {"maxOutputTokens": max_tokens}}
    if model.startswith("gemini-2.5-"):
        payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
    if web_search:
        payload["tools"] = [{"google_search": {}}]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout, connect=min(5.0, timeout))) as client:
            response = client.post(url, headers={"x-goog-api-key": key}, json=payload)
    except httpx.TimeoutException as exc:
        raise ModelProviderError("gemini", "timeout_budget_exhausted", model=model) from exc
    except httpx.HTTPError as exc:
        raise ModelProviderError("gemini", "network", model=model) from exc
    if response.status_code >= 400:
        raise ModelProviderError("gemini", response.status_code, model=model)
    try:
        data = response.json()
        usage = data.get("usageMetadata") or {}
        if usage:
            from ..intelligence.operational_metrics import record_token_usage
            record_token_usage("gemini", model,
                               input_tokens=int(usage.get("promptTokenCount") or 0),
                               output_tokens=int(usage.get("candidatesTokenCount") or 0))
        candidates = data.get("candidates") or []
        candidate = candidates[0] if candidates else {}
        output = "".join(part.get("text", "") for part in
                         (candidate.get("content", {}).get("parts", [])))
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        raise ModelProviderError("gemini", "invalid_response", model=model) from exc
    if not output.strip():
        raise ModelProviderError("gemini", "empty_text", model=model)
    if str(candidate.get("finishReason") or "").upper() in {"MAX_TOKENS", "LENGTH", "TRUNCATED"}:
        raise ModelProviderError("gemini", "truncated", model=model)
    if web_search:
        sources = []
        for chunk in (candidate.get("groundingMetadata") or {}).get("groundingChunks", []):
            uri = (chunk.get("web") or {}).get("uri", "")
            if uri.startswith("https://") and uri not in sources:
                sources.append(uri)
        output += ("\n\nSources:\n" + "\n".join("- " + uri for uri in sources[:5])
                   if sources else "\n\n(Web search returned no verifiable sources.)")
    return output.strip()


def _anthropic_request(model: str, prompt: str, *, max_tokens: int, timeout: float,
                       key: str, image_base64: str | None,
                       image_media_type: str | None) -> str:
    if not MODEL_NAME.fullmatch(model):
        raise ModelProviderError("anthropic", "invalid_model", category="invalid_request")
    try:
        import anthropic
    except ImportError as exc:
        raise ModelProviderError("anthropic", "missing_sdk", category="provider_unavailable") from exc
    blocks: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    if image_base64 and image_media_type:
        blocks.insert(0, {"type": "image", "source": {
            "type": "base64", "media_type": image_media_type, "data": image_base64}})
    try:
        client = anthropic.Anthropic(api_key=key, timeout=httpx.Timeout(timeout, connect=min(5.0, timeout)))
        result = client.messages.create(model=model, max_tokens=max_tokens,
                                        messages=[{"role": "user", "content": blocks}])
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        name = type(exc).__name__.lower()
        if isinstance(exc, httpx.TimeoutException) or "timeout" in name:
            status = "timeout_budget_exhausted"
        elif isinstance(exc, httpx.NetworkError) or "connection" in name:
            status = "network"
        raise ModelProviderError("anthropic", status, model=model) from exc
    usage = getattr(result, "usage", None)
    if usage is not None:
        from ..intelligence.operational_metrics import record_token_usage
        record_token_usage("anthropic", model,
                           input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
                           output_tokens=int(getattr(usage, "output_tokens", 0) or 0))
    output = "".join(block.text for block in result.content
                     if getattr(block, "type", "") == "text").strip()
    if not output:
        raise ModelProviderError("anthropic", "empty_text", model=model)
    if getattr(result, "stop_reason", None) == "max_tokens":
        raise ModelProviderError("anthropic", "truncated", model=model)
    return output


def generate(prompt: str, *, role: str = "fast", max_tokens: int = 500,
             timeout: float = 30.0, image_base64: str | None = None,
             image_media_type: str | None = None, web_search: bool = False,
             correlation_id: str | None = None, execution_id: str | None = None) -> str:
    """Generate under one monotonic latency budget and no more than one retry."""
    primary = os.getenv("AI_PROVIDER", "anthropic").strip().lower()
    if primary not in {"anthropic", "gemini"}:
        raise ModelProviderError(primary or "unknown", "unsupported_provider", category="invalid_request")
    from ..intelligence.trace_context import correlation_id_var, execution_id_var
    correlation_id = correlation_id or correlation_id_var.get()
    execution_id = execution_id or execution_id_var.get()
    correlation_id = correlation_id if isinstance(correlation_id, str) and re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", correlation_id) else None
    execution_id = execution_id if isinstance(execution_id, str) and re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", execution_id) else None
    attempts = _attempts(primary, role, web_search=web_search)
    if not attempts:
        category = "unsupported_capability" if not _task_compatible(primary, web_search=web_search) else "provider_unavailable"
        error = ModelProviderError(primary, "unsupported_capability" if category == "unsupported_capability" else "missing_key",
                                   category=category)
        logger.warning("model_provider_unavailable provider=%s role=%s category=%s correlation_id=%s execution_id=%s",
                       primary, role, category, correlation_id, execution_id)
        try:
            from ..intelligence.operational_metrics import record_counter, record_stage
            record_counter("provider_model_failures_total", labels={"provider": primary, "model": "unknown", "category": category})
            record_stage("model_inference", 0, labels={
                "provider": primary, "model": "unknown", "outcome": "unavailable"})
        except Exception:
            pass
        raise error
    budget = min(max(float(timeout), 0.05), 120.0)
    deadline = time.monotonic() + budget
    last_error: ModelProviderError | None = None
    attempts_made = 0
    for attempt, (provider, model) in enumerate(attempts):
        attempts_made += 1
        if attempt > 0 or provider != primary:
            try:
                from ..intelligence.operational_metrics import record_counter
                previous_provider, previous_model = attempts[attempt - 1] if attempt > 0 else (primary, "unknown")
                record_counter("provider_fallbacks_total", labels={
                    "from_provider": previous_provider, "to_provider": provider,
                    "from_model": previous_model, "to_model": model,
                })
            except Exception:
                pass
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        # Reserve an equal share for each configured attempt. A fast permanent
        # failure must not hand the fallback the entire original deadline, and
        # slow attempts remain strictly bounded by the overall timeout.
        attempt_timeout = max(0.05, min(remaining, budget / len(attempts)))
        if not MODEL_NAME.fullmatch(model):
            raise ModelProviderError(provider, "invalid_model", category="invalid_request", model="invalid")
        logger.info("model_provider_attempt_start provider=%s model=%s role=%s attempt=%d timeout_seconds=%.2f correlation_id=%s execution_id=%s",
                    provider, model, role, attempt + 1, attempt_timeout, correlation_id, execution_id)
        started = time.monotonic()
        try:
            if provider == "gemini":
                output = _gemini_request(model, prompt, role=role, max_tokens=max_tokens,
                                         timeout=attempt_timeout, key=os.environ["GEMINI_API_KEY"],
                                         image_base64=image_base64, image_media_type=image_media_type,
                                         web_search=web_search)
            else:
                output = _anthropic_request(model, prompt, max_tokens=max_tokens,
                                            timeout=attempt_timeout, key=os.environ["ANTHROPIC_API_KEY"],
                                            image_base64=image_base64, image_media_type=image_media_type)
        except ModelProviderError as exc:
            last_error = exc
            elapsed_ms = int((time.monotonic() - started) * 1000)
            error_type = type(exc.__cause__).__name__ if exc.__cause__ else "ProviderResponseError"
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,63}", error_type):
                error_type = "ProviderResponseError"
            logger.warning("model_provider_attempt_failed provider=%s model=%s role=%s status=%s category=%s error_type=%s elapsed_ms=%d attempt=%d correlation_id=%s execution_id=%s",
                           provider, model, role, exc.status, exc.category, error_type, elapsed_ms,
                           attempt + 1, correlation_id, execution_id)
            try:
                from ..intelligence.operational_metrics import record_counter, observe_latency, record_stage
                record_counter("provider_requests_total", labels={"provider": provider, "model": model, "outcome": "failure"})
                record_stage("model_inference", elapsed_ms,
                             labels={"provider": provider, "model": model, "outcome": "failure"})
                record_counter("provider_model_failures_total", labels={"provider": provider, "model": model, "category": exc.category})
                observe_latency("provider_request", elapsed_ms)
            except Exception:
                pass
            if exc.category not in RETRYABLE_CATEGORIES or attempt + 1 >= len(attempts):
                break
            next_provider, next_model = attempts[attempt + 1]
            try:
                from ..intelligence.operational_metrics import record_counter
                record_counter("rev_execution_retries_total", labels={
                    "stage": "model_inference", "category": exc.category})
                record_counter("rev_execution_fallbacks_total", labels={
                    "stage": "model_inference", "category": exc.category})
            except Exception:
                pass
            logger.warning("model_provider_fallback_selected from_provider=%s to_provider=%s to_model=%s role=%s category=%s attempt=%d correlation_id=%s execution_id=%s",
                           provider, next_provider, next_model, role, exc.category, attempt + 2,
                           correlation_id, execution_id)
            continue
        elapsed_ms = int((time.monotonic() - started) * 1000)
        fallback_used = attempt > 0 or provider != primary
        logger.info("model_provider_attempt_success provider=%s model=%s role=%s elapsed_ms=%d attempt=%d fallback_used=%s correlation_id=%s execution_id=%s",
                    provider, model, role, elapsed_ms, attempt + 1, fallback_used,
                    correlation_id, execution_id)
        try:
            from ..intelligence.operational_metrics import record_counter, observe_latency, record_stage
            record_counter("provider_requests_total", labels={"provider": provider, "model": model, "outcome": "success"})
            record_stage("model_inference", elapsed_ms,
                         labels={"provider": provider, "model": model, "outcome": "success"})
            observe_latency("provider_request", elapsed_ms)
        except Exception:
            pass
        return output
    if last_error is None:
        last_error = ModelProviderError(primary, "timeout_budget_exhausted")
        try:
            from ..intelligence.operational_metrics import record_counter, observe_latency
            record_counter("provider_model_failures_total", labels={"provider": primary, "model": "unknown", "category": last_error.category})
            observe_latency("provider_request", int((budget - max(0.0, deadline - time.monotonic())) * 1000))
        except Exception:
            pass
    last_error.attempts = min(2, max(1, attempts_made))
    last_error.fallback_used = attempts_made > 1 or last_error.provider != primary
    raise last_error


def generate_tool_turn(prompt: str, tools: list[dict], *, role: str = "fast",
                       max_tokens: int = 500, timeout: float = 20.0,
                       system: str = "",
                       correlation_id: str | None = None,
                       execution_id: str | None = None) -> dict:
    """Ask a configured provider for one typed function call or a final text turn.

    Tool definitions are supplied by the server's closed capability registry.
    This API deliberately returns provider/model metadata so orchestration can
    report the provider that actually answered, rather than configured intent.
    """
    if not isinstance(prompt, str) or not prompt or len(prompt) > 48_000:
        raise ModelProviderError("unknown", "invalid_request", category="invalid_request")
    if not isinstance(system, str) or len(system) > 4_000:
        raise ModelProviderError("unknown", "invalid_request", category="invalid_request")
    if not tools or len(tools) > 16:
        raise ModelProviderError("unknown", "invalid_request", category="invalid_request")
    for tool in tools:
        if not isinstance(tool, dict) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", str(tool.get("name", ""))):
            raise ModelProviderError("unknown", "invalid_request", category="invalid_request")
        schema = tool.get("input_schema")
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ModelProviderError("unknown", "invalid_request", category="invalid_request")

    primary = os.getenv("AI_PROVIDER", "anthropic").strip().lower()
    if primary not in {"anthropic", "gemini"}:
        raise ModelProviderError(primary or "unknown", "unsupported_provider", category="invalid_request")
    correlation_id = correlation_id or ""
    execution_id = execution_id or ""
    attempts = _attempts(primary, role, web_search=False)
    if not attempts:
        category = "provider_unavailable" if _task_compatible(primary, web_search=False) else "unsupported_capability"
        logger.warning("model_tool_turn_unavailable provider=%s role=%s category=%s correlation_id=%s execution_id=%s",
                       primary, role, category, correlation_id or None, execution_id or None)
        try:
            from ..intelligence.operational_metrics import record_counter, record_stage
            record_counter("provider_model_failures_total", labels={"provider": primary, "model": "unknown", "category": category})
            record_stage("model_tool_selection", 0, labels={"provider": primary, "model": "unknown", "outcome": "unavailable"})
        except Exception:
            pass
        raise ModelProviderError(primary, "missing_key", category=category)
    budget = min(max(float(timeout), .05), 120.0)
    deadline = time.monotonic() + budget
    last_error = None
    for index, (provider, model) in enumerate(attempts):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        attempt_timeout = max(.05, min(remaining, budget / len(attempts)))
        started = time.monotonic()
        try:
            if provider == "gemini":
                if not MODEL_NAME.fullmatch(model):
                    raise ModelProviderError(provider, "invalid_model", category="invalid_request")
                declarations = []
                for tool in tools:
                    declarations.append({
                        "name": tool["name"],
                        "description": str(tool.get("description", ""))[:500],
                        "parameters": _gemini_schema(tool["input_schema"]),
                    })
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "tools": [{"functionDeclarations": declarations}],
                    "toolConfig": {"functionCallingConfig": {"mode": "ANY"}},
                    "generationConfig": {"maxOutputTokens": max(32, min(int(max_tokens), 1200))},
                }
                if system:
                    payload["systemInstruction"] = {"parts": [{"text": system}]}
                if model.startswith("gemini-2.5-"):
                    payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                try:
                    with httpx.Client(timeout=httpx.Timeout(attempt_timeout, connect=min(5.0, attempt_timeout))) as client:
                        response = client.post(url, headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, json=payload)
                except httpx.TimeoutException as exc:
                    raise ModelProviderError(provider, "timeout_budget_exhausted", model=model) from exc
                except httpx.HTTPError as exc:
                    raise ModelProviderError(provider, "network", model=model) from exc
                if response.status_code >= 400:
                    raise ModelProviderError(provider, response.status_code, model=model)
                data = response.json()
                usage = data.get("usageMetadata") or {}
                if usage:
                    from ..intelligence.operational_metrics import record_token_usage
                    record_token_usage(provider, model,
                                       input_tokens=int(usage.get("promptTokenCount") or 0),
                                       output_tokens=int(usage.get("candidatesTokenCount") or 0))
                candidates = data.get("candidates") or []
                candidate = candidates[0] if candidates else {}
                parts = (candidate.get("content") or {}).get("parts") or []
                call = next((part["functionCall"] for part in parts
                             if isinstance(part, dict) and isinstance(part.get("functionCall"), dict)), None)
                text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))[:8000]
                if call:
                    response_value = {"tool_call": {"name": call.get("name"), "arguments": call.get("args") or {}},
                                      "text": text, "provider": provider, "model": model,
                                      "usage": {"input_tokens": int(usage.get("promptTokenCount") or 0),
                                                "output_tokens": int(usage.get("candidatesTokenCount") or 0)}}
                else:
                    response_value = {"tool_call": None, "text": text, "provider": provider, "model": model,
                                      "usage": {"input_tokens": int(usage.get("promptTokenCount") or 0),
                                                "output_tokens": int(usage.get("candidatesTokenCount") or 0)}}
            else:
                if not MODEL_NAME.fullmatch(model):
                    raise ModelProviderError(provider, "invalid_model", category="invalid_request")
                try:
                    import anthropic
                except ImportError as exc:
                    raise ModelProviderError(provider, "missing_sdk", category="provider_unavailable") from exc
                client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"],
                                              timeout=httpx.Timeout(attempt_timeout, connect=min(5.0, attempt_timeout)))
                provider_tools = [{"name": item["name"], "description": str(item.get("description", ""))[:500],
                                   "input_schema": item["input_schema"]} for item in tools]
                request = {
                    "model": model, "max_tokens": max(32, min(int(max_tokens), 1200)),
                    "messages": [{"role": "user", "content": prompt}],
                    "tools": provider_tools, "tool_choice": {"type": "any"},
                }
                if system:
                    request["system"] = system
                try:
                    result = client.messages.create(**request)
                except Exception as exc:
                    status = getattr(exc, "status_code", None)
                    name = type(exc).__name__.lower()
                    if "timeout" in name:
                        status = "timeout_budget_exhausted"
                    elif "connection" in name:
                        status = "network"
                    raise ModelProviderError(provider, status, model=model) from exc
                usage = getattr(result, "usage", None)
                if usage is not None:
                    from ..intelligence.operational_metrics import record_token_usage
                    record_token_usage(provider, model,
                                       input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
                                       output_tokens=int(getattr(usage, "output_tokens", 0) or 0))
                blocks = list(getattr(result, "content", []) or [])
                use = next((block for block in blocks if getattr(block, "type", "") == "tool_use"), None)
                text = "".join(str(getattr(block, "text", "")) for block in blocks
                               if getattr(block, "type", "") == "text")[:8000]
                call = ({"name": getattr(use, "name", None), "arguments": getattr(use, "input", {})}
                        if use is not None else None)
                response_value = {"tool_call": call, "text": text, "provider": provider, "model": model,
                                  "usage": {"input_tokens": int(getattr(usage, "input_tokens", 0) or 0) if usage is not None else 0,
                                            "output_tokens": int(getattr(usage, "output_tokens", 0) or 0) if usage is not None else 0}}
            elapsed = int((time.monotonic() - started) * 1000)
            logger.info("model_tool_turn_success provider=%s model=%s elapsed_ms=%d fallback_used=%s correlation_id=%s execution_id=%s",
                        provider, model, elapsed, index > 0, correlation_id or None, execution_id or None)
            try:
                from ..intelligence.operational_metrics import record_counter, record_stage, observe_latency
                record_counter("provider_requests_total", labels={"provider": provider, "model": model, "outcome": "success"})
                record_stage("model_tool_selection", elapsed, labels={"provider": provider, "model": model, "outcome": "success"})
                observe_latency("provider_request", elapsed)
                if index > 0:
                    previous_provider, previous_model = attempts[index - 1]
                    record_counter("provider_fallbacks_total", labels={
                        "from_provider": previous_provider, "to_provider": provider,
                        "from_model": previous_model, "to_model": model})
            except Exception:
                pass
            return response_value
        except ModelProviderError as exc:
            last_error = exc
            logger.warning("model_tool_turn_failed provider=%s model=%s category=%s status=%s correlation_id=%s execution_id=%s",
                           provider, model, exc.category, exc.status, correlation_id or None, execution_id or None)
            try:
                from ..intelligence.operational_metrics import record_counter, record_stage, observe_latency
                elapsed = int((time.monotonic() - started) * 1000)
                record_counter("provider_requests_total", labels={"provider": provider, "model": model, "outcome": "failure"})
                record_counter("provider_model_failures_total", labels={"provider": provider, "model": model, "category": exc.category})
                record_stage("model_tool_selection", elapsed, labels={"provider": provider, "model": model, "outcome": "failure"})
                observe_latency("provider_request", elapsed)
            except Exception:
                pass
            if exc.category not in RETRYABLE_CATEGORIES or index + 1 >= len(attempts):
                break
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            last_error = ModelProviderError(provider, "invalid_response", model=model)
            last_error.__cause__ = exc
            break
    if last_error is None:
        last_error = ModelProviderError(primary, "timeout_budget_exhausted")
    raise last_error


def _gemini_schema(schema: dict) -> dict:
    """Convert the small JSON-schema subset used by Rev to Gemini's schema form."""
    result = {}
    for key, value in schema.items():
        if key == "additionalProperties" or (key == "required" and not value):
            continue
        if key == "type" and isinstance(value, str):
            result[key] = value.upper()
        elif key == "properties" and isinstance(value, dict):
            result[key] = {name: _gemini_schema(child) for name, child in value.items()}
        elif key == "items" and isinstance(value, dict):
            result[key] = _gemini_schema(value)
        else:
            result[key] = value
    return result
