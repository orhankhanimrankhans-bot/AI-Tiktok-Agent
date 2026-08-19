# Jarvis v2.0 RC1 Final Checklist

Date: 2026-08-15

## Automated release gate

- [x] Version synchronized as `2.0.0-rc1` in runtime and installer metadata.
- [x] Python sources compile and import through the regression suite.
- [x] Full regression command completed successfully.
- [x] 100 tests passed in 6.805 seconds.
- [x] Performance checks remained within their test thresholds.
- [x] Dashboard startup, message flow, background execution, and API-failure recovery passed.
- [x] Conversation success/failure/history behavior passed with deterministic transports.
- [x] Voice lifecycle, repetition, recognition failure, and dashboard responsiveness passed.
- [x] Memory persistence and restart recovery passed.
- [x] WhatsApp resolution, draft, confirmation, duplicate prevention, and restart recovery passed.
- [x] TikTok pipeline boundaries remained covered by regression tests.
- [x] Skill discovery/loading/disablement/failure recovery passed.
- [x] Plugin validation/lifecycle/disablement/failure isolation passed.
- [x] Configuration validation and diagnostics recovery passed.
- [x] Backup, restore, update integrity, and update recovery passed.
- [x] Request IDs and security-log redaction passed.

## Security gate

- [x] Production source scanned for common hardcoded key/private-key signatures.
- [x] Runtime secrets and data paths are Git-ignored.
- [x] Configured secret value was checked for clear-text leakage in logs.
- [x] Structured log fields, messages, representations, and exceptions are redacted.
- [x] Production update URLs require HTTPS.
- [x] Update payload checksum is validated before staging.
- [x] Tool execution remains in Python rather than model-side execution.
- [x] WhatsApp send requires explicit confirmation and guards duplicates.
- [ ] Sign executable and installer with Authenticode before GA.
- [ ] Sign the update manifest or move to an authenticated metadata format before GA.
- [ ] Decide and document encryption-at-rest policy for tokens, databases, and backups.
- [ ] Complete dependency vulnerability/SBOM review in the connected release environment.

## Manual candidate validation

- [ ] Configure a release OpenAI key and run a normal multi-turn ChatGPT conversation.
- [ ] Exercise timeout, bad-key, rate-limit, and network-offline UI messages against a staging account.
- [ ] Test microphone selection, recognition language, repeated turns, TTS, stop/restart, and device unplug/replug.
- [ ] Send one WhatsApp message to an approved test contact; verify draft and confirmation text.
- [ ] Restart with an unconfirmed WhatsApp task and complete it exactly once.
- [ ] Run TikTok OAuth and a private/test publish; verify duplicate protection and recovery.
- [ ] Exercise every dashboard page at 100%, 125%, and 150% Windows scaling.
- [ ] Verify keyboard shortcuts, theme persistence, notification behavior, and code-copy/regenerate actions.
- [ ] Force a plugin and a skill to fail; confirm dashboard status and continued conversation operation.
- [ ] Create, validate, and restore a backup on a clean Windows user profile.
- [ ] Simulate a checksum mismatch and interrupted update; verify prior version remains runnable.
- [ ] Install and uninstall the generated setup package on clean Windows 10 and 11 VMs.

## Administrator checklist

- [ ] Restrict `%LOCALAPPDATA%\Jarvis` ACLs to the intended user and administrators.
- [ ] Keep `.env`, token stores, backups, logs, crash reports, and SQLite files out of support bundles unless scrubbed.
- [ ] Bind local services to loopback; do not expose the dashboard directly to an untrusted network.
- [ ] Configure log retention and protected backup destination.
- [ ] Monitor API quota, authentication, plugin health, disk space, and backup age.
- [ ] Rotate any credential suspected of exposure; do not rely only on log redaction.
- [ ] Publish checksums and signed artifacts over HTTPS.

## Developer checklist

- [x] Working WhatsApp/TikTok behavior was preserved behind established boundaries.
- [x] Orchestrator is the only cross-skill routing authority.
- [x] Plugins and skills expose common lifecycle/contracts and fail independently.
- [x] UI work uses background execution and UI-thread result dispatch.
- [x] External transports and devices are injectable for deterministic tests.
- [x] User data is external to packaged application binaries.
- [ ] Require the single regression command in CI for every release commit.
- [ ] Add Windows installer smoke VMs, dependency scanning, SBOM generation, and signing to CI.
- [ ] Tag RC1 only after manual candidate validation is signed off.

## Release decision

Automated gate: **PASS**.  
Candidate folder-build gate: **PASS**; the SHA-256 is recorded in `RELEASE_CANDIDATE.md`.  
Installer gate: **PENDING** Inno Setup compilation, signing, and clean-VM validation.  
GA gate: **PENDING** the unchecked security-signing and live/manual validation items above.
