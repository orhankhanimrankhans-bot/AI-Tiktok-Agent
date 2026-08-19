"""OpenAI Responses API client for Jarvis conversation and tool intent."""

from __future__ import annotations

import json
import logging
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from observability import get_logger, log_event

logger = get_logger("openai.client")


class LLMError(RuntimeError):
    """Base error exposed by the Jarvis LLM boundary."""


class LLMAuthenticationError(LLMError):
    pass


class LLMRateLimitError(LLMError):
    pass


class LLMTimeoutError(LLMError):
    pass


class LLMNetworkError(LLMError):
    pass


class LLMInvalidResponseError(LLMError):
    pass


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    call_id: str = ""


@dataclass(frozen=True)
class LLMResponse:
    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    response_id: str = ""


class OpenAIResponsesClient:
    """Small dependency-free client with bounded retries and strict parsing."""

    endpoint = "https://api.openai.com/v1/responses"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout: float = 45.0,
        max_retries: int = 2,
        urlopen: Callable[..., Any] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.timeout = timeout
        self.max_retries = max(0, max_retries)
        self._urlopen = urlopen or urllib.request.urlopen
        self._sleep = sleep

    def create_response(
        self,
        *,
        messages: Iterable[dict[str, str]],
        system_prompt: str,
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        if not self.api_key:
            raise LLMAuthenticationError("OPENAI_API_KEY is not configured.")
        if not self.model:
            raise LLMError("JARVIS_OPENAI_MODEL is not configured.")

        payload: dict[str, Any] = {
            "model": self.model,
            "instructions": system_prompt,
            "input": list(messages),
            "store": False,
        }

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        for attempt in range(self.max_retries + 1):
            try:
                log_event(
                    logger,
                    logging.INFO,
                    "execution.started",
                    "OpenAI response request started",
                    module_selection="openai",
                    model=self.model,
                    attempt=attempt + 1,
                )

                with self._urlopen(request, timeout=self.timeout) as response:
                    raw = response.read().decode("utf-8")

                result = self._parse_response(raw)

                log_event(
                    logger,
                    logging.INFO,
                    "execution.completed",
                    "OpenAI response request completed",
                    module_selection="openai",
                    model=self.model,
                    success=True,
                    response_id=result.response_id,
                    tool_calls=len(result.tool_calls),
                )
                return result

            except urllib.error.HTTPError as error:
                if error.code in {401, 403}:
                    raise LLMAuthenticationError(
                        "OpenAI authentication failed."
                    ) from error

                if error.code == 429:
                    error_type = ""
                    error_code = ""
                    error_message = ""

                    try:
                        error_body = error.read().decode(
                            "utf-8",
                            errors="replace",
                        )
                        error_payload = json.loads(error_body)
                        api_error = error_payload.get("error", {})
                        error_type = str(api_error.get("type", ""))
                        error_code = str(api_error.get("code", ""))
                        error_message = str(api_error.get("message", ""))
                    except Exception:
                        pass

                    print(
                        "[Jarvis OpenAI 429] "
                        f"type={error_type} | "
                        f"code={error_code} | "
                        f"message={error_message}"
                    )

                    non_retryable_codes = {
                        "insufficient_quota",
                        "billing_hard_limit_reached",
                    }

                    if error_code in non_retryable_codes:
                        raise LLMRateLimitError(
                            f"OpenAI API quota/billing problem: "
                            f"{error_message or error_code}"
                        ) from error

                    if attempt < self.max_retries:
                        retry_after = error.headers.get("Retry-After")
                        if retry_after:
                            try:
                                delay = max(0.0, float(retry_after))
                            except ValueError:
                                delay = min(2 ** attempt, 4)
                        else:
                            delay = min(2 ** attempt, 4)

                        log_event(
                            logger,
                            logging.WARNING,
                            "execution.retry",
                            "OpenAI request will retry",
                            module_selection="openai",
                            reason="rate_limit",
                            retry_in_seconds=delay,
                        )
                        self._sleep(delay)
                        continue

                    raise LLMRateLimitError(
                        error_message
                        or "OpenAI temporary rate limit was exceeded."
                    ) from error

                if error.code >= 500 and attempt < self.max_retries:
                    self._retry(attempt, "server_error")
                    continue

                raise LLMNetworkError(
                    f"OpenAI request failed with HTTP {error.code}."
                ) from error

            except (TimeoutError, socket.timeout) as error:
                if attempt < self.max_retries:
                    self._retry(attempt, "timeout")
                    continue
                raise LLMTimeoutError(
                    f"OpenAI request timed out after {self.timeout:g} seconds."
                ) from error

            except urllib.error.URLError as error:
                if attempt < self.max_retries:
                    self._retry(attempt, "network")
                    continue
                raise LLMNetworkError(
                    "OpenAI network connection failed."
                ) from error

        raise LLMNetworkError("OpenAI request failed.")

    def _retry(self, attempt: int, reason: str) -> None:
        delay = min(2 ** attempt, 4)
        log_event(
            logger,
            logging.WARNING,
            "execution.retry",
            "OpenAI request will retry",
            module_selection="openai",
            reason=reason,
            retry_in_seconds=delay,
        )
        self._sleep(delay)

    @staticmethod
    def _parse_response(raw: str) -> LLMResponse:
        try:
            payload = json.loads(raw)
            output = payload["output"]
            if not isinstance(output, list):
                raise TypeError("output is not a list")
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise LLMInvalidResponseError(
                "OpenAI returned an invalid response payload."
            ) from error

        texts: list[str] = []
        calls: list[ToolCall] = []

        for item in output:
            if not isinstance(item, dict):
                continue

            if item.get("type") == "function_call":
                try:
                    arguments = json.loads(item.get("arguments") or "{}")
                except json.JSONDecodeError as error:
                    raise LLMInvalidResponseError(
                        "OpenAI returned invalid tool arguments."
                    ) from error

                if not isinstance(arguments, dict) or not item.get("name"):
                    raise LLMInvalidResponseError(
                        "OpenAI returned an invalid tool call."
                    )

                calls.append(
                    ToolCall(
                        str(item["name"]),
                        arguments,
                        str(item.get("call_id", "")),
                    )
                )

            elif item.get("type") == "message":
                for content in item.get("content", []):
                    if (
                        isinstance(content, dict)
                        and content.get("type") == "output_text"
                    ):
                        text = str(content.get("text", "")).strip()
                        if text:
                            texts.append(text)

        text = "\n".join(texts).strip()

        if not text and not calls:
            raise LLMInvalidResponseError(
                "OpenAI returned neither text nor a tool call."
            )

        return LLMResponse(
            text=text,
            tool_calls=tuple(calls),
            response_id=str(payload.get("id", "")),
        )


def _tool(
    name: str,
    description: str,
    properties: dict[str, Any],
    required: list[str],
) -> dict[str, Any]:
    properties = {
        **properties,
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": (
                "Confidence that this function matches "
                "the user's current intent."
            ),
        },
    }

    return {
        "type": "function",
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": [*required, "confidence"],
            "additionalProperties": False,
        },
        "strict": True,
    }


DESKTOP_TOOL_DEFINITIONS = [
    _tool(
        "open_application",
        "Open one registered desktop application.",
        {"application": {"type": "string"}},
        ["application"],
    ),
    _tool(
        "open_path",
        "Open an existing local file or folder path.",
        {"path": {"type": "string"}},
        ["path"],
    ),
    _tool(
        "open_project_in_vscode",
        "Open the current project in Visual Studio Code.",
        {"path": {"type": ["string", "null"]}},
        ["path"],
    ),
    _tool(
        "open_website",
        "Open a website URL in the default browser.",
        {"url": {"type": "string"}},
        ["url"],
    ),
    _tool(
        "list_project_files",
        "List top-level project files and folders.",
        {
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
            }
        },
        ["limit"],
    ),
    _tool(
        "start_whatsapp_message",
        (
            "Start a WhatsApp message workflow for a named contact. "
            "Python will resolve the contact and execute the existing workflow."
        ),
        {
            "recipient": {"type": "string"},
            "message": {"type": ["string", "null"]},
        },
        ["recipient", "message"],
    ),
    _tool(
        "request_clarification",
        (
            "Ask one concise question when the user's intended action "
            "is ambiguous or confidence is low."
        ),
        {"question": {"type": "string"}},
        ["question"],
    ),
]