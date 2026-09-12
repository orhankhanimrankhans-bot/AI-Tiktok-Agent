"use strict";

const crypto = require("node:crypto");

const OWNER_TYPES = new Set(["admin", "child", "additional"]);
const PAGE_STATUSES = new Set(["ACTIVE", "INACTIVE", "NEEDS_CONNECTION", "PAUSED"]);
const REFRESH_INTERVALS = new Set([15, 30, 60, 180, 360, 720, 1440]);
const DEFAULT_REFRESH_MINUTES = 60;
const DEFAULT_OWNER = Object.freeze({ ownerType: "admin", ownerId: "primary" });
const MAX_REASONABLE_PUBLIC_FOLLOWERS = 2_500_000_000;

class FacebookControlError extends Error { constructor(code, message) { super(message); this.code = code; } }

function ownerKey(owner = DEFAULT_OWNER) {
  const ownerType = String(owner?.ownerType || ""); const ownerId = String(owner?.ownerId || "");
  if (!OWNER_TYPES.has(ownerType) || !/^[A-Za-z0-9_-]{1,255}$/.test(ownerId)) throw new FacebookControlError("INVALID_OWNER", "Facebook workspace is invalid.");
  return { ownerType, ownerId };
}
function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }
function cleanText(value, limit = 200) { return String(value || "").trim().slice(0, limit); }
function normalizeNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.round(number) : null; }
function normalizePublicFollowers(value) { const number = normalizeNumber(value); return number !== null && number <= MAX_REASONABLE_PUBLIC_FOLLOWERS ? number : null; }
function normalizeUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { throw new FacebookControlError("INVALID_URL", "Facebook Page URL is invalid."); }
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)facebook\.com$/.test(host) && !/(^|\.)fb\.com$/.test(host)) throw new FacebookControlError("INVALID_URL", "Only Facebook Page URLs are supported.");
  return url.toString();
}
function normalizeStatus(value, fallback = "ACTIVE") { const status = cleanText(value, 40).toUpperCase(); return PAGE_STATUSES.has(status) ? status : fallback; }
function publicTeam(row) { return row && { id: row.id, name: row.name, notes: row.notes || "", pageCount: row.page_count || 0, createdAt: row.created_at, updatedAt: row.updated_at }; }
function publicMetrics(row) { return row ? { followers: row.followers ?? null, views: row.views ?? null, posts: row.posts ?? row.reels ?? null, reels: row.reels ?? row.posts ?? null, engagement: row.engagement ?? null, followerGrowth: row.follower_growth ?? null, capturedAt: row.captured_at || null, metricMeta: row.metric_meta ? JSON.parse(row.metric_meta) : null } : { followers: null, views: null, posts: null, reels: null, engagement: null, followerGrowth: null, capturedAt: null, metricMeta: null }; }
function publicPage(row, metrics = null) { return row && { id: row.id, pageUrl: row.page_url, pageName: row.page_name, pageId: row.page_id || "", pagePictureUrl: row.page_picture_url || "", teamMemberId: row.team_member_id || "", teamMemberName: row.team_member_name || "Unassigned", credentialId: row.credential_id || "", status: row.status, dataConnectionStatus: row.data_connection_status, syncStatus: row.sync_status || row.data_connection_status, syncMessage: row.sync_message || "", lastSyncAt: row.last_sync_at || null, lastPublicScan: row.last_public_scan || null, lastScanStatus: row.last_scan_status || row.sync_status || null, lastScanError: row.last_scan_error || "", publicSource: row.public_source || "", notes: row.notes || "", createdAt: row.created_at, updatedAt: row.updated_at, metrics: publicMetrics(metrics) }; }
function score(metrics = {}) {
  const followers = Number(metrics.followers) || 0; const views = Number(metrics.views) || 0; const posts = Number(metrics.posts ?? metrics.reels) || 0; const growth = Number(metrics.followerGrowth) || 0; const engagement = Number(metrics.engagement) || 0;
  return Math.max(0, Math.min(100, Math.round((Math.log10(followers + 1) * 14) + (Math.log10(views + 1) * 18) + Math.min(posts, 250) * .09 + Math.max(0, growth) * 1.2 + Math.max(0, engagement) * 1.1)));
}
function hasPublicNumbers(metrics = {}) { return normalizePublicFollowers(metrics.followersCount ?? metrics.followers) !== null || normalizeNumber(metrics.recentViewsTotal ?? metrics.views) !== null || normalizeNumber(metrics.postsCount ?? metrics.posts) !== null; }
function metricMeta(metrics = {}) {
  return JSON.stringify({
    followers: metrics.followersCount !== null && metrics.followersCount !== undefined ? { quality: "public", display: metrics.followersDisplay || null, source: metrics.followersSource || "public_page" } : { quality: "unavailable", source: "public_page" },
    views: metrics.recentViewsTotal !== null && metrics.recentViewsTotal !== undefined ? { quality: `latest-${metrics.videosSampled || 0}-videos`, sampled: metrics.videosSampled || 0, source: "public_video_views" } : { quality: "unavailable", source: "public_video_views" },
    posts: metrics.postsCount !== null && metrics.postsCount !== undefined ? { quality: metrics.postsCountType || "recent-public-sample", window: metrics.postsWindow || null, source: "public_feed" } : { quality: "unavailable", source: "public_feed" },
    scanner: metrics.source || "public_http_fetch",
  });
}

function createFacebookControlStore({ db, now = () => new Date().toISOString(), generateId = id } = {}) {
  if (!db) throw new Error("db is required");
  db.exec(`CREATE TABLE IF NOT EXISTS facebook_team_members (
    id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_team_owner_name ON facebook_team_members(owner_type, owner_id, name);
  CREATE TABLE IF NOT EXISTS facebook_pages (
    id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, page_url TEXT NOT NULL, page_name TEXT NOT NULL,
    page_id TEXT, team_member_id TEXT, credential_id TEXT, status TEXT NOT NULL, data_connection_status TEXT NOT NULL,
    last_sync_at TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_facebook_pages_owner ON facebook_pages(owner_type, owner_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS facebook_page_metrics (
    id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, page_record_id TEXT NOT NULL,
    captured_at TEXT NOT NULL, followers INTEGER, views INTEGER, reels INTEGER, posts INTEGER, engagement REAL, follower_growth REAL
  );
  CREATE INDEX IF NOT EXISTS idx_facebook_metrics_page_time ON facebook_page_metrics(page_record_id, captured_at DESC);
  CREATE TABLE IF NOT EXISTS facebook_public_metric_snapshots (
    id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, page_record_id TEXT NOT NULL,
    captured_at TEXT NOT NULL, followers_count INTEGER, followers_display TEXT, followers_source TEXT,
    recent_views_total INTEGER, videos_sampled INTEGER, posts_count INTEGER, posts_count_type TEXT, posts_window TEXT,
    scan_depth INTEGER, scan_status TEXT NOT NULL, scan_error TEXT, source TEXT, metric_meta TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_facebook_public_snapshots_page_time ON facebook_public_metric_snapshots(page_record_id, captured_at DESC);
  CREATE TABLE IF NOT EXISTS facebook_sync_state (
    owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, refresh_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_sync_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(owner_type, owner_id)
  );`);
  const pageColumns = new Set(db.prepare("PRAGMA table_info(facebook_pages)").all().map((column) => column.name));
  if (!pageColumns.has("page_picture_url")) db.exec("ALTER TABLE facebook_pages ADD COLUMN page_picture_url TEXT NOT NULL DEFAULT ''");
  if (!pageColumns.has("sync_status")) db.exec("ALTER TABLE facebook_pages ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'not_synced'");
  if (!pageColumns.has("sync_message")) db.exec("ALTER TABLE facebook_pages ADD COLUMN sync_message TEXT NOT NULL DEFAULT ''");
  if (!pageColumns.has("last_public_scan")) db.exec("ALTER TABLE facebook_pages ADD COLUMN last_public_scan TEXT");
  if (!pageColumns.has("last_scan_status")) db.exec("ALTER TABLE facebook_pages ADD COLUMN last_scan_status TEXT NOT NULL DEFAULT 'not_scanned'");
  if (!pageColumns.has("last_scan_error")) db.exec("ALTER TABLE facebook_pages ADD COLUMN last_scan_error TEXT NOT NULL DEFAULT ''");
  if (!pageColumns.has("scan_backoff_until")) db.exec("ALTER TABLE facebook_pages ADD COLUMN scan_backoff_until TEXT");
  if (!pageColumns.has("public_source")) db.exec("ALTER TABLE facebook_pages ADD COLUMN public_source TEXT NOT NULL DEFAULT ''");
  const metricColumns = new Set(db.prepare("PRAGMA table_info(facebook_page_metrics)").all().map((column) => column.name));
  if (!metricColumns.has("posts")) db.exec("ALTER TABLE facebook_page_metrics ADD COLUMN posts INTEGER");
  const ensureSync = (owner) => db.prepare("INSERT OR IGNORE INTO facebook_sync_state (owner_type, owner_id, refresh_interval_minutes, updated_at) VALUES (?, ?, ?, ?)").run(owner.ownerType, owner.ownerId, DEFAULT_REFRESH_MINUTES, now());
  const latestMetrics = (pageId) => {
    const publicRow = db.prepare("SELECT followers_count AS followers, recent_views_total AS views, posts_count AS posts, posts_count AS reels, NULL AS engagement, NULL AS follower_growth, captured_at, metric_meta FROM facebook_public_metric_snapshots WHERE page_record_id = ? AND (followers_count IS NULL OR followers_count <= ?) ORDER BY captured_at DESC LIMIT 1").get(pageId, MAX_REASONABLE_PUBLIC_FOLLOWERS);
    if (publicRow) return publicRow;
    return db.prepare("SELECT *, NULL AS metric_meta FROM facebook_page_metrics WHERE page_record_id = ? ORDER BY captured_at DESC LIMIT 1").get(pageId);
  };
  const listTeams = (owner) => db.prepare(`SELECT t.*, (SELECT count(*) FROM facebook_pages p WHERE p.team_member_id = t.id AND p.owner_type = t.owner_type AND p.owner_id = t.owner_id) AS page_count FROM facebook_team_members t WHERE owner_type = ? AND owner_id = ? ORDER BY name ASC`).all(owner.ownerType, owner.ownerId).map(publicTeam);
  const listPages = (owner) => db.prepare(`SELECT p.*, t.name AS team_member_name FROM facebook_pages p LEFT JOIN facebook_team_members t ON t.id = p.team_member_id AND t.owner_type = p.owner_type AND t.owner_id = p.owner_id WHERE p.owner_type = ? AND p.owner_id = ? ORDER BY p.updated_at DESC, p.id ASC`).all(owner.ownerType, owner.ownerId).map((row) => publicPage(row, latestMetrics(row.id)));
  return Object.freeze({
    list(ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); ensureSync(owner); const sync = db.prepare("SELECT * FROM facebook_sync_state WHERE owner_type = ? AND owner_id = ?").get(owner.ownerType, owner.ownerId); const pages = listPages(owner).map((page) => ({ ...page, performanceScore: score(page.metrics) })); return { teams: listTeams(owner), pages, sync: { refreshIntervalMinutes: sync.refresh_interval_minutes, lastSyncAt: sync.last_sync_at || null } }; },
    createTeam(input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const name = cleanText(input?.name, 120); if (!name) throw new FacebookControlError("INVALID_TEAM", "Team member name is required."); const timestamp = now(); const teamId = generateId("fbteam"); db.prepare("INSERT INTO facebook_team_members (id, owner_type, owner_id, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(teamId, owner.ownerType, owner.ownerId, name, cleanText(input?.notes, 500), timestamp, timestamp); return this.list(owner).teams.find((team) => team.id === teamId); },
    updateTeam(teamId, input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); if (!/^fbteam_[A-Za-z0-9_-]{8,255}$/.test(String(teamId))) throw new FacebookControlError("INVALID_ID", "Team member ID is invalid."); const current = db.prepare("SELECT * FROM facebook_team_members WHERE id = ? AND owner_type = ? AND owner_id = ?").get(teamId, owner.ownerType, owner.ownerId); if (!current) return null; const name = cleanText(input?.name ?? current.name, 120); if (!name) throw new FacebookControlError("INVALID_TEAM", "Team member name is required."); db.prepare("UPDATE facebook_team_members SET name = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(name, cleanText(input?.notes ?? current.notes, 500), now(), teamId, owner.ownerType, owner.ownerId); return this.list(owner).teams.find((team) => team.id === teamId); },
    createPage(input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const pageUrl = normalizeUrl(input?.pageUrl); const manualName = cleanText(input?.pageName, 180); const pageName = manualName || "Facebook Page"; const timestamp = now(); const pageId = generateId("fbpage"); const credentialId = cleanText(input?.credentialId, 255); db.prepare("INSERT INTO facebook_pages (id, owner_type, owner_id, page_url, page_name, page_id, team_member_id, credential_id, status, data_connection_status, sync_status, sync_message, last_sync_at, last_public_scan, last_scan_status, last_scan_error, public_source, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(pageId, owner.ownerType, owner.ownerId, pageUrl, pageName, cleanText(input?.pageId, 120), cleanText(input?.teamMemberId, 255) || null, credentialId || null, normalizeStatus(input?.status, "ACTIVE"), "public_scan_pending", "not_scanned", "Ready for public scan.", null, null, "not_scanned", "", "facebook_public_url", cleanText(input?.notes, 1000), timestamp, timestamp); return this.list(owner).pages.find((page) => page.id === pageId); },
    updatePage(pageId, input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); if (!/^fbpage_[A-Za-z0-9_-]{8,255}$/.test(String(pageId))) throw new FacebookControlError("INVALID_ID", "Facebook Page record ID is invalid."); const current = db.prepare("SELECT * FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageId, owner.ownerType, owner.ownerId); if (!current) return null; const credentialId = cleanText(input?.credentialId ?? current.credential_id, 255); db.prepare("UPDATE facebook_pages SET page_url = ?, page_name = ?, page_id = ?, team_member_id = ?, credential_id = ?, status = ?, data_connection_status = ?, sync_status = ?, sync_message = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(normalizeUrl(input?.pageUrl ?? current.page_url), cleanText(input?.pageName ?? current.page_name, 180) || current.page_name, cleanText(input?.pageId ?? current.page_id, 120), cleanText(input?.teamMemberId ?? current.team_member_id, 255) || null, credentialId || null, normalizeStatus(input?.status ?? current.status, current.status), current.data_connection_status || "public_scan_pending", current.sync_status || "not_scanned", current.sync_message || "Ready for public scan.", cleanText(input?.notes ?? current.notes, 1000), now(), pageId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageId); },
    deletePage(pageId, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const existing = db.prepare("SELECT id FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageId, owner.ownerType, owner.ownerId); if (!existing) return false; db.prepare("DELETE FROM facebook_public_metric_snapshots WHERE page_record_id = ? AND owner_type = ? AND owner_id = ?").run(pageId, owner.ownerType, owner.ownerId); db.prepare("DELETE FROM facebook_page_metrics WHERE page_record_id = ? AND owner_type = ? AND owner_id = ?").run(pageId, owner.ownerType, owner.ownerId); db.prepare("DELETE FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").run(pageId, owner.ownerType, owner.ownerId); return true; },
    updateSync(input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const minutes = Number(input?.refreshIntervalMinutes); if (!REFRESH_INTERVALS.has(minutes)) throw new FacebookControlError("INVALID_INTERVAL", "Refresh interval is invalid."); ensureSync(owner); db.prepare("UPDATE facebook_sync_state SET refresh_interval_minutes = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ?").run(minutes, now(), owner.ownerType, owner.ownerId); return this.list(owner).sync; },
    markSync(ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); ensureSync(owner); const timestamp = now(); db.prepare("UPDATE facebook_sync_state SET last_sync_at = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ?").run(timestamp, timestamp, owner.ownerType, owner.ownerId); return this.list(owner).sync; },
    recordPageMetrics(pageRecordId, metrics, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const current = db.prepare("SELECT * FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageRecordId, owner.ownerType, owner.ownerId); if (!current) return null; const timestamp = now(); db.prepare("INSERT INTO facebook_page_metrics (id, owner_type, owner_id, page_record_id, captured_at, followers, views, reels, posts, engagement, follower_growth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(generateId("metric"), owner.ownerType, owner.ownerId, pageRecordId, timestamp, normalizeNumber(metrics.followers), normalizeNumber(metrics.views), normalizeNumber(metrics.reels ?? metrics.posts), normalizeNumber(metrics.posts ?? metrics.reels), normalizeNumber(metrics.engagement), normalizeNumber(metrics.followerGrowth)); db.prepare("UPDATE facebook_pages SET page_name = ?, page_id = ?, page_picture_url = ?, page_url = ?, data_connection_status = 'synced', sync_status = 'synced', sync_message = ?, last_sync_at = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(cleanText(metrics.pageName || current.page_name, 180), cleanText(metrics.pageId || current.page_id, 120), cleanText(metrics.pagePictureUrl || current.page_picture_url, 500), normalizeUrl(metrics.pageUrl || current.page_url), cleanText(metrics.message || "Facebook metrics synced.", 500), timestamp, timestamp, pageRecordId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageRecordId); },
    recordPublicMetrics(pageRecordId, metrics, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const current = db.prepare("SELECT * FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageRecordId, owner.ownerType, owner.ownerId); if (!current) return null; const timestamp = metrics.capturedAt || now(); const status = cleanText(metrics.status || (hasPublicNumbers(metrics) ? "synced" : "metric_unavailable"), 80); const message = cleanText(metrics.message || "Public Facebook scan completed.", 500); const followers = normalizePublicFollowers(metrics.followersCount ?? metrics.followers); const views = normalizeNumber(metrics.recentViewsTotal ?? metrics.views); const posts = normalizeNumber(metrics.postsCount ?? metrics.posts); if (followers !== null || views !== null || posts !== null) db.prepare("INSERT INTO facebook_public_metric_snapshots (id, owner_type, owner_id, page_record_id, captured_at, followers_count, followers_display, followers_source, recent_views_total, videos_sampled, posts_count, posts_count_type, posts_window, scan_depth, scan_status, scan_error, source, metric_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(generateId("metric"), owner.ownerType, owner.ownerId, pageRecordId, timestamp, followers, cleanText(metrics.followersDisplay, 80), cleanText(metrics.followersSource, 80), views, normalizeNumber(metrics.videosSampled), posts, cleanText(metrics.postsCountType, 80), cleanText(metrics.postsWindow, 120), normalizeNumber(metrics.scanDepth), status, status === "synced" || status === "partial" ? "" : message, cleanText(metrics.source || "public_http_fetch", 80), metricMeta(metrics)); db.prepare("UPDATE facebook_pages SET page_name = ?, page_picture_url = ?, page_url = ?, data_connection_status = ?, sync_status = ?, sync_message = ?, last_sync_at = ?, last_public_scan = ?, last_scan_status = ?, last_scan_error = ?, public_source = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(cleanText(metrics.pageName || current.page_name, 180), cleanText(metrics.pagePictureUrl || current.page_picture_url, 500), normalizeUrl(metrics.pageUrl || current.page_url), status, status, message, timestamp, timestamp, status, status === "synced" || status === "partial" ? "" : message, cleanText(metrics.source || "public_http_fetch", 80), timestamp, pageRecordId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageRecordId); },
    markPageSyncIssue(pageRecordId, status, message, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const timestamp = now(); const publicStatus = cleanText(status || "sync_failed", 80); db.prepare("UPDATE facebook_pages SET data_connection_status = ?, sync_status = ?, sync_message = ?, last_sync_at = ?, last_public_scan = ?, last_scan_status = ?, last_scan_error = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(publicStatus, publicStatus, cleanText(message || "Facebook sync failed.", 500), timestamp, timestamp, publicStatus, cleanText(message || "Facebook sync failed.", 500), timestamp, pageRecordId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageRecordId); },
  });
}
module.exports = { createFacebookControlStore, FacebookControlError, REFRESH_INTERVALS, score };
