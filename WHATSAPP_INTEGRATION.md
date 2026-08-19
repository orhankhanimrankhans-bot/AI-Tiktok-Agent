# WhatsApp AI Workflow Integration

Date: 2026-08-15
Status: Implemented

## Overview

The existing semantic WhatsApp Desktop automation is now integrated with the ChatGPT conversation brain, central Intent Router and persistent Jarvis memory.

ChatGPT identifies intent only. It cannot send a message. Contact resolution, draft preparation, confirmation and sending remain Python-controlled operations with exact recipient/composer verification.

OpenAI's official guidance recommends explicit confirmation before external side effects and direct tool calling when an action requires approval: <https://developers.openai.com/api/docs/guides/latest-model>.

## Safety boundary

```text
ChatGPT may:
  - identify start_whatsapp_message intent
  - provide recipient/message candidates
  - provide intent confidence

ChatGPT may not:
  - resolve the final contact itself
  - click WhatsApp controls
  - prepare or alter the desktop draft
  - confirm on the user's behalf
  - send a message

Python must:
  - resolve contact against local contacts
  - ask clarification for ambiguous contacts
  - prepare and verify the exact draft
  - persist pending state
  - require explicit confirmation
  - re-verify recipient and draft
  - invoke Send once
  - report the real adapter result
```

## Message flow

```text
User request
  -> JarvisOrchestrator
  -> ChatGPT start_whatsapp_message intent + confidence
  -> Python MessagingManager resolves local contact
       -> not found: ask for another name
       -> ambiguous: ask which contact
       -> resolved: save awaiting_message state
  -> ask: "Basit ko kya message karun?"

User provides message
  -> pending context binds text to resolved contact
  -> WhatsAppAdapter.prepare_message()
       -> validate phone
       -> open exact chat
       -> verify exact recipient composer
       -> replace and verify exact draft
  -> save awaiting_confirmation state
  -> ask: "Draft ready ... send karun?"

User confirms
  -> Python parses confirm/cancel locally
  -> re-run prepare_message() to verify after delays/restart
  -> WhatsAppAdapter.send_prepared_message()
  -> clear persistent pending task
  -> return real success/failure
```

## Multi-turn states

| State | Persisted status | Meaning |
|---|---|---|
| No task | no row | No pending WhatsApp action |
| Awaiting message | `awaiting_message` | Contact is resolved; message text is required |
| Awaiting confirmation | `awaiting_confirmation` | Exact draft is prepared; explicit approval is required |
| Completed/cancelled | row deleted | Workflow cannot send again without a new request |

Accepted confirmation examples include `send`, `send karo`, `bhej do`, `haan`, and Urdu equivalents. Cancellation includes `cancel`, `mat bhejo`, `nahi`, and Urdu equivalents. Anything else produces a clarification prompt and leaves the draft pending.

## Persistence and restart recovery

`jarvis.memory` adds a generic `pending_tasks` table:

```text
kind | status | payload | updated_at
```

For WhatsApp, payload stores only the local contact ID and pending message text. On process restart:

1. `MessagingManager` reads `whatsapp_message` pending state.
2. The contact ID is resolved again against current local contacts.
3. Awaiting-message or awaiting-confirmation state is restored.
4. A confirmed restored draft is prepared and semantically verified again before Send.
5. Missing/deleted contacts invalidate and clear stale pending state.

## Duplicate prevention

- A successful send clears both adapter prepared state and persistent workflow state.
- A second confirmation has no pending context and cannot invoke Send again.
- The existing semantic adapter still deduplicates UI Automation representations of the physical Send button.
- Only one confirmation branch calls `send_prepared_message()`.

## Error recovery

- Contact not found/ambiguous: user receives a clarification; nothing is prepared.
- Draft preparation failure: workflow state is cleared and nothing is sent.
- Unclear confirmation: draft remains pending.
- Restart before confirmation: pending task is restored and re-verified.
- Send verification failure: real adapter failure is returned and logged.
- Exceptions are recorded with request IDs without exposing secrets in dashboard messages.

## Dashboard progress

The existing Live Status panel now mirrors the semantic workflow:

- `None`
- `Awaiting message`
- `Awaiting confirm`
- `Completed`

The dashboard observes messaging state only; it does not execute WhatsApp actions. Network/UI automation continues in background request threads, so the dashboard remains responsive.

## Structured logging

Relevant events include:

- `memory.pending_task_saved`
- `memory.pending_task_cleared`
- `memory.pending_task_invalid`
- `whatsapp.draft_ready`
- `whatsapp.draft_failed`
- `whatsapp.cancelled`
- `whatsapp.send_completed`
- `dashboard.whatsapp_progress`
- existing adapter preparation/send verification events

## Automated tests

`tests/test_whatsapp_integration.py` covers:

- ChatGPT intent followed by Python contact resolution
- exact draft preparation without premature send
- explicit confirmation flow
- duplicate confirmation prevention
- pending confirmation recovery after restart

Dashboard progress is covered by `tests/test_dashboard_integration.py`. Existing tests continue to cover contact ambiguity, duplicate UI send protection, orchestration, ChatGPT, memory, voice and TikTok regressions.

Run:

```powershell
python -m unittest tests.test_whatsapp_integration tests.test_orchestration tests.test_stability_logging -v
python -m unittest discover -s tests -v
```

Focused verification: **18 tests passed**.

Final full-project verification: **59 tests passed**; syntax compilation and diff hygiene checks also passed.

## Integration notes

- `start_whatsapp_message` remains an allow-listed ChatGPT intent schema.
- `JarvisOrchestrator` handles the workflow state machine.
- `MessagingManager` owns multi-turn context and persistence.
- `JarvisMemory` owns pending-task storage.
- `WhatsAppAdapter` remains the sole desktop prepare/send implementation.
- No TikTok pipeline or publishing code was changed.

## Limitations

- Only one pending WhatsApp message task is stored at a time.
- Pending payload is local plaintext SQLite data; OS-level disk encryption is outside this project.
- Restart recovery requires the contact to remain present with the same ID.
- WhatsApp Desktop must be installed, logged in and expose expected UI Automation semantics.
- Confirmation is phrase-based and intentionally conservative.
- Automated tests mock WhatsApp Desktop; they do not click a live account or send real messages.
