"use strict";
const crypto = require("node:crypto");
const { normalizeCredentialOwner } = require("./credentialOwnership");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function ownerKey(owner) { const w = normalizeCredentialOwner(owner); return `${w.ownerType}:${w.ownerId}`; }

class TikTokStore {
  constructor(db, secret) {
    if (!secret) throw new Error("TikTok credential encryption secret is required.");
    this.db = db;
    this.key = crypto.scryptSync(secret, "corex-tiktok-v1", 32);
    db.exec(`CREATE TABLE IF NOT EXISTS tiktok_accounts (
      owner TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tiktok_oauth (
      state_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, session_hash TEXT NOT NULL,
      config_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tiktok_uploads (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, account_id TEXT NOT NULL,
      file_hash TEXT NOT NULL, publish_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tiktok_upload_owner ON tiktok_uploads(owner,created_at);
      CREATE TABLE IF NOT EXISTS tiktok_locks (owner TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
  }
  encrypt(value, owner) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(ownerKey(owner)));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify([iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")]);
  }
  account(owner) {
    const row = this.db.prepare("SELECT payload FROM tiktok_accounts WHERE owner=?").get(ownerKey(owner));
    if (!row) return null;
    const [iv, tag, data] = JSON.parse(row.payload).map(value => Buffer.from(value, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(ownerKey(owner))); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString());
  }
  save(owner, value) {
    this.db.prepare("INSERT INTO tiktok_accounts VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
      .run(ownerKey(owner), this.encrypt(value, owner), Date.now());
  }
  remove(owner) {
    this.db.prepare("DELETE FROM tiktok_accounts WHERE owner=?").run(ownerKey(owner));
    this.db.prepare("DELETE FROM tiktok_uploads WHERE owner=?").run(ownerKey(owner));
    this.db.prepare("DELETE FROM tiktok_oauth WHERE owner=?").run(ownerKey(owner));
  }
  begin(owner, sessionId, configHash) {
    this.db.prepare("DELETE FROM tiktok_oauth WHERE expires_at<? OR owner=?").run(Date.now(), ownerKey(owner));
    const state = crypto.randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO tiktok_oauth VALUES (?,?,?,?,?)").run(hash(state), ownerKey(owner), hash(sessionId), configHash, Date.now() + 600000);
    return state;
  }
  consume(state, owner, sessionId, configHash) {
    if (typeof state !== "string" || state.length > 128) return false;
    return Boolean(this.db.prepare("DELETE FROM tiktok_oauth WHERE state_hash=? AND owner=? AND session_hash=? AND config_hash=? AND expires_at>? RETURNING state_hash")
      .get(hash(state), ownerKey(owner), hash(sessionId), configHash, Date.now()));
  }
  lock(owner) {
    return Boolean(this.db.prepare(`INSERT INTO tiktok_locks VALUES (?,?) ON CONFLICT(owner) DO UPDATE
      SET expires_at=excluded.expires_at WHERE tiktok_locks.expires_at<? RETURNING owner`).get(ownerKey(owner), Date.now() + 300000, Date.now()));
  }
  unlock(owner) { this.db.prepare("DELETE FROM tiktok_locks WHERE owner=?").run(ownerKey(owner)); }
  job(owner, id) { return this.db.prepare("SELECT id,publish_id,status,account_id FROM tiktok_uploads WHERE owner=? AND id=?").get(ownerKey(owner), id); }
  recent(owner) { return this.db.prepare("SELECT id,status,created_at FROM tiktok_uploads WHERE owner=? ORDER BY created_at DESC LIMIT 10").all(ownerKey(owner)); }
  duplicate(owner, accountId, fileHash) {
    return this.db.prepare("SELECT id FROM tiktok_uploads WHERE owner=? AND account_id=? AND file_hash=? AND created_at>? LIMIT 1")
      .get(ownerKey(owner), accountId, fileHash, Date.now() - 86400000);
  }
  createJob(owner, accountId, fileHash, id) {
    this.db.prepare("INSERT INTO tiktok_uploads VALUES (?,?,?,?,NULL,'INITIALIZING',?)").run(id, ownerKey(owner), accountId, fileHash, Date.now());
  }
  updateJob(owner, id, status, publishId = null) {
    this.db.prepare("UPDATE tiktok_uploads SET status=?,publish_id=COALESCE(?,publish_id) WHERE owner=? AND id=?").run(status, publishId, ownerKey(owner), id);
  }
}
module.exports = { TikTokStore, hash };
