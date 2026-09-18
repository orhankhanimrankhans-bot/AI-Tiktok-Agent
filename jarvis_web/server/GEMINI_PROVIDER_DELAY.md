# Gemini provider-directed inference delay

Retryable inference failures wait max(configured 3s/8s/15s backoff, validated
provider guidance), retaining the four-attempt maximum. The existing diagnostics
parser supplies numeric RetryInfo/Retry-After guidance; the larger value wins.
Malformed, negative, non-finite, and values above 24 hours are ignored. Accepted
delays are capped at 120 seconds, covering the observed 46-second guidance without
allowing hours-long sleeps. Guidance above the cap is not fully honored and can
still result in quota rejection within the unchanged attempt budget.

Positive guidance on retryable request_quota/RPM/RPD responses extends one shared
process-local timestamp, including after the final failed attempt. Each inference
waits after file readiness, before the model call. Waiting neither consumes the
provider timeout nor uploads another file. Extensions are rechecked; one admission
wait is bounded to 120 seconds. Continued extensions return the terminal classified
error gemini_cooldown_wait_timeout; remote file cleanup still runs.

Only a timestamp is shared, never credentials, user data, binary references or
outputs. There is no cross-host coordination, distributed queue or strict RPM
limiter. Upload retries, model/provider selection, OpenAI title repair and output
schema remain unchanged. Tests use fake clocks and mocked provider responses;
local tests do not establish live quota recovery.
