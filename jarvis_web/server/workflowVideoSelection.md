# Automated video selection

Workflow executions skip previously submitted source IDs for the same workspace and destination before Prepare Content. Downloaded bytes are also checked by SHA-256, so renamed copies can be skipped. A Limit followed directly by Download can replace a duplicate with the next candidate. Search remains bounded by its existing 1,000-file cap; at most 50 download candidates are examined.

Claims persist in the credentials database and are isolated by workspace. Reserved claims expire unless renewed; submitted claims do not expire automatically because a failed response may still represent a successful remote upload. Existing Facebook reservations and same-workflow successful publishing history are respected. Partial successes are not reuploaded. Skipped source files remain in Drive for review; archival still requires all requested publishers to succeed.

Execution node history includes skippedVideos with source ID and reason. All-duplicate input produces no upload. A disconnected Google account requires reconnection; provider errors remain errors. This mechanism applies to shared whole-workflow execution, not standalone publisher HTTP requests.
