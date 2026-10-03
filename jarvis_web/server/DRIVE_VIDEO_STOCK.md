# Google Drive video stock monitor

The monitor reads source folder IDs and credential references from saved `Search Files and Folders` nodes, including inactive workflows. Move File destinations are not monitored. Identical workspace/folder/credential references are deduplicated. No workflow configuration or publishing behavior is changed.

`drive_video_stock` and `drive_stock_scan_lock` are created idempotently in the existing persistent credential database. Failed checks preserve the previous count, name and successful-check time. The API marks those rows unavailable. Deleted workflow sources disappear from the view; their historical rows are retained.

Drive metadata requests retrieve real folder names and all pages of direct children (not recursive descendants). Only video MIME types or mp4/mov/mkv/webm/avi/m4v extensions count. Google-native folders and shortcuts do not count. No video contents are transferred. OAuth credentials remain server-side and workspace-scoped.

Healthy: 11 or more. Low: 6–10. Critical: 0–5. Logs record stock-status transitions, not repeated unchanged counts.

Startup checks due sources. A one-minute timer dispatches checks when the persisted last-check time reaches six hours. Restarts retain that due time. Manual refresh checks immediately. A renewable SQLite lease prevents overlapping scans across requests/processes; a crashed process releases its lease after 90 seconds. Repeated `start()` calls do not add timers. Disabled/expired workspaces and workspaces without storage + view_workflow permission are not scanned.

GET `/api/drive/video-stock` returns only the authenticated workspace's configured folders. POST `/api/drive/video-stock/refresh` returns 202 and starts a background metadata scan. Both require storage and view_workflow permissions. Dashboard polls every five seconds, so counts appear after background completion. Unauthenticated callers cannot access stock records.

Validation: `node --test driveVideoStock.test.js driveVideoStockRoutes.test.js`. These tests use fake Drive metadata, temporary SQLite, and local HTTP only; they never publish videos. Production acceptance additionally requires observing real persisted folder names/counts after worker startup. An unauthenticated public health check does not prove signed-in browser behavior.
