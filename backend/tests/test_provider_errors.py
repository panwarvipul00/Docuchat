from unittest import mock

import httpx
import openai
import pytest

from services.provider_errors import (
    PATIENT_RETRIES,
    call_with_retries,
    friendly_message,
    is_retryable,
)

REQUEST = httpx.Request("POST", "https://api.openai.com/v1/embeddings")


def status_error(cls, status: int, code: str | None = None, type_: str | None = None):
    # The SDK passes the inner {"error": {...}} object as `body`.
    body = {"message": "raw provider text", "code": code, "type": type_}
    return cls("raw provider text", response=httpx.Response(status, request=REQUEST), body=body)


# The exact shape OpenAI returns for an account with no credits.
NO_CREDITS = status_error(
    openai.RateLimitError, 429, code="credit_balance_exhausted", type_="insufficient_quota"
)
RATE_LIMITED = status_error(openai.RateLimitError, 429, code="rate_limit_exceeded")
BAD_KEY = status_error(openai.AuthenticationError, 401, code="invalid_api_key")
SERVER_ERROR = status_error(openai.InternalServerError, 500)


def gemini_429(quota_id: str, retry_delay: str):
    """Gemini's real 429 shape: the error object wrapped in a list."""
    body = [
        {
            "error": {
                "code": 429,
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                        "violations": [{"quotaId": quota_id, "quotaValue": "20"}],
                    },
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": retry_delay,
                    },
                ],
            }
        }
    ]
    return openai.RateLimitError(
        "Error code: 429", response=httpx.Response(429, request=REQUEST), body=body
    )


GEMINI_DAILY = gemini_429("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "16362s")
GEMINI_MINUTE = gemini_429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "21s")


def test_no_credits_is_permanent_and_explained():
    assert not is_retryable(NO_CREDITS)
    msg = friendly_message(NO_CREDITS)
    assert "run out of credits" in msg
    assert "raw provider text" not in msg


@pytest.mark.parametrize(
    "exc,expected",
    [
        (BAD_KEY, "API key was rejected"),
        (RATE_LIMITED, "rate-limiting"),
        (SERVER_ERROR, "HTTP 500"),
        (openai.APIConnectionError(request=REQUEST), "Couldn't reach OpenAI"),
    ],
)
def test_friendly_messages(exc, expected):
    assert expected in friendly_message(exc)


def test_retryability():
    assert is_retryable(RATE_LIMITED)
    assert is_retryable(SERVER_ERROR)
    assert not is_retryable(BAD_KEY)
    assert not is_retryable(ValueError("bug"))


def test_permanent_errors_fail_immediately():
    fn = mock.Mock(side_effect=NO_CREDITS)
    with mock.patch("services.provider_errors.time.sleep") as sleep:
        with pytest.raises(openai.RateLimitError):
            call_with_retries(fn)
    assert fn.call_count == 1
    sleep.assert_not_called()


def test_transient_errors_retry_with_backoff_then_succeed():
    fn = mock.Mock(side_effect=[RATE_LIMITED, SERVER_ERROR, "ok"])
    with mock.patch("services.provider_errors.time.sleep") as sleep:
        assert call_with_retries(fn) == "ok"
    assert [c.args[0] for c in sleep.call_args_list] == [1.0, 2.0]


def test_gives_up_after_max_attempts():
    fn = mock.Mock(side_effect=RATE_LIMITED)
    with mock.patch("services.provider_errors.time.sleep"):
        with pytest.raises(openai.RateLimitError):
            call_with_retries(fn, attempts=3)
    assert fn.call_count == 3


def test_patient_retries_outlast_a_one_minute_rate_limit():
    fn = mock.Mock(side_effect=RATE_LIMITED)
    with mock.patch("services.provider_errors.time.sleep") as sleep:
        with pytest.raises(openai.RateLimitError):
            call_with_retries(fn, **PATIENT_RETRIES)
    waits = [c.args[0] for c in sleep.call_args_list]
    assert waits == [2.0, 4.0, 8.0, 16.0, 30.0, 30.0]  # capped at 30s each
    assert sum(waits) > 60


def test_ingestion_embeds_patiently_but_questions_do_not(settings):
    from services import embeddings

    with mock.patch.object(
        embeddings.FakeEmbeddingProvider, "embed", autospec=True, return_value=[[0.0] * 1536]
    ) as embed:
        embeddings.embed_texts(["question"])
        embeddings.embed_texts(["chunk"], patient=True)
    assert [c.kwargs["patient"] for c in embed.call_args_list] == [False, True]


def test_gemini_providers_require_gemini_key(settings):
    from services.embeddings import EmbeddingError, get_embedding_provider
    from services.llm import LLMError, get_llm_provider

    settings.EMBEDDING_PROVIDER = settings.LLM_PROVIDER = "gemini"
    settings.GEMINI_API_KEY = ""
    get_embedding_provider.cache_clear()
    get_llm_provider.cache_clear()
    with pytest.raises(EmbeddingError, match="GEMINI_API_KEY"):
        get_embedding_provider()
    with pytest.raises(LLMError, match="GEMINI_API_KEY"):
        get_llm_provider()


def test_gemini_daily_limit_is_not_retried_and_says_when_it_resets():
    assert not is_retryable(GEMINI_DAILY)
    msg = friendly_message(GEMINI_DAILY, "Gemini")
    assert "daily limit" in msg and "4h 33m" in msg
    fn = mock.Mock(side_effect=GEMINI_DAILY)
    with mock.patch("services.provider_errors.time.sleep") as sleep:
        with pytest.raises(openai.RateLimitError):
            call_with_retries(fn, **PATIENT_RETRIES)
    assert fn.call_count == 1
    sleep.assert_not_called()


def test_gemini_per_minute_limit_waits_as_long_as_asked():
    assert is_retryable(GEMINI_MINUTE)
    assert "Try again in about 21 seconds" in friendly_message(GEMINI_MINUTE, "Gemini")
    fn = mock.Mock(side_effect=[GEMINI_MINUTE, "ok"])
    with mock.patch("services.provider_errors.time.sleep") as sleep:
        assert call_with_retries(fn, **PATIENT_RETRIES) == "ok"
    assert [c.args[0] for c in sleep.call_args_list] == [21.0]
