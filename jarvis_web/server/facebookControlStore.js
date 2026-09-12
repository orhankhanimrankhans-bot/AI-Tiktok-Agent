"use strict";

const crypto = require("node:crypto");

const OWNER_TYPES = new Set(["admin", "child", "additional"]);
const PAGE_STATUSES = new Set(["ACTIVE", "INACTIVE", "NEEDS_CONNECTION", "PAUSED"]);
const REFRESH_INTERVALS = new Set([1, 5, 15, 30, 60]);
const DEFAULT_OWNER = Object.freeze({ ownerType: "admin", ownerId: "primary" });

class FacebookControlError extends Error { constructor(code, message) { super(message); this.code = code; } }

function ownerKey(owner = DEFAULT_OWNER) {
  const ownerType = String(owner?.ownerType || ""); const ownerId = String(owner?.ownerId || "");
  if (!OWNER_TYPES.has(ownerType) || !/^[A-Za-z0-9_-]{1,255}$/.test(ownerId)) throw new FacebookControlError("INVALID_OWNER", "Facebook workspace is invalid.");
  return { ownerType, ownerId };
}
function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }
function cleanText(value, limit = 200) { return String(value || "").trim().slice(0, limit); }
function normalizeNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function normalizeUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { throw new FacebookControlError("INVALID_URL", "Facebook Page URL is invalid."); }
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)facebook\.com$/.test(host) && !/(^|\.)fb\.com$/.test(host)) throw new FacebookControlError("INVALID_URL", "Only Facebook Page URLs are supported.");
  return url.toString();
}
function normalizeStatus(value, fallback = "NEEDS_CONNECTION") { const status = cleanText(value, 40).toUpperCase(); return PAGE_STATUSES.has(status) ? status : fallback; }
function publicTeam(row) { return row && { id: row.id, name: row.name, notes: row.notes || "", pageCount: row.page_count || 0, createdAt: row.created_at, updatedAt: row.updated_at }; }
function publicMetrics(row) { return row ? { followers: row.followers ?? null, views: row.views ?? null, reels: row.reels ?? null, engagement: row.engagement ?? null, followerGrowth: row.follower_growth ?? null, capturedAt: row.captured_at || null } : { followers: null, views: null, reels: null, engagement: null, followerGrowth: null, capturedAt: null }; }
function publicPage(row, metrics = null) { return row && { id: row.id, pageUrl: row.page_url, pageName: row.page_name, pageId: row.page_id || "", pagePictureUrl: row.page_picture_url || "", teamMemberId: row.team_member_id || "", teamMemberName: row.team_member_name || "Unassigned", credentialId: row.credential_id || "", status: row.status, dataConnectionStatus: row.data_connection_status, syncStatus: row.sync_status || row.data_connection_status, syncMessage: row.sync_message || "", lastSyncAt: row.last_sync_at || null, notes: row.notes || "", createdAt: row.created_at, updatedAt: row.updated_at, metrics: publicMetrics(metrics) }; }
function score(metrics = {}) {
  const followers = Number(metrics.followers) || 0; const views = Number(metrics.views) || 0; const reels = Number(metrics.reels) || 0; const growth = Number(metrics.followerGrowth) || 0; const engagement = Number(metrics.engagement) || 0;
  return Math.max(0, Math.min(100, Math.round((Math.log10(followers + 1) * 14) + (Math.log10(views + 1) * 18) + Math.min(reels, 250) * .09 + Math.max(0, growth) * 1.2 + Math.max(0, engagement) * 1.1)));
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
    captured_at TEXT NOT NULL, followers INTEGER, views INTEGER, reels INTEGER, engagement REAL, follower_growth REAL
  );
  CREATE INDEX IF NOT EXISTS idx_facebook_metrics_page_time ON facebook_page_metrics(page_record_id, captured_at DESC);
  CREATE TABLE IF NOT EXISTS facebook_sync_state (
    owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, refresh_interval_minutes INTEGER NOT NULL DEFAULT 5,
    last_sync_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(owner_type, owner_id)
  );`);
  const pageColumns = new Set(db.prepare("PRAGMA table_info(facebook_pages)").all().map((column) => column.name));
  if (!pageColumns.has("page_picture_url")) db.exec("ALTER TABLE facebook_pages ADD COLUMN page_picture_url TEXT NOT NULL DEFAULT ''");
  if (!pageColumns.has("sync_status")) db.exec("ALTER TABLE facebook_pages ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'not_synced'");
  if (!pageColumns.has("sync_message")) db.exec("ALTER TABLE facebook_pages ADD COLUMN sync_message TEXT NOT NULL DEFAULT ''");
  const ensureSync = (owner) => db.prepare("INSERT OR IGNORE INTO facebook_sync_state (owner_type, owner_id, refresh_interval_minutes, updated_at) VALUES (?, ?, 5, ?)").run(owner.ownerType, owner.ownerId, now());
  const latestMetrics = (pageId) => db.prepare("SELECT * FROM facebook_page_metrics WHERE page_record_id = ? ORDER BY captured_at DESC LIMIT 1").get(pageId);
  const listTeams = (owner) => db.prepare(`SELECT t.*, (SELECT count(*) FROM facebook_pages p WHERE p.team_member_id = t.id AND p.owner_type = t.owner_type AND p.owner_id = t.owner_id) AS page_count FROM facebook_team_members t WHERE owner_type = ? AND owner_id = ? ORDER BY name ASC`).all(owner.ownerType, owner.ownerId).map(publicTeam);
  const listPages = (owner) => db.prepare(`SELECT p.*, t.name AS team_member_name FROM facebook_pages p LEFT JOIN facebook_team_members t ON t.id = p.team_member_id AND t.owner_type = p.owner_type AND t.owner_id = p.owner_id WHERE p.owner_type = ? AND p.owner_id = ? ORDER BY p.updated_at DESC, p.id ASC`).all(owner.ownerType, owner.ownerId).map((row) => publicPage(row, latestMetrics(row.id)));
  return Object.freeze({
    list(ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); ensureSync(owner); const sync = db.prepare("SELECT * FROM facebook_sync_state WHERE owner_type = ? AND owner_id = ?").get(owner.ownerType, owner.ownerId); const pages = listPages(owner).map((page) => ({ ...page, performanceScore: score(page.metrics) })); return { teams: listTeams(owner), pages, sync: { refreshIntervalMinutes: sync.refresh_interval_minutes, lastSyncAt: sync.last_sync_at || null } }; },
    createTeam(input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const name = cleanText(input?.name, 120); if (!name) throw new FacebookControlError("INVALID_TEAM", "Team member name is required."); const timestamp = now(); const teamId = generateId("fbteam"); db.prepare("INSERT INTO facebook_team_members (id, owner_type, owner_id, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(teamId, owner.ownerType, owner.ownerId, name, cleanText(input?.notes, 500), timestamp, timestamp); return this.list(owner).teams.find((team) => team.id === teamId); },
    updateTeam(teamId, input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); if (!/^fbteam_[A-Za-z0-9_-]{8,255}$/.test(String(teamId))) throw new FacebookControlError("INVALID_ID", "Team member ID is invalid."); const current = db.prepare("SELECT * FROM facebook_team_members WHERE id = ? AND owner_type = ? AND owner_id = ?").get(teamId, owner.ownerType, owner.ownerId); if (!current) return null; const name = cleanText(input?.name ?? current.name, 120); if (!name) throw new FacebookControlError("INVALID_TEAM", "Team member name is required."); db.prepare("UPDATE facebook_team_members SET name = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(name, cleanText(input?.notes ?? current.notes, 500), now(), teamId, owner.ownerType, owner.ownerId); return this.list(owner).teams.find((team) => team.id === teamId); },
    createPage(input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const pageUrl = normalizeUrl(input?.pageUrl); const pageName = cleanText(input?.pageName, 180); if (!pageName) throw new FacebookControlError("INVALID_PAGE", "Facebook Page name is required."); const timestamp = now(); const pageId = generateId("fbpage"); const credentialId = cleanText(input?.credentialId, 255); const dataStatus = credentialId ? "connected" : "connection_required"; db.prepare("INSERT INTO facebook_pages (id, owner_type, owner_id, page_url, page_name, page_id, team_member_id, credential_id, status, data_connection_status, sync_status, sync_message, last_sync_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(pageId, owner.ownerType, owner.ownerId, pageUrl, pageName, cleanText(input?.pageId, 120), cleanText(input?.teamMemberId, 255) || null, credentialId || null, normalizeStatus(input?.status, credentialId ? "ACTIVE" : "NEEDS_CONNECTION"), dataStatus, dataStatus, credentialId ? "Ready for refresh." : "Facebook connection required.", null, cleanText(input?.notes, 1000), timestamp, timestamp); return this.list(owner).pages.find((page) => page.id === pageId); },
    updatePage(pageId, input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); if (!/^fbpage_[A-Za-z0-9_-]{8,255}$/.test(String(pageId))) throw new FacebookControlError("INVALID_ID", "Facebook Page record ID is invalid."); const current = db.prepare("SELECT * FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageId, owner.ownerType, owner.ownerId); if (!current) return null; const credentialId = cleanText(input?.credentialId ?? current.credential_id, 255); const dataStatus = credentialId ? "connected" : "connection_required"; db.prepare("UPDATE facebook_pages SET page_url = ?, page_name = ?, page_id = ?, team_member_id = ?, credential_id = ?, status = ?, data_connection_status = ?, sync_status = ?, sync_message = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(normalizeUrl(input?.pageUrl ?? current.page_url), cleanText(input?.pageName ?? current.page_name, 180), cleanText(input?.pageId ?? current.page_id, 120), cleanText(input?.teamMemberId ?? current.team_member_id, 255) || null, credentialId || null, normalizeStatus(input?.status ?? current.status, current.status), dataStatus, dataStatus, credentialId ? (current.sync_message || "Ready for refresh.") : "Facebook connection required.", cleanText(input?.notes ?? current.notes, 1000), now(), pageId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageId); },
    deletePage(pageId, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const existing = db.prepare("SELECT id FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageId, owner.ownerType, owner.ownerId); if (!existing) return false; db.prepare("DELETE FROM facebook_page_metrics WHERE page_record_id = ? AND owner_type = ? AND owner_id = ?").run(pageId, owner.ownerType, owner.ownerId); db.prepare("DELETE FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").run(pageId, owner.ownerType, owner.ownerId); return true; },
    updateSync(input, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const minutes = Number(input?.refreshIntervalMinutes); if (!REFRESH_INTERVALS.has(minutes)) throw new FacebookControlError("INVALID_INTERVAL", "Refresh interval is invalid."); ensureSync(owner); db.prepare("UPDATE facebook_sync_state SET refresh_interval_minutes = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ?").run(minutes, now(), owner.ownerType, owner.ownerId); return this.list(owner).sync; },
    markSync(ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); ensureSync(owner); const timestamp = now(); db.prepare("UPDATE facebook_sync_state SET last_sync_at = ?, updated_at = ? WHERE owner_type = ? AND owner_id = ?").run(timestamp, timestamp, owner.ownerType, owner.ownerId); return this.list(owner).sync; },
    recordPageMetrics(pageRecordId, metrics, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const current = db.prepare("SELECT * FROM facebook_pages WHERE id = ? AND owner_type = ? AND owner_id = ?").get(pageRecordId, owner.ownerType, owner.ownerId); if (!current) return null; const timestamp = now(); db.prepare("INSERT INTO facebook_page_metrics (id, owner_type, owner_id, page_record_id, captured_at, followers, views, reels, engagement, follower_growth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(generateId("metric"), owner.ownerType, owner.ownerId, pageRecordId, timestamp, normalizeNumber(metrics.followers), normalizeNumber(metrics.views), normalizeNumber(metrics.reels), normalizeNumber(metrics.engagement), normalizeNumber(metrics.followerGrowth)); db.prepare("UPDATE facebook_pages SET page_name = ?, page_id = ?, page_picture_url = ?, page_url = ?, data_connection_status = 'synced', sync_status = 'synced', sync_message = ?, last_sync_at = ?, updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(cleanText(metrics.pageName || current.page_name, 180), cleanText(metrics.pageId || current.page_id, 120), cleanText(metrics.pagePictureUrl || current.page_picture_url, 500), normalizeUrl(metrics.pageUrl || current.page_url), cleanText(metrics.message || "Facebook metrics synced.", 500), timestamp, timestamp, pageRecordId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageRecordId); },
    markPageSyncIssue(pageRecordId, status, message, ownerInput = DEFAULT_OWNER) { const owner = ownerKey(ownerInput); const timestamp = now(); const publicStatus = cleanText(status || "sync_failed", 80); db.prepare("UPDATE facebook_pages SET data_connection_status = ?, sync_status = ?, sync_message = ?, last_sync_at = COALESCE(last_sync_at, NULL), updated_at = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(publicStatus, publicStatus, cleanText(message || "Facebook sync failed.", 500), timestamp, pageRecordId, owner.ownerType, owner.ownerId); return this.list(owner).pages.find((page) => page.id === pageRecordId); },
  });
}
module.exports = { createFacebookControlStore, FacebookControlError, score };
