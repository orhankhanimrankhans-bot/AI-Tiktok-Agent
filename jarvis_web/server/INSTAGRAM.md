# Instagram Reels

The Instagram node is available to existing and new workspaces. Connections and app settings are encrypted and isolated by workspace; no administrator credentials are inherited. Existing workflows are not rewritten.

## Connect

1. Add **Instagram** from the workflow node picker, then **Create new credential**.
2. In Meta's developer dashboard configure **Instagram API with Instagram Login**. Use its Instagram App ID and Instagram App Secret, not a Facebook Page token.
3. Register the exact callback shown by Corex: `https://direngineeringsolutionscom.com/api/instagram/auth/callback`.
4. Save app settings and connect the Creator or Business account, granting `instagram_business_basic` and `instagram_business_content_publish`.
5. Select **Use this account**, review the caption expression/feed setting and authorize the node's manual and scheduled publishing.

App-role/test accounts can be used during development. Other accounts need the appropriate Meta app review/access. A Creator account alone is not API approval. This implementation does not require a linked Facebook Page.

Admin is supported. Child requires its existing `manage_workflow_credentials` and `run_workflow` permissions. Additional Access requires `edit_workflow` and `run_workflow`. No permissions are automatically granted. Disabled and expired workspaces cannot connect, publish, or serve video capabilities.

## Workflow

Download File → Prepare Content → Instagram → Move File. Instagram can also join the existing Facebook, YouTube and TikTok publishing branches; Move File waits for every requested branch.

MP4/MOV up to 128 MiB is accepted locally; Instagram enforces codec, duration, account and platform limits. Corex gives Instagram an expiring URL for only the selected video; the URL is not returned to the browser. Captions support expressions and are limited to 2,200 characters. Share to feed is optional.

If processing remains pending, the node reports that clearly; rerunning checks the original container. A confirmed result includes an Instagram media ID. An uncertain create/publish response is never automatically submitted again. Check the Instagram account before operator intervention. Duplicate history remains after disconnect so reconnecting does not repost the same bytes to the same account. Disconnect removes local tokens and active video links; users can revoke the app in Instagram settings as well.

## Validation boundary

Tests use mocked provider responses and actual local SQLite/HTTP. A production build and deployed API checks do not prove Meta app approval, successful OAuth, or a live Reel publication. Complete connection and an explicitly selected live test to verify those separately.

Reference: Meta's official Instagram collection: https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00
