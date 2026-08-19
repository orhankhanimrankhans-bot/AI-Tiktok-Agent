# Jarvis Project Analysis and Architecture Map

Date: 2026-08-14  
Scope: static, read-only architecture and stability audit of `C:\AI_TikTok_Agent`  
Runtime changes made: none  
Validation performed: Python AST/import analysis and the existing 25-test `unittest` suite

## 1. Executive Summary

The repository currently contains three related but only partially integrated systems:

1. **Desktop Jarvis assistant (`jarvis/`)** — the active PySide6 dashboard, Gemini conversation, Whisper/pyttsx3 voice, local SQLite memory, Windows tools, contact resolution, and WhatsApp Desktop automation.
2. **TikTok production platform (`app/`)** — the nine-stage media pipeline plus a newer task/agent/tool architecture, approvals, checkpoints, and a separate WhatsApp abstraction.
3. **Web dashboard (`dashboard_server.py` + `dashboard/`/HTML)** — a FastAPI dashboard and pipeline monitor with its own assistant endpoint, scheduler, WebSocket state, TikTok OAuth session state, and `app.core` instance.

The core features work, and all 25 current automated tests pass. The main stability risk is not a direct circular import or a failing test; it is **architectural duplication and divergent state**. There are two dashboards, two Jarvis cores, two WhatsApp implementations, two SQLite databases, multiple LLM paths, several voice pipelines, and many checked-in backup copies. A second high-priority issue is visible **mojibake/corrupted Urdu literals** in active `jarvis` source, which can make valid Urdu commands fail deterministic matching.

The current desktop conversation path does use Gemini for non-tool conversation:

```text
PySide6 dashboard
  -> jarvis.main.Jarvis.process()
     -> deterministic/safety routes for local actions
     -> jarvis.conversation.JarvisConversation.reply() for ordinary conversation
        -> Gemini generate_content()
        -> jarvis.memory SQLite history
```

This is intentionally not “Gemini executes every action.” Local actions remain deterministic and are only reported as successful after their tool adapter reports success.

## 2. Repository-Level Architecture

```text
C:\AI_TikTok_Agent
|
+-- jarvis/                     Active Windows desktop assistant
|   +-- dashboard.py            PySide6 control-center UI
|   +-- main.py                 Conversation/action coordinator and CLI
|   +-- conversation.py         Gemini conversational engine
|   +-- speech.py               Microphone, faster-whisper STT, pyttsx3 TTS
|   +-- memory.py               Desktop-assistant SQLite repository
|   +-- tools.py                Local Windows/application tools
|   +-- contact_resolver.py     contacts.json resolver
|   +-- messaging_context.py    Multi-turn recipient/message state
|   +-- whatsapp_adapter.py     WhatsApp Desktop UIA automation
|   +-- *_probe.py              Manual diagnostic utilities
|
+-- app/                        TikTok pipeline and agent platform
|   +-- orchestrator.py         Production pipeline entry point
|   +-- config.py               Ollama/OpenAI/Gemini provider functions
|   +-- memory.py               TikTok video SQLite repository
|   +-- core/                   Objectives, tasks, events, permissions
|   +-- agents/                 Pipeline task executors
|   +-- tools/                  Audited platform tool registry
|   +-- whatsapp/               Separate abstract/testable WhatsApp subsystem
|   +-- voice/, video/, visual/ Media-generation stages
|   +-- publishing/             TikTok OAuth, upload, status, packaging
|
+-- dashboard_server.py         Separate FastAPI dashboard/server entry point
+-- dashboard.html/index.html   Web dashboard assets/legacy pages
+-- dashboard/                  Web dashboard static assets
+-- data/                       SQLite DBs, contacts, OAuth token data
+-- output/                     Pipeline artifacts
+-- logs/                       Reserved log directory; little/no structured use
+-- tests/                      Tests for app.core/tools/Urdu/app.whatsapp
+-- app_backup/                 Legacy duplicate source tree
+-- *_backup*.py                Additional legacy snapshots beside live modules
```

## 3. Entry Points

| Entry point | Command / activation | Purpose | Architecture used |
|---|---|---|---|
| `jarvis/dashboard.py` | `python -X utf8 -m jarvis.dashboard` or Desktop shortcut | Active PySide6 desktop control center | `jarvis.*` |
| `jarvis/main.py` | `python -X utf8 -m jarvis.main` | Text CLI | `jarvis.*` |
| `jarvis/main.py` | `python -X utf8 -m jarvis.main --voice` | Push-to-talk CLI voice loop | `jarvis.*` |
| `app/orchestrator.py` | `python -m app.orchestrator` | Nine-stage TikTok production pipeline | legacy production modules under `app.*` |
| `app/jarvis.py` | `python -m app.jarvis ...` | Objective/task/agent command-line control | newer `app.core.*` |
| `dashboard_server.py` | direct run, batch/PowerShell launcher, or Uvicorn | FastAPI web dashboard, scheduler and pipeline subprocess control | `app.core.*` + pipeline |
| `app/publishing/tiktok_oauth.py` | module execution | Standalone TikTok OAuth server | publishing subsystem |
| Media/publishing modules | `python -m app.<module>` | Standalone stage diagnostics/production | individual pipeline stage |
| Probe modules | `python -m jarvis.<probe>` | WhatsApp UI diagnostics | diagnostic only |

There is no single composition root for all three systems. The desktop dashboard does not currently instantiate `app.core.JarvisCore`, and the FastAPI dashboard does not use `jarvis.main.Jarvis`.

## 4. Module Inventory

### 4.1 Active desktop assistant: `jarvis/`

| Module | Purpose and important dependencies |
|---|---|
| `jarvis/__init__.py` | Package metadata/version only. |
| `jarvis/config.py` | Desktop paths, language list, autonomy/safety flags, and history limit. Creates `data/` and `logs/` on import. Several safety constants are declarations only and are not the controlling policy for every adapter. |
| `jarvis/conversation.py` | Loads `.env`, creates a global Gemini client/conversation singleton, builds bounded Gemini history from local SQLite, selects primary/fallback models, and maps quota/availability errors to user text. Depends on `google-genai`, `dotenv`, and `jarvis.memory`. |
| `jarvis/main.py` | Central desktop coordinator. Normalizes input, handles exits, recognizes deterministic Windows/WhatsApp commands, manages multi-turn message state, calls local tools, then falls back to Gemini. Also supplies text and voice CLI loops. |
| `jarvis/dashboard.py` | PySide6 desktop UI. Runs text requests and continuous voice conversation in worker `QThread`s, displays truthful local UI state, and calls one shared `Jarvis` instance. Most sidebar panels and workflow/runtime status items remain placeholders. |
| `jarvis/speech.py` | Lazy faster-whisper model loading, microphone recording until silence, Urdu-biased STT hints/hotwords, and pyttsx3 TTS. Exposes global `speech`. |
| `jarvis/memory.py` | Creates/uses `data/jarvis_memory.db`; stores conversation turns, preferences, and action audit rows. Exposes global `memory`. |
| `jarvis/tools.py` | Windows application/path/website/project tools and a small local registry. Records actions in Jarvis memory. Exposes global `tools`. This is separate from `app.tools.registry`. |
| `jarvis/contact_resolver.py` | Loads `data/contacts.json`, normalizes aliases/phone variants, performs fuzzy contact matching, rejects junk aliases, and exposes global `contact_resolver`. |
| `jarvis/messaging_context.py` | In-memory recipient ambiguity, active contact, awaiting-message, and prepared-message state; persists preferred contact choices through `jarvis.memory`. Exposes global `messaging`. |
| `jarvis/whatsapp_adapter.py` | Builds `wa.me` links, locates the real `WhatsApp.Root.exe`, validates recipient/composer through UI Automation, prepares exact drafts, invokes the semantic Send control, verifies clearing, and records actions. Exposes global `whatsapp`. |
| `jarvis/inspect_whatsapp.py` | Diagnostic UIA control enumerator. Not imported by production code. |
| `jarvis/focus_probe.py` | Diagnostic Windows foreground/focus probe. Executes at import/module run; not production code. |
| `jarvis/send_button_probe.py` | Diagnostic Send-control candidate/deduplication probe. Executes at module run. |
| `jarvis/composer_probe.py` | Diagnostic bottom-area Edit/Document value probe. Executes at module run. |

### 4.2 Agent/task platform: `app/core`, `app/agents`, `app/tools`, `app/skills`

| Module | Purpose |
|---|---|
| `app/core/models.py` | Enums and dataclasses for agents, objectives, tasks, approvals, tools, results, priorities, and timestamps. |
| `app/core/event_bus.py` | Thread-safe in-process publish/subscribe bus. Subscriber exceptions are silently discarded. |
| `app/core/task_manager.py` | SQLite persistence for objectives, tasks, approvals, events, settings and checkpoints; locking and state transitions. |
| `app/core/permission_manager.py` | Safe/assisted/autonomous policy decisions plus emergency-stop state. |
| `app/core/settings.py` | Settings and “soul/persona” data stored through `TaskManager`. |
| `app/core/jarvis_core.py` | Composition root for the newer agent architecture: registries, task manager, event bus, permissions, skills and WhatsApp agent. Creates TikTok objective dependency graphs and runs ready tasks. |
| `app/core/command_router.py` | Urdu-normalized commands to `JarvisCore` actions/tool calls. Separate from `jarvis.main` routing. |
| `app/agents/base_agent.py` | Common agent lifecycle, task status and event publication. |
| `app/agents/pipeline_agents.py` | Topic, script, quality, visual, voice, pipeline-state, generic module, final-quality and publisher task executors. Delegates to legacy pipeline functions/subprocess modules. |
| `app/agents/registry.py` | In-memory agent registration and lookup. |
| `app/tools/registry.py` | Validated/audited tool execution with permission checks and approval creation. |
| `app/tools/file_tools.py` | Project-root file sandbox and traversal protection. |
| `app/tools/windows_tools.py` | Registered Windows application launching. |
| `app/tools/system_tools.py` | Read-only system information. |
| `app/skills/registry.py` | Lightweight skill metadata registry. |
| Package `__init__.py` files | Package markers/exports; several re-exports appear unused internally. |

### 4.3 TikTok content and media pipeline

| Module | Purpose |
|---|---|
| `app/config.py` | Project `.env` loader and synchronous Ollama, OpenAI, Gemini text/image provider clients. `ask_llm()` selects a provider. This LLM stack is separate from `jarvis/conversation.py`. |
| `app/orchestrator.py` | Current nine-stage master pipeline: topic, script/validation or raw-demo bypass, visuals, voice validation, JSON state, rendering, captions, publishing package, optional upload. Contains unreachable duplicate script-generation code after an earlier `return`. |
| `app/topic_manager.py` | Topic generation/deduplication against `agent.db`; raw-demo mode returns predefined filmable topics. |
| `app/visual_planner.py` | Current scene planner used by orchestrator and agents. |
| `app/visual/visual_planner.py` | Smaller similarly named visual planning implementation; not the orchestrator import target. |
| `app/voice_generator.py` | Piper TTS wrapper/output generation. |
| `app/voice/script_voice_pipeline.py` | Script-to-Piper-to-Whisper verification workflow used by orchestrator. |
| `app/voice_pipeline.py` | Older parallel voice orchestration path; no active internal import found. |
| `app/whisper_checker.py` | Whisper CLI/model transcription and similarity/accuracy validation. |
| `app/video/renderer.py` | Main vertical 1080x1920 renderer, footage acquisition/compositing and audio handling. |
| `app/video/pexels_footage.py` | Pexels footage search/download/cache helper. |
| `app/video/caption_renderer.py` | Current pipeline caption timing/ASS generation/burn stage. |
| `app/video/caption_burner.py` | Separate generic FFmpeg caption burn utility. |
| `app/video/captions.py` | Caption segmentation/timing/ASS helpers; appears parallel to logic in renderer modules. |
| `app/video/quality_check.py` | Final video file, dimensions, FPS, duration/size quality checks. |
| `app/video_studio.py` | Separate Gemini/Veo/Creatomate video-studio job flow. |
| `app/kids_story.py` | Gemini kids-story generation and length validation. |
| `app/kids_video.py` | Kids-story scene/image/audio/video workflow. |

### 4.4 TikTok publishing

| Module | Purpose |
|---|---|
| `app/publishing/publisher.py` | Builds publishing metadata/packages from final pipeline artifacts. Contains its own legacy Ollama constants/client behavior rather than exclusively using `app.config`. |
| `app/publishing/tiktok_oauth.py` | Standalone FastAPI OAuth/PKCE flow and token persistence. Maintains in-memory `oauth_sessions`. |
| `app/publishing/tiktok_upload.py` | Creator info, direct-post initialization, chunk upload and response handling. |
| `app/publishing/tiktok_status.py` | Polls TikTok publish status and interprets final result. |
| `app/publishing/tiktok_publisher.py` | High-level selection, metadata, upload and status orchestration. |

### 4.5 Separate application WhatsApp subsystem: `app/whatsapp/`

| Module | Purpose |
|---|---|
| `models.py` | WhatsApp intent/contact/resolution/result datatypes and enums. |
| `intent.py` | English/Urdu/Roman Urdu WhatsApp intent parser. |
| `contacts.py` | Testable JSON contact resolver. |
| `adapter.py` | Thin web-link adapter/dry-run behavior. It is not the active WhatsApp Desktop UIA adapter. |
| `agent.py` | Stateful follow-up recipient/message agent with duplicate-send protection. |
| `import_contacts.py` | VCF-to-JSON contact import utility. Some malformed rows are silently skipped. |

### 4.6 Dashboard, database and utilities

| Module | Purpose |
|---|---|
| `dashboard_server.py` | FastAPI application, REST API, WebSocket broadcaster, daily scheduler, TikTok OAuth callbacks, pipeline subprocess reader, web assistant endpoint, kids/story endpoints, and static-file responses. Owns significant module-global session/runtime state. |
| `app/memory.py` | `data/agent.db` schema and TikTok video CRUD. Separate from desktop Jarvis memory. |
| `app/view_memory.py` | Import-time console view of TikTok video memory; diagnostic utility. |
| `app/health_check.py` | Database, import and environment checks; one broad exception is suppressed. |
| `agent_test.py` | Large legacy/manual pipeline experiment. It has import-time execution/state and is not an automated unit test despite its name. |

### 4.7 Backup and legacy modules

The following are not on active import paths and should be treated as snapshots, not production modules:

- `app/orchestrator_backup_working.py`
- `app/visual_planner_backup.py`
- `app/visual_planner_backup_v2.py`
- `app/video/renderer_backup_working.py`
- `app/publishing/tiktok_*_backup.py`
- the complete `app_backup/` tree, including two copies of several modules

Exact-file duplicates detected include three copies of `view_memory.py`, three copies of the small visual planner, three copies of `voice_pipeline.py`, and paired copies of multiple `app_backup` modules. Keeping importable `.py` backups increases search noise and creates a high risk of editing or invoking the wrong implementation.

## 5. Dependency Map

No direct internal circular-import strongly connected component was found by static import analysis.

### Desktop dependency chain

```text
jarvis.dashboard
  -> jarvis.main.Jarvis
     -> jarvis.conversation -> jarvis.memory -> jarvis.config
     -> jarvis.speech
     -> jarvis.tools -> jarvis.memory
     -> jarvis.messaging_context
        -> jarvis.contact_resolver -> jarvis.config
        -> jarvis.memory
     -> jarvis.whatsapp_adapter
        -> jarvis.contact_resolver
        -> jarvis.memory
        -> Win32 + pywinauto + browser
```

### Agent platform dependency chain

```text
app.jarvis / dashboard_server
  -> app.core.jarvis_core
     -> app.core.task_manager -> app.core.event_bus + app.core.models
     -> app.core.permission_manager
     -> app.agents.pipeline_agents
        -> app.orchestrator / app.topic_manager / media stages
     -> app.tools.registry
     -> app.whatsapp.agent -> app.whatsapp adapter/intent/contacts
```

### Production pipeline dependency chain

```text
app.orchestrator
  -> app.topic_manager -> app.memory + app.config
  -> app.visual_planner -> app.config
  -> app.voice.script_voice_pipeline
     -> app.voice_generator
     -> app.whisper_checker
  -> subprocess: app.video.renderer
  -> subprocess: app.video.caption_renderer
  -> subprocess: app.publishing.publisher
  -> optional subprocess: app.publishing.tiktok_publisher
     -> app.publishing.tiktok_upload
     -> app.publishing.tiktok_status
```

## 6. Runtime Data Flows

### 6.1 Desktop conversation flow

```text
User text or STT transcript
  -> Dashboard worker thread / CLI
  -> Jarvis.process(user_text)
  -> exit/pending-recipient/pending-message checks
  -> deterministic direct-command router
       success/failure comes from local adapter
     OR
  -> conversation.reply(user_text)
  -> recent rows from jarvis_memory.db (last bounded history)
  -> Gemini primary model, then retryable-error fallback model
  -> save user + assistant turns
  -> dashboard/CLI output
```

Action commands are intentionally evaluated before Gemini. Therefore normal chat is Gemini-backed, but recognized local actions are not sent to Gemini first.

### 6.2 Voice flow

```text
Voice button once
  -> JarvisVoiceThread loop
  -> speech.listen()
     -> sounddevice microphone capture
     -> stop after silence
     -> temporary WAV
     -> lazy faster-whisper `base` model
     -> Urdu default + initial prompt/hotwords
  -> Jarvis.process(transcript)
  -> speech.speak(response) via pyttsx3
  -> loop back to Listening until Stop Voice
```

The dashboard voice thread is continuous. The CLI `--voice` mode remains manual Enter-to-talk. Voice state is held in the dashboard thread object and `request_thread` reference.

### 6.3 WhatsApp flow (desktop implementation)

```text
“Basit ko message karo”
  -> extract recipient
  -> contact_resolver reads in-memory contacts loaded from contacts.json
  -> preference lookup / fuzzy match / ambiguity question
  -> messaging.begin_message(contact)
  -> next utterance cleaned as message text
  -> whatsapp.prepare_message(contact, text)
     -> validate/normalize phone
     -> open wa.me URL
     -> locate WhatsApp.Root.exe
     -> semantically verify recipient composer via UIA
     -> replace/verify exact draft
  -> whatsapp.send_prepared_message()
     -> re-verify contact, exact draft and unique physical Send control
     -> invoke semantic Send control once
     -> clear prepared state
     -> verify composer clears
  -> record action and return actual tool result
```

Current `jarvis.main` behavior sends immediately after a valid second-turn message because that was explicitly wired into the `MESSAGE_READY` branch. The older standalone `send karo` path still exists for an already prepared message. This creates two confirmation semantics and should be documented/tested carefully.

### 6.4 TikTok flow

```text
CLI / FastAPI launch / scheduled launch
  -> app.orchestrator subprocess
  -> topic selection + DB dedupe
  -> raw-demo branch OR script -> visuals -> voice -> Whisper validation
  -> output/pipeline/*.json
  -> renderer -> output/video and/or output/final
  -> caption renderer (unless raw-demo)
  -> publishing package
  -> optional TikTok upload
  -> publish status polling
  -> agent.db result + dashboard WebSocket updates
```

The FastAPI server infers progress by parsing orchestrator stdout markers. This is operationally simple but fragile: changing printed text can silently break dashboard progress while the pipeline itself continues.

## 7. State, Globals and Persistence

### Persistent state

| Store | Owner | Contents |
|---|---|---|
| `data/jarvis_memory.db` | `jarvis.memory` | desktop conversation, preferences, action audit |
| `data/agent.db` | `app.memory` and `app.core.TaskManager` | TikTok video records plus newer objectives/tasks/events/settings/checkpoints (schema use depends on initializer) |
| `data/contacts.json` | desktop and/or imported contact flows | contact names, aliases and phone variants |
| `data/tiktok_tokens.json` | TikTok OAuth/publishing | access/refresh token material; sensitive |
| `output/pipeline/*.json` | orchestrator | intermediate topic/script/visual/voice state |
| `output/**` | media pipeline | downloaded footage, WAVs, captions, rendered/final videos, metadata |

### Important module-global/session state

- Desktop singletons created at import: `conversation`, `memory`, `speech`, `tools`, `contact_resolver`, `messaging`, `whatsapp`.
- `messaging.context` and WhatsApp prepared state are process-local and disappear on restart.
- `dashboard.py`: one `Jarvis`, current request/voice thread, UI status-pill registry.
- `dashboard_server.py`: `jarvis`, `command_router`, `manager`, `pipeline_task`, `pipeline_logs`, `oauth_sessions` and scheduler state.
- `app.core.JarvisCore`: registries, event bus, permissions and task manager live per instance.
- OAuth PKCE sessions are in memory, so a server restart invalidates pending callbacks.
- The web dashboard pipeline “running” state and logs are process memory, although final task/video data is persisted.

### Configuration sources

- Root `.env` is loaded by both `app.config` and `jarvis.conversation` through separate implementations.
- `jarvis/config.py` uses Python constants.
- `app/config.py` reads provider/model/API environment values.
- Individual pipeline/publisher modules also read environment variables directly.
- `dashboard_server.py` reads dashboard-specific provider/model and TikTok variables at import time.
- The source currently has no single validated settings object or one authoritative configuration schema.

## 8. Duplicate, Dead and Unused Code Findings

### Confirmed dead/unreachable code

- `app/orchestrator.py`: a second complete prompt/call block occurs after `return response` inside `generate_script()`. It can never execute.

### High-confidence legacy/diagnostic code

- All `*_backup*.py` files and the complete `app_backup/` directory are outside active production import paths.
- `jarvis/*_probe.py` and `inspect_whatsapp.py` are manual diagnostics, not application dependencies.
- `agent_test.py` is a manual script with import-time execution and should not be confused with `tests/`.
- `app/voice_pipeline.py`, `app/visual/visual_planner.py`, and several caption helpers overlap with active production implementations and have no active internal caller in the current import graph.

### Candidate unused imports

Static AST analysis found these meaningful candidates (excluding harmless `from __future__ import annotations` and intentional package re-exports):

- `agent_test.py`: `Path`
- `dashboard_server.py`: `sqlite3`, `StaticFiles`, imported `LLM_PROVIDER`
- `app/health_check.py`: `subprocess`, `Path`
- `app/topic_manager.py`: `json`
- `app/video_studio.py`: `time`
- `app/publishing/tiktok_oauth.py`: `base64`
- `app/publishing/tiktok_status_backup.py`: `os`
- `app/publishing/tiktok_upload_backup.py`: `os`
- `app/video/captions.py`: `subprocess`
- `jarvis/conversation.py`: `Dict`
- `jarvis/speech.py`: `time`
- `jarvis/whatsapp_adapter.py`: `ctypes`
- tests: `patch` in `test_jarvis_core.py`, `Approval` in `test_tool_registry.py`

This list is static and should be confirmed with a linter before deletion; no imports were removed in this analysis.

### Circular imports

No direct cycle was found among the 103 parsed Python modules. All modules parsed successfully. The main coupling concern is not a syntactic cycle but parallel subsystems and import-time singleton initialization.

## 9. Silent Exception Handling

Production-relevant silent handlers detected:

- `app/core/event_bus.py:56` — any subscriber exception is swallowed, hiding failed observers/audit integrations.
- `app/health_check.py:41` — broad environment/probe failure is converted without retaining diagnostic detail.
- `app/video/pexels_footage.py:32` — filesystem lookup errors are ignored.
- `app/whatsapp/import_contacts.py:37` — invalid decoding/value rows are skipped silently.
- `jarvis/speech.py:377` — temporary-file deletion failure is ignored; low severity.
- `jarvis/whatsapp_adapter.py` — multiple broad `except Exception: pass/continue` sites while enumerating windows/UIA controls and restoring clipboard. Some are appropriate best-effort enumeration, but they make UI incompatibility difficult to diagnose.
- Diagnostic WhatsApp probes contain multiple silent enumeration handlers; lower production impact.

Other broad exceptions generally return/print an error, but the project has almost no centralized traceback logging. As a result, many failures become short UI strings or console messages with no durable diagnostic record.

## 10. Encoding and Internationalization Finding

Active source contains mojibake strings such as `Ø...`, `Ã...`, and `â€¦` in `jarvis/conversation.py`, `jarvis/main.py`, and `jarvis/dashboard.py`. These are not merely terminal rendering artifacts in the inspected content; they are stored literals as read from the files.

Impact:

- Urdu deterministic aliases/regexes can fail even when Whisper produces correct Urdu Unicode.
- The Gemini system prompt includes corrupted examples.
- UI labels can display corrupted punctuation/separators.
- Existing tests cover the separate `app.language.urdu` path, not the active `jarvis.main` mojibake literals.

This is a Priority 0/1 correctness issue for the stated Urdu-first assistant experience.

## 11. Logging and Observability

- `logs/` is created by `jarvis.config`, but active desktop modules rely mainly on `print()` and user-facing return strings.
- The TikTok pipeline uses extensive `print()` output; the web dashboard captures only the most recent 300 lines in memory.
- `jarvis.memory.action_log` and `app.core` event/task tables provide partial audit trails, but they are separate and do not include consistent correlation IDs.
- No repository-wide `logging` configuration, rotating log, structured JSON log, or exception traceback policy was found.
- Dashboard live status is partly real (backend, request/voice activity) and partly explicit placeholder (“Not connected”, “Not queried”). This is honest but not yet an integrated control center.

## 12. Test Coverage Assessment

Command executed:

```text
python -X utf8 -m unittest discover -s tests -v
```

Result: **25 tests passed**.

Covered well enough for the current suite:

- newer `app.core` registration, objective graphs, approvals, checkpoints and emergency stop
- audited tool registry and path traversal protection
- `app.language.urdu` normalization
- abstract `app.whatsapp` intent/contact/follow-up/duplicate protection

Major untested production surfaces:

- active `jarvis.main` deterministic routing and mixed-script regexes
- Gemini fallback/quota/model configuration
- desktop `messaging_context` and `contact_resolver`
- real `jarvis.whatsapp_adapter` UIA prepare/send verification
- PySide6 dashboard worker-thread lifecycle and continuous voice loop
- microphone/STT/TTS failure/recovery behavior
- complete orchestrator media pipeline and subprocess stage contracts
- TikTok OAuth/upload/status responses
- FastAPI routes, WebSocket reconnects, scheduler and concurrent launch protection

Important distinction: the passing WhatsApp tests test `app.whatsapp`, not the UIA-based `jarvis.whatsapp_adapter` used by the desktop dashboard.

## 13. Stability Report by Priority

### P0 — Fix before relying on broad natural-language actions

1. **Repair corrupted Unicode literals in active `jarvis` source and add exact Urdu regression tests.** This directly affects recognition and user-visible text.
2. **Define one authoritative desktop action state machine.** The current message flow supports both automatic send after message capture and a legacy explicit `send karo` route. Document and test the intended safety contract to prevent accidental or duplicate sends.
3. **Protect secrets and tokens.** `.env`, Google client secrets and `data/tiktok_tokens.json` must remain excluded from source control and must never be printed. Confirm file permissions and `.gitignore` coverage.

### P1 — High stability/value

1. **Choose canonical composition roots.** Decide whether the PySide6 dashboard or FastAPI dashboard is the primary UI, and whether `jarvis.main.Jarvis` or `app.core.JarvisCore` owns commands/actions.
2. **Unify the two WhatsApp stacks** or place one behind a shared interface. Current tests do not validate the production UIA adapter.
3. **Unify configuration and LLM policy.** `jarvis.conversation`, `app.config`, publisher code and dashboard assistant currently have different clients/models/error semantics.
4. **Add structured persistent logging** with component, action, contact ID (not full number), task/objective ID, error traceback and correlation ID.
5. **Add tests for the active desktop flow**, especially Urdu/Roman Urdu, ambiguity, exact draft, one-send-only verification, quota fallback and voice-thread stop/restart.
6. **Make UIA automation bounded and diagnosable.** Replace broad silent catches with debug logging and explicit timeouts while retaining safe failure behavior.

### P2 — Maintainability

1. Move `app_backup/`, `*_backup*.py`, and manual probe scripts outside importable production packages or into version-control history/tools.
2. Remove unreachable code in `app/orchestrator.generate_script()` after behavior-preserving tests.
3. Resolve duplicate visual, voice and caption implementations; document the canonical module for each stage.
4. Remove confirmed unused imports with a linter/CI check.
5. Replace stdout-marker progress parsing with structured subprocess events or a persisted stage API.
6. Persist or explicitly reset process-local messaging/OAuth/dashboard session state.

### P3 — Product/control-center completeness

1. Wire PySide6 status cards to `app.core` tasks, approvals, agents, memory and TikTok states.
2. Consolidate desktop and web dashboard presentation over one backend service/API.
3. Add dependency metadata/lock file and startup capability checks for FFmpeg, Piper, Whisper, PySide6, Win32/UIA and API credentials.
4. Add database migrations/schema versioning and backup/recovery procedures.

## 14. Recommended Target Architecture (No Rewrite Required)

This is a migration direction, not a request to replace working code:

```text
PySide6 UI and/or Web UI
        |
        v
Single Application Service / Jarvis Facade
  +-- Conversation port -> Gemini adapter
  +-- Command/intent router -> deterministic verified actions
  +-- Voice port -> Whisper/TTS adapter
  +-- Messaging port -> one WhatsApp adapter
  +-- Workflow port -> app.core task/objective engine
  +-- TikTok port -> existing orchestrator stages
  +-- Memory/audit port -> versioned repositories
        |
        v
Structured events -> both dashboards, logs and checkpoints
```

The safest path is incremental: preserve current working adapters, introduce interfaces around them, route both dashboards through one application service, and only then retire duplicates.

## 15. Final Assessment

| Area | Current assessment |
|---|---|
| Python parse/import health | Good: 103 modules parsed; no direct circular import detected |
| Existing automated suite | Green: 25/25 tests pass |
| Desktop Gemini conversation | Working, with quota/model fallback; active path is separate from pipeline LLM configuration |
| Urdu/Roman Urdu reliability | At risk because active source contains corrupted literals and lacks regression tests |
| Voice | Functional and continuous in PySide6; hardware/model lifecycle remains lightly tested |
| WhatsApp | Sophisticated safety checks, but large/high-risk adapter and not covered by current tests |
| TikTok pipeline | Feature-rich and modular at process boundaries; duplicated implementations and stdout coupling reduce maintainability |
| Agent/task architecture | Well-structured and tested, but not yet the active desktop dashboard backend |
| Persistence | Functional but fragmented across databases and process-local state |
| Logging/diagnostics | Weak; print-heavy and inconsistent, with several silent exceptions |
| Overall stability | **Operational prototype / early integrated product**: core paths work, but consolidation, encoding repair and active-path tests are required before unattended operation |

