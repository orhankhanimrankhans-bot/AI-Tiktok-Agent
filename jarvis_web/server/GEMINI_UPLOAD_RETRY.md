# Gemini upload recovery
Separate upload budget: three attempts, backoff 1s and 3s. Recognized HTTP
408/429/500/502/503/504 and bounded nested network causes are retryable.
400/415 invalid requests/media, 401/403 authorization, 413 size, local read
failures, and unknown errors stop immediately. No raw provider messages logged.

Each upload call receives the same validated private path; SDK 2.20.0 opens a
fresh file handle, reads from offset zero and closes it in finally. No stream
object is shared. After successful upload, readiness/inference uses the same
file and retains its existing four-attempt 3/8/15s policy.

An application upload deadline is ambiguous because this SDK does not propagate
all per-call upload options to the byte-transfer stage. It stops automatic
replacement to avoid overlapping uploads and cleans a late returned file.
Missing upload confirmation similarly stops. If the provider completed a file
but the response was lost, its name is unavailable; orphan cleanup cannot be
guaranteed by this client. No provider configuration or dependency changes.

SDK network errors can be wrapped as Error -> TypeError -> socket error.
The previous classifier inspected only one cause and missed this retryable
shape. The live report alone cannot prove this was the user's exact failure:
available production diagnostics did not identify it. Manual second-execution
success has not been reproduced in an authorized workspace.
