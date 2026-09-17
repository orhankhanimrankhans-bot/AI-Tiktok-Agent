# Multi-Page Facebook credentials

Baseline: 84559cac5cf9a7aa13e76850254708f2066449b1.

The connected OAuth credential supplies the existing account authorization. GET
/api/facebook/credentials/:credentialId/pages fetches the complete authorized
Page list; POST to the same path accepts only pageId and rechecks authorization.
No Meta App per Page or additional OAuth exchange is required by Add Page.

New credentials use existing encrypted facebook_credentials storage, including
workspace ownership, account ID, app ID, Page ID/name, user authorization and
only the selected Page token. Add Page checks workspace + Page ID in a serialized
transaction and returns an existing credential without writing it. Existing
rows, including pre-existing duplicates, are not rewritten or removed.

The modal refreshes the existing credential list after adding a Page. It never
changes a workflow's selected credential. Each node retains its own credentialId.
Existing OAuth reconnect remains available; it refreshes its selected credential,
not all credentials associated with that account.

No schema migration or configuration change is introduced. Rollback removes
the new UI/routes; created credentials remain compatible with the previous
single-Page publishing implementation. Do not delete credentials on rollback.

Validation uses mocked Meta responses and local HTTP sessions. Real Meta
authorization, Page visibility and authenticated browser appearance require a
separate authorized acceptance check. No production calls or deployment are
part of this implementation.
