# Facebook duplicate protection

All manual and scheduled Corex Publish Reel requests use the same server-side
guard. Each workspace and destination Page has a persistent publication ledger.
The source file ID and SHA-256 of the video bytes both identify repeats. Renaming,
copying a file, changing credentials for the same Page, or changing captions does
not authorize a second submission. Different Pages and workspaces remain isolated.

The reservation is committed before Facebook upload initialization. Concurrent
requests and restarts cannot expire it into permission to upload again. Confirmed
success returns the original publication with `duplicateBlocked: true` and
`DUPLICATE_ALREADY_POSTED`; the normal all-publisher archive barrier still applies.
Pending uploads are checked by video ID without uploading or finishing again.
Unknown outcomes return `facebook_duplicate_pending` and retain the source.
Even a rejected submission remains blocked pending reconciliation; this deliberately
favors avoiding repeats over automatic recovery of failed uploads.

Existing Facebook publication history is imported by original source file ID.
Old posts with no recorded source ID cannot be identified retrospectively. Byte
hashes protect new submissions and attach to imported records when encountered.
Re-encoded or edited copies with new source IDs are not perceptually matched.
This change does not delete existing duplicates, change credentials/access, or
change YouTube/TikTok publishing. It prevents Facebook repeats for every access
account, not repeats across unrelated accounts or destinations.

Validation uses fake provider responses, real streamed local media and persistent
SQLite. No real videos are uploaded by the tests.
