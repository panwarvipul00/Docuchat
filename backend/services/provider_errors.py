"""Shared retry + error-message handling for OpenAI-compatible APIs.

The OpenAI SDK's built-in retries treat every 429 the same, so an account with
no credits ("insufficient_quota", which will never succeed on retry) was
retried for ~20s before failing. We disable SDK retries and retry here only on
errors that can actually succeed later: rate limits, timeouts, connection
problems and 5xx responses.
"""

import re
import time
from collections.abc import Callable

import openai

# Gemini and Groq expose OpenAI-compatible APIs, so one SDK covers all three.
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Error codes on a 429 that mean "fix your account", not "slow down".
_PERMANENT_429_CODES = {"insufficient_quota", "credit_balance_exhausted"}


# Gemini puts the details in google.rpc objects inside the body, e.g.
#   QuotaFailure.violations[].quotaId = "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
#   RetryInfo.retryDelay = "16362s"
# Its body is also wrapped in a list, so the SDK can't lift `code` out of it;
# matching on the text is the robust way to read both shapes.
_RETRY_DELAY_RE = re.compile(r"retryDelay['\"]?\s*:\s*['\"](\d+(?:\.\d+)?)s")
# A wait longer than this isn't worth retrying in-process: report it instead.
_MAX_USEFUL_WAIT = 60.0


def _error_text(exc: Exception) -> str:
    return f"{exc} {getattr(exc, 'body', '')}"


def is_quota_error(exc: Exception) -> bool:
    # The SDK lifts `code` and `type` out of the {"error": {...}} response body.
    return isinstance(exc, openai.RateLimitError) and bool(
        {exc.code, exc.type} & _PERMANENT_429_CODES
    )


def is_daily_limit(exc: Exception) -> bool:
    """A per-day quota (e.g. Gemini's free tier): retrying today won't help."""
    return isinstance(exc, openai.RateLimitError) and "PerDay" in _error_text(exc)


def retry_after(exc: Exception) -> float | None:
    """Seconds the provider asked us to wait, if it said."""
    match = _RETRY_DELAY_RE.search(_error_text(exc))
    return float(match[1]) if match else None


def _duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    if minutes < 1:
        return f"{max(1, round(seconds))} seconds"
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    return f"{minutes // 60}h {minutes % 60}m"


def is_retryable(exc: Exception) -> bool:
    if is_quota_error(exc) or is_daily_limit(exc):
        return False
    wait = retry_after(exc)
    if wait is not None and wait > _MAX_USEFUL_WAIT:
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
    if is_daily_limit(exc):
        wait = retry_after(exc)
        when = f" It resets in about {_duration(wait)}." if wait else " It resets daily."
        return (
            f"The free {provider} daily limit for this model is used up.{when} To continue "
            "now, set a different LLM_PROVIDER/LLM_MODEL (e.g. Groq) or a paid key in .env."
        )
    if isinstance(exc, openai.RateLimitError):
        wait = retry_after(exc)
        if wait:
            return f"{provider} is rate-limiting requests. Try again in about {_duration(wait)}."
        return f"{provider} is rate-limiting requests. Wait a moment and try again."
    if isinstance(exc, openai.APITimeoutError | openai.APIConnectionError):
        return f"Couldn't reach {provider}. Check the internet connection and try again."
    if isinstance(exc, openai.APIStatusError):
        return f"{provider} returned an error (HTTP {exc.status_code}). Try again later."
    return f"Unexpected error talking to {provider}."


# For background work that can afford to wait out a per-minute rate limit:
# 2, 4, 8, 16, 30, 30s = ~90s, longer than a one-minute quota window.
PATIENT_RETRIES = {"attempts": 7, "base_delay": 2.0, "max_delay": 30.0}


def call_with_retries[T](
    fn: Callable[[], T], attempts: int = 4, base_delay: float = 1.0, max_delay: float = 30.0
) -> T:
    """Call `fn`, retrying transient provider errors with exponential backoff.

    The default (1s, 2s, 4s) suits interactive requests, where a user is
    waiting; pass PATIENT_RETRIES for background jobs.
    """
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            if attempt == attempts - 1 or not is_retryable(exc):
                raise
            # Wait at least as long as the provider asked, within our cap.
            backoff = max(base_delay * 2**attempt, retry_after(exc) or 0)
            time.sleep(min(backoff, max_delay))
    raise AssertionError("unreachable")
