"""LLM provider wrapper with streaming.

All chat-completion calls go through `get_llm_provider()`. Providers yield a
stream of `TextDelta` events followed by at most one `Usage` event, so callers
never deal with a vendor's response format.
"""

import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Protocol

from django.conf import settings

from services.provider_errors import (
    GEMINI_BASE_URL,
    GROQ_BASE_URL,
    call_with_retries,
    friendly_message,
)

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class Usage:
    prompt_tokens: int
    completion_tokens: int

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens


StreamEvent = TextDelta | Usage


class LLMError(Exception):
    pass


class LLMProvider(Protocol):
    def stream_chat(self, messages: Sequence[ChatMessage]) -> Iterator[StreamEvent]: ...


class OpenAICompatibleProvider:
    """OpenAI's Chat Completions API. Also serves Gemini and Groq, which expose
    OpenAI-compatible endpoints, by pointing the same SDK at a different base URL."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        include_usage: bool = True,
        provider_name: str = "OpenAI",
        key_name: str = "OPENAI_API_KEY",
    ) -> None:
        if not api_key:
            raise LLMError(f"{key_name} is not set. Add it to .env.")
        from openai import OpenAI

        # Retries are handled by call_with_retries, which skips permanent errors.
        self._client = OpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=120)
        self.model = model
        self.include_usage = include_usage
        self.provider_name = provider_name

    def stream_chat(self, messages: Sequence[ChatMessage]) -> Iterator[StreamEvent]:
        kwargs = {}
        if self.include_usage:
            # Ask for a final chunk carrying token counts (for tokens_used).
            kwargs["stream_options"] = {"include_usage": True}
        try:
            # Only opening the stream is retried; once tokens have been sent to
            # the client, a retry would duplicate text.
            stream = call_with_retries(
                lambda: self._client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": m.role, "content": m.content} for m in messages],
                    stream=True,
                    # Low temperature: we want faithful extraction from the
                    # context, not creative writing.
                    temperature=0.1,
                    **kwargs,
                )
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield TextDelta(chunk.choices[0].delta.content)
                if getattr(chunk, "usage", None):
                    yield Usage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
        except Exception as exc:
            raise LLMError(friendly_message(exc, self.provider_name)) from exc


class FakeLLMProvider:
    """Offline, deterministic provider for tests and keyless local runs.

    Answers by quoting the first sentence of context source [1], cited, so the
    whole streaming + citation path can be exercised without an API key.
    """

    NOT_FOUND = "I couldn't find this in your documents."

    def stream_chat(self, messages: Sequence[ChatMessage]) -> Iterator[StreamEvent]:
        prompt = messages[-1].content
        match = re.search(r"^\[1\][^\n]*\n(.+?)(?:[.!?](?:\s|$)|\n)", prompt, re.MULTILINE)
        answer = (
            f"According to your documents, {match.group(1).strip()}. [1]"
            if match
            else self.NOT_FOUND
        )
        for word in answer.split(" "):
            yield TextDelta(word + " ")
        prompt_tokens = sum(len(m.content.split()) for m in messages)
        yield Usage(prompt_tokens, len(answer.split()))


@lru_cache(maxsize=1)
def get_llm_provider() -> LLMProvider:
    name = settings.LLM_PROVIDER
    if name == "openai":
        return OpenAICompatibleProvider(settings.OPENAI_API_KEY, settings.LLM_MODEL)
    if name == "gemini":
        return OpenAICompatibleProvider(
            settings.GEMINI_API_KEY,
            settings.LLM_MODEL,
            base_url=GEMINI_BASE_URL,
            # Without usage data, tokens_used is estimated with tiktoken (see rag.py).
            include_usage=False,
            provider_name="Gemini",
            key_name="GEMINI_API_KEY",
        )
    if name == "groq":
        return OpenAICompatibleProvider(
            settings.GROQ_API_KEY,
            settings.LLM_MODEL,
            base_url=GROQ_BASE_URL,
            include_usage=False,
            provider_name="Groq",
            key_name="GROQ_API_KEY",
        )
    if name == "fake":
        return FakeLLMProvider()
    raise LLMError(f"Unknown LLM_PROVIDER: {name!r}")
