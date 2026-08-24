"use strict";

const crypto = require("node:crypto");

const DEFAULT_CHILD_PERMISSIONS = Object.freeze({
  dashboard: false, tools: false, view_workflow: false, edit_workflow: false,
  run_workflow: false, publish_facebook: false, view_facebook: false,
  storage: false, storage_modify: false,
});
const PERMISSIONS = Object.freeze(Object.keys(DEFAULT_CHILD_PERMISSIONS));
const OWNER_PERMISSIONS = Object.freeze(Object.fromEntries(PERMISSIONS.map((key) => [key, true])));

function normalizePermissions(value) {
  const input = value && typeof value === "object" ? value : {};
  return Object.fromEntries(PERMISSIONS.map((key) => [key, input[key] === true]));
}
function safeMinutes(value) { return [0, 5, 15, 30, 60, 120].includes(Number(value)) ? Number(value) : 0; }
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
  const child = { id: row.id, displayName: row.display_name, enabled: Boolean(row.enabled), permissions: normalizePermissions(JSON.parse(row.permissions_json)), sessionLimitMinutes: row.session_limit_minutes, createdAt: row.created_at, updatedAt: row.updated_at };
  if (includeHash) child.passwordHash = row.password_hash;
  return child;
}

class AccessControlStore {
  constructor({ db }) { this.db = db; }
  open() {
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_security_settings (id INTEGER PRIMARY KEY CHECK (id = 1), admin_password_hash TEXT NOT NULL, auto_lock_minutes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS jarvis_child_profiles (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, permissions_json TEXT NOT NULL, session_limit_minutes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  }
  settings() { return this.db.prepare("SELECT admin_password_hash, auto_lock_minutes, updated_at FROM jarvis_security_settings WHERE id = 1").get() || null; }
  securityState() { const value = this.settings(); return !value ? "disabled" : validStoredHash(value.admin_password_hash) ? "enabled" : "recovery_required"; }
  publicSettings() { const value = this.settings(); return { enabled: this.securityState() === "enabled", recoveryRequired: this.securityState() === "recovery_required", autoLockMinutes: this.securityState() === "enabled" ? safeMinutes(value.auto_lock_minutes) : 0 }; }
  async setup(password, autoLockMinutes = 0) { if (this.securityState() !== "disabled") throw new Error(this.securityState() === "recovery_required" ? "Security recovery is required." : "Security is already configured."); const now = new Date().toISOString(); this.db.prepare("INSERT INTO jarvis_security_settings (id, admin_password_hash, auto_lock_minutes, updated_at) VALUES (1, ?, ?, ?)").run(await hashPassword(password), safeMinutes(autoLockMinutes), now); }
  async recover(password, autoLockMinutes = 0) { if (this.securityState() !== "recovery_required") throw new Error("Security recovery is not required."); const now = new Date().toISOString(); this.db.prepare("UPDATE jarvis_security_settings SET admin_password_hash = ?, auto_lock_minutes = ?, updated_at = ? WHERE id = 1").run(await hashPassword(password), safeMinutes(autoLockMinutes), now); }
  async verifyAdmin(password) { const value = this.settings(); return Boolean(value && await verifyPassword(password, value.admin_password_hash)); }
  setAutoLock(minutes) { this.db.prepare("UPDATE jarvis_security_settings SET auto_lock_minutes = ?, updated_at = ? WHERE id = 1").run(safeMinutes(minutes), new Date().toISOString()); }
  listChildren() { return this.db.prepare("SELECT * FROM jarvis_child_profiles ORDER BY created_at ASC").all().map(publicChild); }
  getChild(id, includeHash = false) { const row = this.db.prepare("SELECT * FROM jarvis_child_profiles WHERE id = ?").get(id); return row ? publicChild(row, includeHash) : null; }
  async createChild({ displayName, password, enabled = true, permissions, sessionLimitMinutes = 0 }) { const name = String(displayName || "").trim(); if (!name || name.length > 80) throw new Error("Display name must be 1 to 80 characters."); const now = new Date().toISOString(); const id = `child_${crypto.randomBytes(16).toString("base64url")}`; this.db.prepare("INSERT INTO jarvis_child_profiles (id, display_name, password_hash, enabled, permissions_json, session_limit_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, name, await hashPassword(password), enabled ? 1 : 0, JSON.stringify(normalizePermissions(permissions)), safeMinutes(sessionLimitMinutes), now, now); return this.getChild(id); }
  async verifyChild(id, password) { const child = this.getChild(id, true); return child?.enabled && await verifyPassword(password, child.passwordHash) ? child : null; }
  updateChild(id, patch) { const existing = this.getChild(id, true); if (!existing) return null; const permissions = patch.permissions === undefined ? existing.permissions : normalizePermissions(patch.permissions); const enabled = patch.enabled === undefined ? existing.enabled : Boolean(patch.enabled); const minutes = patch.sessionLimitMinutes === undefined ? existing.sessionLimitMinutes : safeMinutes(patch.sessionLimitMinutes); this.db.prepare("UPDATE jarvis_child_profiles SET enabled = ?, permissions_json = ?, session_limit_minutes = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, JSON.stringify(permissions), minutes, new Date().toISOString(), id); return this.getChild(id); }
  deleteChild(id) { return this.db.prepare("DELETE FROM jarvis_child_profiles WHERE id = ?").run(id).changes > 0; }
}
function sessionIdentity(req, now = Date.now()) { const value = req.session?.jarvisAuth; return value?.role && (!value.expiresAt || now < value.expiresAt) ? value : null; }
function publicSession(req) { const value = sessionIdentity(req); return value ? { role: value.role, displayName: value.displayName, permissions: value.role === "owner" ? OWNER_PERMISSIONS : normalizePermissions(value.permissions), expiresAt: value.expiresAt || null } : null; }
function hasPermission(req, permission) { const value = sessionIdentity(req); return value?.role === "owner" || Boolean(value?.permissions?.[permission]); }

module.exports = { AccessControlStore, DEFAULT_CHILD_PERMISSIONS, OWNER_PERMISSIONS, PERMISSIONS, hasPermission, hashPassword, normalizePermissions, publicSession, safeMinutes, sessionIdentity, validStoredHash, verifyPassword };
