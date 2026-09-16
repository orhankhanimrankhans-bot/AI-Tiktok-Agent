"use strict";
const crypto = require("node:crypto");
const { FacebookGraphError } = require("./facebookGraph");
function requireWorkspace(owner) {
  if (!owner || !["admin", "child", "additional"].includes(owner.ownerType) || !/^[A-Za-z0-9_-]{1,200}$/.test(owner.ownerId || "")) {
    throw new FacebookGraphError(401, "workspace_required", "An authenticated workspace is required.");
  }
  return { ownerType: owner.ownerType, ownerId: owner.ownerId };
}
function binding(owner) { const w = requireWorkspace(owner); return `${w.ownerType}:${w.ownerId}`; }
class MetaAppConfigStore {
  constructor({ db, encryptionSecret, isActive = () => true }) {
    if (!encryptionSecret) throw new Error("Meta configuration encryption is required.");
    this.db = db; this.key = crypto.createHash("sha256").update(encryptionSecret).digest(); this.isActive = isActive;
  }
  open() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS corex_workspaces (
      owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(owner_type,owner_id));
      CREATE TABLE IF NOT EXISTS meta_app_configs (
        owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, app_id TEXT NOT NULL, graph_version TEXT NOT NULL,
        redirect_uri TEXT NOT NULL, secret_ciphertext BLOB NOT NULL, secret_iv BLOB NOT NULL, secret_tag BLOB NOT NULL,
        revision TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_type,owner_id),
        FOREIGN KEY(owner_type,owner_id) REFERENCES corex_workspaces(owner_type,owner_id));
      CREATE TABLE IF NOT EXISTS meta_oauth_flows (
        state_hash TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, session_hash TEXT NOT NULL,
        revision TEXT NOT NULL, mode TEXT NOT NULL, credential_id TEXT, expires_at INTEGER NOT NULL,
        FOREIGN KEY(owner_type,owner_id) REFERENCES meta_app_configs(owner_type,owner_id));`);
    // Additive private tables only: no triggers on existing production tables.
  }
  row(owner) { const w = requireWorkspace(owner); return this.db.prepare("SELECT * FROM meta_app_configs WHERE owner_type=? AND owner_id=?").get(w.ownerType, w.ownerId); }
  public(owner) {
    const row = this.row(owner);
    return row ? { configured: true, appId: row.app_id, graphVersion: row.graph_version, redirectUri: row.redirect_uri, secretConfigured: true, revision: row.revision }
      : { configured: false, code: "META_APP_NOT_CONFIGURED" };
  }
  save(input, owner) {
    const w = requireWorkspace(owner); this.assertActive(w);
    if (Object.keys(input || {}).some((key) => !["appId", "appSecret", "graphVersion", "redirectUri"].includes(key))) throw new FacebookGraphError(400, "invalid_meta_config", "Only Meta app configuration fields are accepted.");
    input = { ...input, appId: String(input?.appId || "").trim() };
    if (!/^\d{3,30}$/.test(input.appId || "") || !/^v\d{1,2}\.\d{1,2}$/.test(input.graphVersion || "")) throw new FacebookGraphError(400, "invalid_meta_config", "Enter a valid Meta App ID and Graph version.");
    let url; try { url = new URL(input.redirectUri); } catch { /* handled below */ }
    if (!url || url.username || url.password || url.hash || url.search || !["https:", "http:"].includes(url.protocol)
      || (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) || url.pathname !== "/api/facebook/auth/callback") {
      throw new FacebookGraphError(400, "invalid_meta_redirect", "Use an HTTPS COREX Facebook callback URL (HTTP is allowed only for localhost).");
    }
    let secret = input.appSecret;
    if (!secret && this.row(w)?.app_id === input.appId) secret = this.require(w).appSecret;
    if (typeof secret !== "string" || secret.length < 16 || secret.length > 512 || /\s/.test(secret)) throw new FacebookGraphError(400, "invalid_meta_secret", "Enter a valid Meta App Secret.");
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${binding(w)}:${input.appId}`));
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const revision = crypto.randomUUID(), now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO corex_workspaces VALUES (?,?,?)").run(w.ownerType, w.ownerId, now);
      this.db.prepare(`INSERT INTO meta_app_configs VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id) DO UPDATE SET
        app_id=excluded.app_id, graph_version=excluded.graph_version,redirect_uri=excluded.redirect_uri,secret_ciphertext=excluded.secret_ciphertext,
        secret_iv=excluded.secret_iv,secret_tag=excluded.secret_tag,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(w.ownerType,w.ownerId,input.appId,input.graphVersion,url.toString(),encrypted,iv,cipher.getAuthTag(),revision,now);
      this.db.prepare("DELETE FROM meta_oauth_flows WHERE owner_type=? AND owner_id=?").run(w.ownerType,w.ownerId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.public(w);
  }
  remove(owner) {
    const w = requireWorkspace(owner); this.assertActive(w);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM meta_oauth_flows WHERE owner_type=? AND owner_id=?").run(w.ownerType,w.ownerId);
      this.db.prepare("DELETE FROM meta_app_configs WHERE owner_type=? AND owner_id=?").run(w.ownerType,w.ownerId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.public(w);
  }
  assertActive(owner) { if (!this.isActive(requireWorkspace(owner))) throw new FacebookGraphError(403, "workspace_inactive", "Workspace access is disabled or expired."); }
  require(owner, credential = null) {
    this.assertActive(owner); const row = this.row(owner);
    if (!row) throw new FacebookGraphError(503, "META_APP_NOT_CONFIGURED", "Configure a Meta app for this workspace before connecting or using Facebook.");
    if (credential && credential.appId !== row.app_id) throw new FacebookGraphError(409, "META_APP_CREDENTIAL_MISMATCH", "Reconnect this Facebook credential using this workspace's Meta app.");
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, row.secret_iv);
      decipher.setAAD(Buffer.from(`${binding(owner)}:${row.app_id}`)); decipher.setAuthTag(row.secret_tag);
      return { ...this.public(owner), appSecret: Buffer.concat([decipher.update(row.secret_ciphertext), decipher.final()]).toString("utf8") };
    } catch { throw new FacebookGraphError(503, "META_APP_SECRET_UNAVAILABLE", "The workspace Meta secret could not be decrypted."); }
  }
  begin(owner, sessionId, { mode = "redirect", credentialId = null } = {}) {
    const w = requireWorkspace(owner), config = this.require(w);
    if (!sessionId) throw new FacebookGraphError(401, "oauth_session_required", "Sign in before starting Meta OAuth.");
    const state = crypto.randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO meta_oauth_flows VALUES (?,?,?,?,?,?,?,?)").run(digest(state),w.ownerType,w.ownerId,digest(sessionId),config.revision,mode,credentialId,Date.now()+600000);
    return { state, config };
  }
  consume(state, owner, sessionId) {
    const w = requireWorkspace(owner);
    if (typeof state !== "string" || !/^[\w-]{43}$/.test(state) || !sessionId) return null;
    // DELETE RETURNING is atomic: only the bound browser/workspace can consume once.
    const row = this.db.prepare(`DELETE FROM meta_oauth_flows WHERE state_hash=? AND owner_type=? AND owner_id=? AND session_hash=? AND expires_at>? RETURNING *`)
      .get(digest(state),w.ownerType,w.ownerId,digest(sessionId),Date.now());
    if (!row) return null;
    const config = this.require(w); if (config.revision !== row.revision) return null;
    return { ...w, mode: row.mode, intent: row.credential_id ? "reconnect" : "create", credentialId: row.credential_id, config };
  }
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
module.exports = { MetaAppConfigStore, requireWorkspace, binding };
