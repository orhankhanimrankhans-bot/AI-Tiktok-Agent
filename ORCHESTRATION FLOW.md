# Jarvis Central Orchestration Flow

Date: 2026-08-15
Status: Implemented

## Overview

`jarvis/orchestrator.py` is the central request boundary for the desktop dashboard, text CLI and continuous voice interface. It coordinates conversation context, deterministic safety routes, ChatGPT structured intent, confidence gating, Python execution, persistence and final responses.

The runtime is deliberately single-agent today. Its `ExecutionPlan` and `OrchestrationStep.agent` fields provide a stable seam for a future dispatcher without enabling concurrent or autonomous agents now.

OpenAI's official guidance recommends the Responses API for multi-turn and tool-calling workflows and emphasizes explicit tool schemas and stopping limits: <https://developers.openai.com/api/docs/guides/latest-model>.

## Request diagram

```text
Dashboard / text CLI / continuous voice
                  |
                  v
        Jarvis.process(user input)
                  |
        request ID + structured log
                  |
                  v
       JarvisOrchestrator.handle()
                  |
        +---------+----------+
        |                    |
 active saved context?   no active context
        |                    |
        v                    v
 resolve local follow-up  deterministic guardrail route
        |                    |
        |                 no match
        |                    |
        |                    v
        |          ChatGPT Responses API
        |          text or function intent
        |                    |
        |            ToolRouter + confidence
        |                    |
        |          +---------+---------+
        |          |                   |
        |     confidence low      confidence sufficient
        |          |                   |
        |     clarification       ExecutionPlan
        |                              |
        |                   Python tool/workflow adapter
        |                              |
        +---------------+--------------+
                        |
               save conversation turn
                        |
               final response + logs
                        |
                     Dashboard
```

## Multi-turn WhatsApp example

```text
User: Basit ko message karo
  -> ChatGPT: start_whatsapp_message
       recipient="Basit", message=null, confidence=0.98
  -> ToolRouter accepts confidence
  -> existing MessagingManager resolves Basit
  -> context.active_contact = Basit
  -> context.awaiting_message_text = true
  -> Jarvis: Basit ko kya message karun?

User: Main aa raha hoon.
  -> orchestrator sees awaiting_message_text
  -> existing MessagingManager binds text to Basit
  -> existing WhatsApp adapter prepares and sends
  -> real adapter result becomes the response
  -> context is cleared and both turns remain in memory
```

Active follow-up context is resolved locally rather than asking the model to guess the recipient again. This prevents recipient drift between turns.

## Components

### Conversation context

`ConversationContext` snapshots:

- pending contact selection
- whether message text is awaited
- active contact display name

Recent ordinary conversation remains in the existing SQLite memory and is supplied to ChatGPT by `JarvisConversation`.

### ChatGPT intent detection

The Responses API can return normal text or one allow-listed function call. Every function schema now requires a `confidence` value from `0.0` to `1.0`.

Supported orchestration intents include:

- existing desktop tools (`open_application`, `open_path`, and others)
- `start_whatsapp_message`, delegated to the existing messaging workflow
- `request_clarification`, which never executes a side effect

The configurable threshold is:

```dotenv
JARVIS_INTENT_CONFIDENCE_THRESHOLD=0.65
```

Below the threshold, ToolRouter asks for clarification and does not invoke Python tools.

### Deterministic guardrails

Existing high-confidence and safety-sensitive local routes remain available before model routing, including active workflow continuations, exit handling, explicit confirmations, status queries and known commands. They are coordinated and logged by the same orchestrator but do not depend on network availability.

### Tool Router

`ToolRouter` converts a validated `ToolCall` into an immutable `ExecutionPlan`. It:

- removes orchestration metadata before Python invocation
- clamps malformed confidence values safely
- rejects unknown tools
- converts low confidence into clarification
- separates internal workflows from generic tools

### Python execution

Only existing registered tools or explicitly handled workflows execute. ChatGPT cannot run arbitrary Python or shell commands. Tool success/failure messages come from the real Python adapter.

### Future multi-agent seam

```text
ExecutionPlan
  strategy = single_agent_sequential
  steps[]
    agent = primary
    kind = tool | workflow | clarification
    name
    arguments
    confidence
```

A future dispatcher may map steps to named agents. This release always executes one step sequentially and does not spawn agents.

## Error recovery

- ChatGPT/API failure returns the existing friendly conversation failure message.
- Unknown or low-confidence intent becomes clarification.
- Tool exceptions are logged and converted to a safe action-failure response.
- Tool-returned failure remains a normal adapter result and is logged as unsuccessful.
- Request IDs flow through orchestration, tool execution and final response logs.
- Sensitive exception text is not included in user-facing responses.

## Structured logging

Important events include:

- `orchestration.started`
- `orchestration.intent_detected`
- `orchestration.intent_failed`
- `orchestration.execution_failed`
- `orchestration.completed`

Fields include input, context snapshot, selected intent, confidence, strategy, success and response length.

## Integration notes

- `jarvis.main.Jarvis` constructs one `JarvisOrchestrator` and delegates requests to it.
- PySide6 dashboard text requests already call `Jarvis.process()` in a background thread.
- Continuous voice transcripts already call the same `Jarvis.process()` method.
- The FastAPI dashboard endpoint already delegates to the desktop Jarvis instance via `asyncio.to_thread`.
- Existing WhatsApp UI automation and TikTok pipeline/publishing implementations are not replaced.
- Conversation persistence continues to use `jarvis_memory.db`.

## Automated tests

`tests/test_orchestration.py` covers:

- complete two-turn WhatsApp conversation flow
- high-confidence tool invocation
- low-confidence clarification without execution
- execution exception recovery
- structured orchestration logging

Existing suites continue to cover ChatGPT transport, dashboard, voice, WhatsApp, TikTok, memory and tool safety.

Run:

```powershell
python -m unittest tests.test_orchestration tests.test_chatgpt_integration tests.test_stability_logging -v
python -m unittest discover -s tests -v
```

Focused verification: **20 tests passed**.

Final full-project verification: **54 tests passed**; syntax compilation and diff hygiene checks also passed.

## Current limitations

- One model-selected function is processed per turn.
- Execution is single-agent and sequential.
- Confidence is model-reported and therefore treated as a routing signal, not a calibrated probability.
- Conversation transcripts and unfinished WhatsApp tasks are persisted; restart recovery is covered by the WhatsApp integration regression tests.
- Tool output is returned directly without a second model summarization call.
- Deterministic guardrails intentionally bypass model intent detection when a safe workflow state or explicit local command already determines the action.
