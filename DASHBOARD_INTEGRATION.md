# Dashboard–ChatGPT Integration

Date: 2026-08-15
Status: Implemented

## Overview

The active PySide6 Jarvis dashboard now presents the shared ChatGPT conversation brain as a persistent, non-blocking chat experience. The change is limited to `jarvis/dashboard.py` and dashboard integration tests. Existing WhatsApp and TikTok workflow code is unchanged.

The dashboard uses the same `Jarvis.process()` entry point as the CLI. That preserves deterministic command routing, structured ChatGPT tool intents, local Python execution, conversation memory and centralized request logging.

## Message flow

```text
User submits text
  -> Dashboard appends a timestamped user message
  -> input controls are disabled
  -> JarvisRequestThread starts
     -> status: Thinking
     -> status: Executing
     -> Jarvis.process(text)
        -> deterministic workflow, or ChatGPT conversation
        -> local memory persists completed conversation turns
     -> response_ready or request_failed signal
  -> main UI thread renders response/error
  -> status: Ready or Error
  -> input controls are restored
```

At startup, the dashboard reads recent user and assistant messages from `data/jarvis_memory.db` and renders them chronologically. The database remains the source of truth, so history survives application restarts.

## Threading model

- Qt widgets are created and updated only on the main UI thread.
- Every text request runs inside `JarvisRequestThread`, a `QThread` worker.
- ChatGPT network waits, retries and Python tool execution therefore do not block Qt event processing.
- Worker-to-UI communication uses Qt signals: `state_changed`, `response_ready` and `request_failed`.
- Only one request is accepted at a time. Text, send and voice controls are temporarily disabled to prevent overlapping state mutation.
- The FastAPI dashboard integration added in Prompt 3 separately uses `asyncio.to_thread`, so its event loop also remains non-blocking.

## UI changes

### Text conversation

- User and Jarvis messages appear as distinct chat cards.
- Each card includes a local timestamp in `YYYY-MM-DD HH:MM` format.
- New messages scroll into view automatically.
- Empty history shows a simple ready message.

### Persistent history

- Recent conversation turns are loaded from the existing Jarvis memory repository during backend connection.
- Invalid or unavailable history does not prevent dashboard startup.
- System rows are excluded from the user-facing transcript.

### Status indicator

The header and live-status panel expose four request states:

| State | Meaning |
|---|---|
| `Ready` | Backend is connected and input is available |
| `Thinking` | A request was accepted and queued in the worker |
| `Executing` | The background worker is processing the request |
| `Error` | Startup or request processing failed gracefully |

### Error handling

- Backend initialization failures leave the window open in an Error state.
- ChatGPT/API exceptions are logged with full technical context and request ID.
- The UI receives a safe message with a short correlation reference.
- Upstream exception text, credentials and raw payload details are not displayed.
- After a request failure, input controls are restored so the user can retry.

## Structured logging

Dashboard events use the centralized JSON logger and current request context. Added events include:

- `dashboard.request_started`
- `dashboard.state_changed`
- `dashboard.response_received`
- `dashboard.request_failed`
- `dashboard.request_recovered`
- `dashboard.history_loaded`
- `dashboard.history_failed`
- `dashboard.timestamp_invalid`

Logs continue to be written to `logs/jarvis.jsonl` with rotating-file limits.

## Testing results

Dashboard integration coverage is in `tests/test_dashboard_integration.py`:

- startup survives backend/API initialization failure
- background message send and response delivery
- API failure becomes a safe, user-friendly error
- persisted history and timestamps render correctly

The existing stability suite continues to cover dashboard construction, conversation, WhatsApp, TikTok, memory and voice behavior.

Commands:

```powershell
python -m unittest tests.test_dashboard_integration tests.test_stability_logging -v
python -m unittest discover -s tests -v
```

Focused verification: **13 tests passed**.

Final full-project verification: **44 tests passed**; syntax compilation and diff hygiene checks also passed.

## Limitations

- The dashboard accepts one active text or voice request at a time.
- Text responses are displayed after completion; token-by-token streaming is not implemented.
- `Executing` represents background request processing and does not expose individual backend sub-steps.
- Only the configured recent-history limit is rendered, not an unlimited transcript.
- A running synchronous network call is allowed to finish; this phase does not add hard cancellation inside the OpenAI HTTP transport.
- Automated UI tests run with Qt's offscreen platform and do not validate pixel-level appearance.
