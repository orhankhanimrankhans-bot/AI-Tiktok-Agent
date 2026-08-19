# ChatGPT Integration — Jarvis Conversation Brain

Date: 2026-08-15
Status: Implemented

## Architecture overview

ChatGPT is now the primary conversation engine for the desktop and dashboard Jarvis interfaces. The integration is intentionally limited to conversation and structured intent selection.

```text
PySide6 dashboard / CLI / FastAPI dashboard
  -> jarvis.main.Jarvis.process()
     -> existing deterministic WhatsApp, TikTok and desktop routes
     -> ordinary conversation
        -> jarvis.conversation.JarvisConversation
        -> local SQLite conversation history
        -> jarvis.llm_client.OpenAIResponsesClient
        -> OpenAI Responses API
           -> text response, or allow-listed function intent
        -> existing jarvis.tools Python registry executes function intent
        -> user + final assistant/tool result saved in local memory
```

The TikTok pipeline provider in `app/config.py`, WhatsApp adapters, publishing code, memory schema and existing automations were not replaced. OpenAI's official guidance recommends the Responses API for multi-turn and tool-calling workflows: <https://developers.openai.com/api/docs/guides/latest-model>.

## Request flow

1. `Jarvis.process()` assigns/uses the correlated request ID and logs the input.
2. Existing deterministic routes run first. This preserves current WhatsApp, TikTok and known desktop command behavior.
3. Ordinary conversation is sent to `JarvisConversation.respond()`.
4. Recent `jarvis_memory.db` user/assistant turns are added in chronological order, followed by the current turn.
5. `OpenAIResponsesClient` sends the configured system prompt, history, model and allow-listed function schemas to `/v1/responses`.
6. A text response is saved and returned. A function call is validated and handed to `jarvis.tools`; Python executes it and its real result is saved and returned.
7. The FastAPI `/api/agent/respond` endpoint uses the same `Jarvis.process()` path in a worker thread, so API latency does not block the event loop.

Only these desktop functions are exposed to ChatGPT:

- `open_application`
- `open_path`
- `open_project_in_vscode`
- `open_website`
- `list_project_files`

ChatGPT cannot execute arbitrary Python, shell commands, WhatsApp sends or TikTok publishing through the function interface.

## Configuration

Put secrets in `.env` at the project root. Do not commit `.env`.

```dotenv
OPENAI_API_KEY=your_api_key_here
JARVIS_OPENAI_MODEL=gpt-5.6-luna
JARVIS_OPENAI_TIMEOUT=45
JARVIS_OPENAI_MAX_RETRIES=2
```

Optional system-prompt configuration:

```dotenv
# Short inline override
JARVIS_SYSTEM_PROMPT=You are Jarvis. Respond clearly.

# Or a UTF-8 file path, relative to the project root or absolute
JARVIS_SYSTEM_PROMPT_FILE=config/jarvis_system_prompt.txt
```

If both prompt variables are set, `JARVIS_SYSTEM_PROMPT` takes precedence. If neither is set, the safe multilingual Jarvis default is used.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | none | OpenAI API authentication; required for live conversation |
| `JARVIS_OPENAI_MODEL` | `gpt-5.6-luna` | Responses API model |
| `JARVIS_OPENAI_TIMEOUT` | `45` | Per-attempt timeout in seconds |
| `JARVIS_OPENAI_MAX_RETRIES` | `2` | Retries after the initial attempt for transient failures |
| `JARVIS_SYSTEM_PROMPT` | empty | Inline system prompt override |
| `JARVIS_SYSTEM_PROMPT_FILE` | empty | UTF-8 prompt file path |
| `DASHBOARD_AI_PROVIDER` | `openai` | Dashboard status metadata; conversation always uses the shared Jarvis brain |

## Failure behavior

- HTTP 401/403: classified as authentication failure and not retried.
- HTTP 429: exponential bounded retry, then a rate-limit message.
- HTTP 5xx: bounded retry, then a network/service error.
- Socket or request timeout: bounded retry, then a timeout message.
- Network/DNS failure: bounded retry, then a network message.
- Invalid JSON, missing output, empty output or malformed function arguments: rejected as an invalid response.

Failures are written to centralized structured logs with the current request ID. API keys and authorization headers are not logged.

## Automated tests

Run:

```powershell
python -m unittest tests.test_chatgpt_integration -v
python -m unittest discover -s tests -v
```

Coverage includes:

- successful Responses API call and payload construction
- timeout retry and final classification
- failed authentication without retry
- chronological conversation history and current-turn inclusion
- structured tool-intent parsing
- execution through the Python allow-listed registry
- prior dashboard, conversation, WhatsApp, TikTok, memory and voice regressions

Test transports are mocked. The suite does not consume API credits or require a live OpenAI key.

Final verification on 2026-08-15: **40 tests passed**; Python syntax compilation also passed.

## Limitations

- Conversation state is replayed from local SQLite rather than using server-side stored responses (`store` is false).
- Only one structured tool call is executed per user request; additional calls are ignored deliberately to keep action scope bounded.
- The dashboard's previous `live_search` flag is not exposed to ChatGPT in this phase.
- Tool results are returned directly; a second model call does not rewrite or summarize them.
- Model access and rate limits depend on the user's OpenAI account and project permissions.
- No live API smoke test is performed by the automated suite.
