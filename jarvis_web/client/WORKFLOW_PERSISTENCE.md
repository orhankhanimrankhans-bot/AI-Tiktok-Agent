# Workspace workflow persistence

Browser draft and server-linkage storage now uses
jarvis_workflow_v3:<server-owner-role>:<profile-id-or-primary>.
Unknown/unauthenticated identities do not mount the editor. Switching identity
remounts the editor and restores only that workspace's scoped draft.

One unpublished draft per workspace is supported. New Workflow refuses to
discard a nonempty local draft or dirty server edits; publish the draft or save
the server edits first. It does not create an empty server row. Local Save still
saves the draft; Publish creates a new server row for an unlinked editor and
updates only the selected ID for a linked server editor.

The unowned legacy jarvis_workflow_v2 value is left untouched and never
automatically assigned to the current user. Existing server workflows remain
available through Workflow Manager. A legacy local-only draft requires explicit
ownership confirmation before a separate recovery/import; this patch does not
perform such recovery.

No server schema, listing, credential, provider, or production data changes.
Rolling back restores old browser-key behavior; v3 drafts remain stored but are
not read by the old application. Do not delete either key during rollback.

Tests use in-memory SQLite and mocked requests, not production user data.
