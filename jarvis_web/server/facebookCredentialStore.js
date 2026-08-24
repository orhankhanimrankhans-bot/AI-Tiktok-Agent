const crypto = require("crypto");
const { decryptTokensWithFallback, encryptionKeys, encryptTokens } = require("./credentialStore");

const ID_PATTERN = /^fcred_[A-Za-z0-9_-]{22}$/;
const SELECTION_ID_PATTERN = /^fsel_[A-Za-z0-9_-]{22}$/;
const AUTH_MODE_OAUTH = "oauth";
const AUTH_MODE_MANUAL = "manual_access_token";

function publicCredential(row) {
  const authMode = row.auth_mode || AUTH_MODE_OAUTH;
  return { id: row.id, name: row.name || row.account_name || "Facebook account", provider: "facebook",
    type: authMode === AUTH_MODE_MANUAL ? "access_token" : "oauth2", authMode,
    accountId: row.account_id, accountName: row.account_name || "", pageId: row.page_id || "", pageName: row.page_name || "",
    appId: row.app_id || "", connected: row.connection_status !== "error", status: row.connection_status || "connected",
    connectionStatus: row.connection_status || "connected", createdAt: row.created_at, updatedAt: row.updated_at,
    lastTestedAt: row.last_tested_at || null };
}

class FacebookCredentialStore {
  constructor({ db, encryptionSecret, legacyEncryptionSecrets = [] }) {
    this.db = db; const keys = encryptionKeys(encryptionSecret, legacyEncryptionSecrets); this.key = keys.currentKey; this.legacyKeys = keys.legacyKeys;
  }
  static generateId() { return `fcred_${crypto.randomBytes(16).toString("base64url")}`; }
  static generateSelectionId() { return `fsel_${crypto.randomBytes(16).toString("base64url")}`; }
  static isValidId(id) { return typeof id === "string" && ID_PATTERN.test(id); }
  open() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS facebook_credentials (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, type TEXT NOT NULL,
      account_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '',
      token_ciphertext BLOB NOT NULL, token_iv BLOB NOT NULL, token_tag BLOB NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    const columns = new Set(this.db.prepare("PRAGMA table_info(facebook_credentials)").all().map((column) => column.name));
    const migrations = [["name", "TEXT NOT NULL DEFAULT ''"], ["auth_mode", `TEXT NOT NULL DEFAULT '${AUTH_MODE_OAUTH}'`],
      ["connection_status", "TEXT NOT NULL DEFAULT 'connected'"], ["page_id", "TEXT NOT NULL DEFAULT ''"],
      ["page_name", "TEXT NOT NULL DEFAULT ''"], ["app_id", "TEXT NOT NULL DEFAULT ''"], ["last_tested_at", "TEXT"]];
    for (const [name, definition] of migrations) if (!columns.has(name)) this.db.exec(`ALTER TABLE facebook_credentials ADD COLUMN ${name} ${definition}`);
    this.db.exec("UPDATE facebook_credentials SET auth_mode = 'oauth' WHERE auth_mode IS NULL OR trim(auth_mode) = ''");
    this.db.exec("DROP INDEX IF EXISTS idx_facebook_credentials_account");
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_credentials_oauth_page
      ON facebook_credentials(account_id, page_id, auth_mode)
      WHERE auth_mode = 'oauth' AND trim(page_id) <> ''`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_credentials_manual_page
      ON facebook_credentials(page_id, auth_mode)
      WHERE auth_mode = 'manual_access_token' AND trim(page_id) <> ''`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS facebook_oauth_page_selections (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '', pages_json TEXT NOT NULL,
      token_ciphertext BLOB NOT NULL, token_iv BLOB NOT NULL, token_tag BLOB NOT NULL, expires_at INTEGER NOT NULL,
      credential_id TEXT)`);
    const selectionColumns = new Set(this.db.prepare("PRAGMA table_info(facebook_oauth_page_selections)").all().map((column) => column.name));
    if (!selectionColumns.has("credential_id")) this.db.exec("ALTER TABLE facebook_oauth_page_selections ADD COLUMN credential_id TEXT");
    this.db.prepare("DELETE FROM facebook_oauth_page_selections WHERE expires_at <= ?").run(Date.now());
  }
  list() { return this.db.prepare("SELECT * FROM facebook_credentials ORDER BY created_at ASC").all().map(publicCredential); }
  get(id, { includeTokens = false } = {}) {
    if (!FacebookCredentialStore.isValidId(id)) return null;
    const row = this.db.prepare("SELECT * FROM facebook_credentials WHERE id = ?").get(id);
    if (!row) return null;
    const result = publicCredential(row); const decrypted = decryptTokensWithFallback(row, this.key, this.legacyKeys);
    if (decrypted.migrated) {
      const encrypted = encryptTokens(decrypted.tokens, this.key);
      this.db.prepare("UPDATE facebook_credentials SET token_ciphertext = ?, token_iv = ?, token_tag = ? WHERE id = ?")
        .run(encrypted.ciphertext, encrypted.iv, encrypted.tag, row.id);
    }
    if (includeTokens) result.tokens = decrypted.tokens; return result;
  }
  findByAccountId(accountId, options = {}) {
    const row = this.db.prepare("SELECT * FROM facebook_credentials WHERE account_id = ? AND auth_mode = ?").get(String(accountId || ""), AUTH_MODE_OAUTH);
    return row ? this.get(row.id, options) : null;
  }
  findByPage({ accountId = "", pageId, authMode = AUTH_MODE_OAUTH }, options = {}) {
    const normalizedPageId = String(pageId || "");
    if (!normalizedPageId) return null;
    const row = authMode === AUTH_MODE_MANUAL
      ? this.db.prepare("SELECT id FROM facebook_credentials WHERE page_id = ? AND auth_mode = ?").get(normalizedPageId, AUTH_MODE_MANUAL)
      : this.db.prepare("SELECT id FROM facebook_credentials WHERE account_id = ? AND page_id = ? AND auth_mode = ?")
        .get(String(accountId || ""), normalizedPageId, AUTH_MODE_OAUTH);
    return row ? this.get(row.id, options) : null;
  }
  createPageSelection({ accountId, accountName = "", pages, tokens, credentialId = null, ttlMs = 10 * 60 * 1000 }) {
    const safePages = (Array.isArray(pages) ? pages : []).map((page) => ({ id: String(page.id), name: String(page.name || "Facebook Page") }));
    if (!safePages.length || !tokens || typeof tokens !== "object") throw new Error("Facebook Page selection data is required.");
    const id = FacebookCredentialStore.generateSelectionId(); const encrypted = encryptTokens(tokens, this.key);
    this.db.prepare(`INSERT INTO facebook_oauth_page_selections
      (id,account_id,account_name,pages_json,token_ciphertext,token_iv,token_tag,expires_at,credential_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, String(accountId), String(accountName), JSON.stringify(safePages), encrypted.ciphertext, encrypted.iv, encrypted.tag,
        Date.now() + ttlMs, FacebookCredentialStore.isValidId(credentialId) ? credentialId : null);
    return { id, pages: safePages };
  }
  consumePageSelection({ selectionId, pageId }) {
    if (typeof selectionId !== "string" || !SELECTION_ID_PATTERN.test(selectionId)) return null;
    const row = this.db.prepare("SELECT * FROM facebook_oauth_page_selections WHERE id = ? AND expires_at > ?").get(selectionId, Date.now());
    if (!row) return null;
    const pages = JSON.parse(row.pages_json); const page = pages.find((item) => item.id === String(pageId));
    if (!page) return null;
    const tokens = decryptTokensWithFallback(row, this.key, this.legacyKeys).tokens;
    this.db.prepare("DELETE FROM facebook_oauth_page_selections WHERE id = ?").run(selectionId);
    return { accountId: row.account_id, accountName: row.account_name, page, tokens, credentialId: row.credential_id || null };
  }
  save({ id, accountId, accountName = "", pageId = "", pageName = "", name = "", tokens }) {
    if (!FacebookCredentialStore.isValidId(id)) throw new Error("Invalid Facebook credential ID.");
    if (!String(accountId || "").trim()) throw new Error("Facebook account ID is required.");
    if (!tokens || typeof tokens !== "object") throw new Error("Facebook OAuth tokens are required.");
    const existingPage = pageId ? this.findByPage({ accountId, pageId, authMode: AUTH_MODE_OAUTH }) : null;
    return this.#write({ id: existingPage?.id || id, name: name || pageName || accountName, authMode: AUTH_MODE_OAUTH, accountId, accountName,
      pageId: String(pageId || ""), pageName: String(pageName || ""), tokens, status: "connected" });
  }
  saveManual({ id, name, pageId, pageName = "", appId = "", accessToken, lastTestedAt = new Date().toISOString() }) {
    if (!FacebookCredentialStore.isValidId(id)) throw new Error("Invalid Facebook credential ID.");
    if (!String(name || "").trim()) throw new Error("Credential name is required.");
    if (!/^\d{3,30}$/.test(String(pageId || ""))) throw new Error("A valid Facebook Page ID is required.");
    if (!String(accessToken || "")) throw new Error("Facebook Page access token is required.");
    const existingPage = this.findByPage({ pageId, authMode: AUTH_MODE_MANUAL });
    return this.#write({ id: existingPage?.id || id, name: String(name).trim(), authMode: AUTH_MODE_MANUAL, accountId: String(pageId), accountName: pageName,
      pageId: String(pageId), pageName, appId, tokens: { pageAccessToken: String(accessToken) }, status: "connected", lastTestedAt });
  }
  updateManual({ id, name, accessToken, pageId, pageName, appId, lastTestedAt }) {
    const existing = this.get(id, { includeTokens: true });
    if (!existing) return null;
    if (existing.authMode !== AUTH_MODE_MANUAL) throw new Error("Only manual Facebook credentials can be updated here.");
    if (!accessToken) {
      this.db.prepare("UPDATE facebook_credentials SET name = ?, updated_at = ? WHERE id = ?")
        .run(String(name || existing.name).trim(), new Date().toISOString(), id);
      return this.get(id);
    }
    return this.saveManual({ id, name: String(name || existing.name).trim(), pageId: pageId || existing.pageId,
      pageName: pageName ?? existing.pageName, appId: appId ?? existing.appId,
      accessToken: accessToken || existing.tokens.pageAccessToken, lastTestedAt: lastTestedAt || existing.lastTestedAt });
  }
  #write({ id, name = "", authMode, accountId, accountName = "", pageId = "", pageName = "", appId = "", tokens, status, lastTestedAt = null }) {
    const existing = this.db.prepare("SELECT created_at FROM facebook_credentials WHERE id = ?").get(id);
    const encrypted = encryptTokens(tokens, this.key); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO facebook_credentials (id,provider,type,account_id,account_name,token_ciphertext,token_iv,token_tag,created_at,updated_at,name,auth_mode,connection_status,page_id,page_name,app_id,last_tested_at)
      VALUES (?,'facebook',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, account_id=excluded.account_id, account_name=excluded.account_name, token_ciphertext=excluded.token_ciphertext,
      token_iv=excluded.token_iv, token_tag=excluded.token_tag, updated_at=excluded.updated_at, name=excluded.name, auth_mode=excluded.auth_mode,
      connection_status=excluded.connection_status, page_id=excluded.page_id, page_name=excluded.page_name, app_id=excluded.app_id, last_tested_at=excluded.last_tested_at`)
      .run(id, authMode === AUTH_MODE_MANUAL ? "access_token" : "oauth2", String(accountId), accountName, encrypted.ciphertext, encrypted.iv, encrypted.tag,
        existing?.created_at || now, now, name, authMode, status, pageId, pageName, appId, lastTestedAt);
    return this.get(id);
  }
  delete(id) { if (!FacebookCredentialStore.isValidId(id)) return false; return Number(this.db.prepare("DELETE FROM facebook_credentials WHERE id = ?").run(id).changes) > 0; }
}

module.exports = { AUTH_MODE_MANUAL, AUTH_MODE_OAUTH, FacebookCredentialStore };
