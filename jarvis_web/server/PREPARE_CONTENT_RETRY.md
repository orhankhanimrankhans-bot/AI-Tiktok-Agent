# Developer API reliability candidate

Baseline: `9b0232888a6b1ee379eb2f9e94ed0854a3eec2b5`.

This release retains the existing Gemini Developer API constructor, key/model
selection, factual-analysis schema/prompt, and OpenAI publishing-copy contract.
There is no provider selector, Vertex transport/configuration, ffprobe dependency,
credential migration, or Facebook publishing change.

The reported generic error originated in the production generateContent catch.
It does not establish the historical provider status. Download already awaits the
response and closes its binary before returning; inference waits for upload and
ACTIVE. This fix handles transient failures at those provider boundaries.

Each Prepare Content analysis permits at most four application attempts, with
3s, 8s, 15s backoff. SDK retries are disabled. Retryable cases are specific file
readiness errors, HTTP 408/429/500/502/503/504, recognized network errors/timeouts,
and empty/malformed/truncated model output. Authentication, permission, arbitrary
HTTP 400, safety/prompt refusal, low confidence, and unknown errors stop immediately.
The final classified code/message is preserved; provider bodies are not returned
or logged. The public HTTP status distinguishes quota, availability and timeout.

The uploaded file/client are request-local and reused during retries. A stale
ACTIVE rejection triggers polling of the same file. Only a terminal FAILED file
with a known transient processing code is replaced. Cleanup runs after completion
or exhaustion and before replacing failed resources. A lost upload response can
leave an unknown resource for provider expiry; its ID cannot safely be recovered.

The existing 120s attempt budget now bounds upload, polling and inference together.
Cleanup has a separate 10s bound. Four full attempts plus backoff and four cleanup
calls can take approximately 546s, before the unchanged OpenAI generation timeout.
No frontend or host timeout configuration is changed. Live end-to-end timing and
provider behavior require a separately authorized deployment smoke test.

Tests use mocked providers and synthetic media. The production baseline scope
assertion is updated to freeze unrelated runtime modules at 9b02328; it normalizes
Windows checkout newlines. No live publication is performed during validation.
