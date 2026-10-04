# Prepare Content daily allowance

An operator can place `prepare-content-limits.json` beside the persistent `prepare-content-policy.sqlite3` database, with `{"dailyAttemptsPerWorkspace":100}`. This setting overrides `PREPARE_CONTENT_DAILY_LIMIT` inherited from the host; otherwise the environment setting and existing default remain in effect. Restart/redeploy the app after changing it. No client API writes this file.

Production allowance was raised to 100 on 2026-10-04. Existing daily usage is retained, each workspace has its own counter, and the UTC midnight reset and concurrency rules are unchanged. Keeping the file in the persistent data directory preserves it across deployments.
