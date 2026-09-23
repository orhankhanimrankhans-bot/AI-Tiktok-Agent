# Reviewed TikTok Direct Post

This implements Direct Post in the existing TikTok workflow node. Inbox remains
the default operation. No existing workflow is changed automatically.

## Enable private testing

1. In the same TikTok **Sandbox** whose credentials are already on the server,
   enable Content Posting API / Direct Post (`video.publish`) and apply changes.
   Retain Login Kit, `user.info.basic`, `video.upload`, the existing callback, and
   the target account. Verify the Corex domain/URL prefix for video retrieval.
2. Direct Post private testing is enabled by default in this release. It can be
   disabled with `TIKTOK_DIRECT_POST_ENABLED=false`. Leave
   `TIKTOK_DIRECT_POST_PUBLIC_ENABLED` absent or `false`. Redeploy/restart if changing flags.
3. Open a TikTok node, edit its credential, and choose **Connect with Direct Post
   permission**. Complete the real TikTok authorization and save the connection.
4. Use a private TikTok test account as required by unaudited TikTok clients.
   Changing account visibility is a user decision; Corex does not change it.
5. Execute the source/download/preparation nodes to obtain a real MP4/MOV input
   (up to 32 MiB). Choose **Direct Post**, then **Load video and TikTok posting
   options**. Review the exact video, caption, and live creator information.
6. Manually select Only me for private testing. Choose interactions, AI label,
   commercial disclosures if applicable, and both consent checkboxes. Approve.
7. Execute **only the TikTok step** for the test. Do not rerun successful
   YouTube/Facebook uploads to test TikTok. Check real provider status and the
   private video on TikTok. Nothing is considered published until PUBLISH_COMPLETE.

The schedule can execute an approved video within 7 days, without phone approval.
This is **not** unattended approval of arbitrary future generated content. Every
new video needs review. Approvals bind workspace, account, SHA-256 file content,
caption and settings. A re-download with the same content can use the approval;
changed bytes cannot. Caption regeneration does not replace the approved caption.
Cancel an unsubmitted approval before editing/reviewing it again.

## Data and failure behavior

Direct reviews and post jobs use additional SQLite tables in the existing
credential database. Existing inbox jobs are unchanged. Approval retries never
re-initialize an uncertain or already published job. Explicit provider rejection
or FAILED can be cancelled and reviewed again; uncertain outcomes cannot.

Video previews require the authenticated workspace. After approval and when a
post starts, Corex issues a random, one-hour, single-video capability for TikTok's
PULL_FROM_URL. It is bound to the approved file hash and current account and is
revoked on disconnect or terminal status. Treat that URL as sensitive. It cannot
enumerate files. No provider token is returned to the browser. Domain verification
must cover `/api/tiktok/media/` on the callback origin.

The shared archive barrier retains the source until Direct Post completes and all
other requested publisher branches succeed. Source Drive identifiers are retained.

## Public posting and review

Public posting still requires TikTok's Direct Post audit and appropriate app/user
permissions. Only after actual approval should an operator enable
`TIKTOK_DIRECT_POST_PUBLIC_ENABLED=true` and connect approved production credentials.
The flag does not grant provider permission and does not bypass TikTok enforcement.

Record the real browser flow on the production domain using Sandbox credentials:
OAuth connection, selected video preview, editable caption, manually chosen privacy,
interaction/disclosure/consent controls, approval, actual execution status, and the
result in TikTok. If requesting video.upload too, also demonstrate its inbox flow.
Do not claim public posting was demonstrated by a private test. Do not describe
the app as serving a public audience if it only serves its owner/team. The latter
use is excluded by TikTok's published Direct Post intended-use guidelines, so a
submission may be rejected even with a technically working demo.

Sources (checked 2026-09-24):
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
