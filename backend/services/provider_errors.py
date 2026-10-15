"""Shared retry + error-message handling for OpenAI-compatible APIs.

The OpenAI SDK's built-in retries treat every 429 the same, so an account with
no credits ("insufficient_quota", which will never succeed on retry) was
retried for ~20s before failing. We disable SDK retries and retry here only on
errors that can actually succeed later: rate limits, timeouts, connection
problems and 5xx responses.
"""

import time
from collections.abc import Callable

import openai

# Gemini and Groq expose OpenAI-compatible APIs, so one SDK covers all three.
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Error codes on a 429 that mean "fix your account", not "slow down".
_PERMANENT_429_CODES = {"insufficient_quota", "credit_balance_exhausted"}


def is_quota_error(exc: Exception) -> bool:
    # The SDK lifts `code` and `type` out of the {"error": {...}} response body.
    return isinstance(exc, openai.RateLimitError) and bool(
        {exc.code, exc.type} & _PERMANENT_429_CODES
    )


def is_retryable(exc: Exception) -> bool:
    if is_quota_error(exc):
        return False
    return isinstance(
        exc,
        openai.RateLimitError
        | openai.APITimeoutError
        | openai.APIConnectionError
        | openai.InternalServerError,
    )


def friendly_message(exc: Exception, provider: str = "OpenAI") -> str:
    """A short, user-facing explanation of a provider error (no raw payloads)."""
    if is_quota_error(exc):
        return (
            f"The {provider} account has run out of credits. Add credits in your "
            f"{provider} billing settings, then try again."
        )
    if isinstance(exc, openai.AuthenticationError):
        return f"The {provider} API key was rejected. Check the API key in .env."
    if isinstance(exc, openai.PermissionDeniedError):
        return f"The {provider} API key doesn't have access to this model."
    if isinstance(exc, openai.NotFoundError):
        return f"The configured {provider} model wasn't found. Check the model name in .env."
    if isinstance(exc, openai.RateLimitError):
        return f"{provider} is rate-limiting requests. Wait a moment and try again."
    if isinstance(exc, openai.APITimeoutError | openai.APIConnectionError):
        return f"Couldn't reach {provider}. Check the internet connection and try again."
    if isinstance(exc, openai.APIStatusError):
        return f"{provider} returned an error (HTTP {exc.status_code}). Try again later."
    return f"Unexpected error talking to {provider}."


def call_with_retries[T](fn: Callable[[], T], attempts: int = 4, base_delay: float = 1.0) -> T:
    """Call `fn`, retrying transient provider errors with exponential backoff (1s, 2s, 4s)."""
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            if attempt == attempts - 1 or not is_retryable(exc):
                raise
            time.sleep(base_delay * 2**attempt)
    raise AssertionError("unreachable")
