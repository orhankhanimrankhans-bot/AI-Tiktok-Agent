# Jarvis Facebook Workflow Connector

The Facebook workflow node calls Meta Graph API through `workflow/connectors/facebook.py`; PySide6 widgets do not make HTTP requests. Workflow files store only `credential_id`, operation, Page ID, and field mappings. Access tokens are resolved by `workflow/credentials/store.py` and are removed from adapter output, exceptions, logs, and execution records.

## Configuration

Add these values to the private `.env` file used by Jarvis:

```env
FACEBOOK_ACCESS_TOKEN=your_user_or_page_access_token
FACEBOOK_PAGE_ID=optional_default_page_id
FACEBOOK_GRAPH_VERSION=v25.0
```

Named credentials use a suffix. A workflow credential ID of `marketing` resolves `FACEBOOK_ACCESS_TOKEN_MARKETING`, `FACEBOOK_PAGE_ID_MARKETING`, and optionally `FACEBOOK_GRAPH_VERSION_MARKETING`.

Never put the token in workflow JSON. When a user token is configured, `list_pages()` calls `/me/accounts`, caches returned Page tokens only in memory, and strips them from output. When a Page token is configured, set its matching `FACEBOOK_PAGE_ID` so Page operations can use it directly.

## Supported operations

| Operation | Graph endpoint | Expected permission |
|---|---|---|
| Test Connection | `GET /me` | token-dependent basic identity |
| List Pages | `GET /me/accounts` | `pages_show_list` |
| Get Page Information | `GET /{page-id}` | `pages_read_engagement` |
| Create Page Post | `POST /{page-id}/feed` | `pages_manage_posts` |
| Upload Page Video | `POST /{page-id}/videos` | `pages_manage_posts` |
| Check Video Status | `GET /{video-id}?fields=id,status` | `pages_read_engagement` |

Meta can additionally require App Review, Business Verification, a Page role/task such as content creation, or dependent permissions. Jarvis displays the sanitized Meta error code and the permission associated with the failed operation.

## Workflow usage

1. Add a Facebook node from Social.
2. Double-click the node.
3. Choose the real operation, credential ID, and Page ID.
4. Use mappings such as `{{$json.video_path}}` and `{{$json.caption}}`.
5. Use **Test Step — Real Meta API** for safe read operations. Posting and video operations perform the configured real write, so use them deliberately.
6. Press **Run** to execute nodes in dependency order. Execution records are saved under the workflow `executions` directory and shown in the EXECUTIONS tab.

Meta references: [Pages API posts](https://developers.facebook.com/docs/pages-api/posts/), [Page videos reference](https://developers.facebook.com/docs/graph-api/reference/page/videos/), and Meta's [Facebook API Postman collection](https://www.postman.com/meta/facebook/overview).
