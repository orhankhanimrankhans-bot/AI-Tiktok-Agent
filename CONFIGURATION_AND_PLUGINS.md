# Configuration, Security, and Plugin System

## Overview

Prompt 12 centralizes Jarvis startup configuration diagnostics and adds a fault-isolated application plugin lifecycle. Existing conversation, skills, WhatsApp, TikTok, memory, and automation behavior remains unchanged.

```text
.env / environment
       |
       v
 jarvis.config
   -> safe numeric parsing
   -> validate_configuration()
   -> ConfigReport + actionable ConfigIssue entries
       |
       v
 Jarvis startup
   -> structured issue logging (key and remediation only)
   -> PluginManager
       -> initialize -> validate -> start
       -> stop -> shutdown
       |
       v
 Dashboard Settings + System Health
   -> redacted configuration summary
   -> plugin state and controls
```

## Configuration model

`jarvis/config.py` remains the central source for desktop Jarvis settings. Numeric environment settings now use safe parsing: malformed values produce validation issues and fall back to safe defaults instead of crashing module import.

`validate_configuration()` checks:

- presence of `OPENAI_API_KEY` when ChatGPT is expected;
- non-empty model configuration;
- positive request timeout;
- non-negative retry count;
- intent confidence between zero and one;
- parse failures captured during environment loading.

Missing API credentials are reported as actionable warnings so local/non-conversation diagnostics can still start. Invalid operational values are errors. `ConfigReport.valid` reflects error-level findings.

## Security

- Real credentials remain in `.env` or process environment only.
- `.env.example` contains empty placeholders, never working secrets.
- `safe_summary()` exposes only `api_key_configured: true/false`; it never returns the key.
- Structured configuration logs contain the setting name, severity, and remediation—not its value.
- Plugin errors store exception type only in public state. Detailed tracebacks remain in protected structured logs.
- Dashboard configuration diagnostics explicitly render redacted safe summaries.

## Plugin lifecycle

All plugins inherit `BasePlugin` and may implement:

```python
initialize(context)
validate() -> PluginValidation
start()
stop()
shutdown()
```

Lifecycle rules:

1. `register` applies enabled/disabled configuration.
2. `initialize` receives a copy of shared, non-secret startup context.
3. `validate` must succeed before start.
4. `start` moves the plugin to `running`.
5. `stop` supports dashboard or application lifecycle control.
6. `shutdown` always runs during orderly Jarvis exit.
7. Every plugin boundary catches failures independently; one failed plugin does not block later plugins.

Current built-in plugin: `DiagnosticsPlugin`, which stores only the safe configuration report.

## Plugin configuration

```dotenv
JARVIS_ENABLED_PLUGINS=diagnostics
JARVIS_DISABLED_PLUGINS=
```

The enabled list acts as an allow-list. The disabled list takes precedence. Disabled plugins are recorded as `disabled` and never initialized.

## Dashboard

The Settings page now includes:

- dark/light appearance controls;
- keyboard shortcut reference;
- redacted configuration validity and actionable issues;
- plugin name, current lifecycle phase, and safe failure type;
- Start enabled plugins and Stop plugins controls.

System Health summarizes configuration state, healthy/failed plugin counts, and confirms that secrets are redacted. All controls call `PluginManager`; the dashboard does not implement plugin lifecycle logic itself. Window close invokes orderly Jarvis/plugin shutdown.

## Logging

Structured events cover:

- configuration validation issues;
- plugin disabled, validation failed, started, stopped, failed, and shutdown-failed states;
- dashboard shutdown recovery.

No secret values are passed to these events.

## Automated tests

`tests/test_configuration_and_plugins.py` verifies:

1. missing API key produces an actionable, non-fatal warning;
2. invalid model, timeout, retries, and confidence are rejected clearly;
3. safe diagnostics never reveal an API key;
4. disabled plugins never initialize;
5. lifecycle order is initialize, validate, start, stop, shutdown;
6. one failed plugin does not block a healthy plugin and recovery;
7. dashboard configuration and plugin controls remain redacted and functional.

Validation command:

```powershell
python -m unittest discover -s tests -v
```

Result on 2026-08-15: **77 tests passed**. This includes all existing ChatGPT, skills, orchestration, dashboard, voice, memory, logging, WhatsApp, TikTok, tools, core, and Urdu-language regressions.

## Limitations

- Plugin installation and third-party package downloading are outside this milestone.
- Environment/config changes require a process restart.
- Dashboard controls start or stop all registered enabled plugins; per-plugin selection can be added later.
- Diagnostics report configuration and lifecycle state, not external service latency or billing/quota information.
- Plugin isolation catches Python failures but is in-process; OS-level process isolation is not part of this version.
