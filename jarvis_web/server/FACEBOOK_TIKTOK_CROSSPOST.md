# Facebook to TikTok crossposting

Entry: `/tiktok/crosspost`, linked from `/tiktok`.

This is an independent queue, not a workflow schema change. It does not edit,
execute, archive, or publish to existing Facebook/YouTube/Drive workflows. No
permission definitions, credentials, OAuth scopes, or access settings are changed.

## Behavior

1. Select an existing connected Facebook Page credential and the current TikTok
   destination. Route identity is pinned to that Page and TikTok account reference.
2. Check Facebook manually or enable five-minute discovery. It reads the Page's
   uploaded-video edge with a Page-authorized token. Most recent 500 videos per
   scan, at most five routes per workspace. Limited scans are reported explicitly.
3. New videos enter `NEEDS_REVIEW`; discovery never posts unseen videos.
4. Review downloads the original accessible video through Meta's source field.
   Videos not returned by the Page edge, missing source, or missing Page ownership
   are unsupported and fail explicitly. No Facebook scraping or downloader service.
5. Existing Direct Post review enforces preview, exact file hash, editable caption,
   explicit privacy, current creator limits, disclosures, music consent and consent.
6. Approve and publish now, or schedule within six days. Worker checks every 30s;
   server must be running. Turning discovery off does not cancel scheduled posts;
   use each item's Cancel approval / schedule button.

Public posting remains blocked by the existing server private-testing flag and
TikTok audit restrictions. This feature does not grant approval or enable automatic
public publishing of every newly discovered video. Approved scheduled videos can
post without a browser session. Each new video needs its own review.

## Isolation and storage

Only new `fb_tiktok_routes`, `fb_tiktok_items`, and `fb_tiktok_locks` tables are
added to the credential DB. Existing Direct Post service is called unchanged.
API namespace `/api/crosspost/facebook-tiktok` has its own strict authentication,
existing permission checks (`view_facebook`, `manage_workflow_credentials`,
`run_workflow`), same-origin/custom-header CSRF check, and owner-scoped lookups.
Worker rechecks enabled workspace, expiry, permissions, source credential, Meta
configuration and TikTok account before operations. Permissions are never granted.

Video retrieval uses fixed Graph endpoints, opaque paging cursors, bounded reads,
timeouts, HTTPS Meta CDN host allowlist, no redirects and no credentials on CDN
requests. URLs and tokens never enter queue responses. Media is registered to the
existing workspace ownership store; preview uses existing authenticated routes.
Limit: ten local videos per workspace, 32 MiB each. Users can remove local copies
and cancel unused approvals. Published ledger entries remain for deduplication.
Pending/uncertain submissions cannot be deleted or retried blindly.

Route+video uniqueness and the existing exact-file/account Direct Post ledger
prevent duplicates. An owner-wide renewable DB lease serializes queue operations
across processes. Before provider work the queue records SUBMITTING; restart checks
the existing Direct Post review, never sends a fresh request. Only provider
PUBLISH_COMPLETE is shown as PUBLISHED. Revoked scheduled jobs become BLOCKED.

## Verification

`node --test --test-concurrency=1 facebookTikTokCrosspost.test.js tiktokDirect.test.js tiktokWorkflow.test.js`

Tests use mocked Graph/TikTok responses and real SQLite/HTTP routes. They cover
workspace isolation, permissions/CSRF, revocation, duplicate scanning, explicit
review, private-only gate, schedule restart/cancellation, lost responses, status
polling, concurrent submissions, Page ownership and download limits.

Live acceptance still requires an authorized Page whose Graph video edge exposes
the intended Reel/video and a permitted TikTok test account. A successful build or
HTTP 401 is not proof of provider access or public publication. Do not rerun other
publishers for this acceptance test. Leave discovery off until the owner selects
the intended Page and destination in the new screen.

Official references:
- https://developers.facebook.com/docs/graph-api/reference/page/videos/
- https://developers.facebook.com/docs/graph-api/reference/video/
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post

Meta's reference pages returned HTTP 429 during implementation. The adapter uses
the existing Graph version and Page-video edge; actual Reel visibility/source
access must be verified with the connected Page rather than assumed.
