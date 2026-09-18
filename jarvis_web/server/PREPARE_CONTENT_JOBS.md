# Prepare Content short-request job transport

Observed production evidence: HTTP request 7364f55d-a71b-4328-be3f-77a916dcb853
started 2026-09-18 12:07:21.283 UTC, closed unfinished after 55,919 ms, and
attempted its JSON 429 response after disconnect at 114,619 ms. The browser
reported HTTP 504. The logs establish premature connection closure; they do not
identify the specific hosting proxy component.

The browser now submits POST /api/ai/prepare-content/jobs, receives HTTP 202 and a
job ID, and polls GET /api/ai/prepare-content/jobs/:id every two seconds. Each
browser HTTP request has a 15-second timeout. One ambiguous submission retry uses
the same random request ID; SQLite uniqueness by owner + request ID prevents a
second provider execution. Transient polling failures retry only the read, up to
five consecutive failures. Authentication/permission errors stop immediately.

Existing synchronous provider services and the old API route remain available.
Gemini upload, retries, cooldown, model and OpenAI title repair are untouched.
The returned provider result still passes through mergePreparedContent so original
binary/reference metadata and Facebook handoff remain unchanged.

The new additive prepare-content-jobs.sqlite3 file lives alongside the configured
persistent JARVIS database. It stores job status and final output, not API keys,
input prompts, or binary/video contents. Every job lookup is workspace-scoped;
submission and polling require the existing run_workflow permission. The shared
SQLite file supports requests handled by different local Node processes.

Background work runs in the submitting process. A 15-second heartbeat supports
interruption detection; missing heartbeat for 60 seconds fails the job explicitly.
Jobs are not silently resumed after worker death (avoids duplicate provider work).
Running jobs expire at 40 minutes; records are removed after one hour on access.
Admission is bounded to two running jobs per workspace and 16 across this database.
Only a result/status is persisted; active providers may finish after browser exit.

This removes the long synchronous browser request, not the underlying Gemini
quota restriction. Real quota failures still surface as classified job failures.
No hosting timeout, billing, credential, provider or model changes are required.
Rollback restores the old browser transport; the additive job database can remain.
Do not remove it while work is running. No existing workflow or credential tables
are changed. Reload/reopen does not yet resume a browser's abandoned job ID.

Validation: local mocked HTTP submission responds before provider completion;
separate SQLite connections can poll results; duplicate keys don't rerun work;
cross-owner reads fail; simulated 120-second work completes via short polls;
provider errors and interrupted work are explicit. Local tests are not production
provider acceptance. This candidate has not been deployed.
