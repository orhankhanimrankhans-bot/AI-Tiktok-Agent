"use strict";

const session = require("express-session");

class SqliteSessionStore extends session.Store {
  constructor({ db, now = () => Date.now(), cleanupIntervalMs = 60 * 60_000 } = {}) {
    super();
    this.db = null;
    this.now = now;
    this.cleanupIntervalMs = cleanupIntervalMs;
    if (db) this.attach(db);
  }
  attach(db) {
    if (!db) throw new Error("A SQLite database is required for persistent sessions.");
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS jarvis_http_sessions (
      sid TEXT PRIMARY KEY, session_json TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_jarvis_http_sessions_expiry ON jarvis_http_sessions(expires_at);`);
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }
  get(sid, callback) { try { if (!this.db) return callback(new Error("Session store is not ready.")); const row = this.db.prepare("SELECT session_json, expires_at FROM jarvis_http_sessions WHERE sid = ?").get(sid); if (!row || row.expires_at <= this.now()) { if (row) this.destroy(sid, () => {}); return callback(null, null); } return callback(null, JSON.parse(row.session_json)); } catch (error) { return callback(error); } }
  set(sid, value, callback = () => {}) { try { const expiresAt = value?.cookie?.expires ? new Date(value.cookie.expires).getTime() : this.now() + 3650 * 86_400_000; this.db.prepare(`INSERT INTO jarvis_http_sessions (sid, session_json, expires_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET session_json = excluded.session_json, expires_at = excluded.expires_at, updated_at = excluded.updated_at`).run(sid, JSON.stringify(value), expiresAt, new Date(this.now()).toISOString()); callback(null); } catch (error) { callback(error); } }
  destroy(sid, callback = () => {}) { try { this.db.prepare("DELETE FROM jarvis_http_sessions WHERE sid = ?").run(sid); callback(null); } catch (error) { callback(error); } }
  touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
  cleanup() { if (this.db) this.db.prepare("DELETE FROM jarvis_http_sessions WHERE expires_at <= ?").run(this.now()); }
  close() { clearInterval(this.cleanupTimer); }
}

module.exports = { SqliteSessionStore };
