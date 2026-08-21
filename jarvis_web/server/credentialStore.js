const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  throw new Error(
    "Jarvis credential storage requires a Node.js runtime with node:sqlite support.",
    { cause: error }
  );
}

const PROVIDER = "google-drive";
const TYPE = "oauth2";
const CREDENTIAL_ID_PATTERN = /^gcred_[A-Za-z0-9_-]{22}$/;
const KEY_SALT = "jarvis-web-google-credential-store-v1";

function deriveEncryptionKey(secret) {
  if (!secret || typeof secret !== "string") {
    throw new Error("A server-side credential encryption secret is required.");
  }
  return crypto.scryptSync(secret, KEY_SALT, 32);
}

function encryptTokens(tokens, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptTokens(row, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, row.token_iv);
  decipher.setAuthTag(row.token_tag);
  const plaintext = Buffer.concat([
    decipher.update(row.token_ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function publicCredential(row) {
  return {
    id: row.id,
    provider: row.provider,
    type: row.type,
    accountEmail: row.account_email || "",
    accountName: row.account_name || "",
    connected: true,
    status: "connected",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class CredentialStore {
  constructor({ dbPath, encryptionSecret }) {
    if (!dbPath) throw new Error("Credential database path is required.");
    this.dbPath = path.resolve(dbPath);
    this.key = deriveEncryptionKey(encryptionSecret);
    this.db = null;
  }

  static generateId() {
    return `gcred_${crypto.randomBytes(16).toString("base64url")}`;
  }

  static isValidId(id) {
    return typeof id === "string" && CREDENTIAL_ID_PATTERN.test(id);
  }

  async open() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    await this.run("PRAGMA journal_mode = WAL");
    await this.run("PRAGMA foreign_keys = ON");
    await this.run(`
      CREATE TABLE IF NOT EXISTS google_credentials (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        account_email TEXT NOT NULL DEFAULT '',
        account_name TEXT NOT NULL DEFAULT '',
        token_ciphertext BLOB NOT NULL,
        token_iv BLOB NOT NULL,
        token_tag BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    return this;
  }

  run(sql, params = []) {
    if (params.length === 0 && /^\s*PRAGMA\b/i.test(sql)) {
      this.db.exec(sql);
      return Promise.resolve({ changes: 0, lastID: 0 });
    }
    const result = this.db.prepare(sql).run(...params);
    return Promise.resolve({
      changes: Number(result.changes),
      lastID: Number(result.lastInsertRowid),
    });
  }

  all(sql, params = []) {
    return Promise.resolve(this.db.prepare(sql).all(...params));
  }

  getRow(id) {
    const row = this.db
      .prepare("SELECT * FROM google_credentials WHERE id = ?")
      .get(id);
    return Promise.resolve(row || null);
  }

  async list() {
    const rows = await this.all(
      "SELECT * FROM google_credentials ORDER BY created_at ASC"
    );
    return rows.map(publicCredential);
  }

  async get(id, { includeTokens = false } = {}) {
    if (!CredentialStore.isValidId(id)) return null;
    const row = await this.getRow(id);
    if (!row) return null;
    const credential = publicCredential(row);
    if (includeTokens) credential.tokens = decryptTokens(row, this.key);
    return credential;
  }

  async save({ id, accountEmail = "", accountName = "", tokens }) {
    if (!CredentialStore.isValidId(id)) throw new Error("Invalid credential ID.");
    if (!tokens || typeof tokens !== "object") throw new Error("OAuth tokens are required.");
    const existing = await this.getRow(id);
    const now = new Date().toISOString();
    const encrypted = encryptTokens(tokens, this.key);
    await this.run(
      `INSERT INTO google_credentials (
        id, provider, type, account_email, account_name,
        token_ciphertext, token_iv, token_tag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_email = excluded.account_email,
        account_name = excluded.account_name,
        token_ciphertext = excluded.token_ciphertext,
        token_iv = excluded.token_iv,
        token_tag = excluded.token_tag,
        updated_at = excluded.updated_at`,
      [
        id, PROVIDER, TYPE, accountEmail, accountName,
        encrypted.ciphertext, encrypted.iv, encrypted.tag,
        existing?.created_at || now, now,
      ]
    );
    return this.get(id);
  }

  async delete(id) {
    if (!CredentialStore.isValidId(id)) return false;
    const result = await this.run(
      "DELETE FROM google_credentials WHERE id = ?",
      [id]
    );
    return result.changes > 0;
  }

  close() {
    if (!this.db) return Promise.resolve();
    const db = this.db;
    this.db = null;
    db.close();
    return Promise.resolve();
  }
}

module.exports = {
  CredentialStore,
  decryptTokens,
  deriveEncryptionKey,
  encryptTokens,
};
