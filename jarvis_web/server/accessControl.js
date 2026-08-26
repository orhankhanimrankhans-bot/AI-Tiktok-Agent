"use strict";

const crypto = require("node:crypto");

const DEFAULT_CHILD_PERMISSIONS = Object.freeze({
  dashboard: false, tools: false, view_workflow: false, edit_workflow: false,
  run_workflow: false, publish_facebook: false, view_facebook: false,
  storage: false, storage_modify: false,
});
const PERMISSIONS = Object.freeze(Object.keys(DEFAULT_CHILD_PERMISSIONS));
const OWNER_PERMISSIONS = Object.freeze(Object.fromEntries(PERMISSIONS.map((key) => [key, true])));
const CHILD_PERMISSIONS = Object.freeze({
  dashboard: true, conversation: true, ai_office: true, voice: true, tools: true,
  view_workflow: true, run_workflow: true, edit_workflow: false, delete_workflow: false,
  manage_workflow_credentials: false, media: false, credentials: false,
  additional_access: false, security: false, system_settings: false,
});
const ROLE_PERMISSIONS = Object.freeze(Object.keys(CHILD_PERMISSIONS));
const ADMIN_PERMISSIONS = Object.freeze(Object.fromEntries(ROLE_PERMISSIONS.map((key) => [key, true])));
const RESET_TTL_MS = 15 * 60_000;
function normalizeEmail(value) { const email = String(value || "").trim().toLowerCase(); if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address."); return email; }

function normalizePermissions(value) {
  const input = value && typeof value === "object" ? value : {};
  return Object.fromEntries(PERMISSIONS.map((key) => [key, input[key] === true]));
}
function normalizeRolePermissions(value) {
  const input = value && typeof value === "object" ? value : {};
  return Object.fromEntries(ROLE_PERMISSIONS.map((key) => [key, input[key] === true]));
}
function safeMinutes(value) { return [0, 5, 15, 30, 60, 120].includes(Number(value)) ? Number(value) : 0; }
const DAY_MS = 86_400_000;
const DURATION_UNITS = Object.freeze({ days: 1, weeks: 7, months: 30, year: 365 });
function normalizeAccessDuration(value, unit, now = Date.now()) {
  const amount = Number(value); const normalizedUnit = String(unit || "").toLowerCase();
  if (!Number.isInteger(amount) || amount < 1 || !DURATION_UNITS[normalizedUnit]) throw new Error("Choose a valid access duration.");
  let days = amount * DURATION_UNITS[normalizedUnit];
  if (normalizedUnit === "months" && amount === 12) days = 365;
  if (days < 1 || days > 365) throw new Error("Access duration must be between 1 day and 1 year.");
  return { durationValue: amount, durationUnit: normalizedUnit, accessExpiresAt: now + days * DAY_MS };
}
function validPassword(value) { return typeof value === "string" && value.length >= 8 && value.length <= 1024; }
function validStoredHash(value) { return /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(String(value || "")); }
function hashPassword(password) {
  if (!validPassword(password)) throw new Error("Password must be between 8 and 1024 characters.");
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(`scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`)));
}
function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return Promise.resolve(false);
  const [algorithm, n, r, p, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return Promise.resolve(false);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return new Promise((resolve) => crypto.scrypt(password, Buffer.from(salt, "base64url"), expectedBuffer.length, { N: Number(n), r: Number(r), p: Number(p) }, (error, actual) => resolve(!error && actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer))));
}
function publicChild(row, includeHash = false) {
  const child = { id: row.id, displayName: row.display_name, email: row.email || "", emailRequired: !row.email, enabled: Boolean(row.enabled), permissions: normalizePermissions(JSON.parse(row.permissions_json)), sessionLimitMinutes: row.session_limit_minutes, accessExpiresAt: row.access_expires_at || null, durationValue: row.duration_value || null, durationUnit: row.duration_unit || null, createdAt: row.created_at, updatedAt: row.updated_at };
  if (includeHash) child.passwordHash = row.password_hash;
  return child;
}

class AccessControlStore {
  constructor({ db }) { this.db = db; }
  open() {
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_security_settings (id INTEGER PRIMARY KEY CHECK (id = 1), admin_password_hash TEXT NOT NULL, auto_lock_minutes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_child_profiles (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, permissions_json TEXT NOT NULL, session_limit_minutes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const childColumns = new Set(this.db.prepare("PRAGMA table_info(jarvis_child_profiles)").all().map((column) => column.name));
    if (!childColumns.has("access_expires_at")) this.db.exec("ALTER TABLE jarvis_child_profiles ADD COLUMN access_expires_at INTEGER");
    if (!childColumns.has("duration_value")) this.db.exec("ALTER TABLE jarvis_child_profiles ADD COLUMN duration_value INTEGER");
    if (!childColumns.has("duration_unit")) this.db.exec("ALTER TABLE jarvis_child_profiles ADD COLUMN duration_unit TEXT");
    const settingsColumns = new Set(this.db.prepare("PRAGMA table_info(jarvis_security_settings)").all().map((column) => column.name));
    if (!settingsColumns.has("auth_version")) this.db.exec("ALTER TABLE jarvis_security_settings ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1");
    if (!settingsColumns.has("owner_email")) this.db.exec("ALTER TABLE jarvis_security_settings ADD COLUMN owner_email TEXT");
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_child_account (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, permissions_json TEXT NOT NULL, auth_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)");
    const accountColumns = new Set(this.db.prepare("PRAGMA table_info(jarvis_child_account)").all().map((column) => column.name));
    if (!accountColumns.has("display_name")) this.db.exec("ALTER TABLE jarvis_child_account ADD COLUMN display_name TEXT");
    if (!accountColumns.has("email")) this.db.exec("ALTER TABLE jarvis_child_account ADD COLUMN email TEXT");
    if (!childColumns.has("email")) this.db.exec("ALTER TABLE jarvis_child_profiles ADD COLUMN email TEXT");
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_auth_sessions (id TEXT PRIMARY KEY, role TEXT NOT NULL, profile_id TEXT, auth_version INTEGER NOT NULL, login_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, revoked_at TEXT)");
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_password_resets (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at TEXT, created_at TEXT NOT NULL)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_jarvis_child_profiles_active_email ON jarvis_child_profiles(lower(trim(email))) WHERE enabled = 1 AND email IS NOT NULL AND trim(email) <> ''");
    this.db.prepare("DELETE FROM jarvis_auth_sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?").run(new Date(Date.now() - 30 * DAY_MS).toISOString());
    this.db.prepare("DELETE FROM jarvis_password_resets WHERE expires_at < ? OR used_at IS NOT NULL").run(Date.now());
  }
  settings() { return this.db.prepare("SELECT admin_password_hash, auto_lock_minutes, auth_version, owner_email, updated_at FROM jarvis_security_settings WHERE id = 1").get() || null; }
  securityState() { const value = this.settings(); return !value ? "disabled" : validStoredHash(value.admin_password_hash) ? "enabled" : "recovery_required"; }
  publicSettings() { const value = this.settings(); return { enabled: this.securityState() === "enabled", recoveryRequired: this.securityState() === "recovery_required", autoLockMinutes: this.securityState() === "enabled" ? safeMinutes(value.auto_lock_minutes) : 0 }; }
  async setup(password, autoLockMinutes = 0, ownerEmail) { if (this.securityState() !== "disabled") throw new Error(this.securityState() === "recovery_required" ? "Security recovery is required." : "Security is already configured."); const now = new Date().toISOString(); this.db.prepare("INSERT INTO jarvis_security_settings (id, admin_password_hash, auto_lock_minutes, owner_email, updated_at) VALUES (1, ?, ?, ?, ?)").run(await hashPassword(password), safeMinutes(autoLockMinutes), normalizeEmail(ownerEmail), now); }
  async recover(password, autoLockMinutes = 0) { if (this.securityState() !== "recovery_required") throw new Error("Security recovery is not required."); const now = new Date().toISOString(); this.db.prepare("UPDATE jarvis_security_settings SET admin_password_hash = ?, auto_lock_minutes = ?, updated_at = ? WHERE id = 1").run(await hashPassword(password), safeMinutes(autoLockMinutes), now); }
  async verifyAdmin(password) { const value = this.settings(); return Boolean(value && await verifyPassword(password, value.admin_password_hash)); }
  ownerAccount() { const value = this.settings(); return value ? { email: value.owner_email || "", emailRequired: !value.owner_email } : null; }
  async updateOwnerEmail(currentPassword, email) { if (!await this.verifyAdmin(currentPassword)) throw new Error("Current password is incorrect."); const normalized = normalizeEmail(email); this.db.prepare("UPDATE jarvis_security_settings SET owner_email = ?, updated_at = ? WHERE id = 1").run(normalized, new Date().toISOString()); return this.ownerAccount(); }
  async recoverOwnerLocally(email, password) { const settings = this.settings(); if (!settings) throw new Error("Admin security is not configured."); const normalized = normalizeEmail(email); const hash = await hashPassword(password); const now = new Date().toISOString(); this.db.exec("BEGIN IMMEDIATE"); try { this.db.prepare("UPDATE jarvis_security_settings SET owner_email = ?, admin_password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = 1").run(normalized, hash, now); this.db.prepare("UPDATE jarvis_auth_sessions SET revoked_at = ? WHERE role = 'admin' AND revoked_at IS NULL").run(now); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  childAccount() { const row = this.db.prepare("SELECT * FROM jarvis_child_account WHERE id = 1").get(); return row ? { displayName: row.display_name || "", email: row.email || "", emailRequired: !row.email, enabled: Boolean(row.enabled), permissions: normalizeRolePermissions(JSON.parse(row.permissions_json)), authVersion: row.auth_version, updatedAt: row.updated_at } : null; }
  async setChildPassword(password, { displayName, email } = {}) { const hash = await hashPassword(password); const name = String(displayName || "").trim(); if (!name || name.length > 80) throw new Error("Child name must be 1 to 80 characters."); const normalized = normalizeEmail(email); const now = new Date().toISOString(); const existing = this.childAccount(); if (existing) this.db.prepare("UPDATE jarvis_child_account SET password_hash = ?, display_name = ?, email = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = 1").run(hash, name, normalized, now); else this.db.prepare("INSERT INTO jarvis_child_account (id, password_hash, enabled, permissions_json, auth_version, display_name, email, updated_at) VALUES (1, ?, 1, ?, 1, ?, ?, ?)").run(hash, JSON.stringify(CHILD_PERMISSIONS), name, normalized, now); this.revokeSessions("child"); return this.childAccount(); }
  async verifyRoleChild(password) { const row = this.db.prepare("SELECT * FROM jarvis_child_account WHERE id = 1").get(); return row?.enabled && await verifyPassword(password, row.password_hash) ? this.childAccount() : null; }
  updateChildAccount(patch) { const existing = this.childAccount(); if (!existing) throw new Error("Set the Child password before enabling Child access."); const enabled = patch.enabled === undefined ? existing.enabled : Boolean(patch.enabled); if (enabled && (!existing.email || !existing.displayName)) throw new Error("Child name and email are required before enabling access."); const permissions = patch.permissions === undefined ? existing.permissions : normalizeRolePermissions(patch.permissions); this.db.prepare("UPDATE jarvis_child_account SET enabled = ?, permissions_json = ?, updated_at = ? WHERE id = 1").run(enabled ? 1 : 0, JSON.stringify(permissions), new Date().toISOString()); if (!enabled) this.revokeSessions("child"); return this.childAccount(); }
  async changeAdminPassword(currentPassword, password) { if (!await this.verifyAdmin(currentPassword)) throw new Error("Current password is incorrect."); const hash = await hashPassword(password); this.db.prepare("UPDATE jarvis_security_settings SET admin_password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = 1").run(hash, new Date().toISOString()); this.revokeSessions("admin"); }
  createPasswordReset(email, now = Date.now()) { const settings = this.settings(); let rawToken = null; if (settings?.owner_email && normalizeEmail(email) === settings.owner_email) { this.db.prepare("UPDATE jarvis_password_resets SET used_at = ? WHERE used_at IS NULL").run(new Date(now).toISOString()); rawToken = crypto.randomBytes(32).toString("base64url"); const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex"); this.db.prepare("INSERT INTO jarvis_password_resets (id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)").run(`reset_${crypto.randomBytes(16).toString("base64url")}`, tokenHash, now + RESET_TTL_MS, new Date(now).toISOString()); } return rawToken; }
  async completePasswordReset(token, password, now = Date.now()) { const tokenHash = crypto.createHash("sha256").update(String(token || "")).digest("hex"); const row = this.db.prepare("SELECT * FROM jarvis_password_resets WHERE token_hash = ?").get(tokenHash); if (!row || row.used_at || row.expires_at <= now) throw new Error("This reset link is invalid or expired."); const hash = await hashPassword(password); const completedAt = new Date(now).toISOString(); this.db.exec("BEGIN IMMEDIATE"); try { this.db.prepare("UPDATE jarvis_security_settings SET admin_password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = 1").run(hash, completedAt); this.db.prepare("UPDATE jarvis_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL").run(completedAt, row.id); this.db.prepare("UPDATE jarvis_auth_sessions SET revoked_at = ? WHERE role = 'admin' AND revoked_at IS NULL").run(completedAt); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  createSession(role, { profileId = null, authVersion = 1 } = {}) { const id = `auth_${crypto.randomBytes(24).toString("base64url")}`; const now = new Date().toISOString(); this.db.prepare("INSERT INTO jarvis_auth_sessions (id, role, profile_id, auth_version, login_at, last_activity_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(id, role, profileId, authVersion, now, now); return id; }
  sessionRecord(id) { return id ? this.db.prepare("SELECT * FROM jarvis_auth_sessions WHERE id = ?").get(id) || null : null; }
  touchSession(id) { if (id) this.db.prepare("UPDATE jarvis_auth_sessions SET last_activity_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(), id); }
  revokeSession(id) { if (id) this.db.prepare("UPDATE jarvis_auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(), id); }
  revokeSessions(role, profileId = null) { const now = new Date().toISOString(); if (profileId) this.db.prepare("UPDATE jarvis_auth_sessions SET revoked_at = ? WHERE role = ? AND profile_id = ? AND revoked_at IS NULL").run(now, role, profileId); else this.db.prepare("UPDATE jarvis_auth_sessions SET revoked_at = ? WHERE role = ? AND revoked_at IS NULL").run(now, role); }
  listSessions() { return this.db.prepare("SELECT id, role, profile_id, login_at, last_activity_at, revoked_at FROM jarvis_auth_sessions ORDER BY login_at DESC LIMIT 100").all().map((row) => ({ id: row.id, role: row.role, profileId: row.profile_id || null, loginAt: row.login_at, lastActivityAt: row.last_activity_at, active: !row.revoked_at })); }
  setAutoLock(minutes) { this.db.prepare("UPDATE jarvis_security_settings SET auto_lock_minutes = ?, updated_at = ? WHERE id = 1").run(safeMinutes(minutes), new Date().toISOString()); }
  listChildren() { return this.db.prepare("SELECT * FROM jarvis_child_profiles ORDER BY created_at ASC").all().map(publicChild); }
  getChild(id, includeHash = false) { const row = this.db.prepare("SELECT * FROM jarvis_child_profiles WHERE id = ?").get(id); return row ? publicChild(row, includeHash) : null; }
  async createChild({ displayName, email, password, enabled = true, permissions, sessionLimitMinutes = 0, durationValue, durationUnit }) { const name = String(displayName || "").trim(); if (!name || name.length > 80) throw new Error("Display name must be 1 to 80 characters."); const normalized = normalizeEmail(email); const duplicate = this.db.prepare("SELECT id FROM jarvis_child_profiles WHERE enabled = 1 AND lower(trim(email)) = ?").get(normalized); if (duplicate) throw new Error("An active access profile already uses this email address."); const nowMs = Date.now(); const now = new Date(nowMs).toISOString(); const id = `child_${crypto.randomBytes(16).toString("base64url")}`; const custom = durationUnit ? normalizeAccessDuration(durationValue, durationUnit, nowMs) : null; const minutes = Number(sessionLimitMinutes); if (!custom && ![0, 5, 15, 30, 60, 120].includes(minutes)) throw new Error("Choose a valid session duration."); this.db.prepare("INSERT INTO jarvis_child_profiles (id, display_name, email, password_hash, enabled, permissions_json, session_limit_minutes, access_expires_at, duration_value, duration_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, name, normalized, await hashPassword(password), enabled ? 1 : 0, JSON.stringify(normalizePermissions(permissions)), custom ? 0 : minutes, custom?.accessExpiresAt || null, custom?.durationValue || null, custom?.durationUnit || null, now, now); return this.getChild(id); }
  async verifyChild(id, password, now = Date.now()) { const child = this.getChild(id, true); return child?.enabled && (!child.accessExpiresAt || now < child.accessExpiresAt) && await verifyPassword(password, child.passwordHash) ? child : null; }
  updateChild(id, patch) { const existing = this.getChild(id, true); if (!existing) return null; const permissions = patch.permissions === undefined ? existing.permissions : normalizePermissions(patch.permissions); const enabled = patch.enabled === undefined ? existing.enabled : Boolean(patch.enabled); const email = patch.email === undefined ? existing.email : normalizeEmail(patch.email); if (enabled && !email) throw new Error("Add a valid email before enabling this access profile."); const duplicate = email && this.db.prepare("SELECT id FROM jarvis_child_profiles WHERE id <> ? AND enabled = 1 AND lower(trim(email)) = ?").get(id, email); if (duplicate) throw new Error("An active access profile already uses this email address."); const minutes = patch.sessionLimitMinutes === undefined ? existing.sessionLimitMinutes : safeMinutes(patch.sessionLimitMinutes); this.db.prepare("UPDATE jarvis_child_profiles SET email = ?, enabled = ?, permissions_json = ?, session_limit_minutes = ?, updated_at = ? WHERE id = ?").run(email || null, enabled ? 1 : 0, JSON.stringify(permissions), minutes, new Date().toISOString(), id); return this.getChild(id); }
  deleteChild(id) { const now = new Date().toISOString(); this.db.exec("BEGIN IMMEDIATE"); try { this.db.prepare("UPDATE jarvis_auth_sessions SET revoked_at = ? WHERE role = 'additional' AND profile_id = ? AND revoked_at IS NULL").run(now, id); const deleted = this.db.prepare("DELETE FROM jarvis_child_profiles WHERE id = ?").run(id).changes > 0; this.db.exec("COMMIT"); return deleted; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
}
function sessionIdentity(req, now = Date.now(), store = null) { const value = req.session?.jarvisAuth; if (!value?.role || (value.expiresAt && now >= value.expiresAt)) return null; if (store && value.sessionId) { const record = store.sessionRecord(value.sessionId); if (!record || record.revoked_at) return null; } if (value.role === "additional" && store) { const profile = store.getChild(value.profileId); if (!profile?.enabled || (profile.accessExpiresAt && now >= profile.accessExpiresAt)) return null; return { ...value, permissions: profile.permissions }; } if (value.role === "child" && store) { const account = store.childAccount(); if (!account?.enabled || account.authVersion !== value.authVersion) return null; } if (store && value.role === "admin" && store.settings()?.auth_version !== value.authVersion) return null; return value; }
function publicSession(req, store = null) { const value = sessionIdentity(req, Date.now(), store); if (!value) return null; const permissions = value.role === "admin" ? ADMIN_PERMISSIONS : value.role === "owner" ? OWNER_PERMISSIONS : value.role === "child" ? normalizeRolePermissions(value.permissions) : normalizePermissions(value.permissions); return { role: value.role === "owner" ? "admin" : value.role, displayName: value.displayName, permissions, expiresAt: value.expiresAt || null }; }
function workflowWorkspace(req, store = null) { const identity = sessionIdentity(req, Date.now(), store); if (!identity) return store?.securityState?.() === "disabled" ? { ownerType: "admin", ownerId: "primary" } : null; if (identity.role === "admin" || identity.role === "owner") return { ownerType: "admin", ownerId: "primary" }; if (identity.role === "child") return { ownerType: "child", ownerId: "primary" }; if (identity.role === "additional" && identity.profileId) return { ownerType: "additional", ownerId: identity.profileId }; return null; }
function hasPermission(req, permission, store = null) { const value = sessionIdentity(req, Date.now(), store); return value?.role === "admin" || value?.role === "owner" || Boolean(value?.permissions?.[permission]); }

module.exports = { AccessControlStore, ADMIN_PERMISSIONS, CHILD_PERMISSIONS, DAY_MS, DEFAULT_CHILD_PERMISSIONS, OWNER_PERMISSIONS, PERMISSIONS, RESET_TTL_MS, ROLE_PERMISSIONS, hasPermission, hashPassword, normalizeAccessDuration, normalizeEmail, normalizePermissions, normalizeRolePermissions, publicSession, safeMinutes, sessionIdentity, validStoredHash, verifyPassword, workflowWorkspace };
