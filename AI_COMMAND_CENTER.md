# Jarvis AI Command Center

## Overview

Prompt 10 upgrades the existing PySide6 desktop dashboard into a responsive AI Command Center. The change is confined to the presentation layer in `jarvis/dashboard.py`; it reuses the established `Jarvis.process`, conversation memory, continuous voice worker, WhatsApp progress context, and structured logging. No backend workflow, router, tool, WhatsApp, TikTok, memory schema, or API client was changed.

## UI architecture

```text
DashboardWindow
├── Left navigation
│   ├── Home / Chat / Voice / WhatsApp / TikTok
│   └── Memory / Tasks / Logs / Settings / System Health
├── Center QStackedWidget
│   ├── overview and workflow pages
│   ├── multi-turn Chat with code blocks and timestamps
│   ├── copy-last and regenerate actions
│   ├── read-only memory and structured-log views
│   └── theme and shortcut settings
└── Right Live Status
    ├── AI state / active task / tools running
    ├── voice / memory / API status
    └── existing interface and workflow indicators
```

The navigation buttons switch local pages only. Operational pages explain or display existing workflows; they do not duplicate backend execution logic.

## Screen layout

- **Left:** ten requested destinations, active-page styling, assisted-mode indicator.
- **Center:** page-specific content. Chat preserves persisted multi-turn history, renders fenced code safely, includes timestamps, and exposes Copy last and Regenerate controls.
- **Right:** live, truthful state derived from existing dashboard signals. It shows Ready, Thinking, Executing, or Error plus the active task, tool count, voice lifecycle, memory availability, and API state.
- **Compact layout:** below 1120 px the right panel collapses; below 980 px the navigation narrows. The minimum window is 820×620.

## Event flow

```text
User input
  → dashboard appends timestamped user turn
  → JarvisRequestThread (background QThread)
  → existing Jarvis.process backend
  → existing intent/router/tool/conversation flow
  → response_ready or request_failed signal
  → safe rich-text render + notification + live-status update
```

Voice continues through `JarvisVoiceThread` and reports Listening, Processing, Speaking, and Stopped. WhatsApp progress remains a read-only projection of the existing persisted messaging context. Logs are read from `logs/jarvis.jsonl`; Memory reads the existing repository API.

## Interaction features

- Global, auto-dismissing success/warning/error notifications.
- Dark and light theme switching without restart.
- Keyboard shortcuts:
  - `Ctrl+K`: open Chat and focus the input.
  - `Ctrl+L`: open and refresh Logs.
  - `Ctrl+,`: open Settings.
  - `Ctrl+Shift+V`: start continuous voice.
  - `Esc`: request voice-session stop.
- API/startup failures remain non-fatal and produce user-friendly status and chat messages.
- Code fences are HTML-escaped before rendering, preventing response content from injecting UI markup.

## Tests and results

New integration coverage is in `tests/test_ai_command_center.py`:

1. Required navigation and page switching.
2. Safe fenced-code rendering and timestamps.
3. Copy and regenerate actions.
4. Theme switching, shortcuts, and responsive layout.
5. AI/task/tool/voice live-status propagation.
6. Visible, graceful API/backend startup failure.

Validation command:

```powershell
python -m unittest discover -s tests -v
```

Result on 2026-08-15: **65 tests passed**. This includes the 6 new Command Center tests and all existing ChatGPT, dashboard, voice, orchestration, logging, memory, WhatsApp, TikTok, core, tools, and Urdu-language regressions.

## Limitations

- Workflow pages are presentation and monitoring surfaces; they intentionally do not introduce new backend APIs.
- “Tools running” reflects the current foreground request execution signal, not a cross-process inventory of every system process.
- The right status rail collapses on compact windows; its information remains available through the corresponding center pages.
- Themes apply for the current process and are not persisted as a new backend setting.
- Log display is capped at the most recent 300 structured events to keep the UI responsive.
