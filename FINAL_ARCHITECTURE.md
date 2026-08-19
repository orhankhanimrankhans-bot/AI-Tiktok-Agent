# Jarvis v2.0 RC1 Final Architecture

## System overview

Jarvis v2.0 RC1 is a desktop-first AI command center with a stable central orchestration boundary. Conversation understanding proposes structured intent; Python owns validation, tool routing, confirmation, execution, persistence, and the final user response. Existing TikTok and WhatsApp implementations remain integration modules rather than model-controlled side effects.

```text
Text / continuous voice
          |
          v
PySide6 Command Center ---- status, history, notifications, diagnostics
          |
          v
Jarvis facade / request context (request_id, conversation_id)
          |
          v
Central Orchestrator <----> Conversation memory
     |          |
     |          +---- ChatGPT client (intent + natural-language response)
     |
     +---- Tool Router ---- confirmation / validation policy
                 |
                 +---- WhatsApp workflow
                 +---- TikTok pipeline
                 +---- Memory and task tools
                 +---- Skills registry
                 +---- Plugin manager
                              |
                              v
                     Python execution result
                              |
                              v
              response + event bus + structured logs
```

## Core boundaries

### Presentation

The PySide6 dashboard provides Home, Chat, Voice, WhatsApp, TikTok, Memory, Tasks, Logs, Settings, System Health, Updates, and Backups. Network, recognition, synthesis, automation, backup, and update work runs outside the UI thread. Results return through signals/event dispatch so failures update status without freezing the application.

### Conversation brain

The dedicated LLM client owns API authentication, model configuration, timeouts, retries, response parsing, and normalized failure types. The orchestrator supplies conversation context and accepts structured intent. A model never directly sends a message, publishes content, edits persistent state, or invokes another skill.

### Orchestration and tools

Every request receives a request ID and follows one route:

```text
input -> context -> intent -> confidence/clarification -> tool selection
      -> policy/confirmation -> Python execution -> persisted result -> response
```

Low-confidence or incomplete requests create a clarification turn. Pending tasks retain the necessary structured fields across turns and, where supported, restarts. The tool registry isolates lookup and execution errors and emits progress for the dashboard.

### Memory

Conversation history, workflow state, and durable tasks use repository-provided persistence interfaces backed by SQLite/JSON as appropriate. Mutable state lives outside packaged binaries. Memory is distinct from model inference and tool execution, so each layer can be tested or replaced independently.

### WhatsApp

The model recognizes the intent only. Python resolves the contact, prepares a draft, asks for confirmation, prevents duplicate sends, and calls the existing automation only after confirmation. Pending drafts are recoverable after restart.

### TikTok

The existing nine-stage pipeline remains the production boundary: topic, script, visual plan, voice, voice validation, persistence, render, captions, and OAuth publishing. The command center observes and invokes this pipeline without relocating its business rules.

### Voice

Continuous voice is an interaction adapter around the same orchestrator. Its state machine is `idle -> listening -> processing -> speaking`, with recoverable error transitions and an explicit `stopped` state. It does not duplicate tool logic.

### Skills and plugins

Skills implement a common discovery/availability/execution contract and never call one another directly. The orchestrator selects one and records active/failed state. Plugins use `init -> validate -> start -> stop -> shutdown`; an unavailable or failed plugin is isolated and reported without preventing unrelated startup.

### Configuration and observability

Typed configuration reads environment and external settings, validates them at startup, and returns actionable errors. Secrets are never defaults in source. Structured JSON logs record request IDs, input lifecycle, intent, module selection, execution, success/failure, and exceptions while masking secret fields and token patterns. Diagnostics aggregate configuration, dependencies, API readiness, plugins, skills, disk/runtime health, crashes, updates, and backups.

### Deployment and recovery

PyInstaller creates a Windows application directory; Inno Setup defines the installer. Application binaries are replaced during upgrades, while `%LOCALAPPDATA%\Jarvis` retains configuration, prompts, logs, databases, tokens, crash reports, and backups. The updater checks versions, requires production HTTPS, validates SHA-256, stages safely, and preserves the prior version on failure. Backups use manifest/checksum validation and restore through a temporary validated copy.

## Developer guide

Run the full suite with:

```powershell
python -m unittest discover -s tests
```

Build Windows artifacts with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build_windows.ps1
```

New tools must be registered with the tool router, return structured results, log through the shared observability layer, and avoid UI calls. New skills must implement the shared interface and route only through the orchestrator. New plugins must implement the lifecycle and tolerate repeated stop/shutdown. External services and devices require injectable adapters plus success, timeout/error, and recovery tests.

## User guide

Start Jarvis, confirm System Health shows no blocking configuration errors, and use Chat for ordinary conversation or commands. Review clarification and confirmation prompts before any side effect. Voice mode can remain listening across turns and can be stopped at any time. Use Tasks for pending work, Logs for request IDs and errors, Settings for non-secret options, and Updates/Backups before changing versions. Never paste secrets into chat or support screenshots.

## Administrator guide

Store required credentials in the external environment/configuration location, restrict its Windows ACLs, and rotate credentials independently of application releases. Keep dashboard services loopback-only unless protected by authentication and TLS. Establish log retention, encrypted backup storage, release checksum/signature publication, crash-report scrubbing, disk monitoring, and periodic restore drills. Treat live WhatsApp/TikTok/voice automation as privileged workstation capabilities.

## Verification baseline

On 2026-08-15, the RC1 regression suite completed **100 tests in 6.805 seconds**. Deterministic tests cover functional and recovery contracts. Live API credentials, physical audio devices, third-party desktop UI, TikTok publishing, signed-installer reputation, and clean-VM installation remain manual release gates documented in `FINAL_CHECKLIST.md`.

## Documentation map

- `RELEASE_CANDIDATE.md`: release notes, audit summary, install/upgrade/rollback.
- `FINAL_CHECKLIST.md`: automated, security, manual, admin, and developer gates.
- `DEPLOYMENT_GUIDE.md`: reproducible build, data preservation, backup, recovery, Windows installation.
- `CHATGPT_INTEGRATION.md`, `DASHBOARD_INTEGRATION.md`, `VOICE_MODE.md`: interaction layers.
- `ORCHESTRATION FLOW.md`, `WHATSAPP_INTEGRATION.md`, `TIKTOK_INTEGRATION.md`: workflow boundaries.
- `SKILLS_FRAMEWORK.md`, `CONFIGURATION_AND_PLUGINS.md`: extension and configuration contracts.
- `TESTING_AND_PERFORMANCE.md`: QA and performance baseline.
