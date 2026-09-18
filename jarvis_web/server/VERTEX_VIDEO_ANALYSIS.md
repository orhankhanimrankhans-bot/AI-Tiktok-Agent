# Direct Vertex Gemini video analysis candidate

Based on production c362b11fdfac9140e93b3f44a7ad0b196fd5afe4. No dependency changes. The September 18 continuation also adds shared media ownership and usage enforcement for multi-user production use.

## September 18 Hostinger validation and activation status

The isolated Hostinger test completed the full Vertex video analysis and existing OpenAI title/caption/hashtags flow in 22.251 seconds. It produced "Metal Chair Being Shredded", retained the sample binary, and completed cloud cleanup without a cleanup failure. A foreign workspace was denied before provider work. This is an isolated server-side test, not a signed-in production UI acceptance test.

The test found and fixed an ADC bug: passing `apiKey: ""` caused the SDK to emit an empty API-key header instead of Authorization when no Developer key was present. Omit `apiKey`; explicit project/location takes precedence over environment keys. Regression tests now check actual Authorization header presence with and without a Developer key.

Fresh validation: 303 server tests, 226 client tests, and the client production build passed. Production provider selection has not been changed. The credential is installed outside the web root in the existing persistent data directory with mode 0600. Activation still requires the existing site's hPanel environment settings and deployment of this candidate; never patch generated release directories. Keep existing environment variables, encryption keys, databases, OAuth settings and Developer credentials for rollback.

## Multi-user enforcement

The production execution service records new Download File references in `prepare-content-policy.sqlite3` beside the existing credential database. Prepare Content checks that the reference belongs to the requesting workspace before any provider call. Old unregistered references fail closed: download the video again after deployment. No legacy ownership is guessed or assigned to the owner account.

Browser jobs, the direct HTTP route, and manual/scheduled workflow execution pass the server-derived workspace to the same service. HTTP Prepare Content requires a signed-in session with `run_workflow` permission. Job results remain workspace scoped.

SQLite transactions apply these configurable positive-integer limits across workers sharing the same persistent database:

- `PREPARE_CONTENT_DAILY_LIMIT=50`: attempts per workspace per UTC day, including provider failures.
- `PREPARE_CONTENT_WORKSPACE_CONCURRENCY=2`: active calls per workspace.
- `PREPARE_CONTENT_GLOBAL_CONCURRENCY=4`: active calls overall.

Provider retries within a call count as one attempt; this is an attempt limit, not a monetary spending cap. Active leases heartbeat every 15 seconds and expire after two minutes without a heartbeat. As with any lease, a stalled worker or provider-side work continuing after a timeout can outlive the lease. Usage counts survive restarts. The browser's existing job admission limits are additional to this shared policy.

## Selection and configuration

Default remains `GEMINI_PROVIDER=developer` (also when unset). Explicit `vertex` requires all four server-only settings:

- `GEMINI_VERTEX_PROJECT` (or existing `GOOGLE_CLOUD_PROJECT`): intended project is `project-cbb58099-9e8b-4ba4-a05` (not hardcoded).
- `GEMINI_VERTEX_LOCATION` (or existing `GOOGLE_CLOUD_LOCATION`): supported region, or `global` if acceptable for data location.
- `GEMINI_VERTEX_MODEL`: a video-capable Gemini model available to the project/location. Must be verified live; no implicit model replacement.
- `GEMINI_VERTEX_BUCKET`: private bucket name only, without a URI or path.

Authenticate with Application Default Credentials. Prefer Workload Identity Federation for an external host where available. Otherwise provision a service-account credential file securely outside the repository and web root and point `GOOGLE_APPLICATION_CREDENTIALS` at it. Never paste credentials into chat, browser storage or source control. SDK uses explicit project/location, ADC and a pinned Google Vertex base endpoint with `v1`; Developer API keys and base-URL environment overrides do not select the Vertex endpoint.

Missing/invalid Vertex configuration fails closed, with no Developer fallback. `geminiConfigured` means configuration fields are present, not that IAM/billing/provider access has been verified. OpenAI remains required for publishing copy/title repair.

## Existing GitHub Vertex script audit (September 18)

Remote main contains `summarize_video.py`, introduced by `3baaa4f`. It uses `genai.Client(vertexai=True, api_key=os.environ.get("GOOGLE_CLOUD_API_KEY"))`, a fixed YouTube URL and an example summarization prompt. It is not called by the Node Prepare Content service. Its API-key/Express initialization does not provide the ADC/private-storage credentials used by this candidate. Do not copy its unrelated prompt, safety settings or model name into production without verification.

A presence-only audit found none of `GOOGLE_CLOUD_API_KEY`, `GEMINI_PROVIDER`, the Vertex project/location/model/bucket settings, or `GOOGLE_APPLICATION_CREDENTIALS` in the checked root/server local .env files or the live Hostinger Node process environment. No values were printed and no production settings were modified. This does not establish whether credentials/resources exist elsewhere in Google Cloud or on disk. Live authentication, bucket availability and credit eligibility remain unverified.

## Cloud prerequisites before activation

1. Verify billing and Vertex AI API are enabled and the chosen model is accessible. The IAM screenshot alone does not prove these conditions. Agent Engine deployment/agent identity is not required.
2. Give the runtime identity Vertex inference permission (for example Vertex AI User); do not grant project Owner for this integration.
3. Use a dedicated private GCS bucket, preferably in the same project and compatible region. Enforce uniform bucket-level access and public access prevention. The code checks both before sending video.
4. Grant runtime bucket metadata read (`storage.buckets.get`) and the needed object permissions (`storage.objects.create`, `storage.objects.get`, `storage.objects.delete`) only on that bucket. Verify Vertex can read the private video with that identity/project arrangement.
5. Set a delete lifecycle on `prepare-content/` objects (for example one day) to catch interrupted/late uploads. Review soft delete, retention and versioning for unwanted retention/cost. Lifecycle is not configured automatically.
6. Run an authorized small-video acceptance test through the existing async Prepare Content job and verify output and object cleanup before production activation.

## Runtime behavior

The browser/scheduler use the same server execution service. Alongside provider selection, the shared policy enforces media ownership and usage limits. Download reference format, factual schema/prompt, OpenAI/title repair, output fields, async job ownership and Facebook handoff remain unchanged.

Vertex uploads once to a random `prepare-content/<UUID>` object with a create-only generation precondition. A confirmed GCS write replaces the Developer Files upload/ACTIVE polling; no Vertex `files.upload()` is used. The same object is referenced on all inference attempts. Four attempts, base delays 3/8/15 seconds, validated provider delay and 120-second cap are preserved. Vertex has its own process-local cooldown (using the existing allowlisted request-quota metadata); Developer cooldown state is separate.

This initial Vertex path makes one bounded GCS upload attempt, with SDK transport retries disabled. It does not blindly repeat an upload with uncertain completion. This differs from the existing Developer Files upload retry path, which is unchanged. A later GCS retry enhancement should reconcile generation/object existence before retrying.

Cleanup is attempted after success and failure, using the confirmed generation when available. Cleanup failures emit only a sanitized event and do not discard successful analysis. Lifecycle is required to handle process death or a late upload after cleanup. Objects are never public and their names/URIs are not returned to the browser or logged.

Diagnostics reuse the inference allowlist and add a provider-specific event with correlation ID, stage, attempt and `sourceReady`/`sourceKind`. `fileActive: false` in the shared diagnostic is expected: Vertex does not use Developer Files ACTIVE state. No prompts, credentials, video contents, paths or object URIs are logged.

## Validation and rollback

Automated tests mock cloud calls; an SDK-level test intercepts fetch to verify the actual v1 Vertex path and ADC header behavior. They do not prove live IAM, billing, quotas, model availability or video interpretation.

No migration or credential rewrite. Roll back selection with `GEMINI_PROVIDER=developer` and the existing Developer key/model, after draining active jobs and restarting through the normal deployment process. Existing jobs capture the selected server service; changing environment requires a process restart. Vertex can still return rate-limit/service errors; moving providers does not guarantee unlimited quota.

References:
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/googlegenaisdk-textgen-with-video
- https://docs.cloud.google.com/docs/authentication/provide-credentials-adc
