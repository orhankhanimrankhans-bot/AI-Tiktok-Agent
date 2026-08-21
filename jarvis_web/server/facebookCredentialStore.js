const crypto = require("crypto");
const { decryptTokens, deriveEncryptionKey, encryptTokens } = require("./credentialStore");

const ID_PATTERN = /^fcred_[A-Za-z0-9_-]{22}$/;

function publicCredential(row) {
  return { id: row.id, provider: "facebook", type: "oauth2", accountId: row.account_id,
    accountName: row.account_name || "", connected: true, status: "connected",
    createdAt: row.created_at, updatedAt: row.updated_at };
}

class FacebookCredentialStore {
  constructor({ db, encryptionSecret }) { this.db = db; this.key = deriveEncryptionKey(encryptionSecret); }
  static generateId() { return `fcred_${crypto.randomBytes(16).toString("base64url")}`; }
  static isValidId(id) { return typeof id === "string" && ID_PATTERN.test(id); }
  open() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS facebook_credentials (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, type TEXT NOT NULL,
      account_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '',
      token_ciphertext BLOB NOT NULL, token_iv BLOB NOT NULL, token_tag BLOB NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_credentials_account ON facebook_credentials(account_id)");
  }
  list() { return this.db.prepare("SELECT * FROM facebook_credentials ORDER BY created_at ASC").all().map(publicCredential); }
  get(id, { includeTokens = false } = {}) {
    if (!FacebookCredentialStore.isValidId(id)) return null;
    const row = this.db.prepare("SELECT * FROM facebook_credentials WHERE id = ?").get(id);
    if (!row) return null;
    const result = publicCredential(row);
    if (includeTokens) result.tokens = decryptTokens(row, this.key);
    return result;
  }
  findByAccountId(accountId, options = {}) {
    const row = this.db.prepare("SELECT * FROM facebook_credentials WHERE account_id = ?").get(String(accountId || ""));
    return row ? this.get(row.id, options) : null;
  }
  save({ id, accountId, accountName = "", tokens }) {
    if (!FacebookCredentialStore.isValidId(id)) throw new Error("Invalid Facebook credential ID.");
    if (!String(accountId || "").trim()) throw new Error("Facebook account ID is required.");
    if (!tokens || typeof tokens !== "object") throw new Error("Facebook OAuth tokens are required.");
    const existing = this.db.prepare("SELECT created_at FROM facebook_credentials WHERE id = ?").get(id);
    const encrypted = encryptTokens(tokens, this.key); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO facebook_credentials (id,provider,type,account_id,account_name,token_ciphertext,token_iv,token_tag,created_at,updated_at)
      VALUES (?,'facebook','oauth2',?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      account_id=excluded.account_id, account_name=excluded.account_name, token_ciphertext=excluded.token_ciphertext,
      token_iv=excluded.token_iv, token_tag=excluded.token_tag, updated_at=excluded.updated_at`)
      .run(id, String(accountId), accountName, encrypted.ciphertext, encrypted.iv, encrypted.tag, existing?.created_at || now, now);
    return this.get(id);
  }
  delete(id) {
    if (!FacebookCredentialStore.isValidId(id)) return false;
    return Number(this.db.prepare("DELETE FROM facebook_credentials WHERE id = ?").run(id).changes) > 0;
  }
}

module.exports = { FacebookCredentialStore };
