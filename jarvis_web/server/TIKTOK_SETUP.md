# TikTok inbox upload

Corex provides an authenticated `/tiktok` page, also reached from its TikTok navigation item. This implementation sends a manually selected and previewed video to TikTok's inbox. Users complete captions, settings, and publication inside TikTok. The TikTok workflow node uses the same workspace account to upload downloaded videos on explicitly authorized manual or scheduled runs. It never directly publishes a public post.

## Server configuration

Configure these privately in the deployed Node application's environment:

```
TIKTOK_CLIENT_KEY=<TikTok app client key>
TIKTOK_CLIENT_SECRET=<TikTok app client secret>
TIKTOK_REDIRECT_URI=https://direngineeringsolutionscom.com/api/tiktok/auth/callback
```

Use the corresponding sandbox credentials for sandbox tests. Never commit credentials. Missing configuration leaves the application functional but shows TikTok as unavailable. Existing `CLIENT_URL`, persistent session/database configuration, and credential encryption secret must remain stable.

In TikTok's Login Kit Web settings, register the exact HTTPS redirect URI above. Enable Content Posting API's Upload to TikTok and request `user.info.basic` and `video.upload`. Direct Post / `video.publish` is not used by this flow.

## Security and operational boundaries

- Authenticated workspace and both account-management and execution permissions are required. No anonymous or administrator credential fallback.
- AES-256-GCM account encryption binds ciphertext to its owner; no tokens or upload URLs go to the browser.
- OAuth state is random, persisted, single-use, session/workspace/configuration-bound, and expires after ten minutes.
- Writes require the configured client origin and a custom request header.
- One account per workspace. Connecting another account replaces that workspace's connection; existing job status requires the original account.
- Videos are limited to 32 MiB to bound memory use on this host. Media container signatures are checked; TikTok remains responsible for final codec/duration/content acceptance. Selected videos are not persisted by this route.
- Per-workspace database locks serialize provider work. A durable upload record prevents the same request or video from being initialized again for 24 hours. Uncertain outcomes must be checked, never automatically retried.
- Disconnect removes account, OAuth, and upload records locally and attempts provider revocation. Failed remote revocation is explicitly reported.

## Workflow node

Add TikTok from the node picker and connect it after Download File or Prepare Content. Select the connected account, choose the input binary property, and authorize inbox uploads. Changing the selected account requires new consent. Prepare Content can branch to YouTube, Facebook, and TikTok; connect all requested branches to Move File. Move File waits for confirmed TikTok inbox delivery and success from every other connected publisher. Pending, failed, or uncertain uploads retain the source. Retrying the TikTok node checks the durable existing upload instead of uploading the same bytes again within 24 hours. Do not rerun other successful publisher nodes to repair a downstream archive failure.

The node accepts only workspace-owned downloaded binary references. Workflow media follows the existing download storage lifecycle. No real uploads occur in automated tests.

## Acceptance and demo

1. Publish the reviewed build and configure credentials. Confirm `/terms`, `/privacy-policy`, `/tiktok`, and the verification text file remain reachable.
2. Sign in to Corex. Connect a permitted TikTok sandbox/test account and approve the displayed scopes.
3. Confirm the returned account name. Select an authorized test video, preview it, and tick the upload consent checkbox.
4. Send to TikTok inbox. Check status until TikTok confirms inbox delivery. Open TikTok and finish editing and posting only if intended.
5. Record this real flow for review. Do not use mock test output as proof of TikTok acceptance.

Policy contact/operator details must be supplied and reviewed before app submission. Automated tests cannot demonstrate TikTok app approval, OAuth success with real credentials, inbox delivery, or publication.

Official references:
- https://developers.tiktok.com/doc/login-kit-web
- https://developers.tiktok.com/doc/oauth-user-access-token-management
- https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
