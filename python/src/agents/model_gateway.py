"""Centralised model transport. Merchant data is never logged or sent to fallback providers."""
import logging
import os
import time

import httpx

logger = logging.getLogger("rev.model_gateway")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_FAST_MODEL = os.environ.get("GEMINI_FAST_MODEL", "gemini-2.5-flash-lite")


class ModelProviderError(RuntimeError):
    def __init__(self, provider, status=None):
        self.provider = provider
        self.status = status
        super().__init__(f"{provider} request failed (HTTP {status or 'unknown'})")


def generate(prompt, *, role="fast", max_tokens=500, timeout=30.0,
             image_base64=None, image_media_type=None, web_search=False):
    provider = os.getenv("AI_PROVIDER", "anthropic").strip().lower()
    if provider == "gemini":
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise ModelProviderError("gemini", "missing_key")
        model = GEMINI_FAST_MODEL if role == "fast" else GEMINI_MODEL
        parts = [{"text": prompt}]
        if image_base64 and image_media_type:
            parts.append({"inline_data": {"mime_type": image_media_type, "data": image_base64}})
        if web_search:
            model = GEMINI_MODEL
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        started = time.monotonic()
        logger.info("model_provider_request_start provider=gemini model=%s role=%s grounded=%s timeout_seconds=%s", model, role, web_search, timeout)
        try:
            payload = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"maxOutputTokens": max_tokens}}
            if model.startswith("gemini-2.5-"):
                payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
            if web_search:
                payload["tools"] = [{"google_search": {}}]
            with httpx.Client(timeout=timeout) as client:
                response = client.post(
                    url, headers={"x-goog-api-key": key},
                    json=payload,
                )
            if response.status_code >= 400:
                logger.error("model_provider_http_error provider=gemini status=%s model=%s elapsed_ms=%d", response.status_code, model, int((time.monotonic()-started)*1000), extra={
                    "provider": "gemini", "status": response.status_code,
                    "model": model,
                })
                raise ModelProviderError("gemini", response.status_code)
            data = response.json()
            candidates = data.get("candidates") or []
            if not candidates:
                raise ModelProviderError("gemini", "empty_candidates")
            output = "".join(p.get("text", "") for p in
                             candidates[0].get("content", {}).get("parts", []))
            if not output.strip():
                raise ModelProviderError("gemini", "empty_text")
            if web_search:
                sources = []
                for chunk in (candidates[0].get("groundingMetadata") or {}).get("groundingChunks", []):
                    uri = (chunk.get("web") or {}).get("uri", "")
                    if uri.startswith("https://") and uri not in sources:
                        sources.append(uri)
                output += "\n\nSources:\n" + "\n".join("- " + uri for uri in sources[:5]) if sources else "\n\n(Web search returned no verifiable sources.)"
            logger.info("model_provider_request_success provider=gemini model=%s elapsed_ms=%d", model, int((time.monotonic()-started)*1000))
            return output.strip()
        except httpx.HTTPError as exc:
            logger.error("model_provider_network_error provider=gemini error_type=%s model=%s elapsed_ms=%d",
                         type(exc).__name__, model, int((time.monotonic()-started)*1000),
                         extra={"provider": "gemini", "error_type": type(exc).__name__, "model": model})
            raise ModelProviderError("gemini", "network") from exc
    if provider == "anthropic":
        import anthropic
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ModelProviderError("anthropic", "missing_key")
        model = "claude-haiku-4-5-20251001" if role == "fast" else "claude-sonnet-4-6"
        blocks = [{"type": "text", "text": prompt}]
        if image_base64 and image_media_type:
            blocks.insert(0, {"type": "image", "source": {
                "type": "base64", "media_type": image_media_type, "data": image_base64}})
        client = anthropic.Anthropic(api_key=key, timeout=timeout)
        result = client.messages.create(model=model, max_tokens=max_tokens,
                                        messages=[{"role": "user", "content": blocks}])
        return "".join(b.text for b in result.content
                       if getattr(b, "type", "") == "text").strip()
    raise ModelProviderError("configuration", "unsupported_provider")
