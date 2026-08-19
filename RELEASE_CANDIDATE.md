# Jarvis v2.0 RC1

Release date: 2026-08-15  
Version: `2.0.0-rc1`  
Status: Release candidate for controlled Windows validation; not yet General Availability.

## Candidate artifact

- Bundle: `dist\Jarvis`
- Executable: `dist\Jarvis\Jarvis.exe`
- Executable size: 17,504,882 bytes
- Bundle size: 380,047,468 bytes (about 362.4 MiB)
- SHA-256: `E90B3445C3A908E2EE743913AE98D59BA18BF65B1D3B8D5064AA85826447E5FE`
- Build tools: Python 3.12.0, PyInstaller 6.21.0, Windows 10 x64

The source-current folder bundle built successfully. Inno Setup (`iscc`) was not installed in the verification environment, so the setup executable was not generated or tested.

## Release decision

Jarvis v2.0 RC1 is approved for candidate testing. The complete automated suite passed: **100 tests in 6.805 seconds**. This verifies the dashboard contracts, ChatGPT client failure handling and history, continuous voice lifecycle, memory, WhatsApp orchestration, TikTok pipeline contracts, skills, plugins, configuration, diagnostics, logging, packaging, backup/restore, update recovery, and RC security controls.

Live OpenAI/ChatGPT validation was not run because `OPENAI_API_KEY` is not configured. Physical microphone/speaker behavior, WhatsApp Desktop UI automation, TikTok OAuth publishing, Authenticode signing, and the Inno Setup installer require manual release-environment validation before GA.

## Release highlights

- Central request orchestration with persistent multi-turn context and Python-owned tool execution.
- ChatGPT conversation client with configurable model, timeout, retry, and actionable failures.
- Non-blocking command-center dashboard with Chat, Voice, WhatsApp, TikTok, Memory, Tasks, Logs, Settings, Health, Updates, and Backups views.
- Continuous voice session state machine with recovery paths.
- Persistent, confirmation-gated WhatsApp drafts with duplicate-send protection.
- Configurable skills and isolated plugin lifecycle management.
- Startup configuration validation, structured request logging, health diagnostics, crash reports, backup/restore, and safe update primitives.
- Windows PyInstaller packaging and Inno Setup definition.
- RC1 hardening: recursive log-secret redaction, HTTPS enforcement for production update traffic, RC-aware version comparison, and corrected Urdu send aliases.

## Milestone verification

| Area | Automated evidence | RC1 status |
|---|---|---|
| Stability and logging | Request IDs, lifecycle/exception logs, redaction tests | Verified |
| ChatGPT conversation | Success, timeout, authentication, history tests | Verified with mocked transport; live key pending |
| Dashboard | Startup, send/receive, API failure, responsiveness tests | Verified |
| Voice | Lifecycle, repeated turns, recognition error/recovery tests | Verified with fakes; hardware pending |
| Orchestration | Multi-turn clarification, routing, execution, recovery tests | Verified |
| Memory | Persistence and restart recovery tests | Verified |
| WhatsApp | Resolution, draft, confirmation, deduplication, restart tests | Verified; Desktop send smoke pending |
| TikTok | Pipeline/config/publisher boundary regression tests | Verified; live OAuth publish pending |
| Skills and plugins | Discovery, disablement, lifecycle, isolation/recovery tests | Verified |
| Configuration/diagnostics | Missing/invalid config, health, startup recovery tests | Verified |
| Deployment | Build specification, update, backup/restore, rollback tests | Verified; signed installer pending |

Prompt 7 and Prompt 9 artifacts were not present in the workspace, so no independent milestone claim is made for them.

## Security audit

Checks performed:

- No OpenAI `sk-`, Google `AIza`, or private-key signature was found hardcoded in production source.
- `.env`, TikTok token storage, logs, databases, backups, build output, and crash reports are excluded from Git.
- The configured Gemini key was checked against logs without printing it; it was not present in clear text.
- Structured logging now recursively masks sensitive fields and common token formats, including exception text.
- Production update manifests and packages must use HTTPS; downloaded artifacts require SHA-256 integrity validation before staging.
- WhatsApp sends remain confirmation-gated and duplicate protected.
- Plugin and skill failures are isolated from application startup.

Accepted RC risks:

- SHA-256 protects package integrity only when the manifest is trusted. Authenticode and a signed manifest are required for GA.
- Local `.env`, OAuth tokens, SQLite data, and backup archives are plaintext at rest. Protect the application-data directory with Windows ACLs and encrypted storage.
- Dashboard authentication is not intended for untrusted network exposure; bind it locally unless an authenticated reverse proxy is installed.
- Third-party desktop/API behavior can change independently and must be smoke-tested in the release environment.

## Installation checklist

- [ ] Use supported Windows 10/11 x64.
- [ ] Verify the published SHA-256 checksum and, for GA, Authenticode signature.
- [ ] Install outside the mutable application-data directory.
- [ ] Confirm `%LOCALAPPDATA%\Jarvis` is writable by the current user only.
- [ ] Copy `.env.example` to the external configuration location and add only required keys.
- [ ] Run startup diagnostics; resolve errors, then warnings.
- [ ] Verify Dashboard, Chat, Memory, Logs, Backups, and System Health.
- [ ] If enabled, smoke-test microphone, WhatsApp Desktop, and TikTok OAuth using non-production targets.

## Upgrade checklist

- [ ] Create and verify a backup before staging an update.
- [ ] Stop active voice, WhatsApp, and TikTok jobs.
- [ ] Verify update version, HTTPS URL, checksum, and publisher signature when available.
- [ ] Install application binaries without replacing user configuration, memory DB, logs, prompts, tokens, or backups.
- [ ] Run diagnostics and the regression smoke set.
- [ ] Keep the previous binary and backup until acceptance is complete.

## Rollback checklist

- [ ] Stop Jarvis and capture crash/update diagnostics.
- [ ] Restore the previous signed application version.
- [ ] Restore the pre-upgrade backup only if a data migration or corruption occurred.
- [ ] Start Jarvis and verify configuration, memory, pending tasks, dashboard, and integrations.
- [ ] Mark the failed release unavailable in the update manifest and retain evidence for triage.

## Test command

```powershell
python -m unittest discover -s tests
```

Result: `Ran 100 tests in 6.805s — OK`.

## Related documentation

- Architecture: `FINAL_ARCHITECTURE.md`
- Acceptance and operational checks: `FINAL_CHECKLIST.md`
- Packaging, backup, and rollback: `DEPLOYMENT_GUIDE.md`
- Quality baseline: `TESTING_AND_PERFORMANCE.md`
