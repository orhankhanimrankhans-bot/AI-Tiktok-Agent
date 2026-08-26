const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  throw new Error(
    "Corex credential storage requires a Node.js runtime with node:sqlite support.",
    { cause: error }
  );
}

const PROVIDER = "google-drive";
const TYPE = "oauth2";
const CREDENTIAL_ID_PATTERN = /^gcred_[A-Za-z0-9_-]{22}$/;
const KEY_SALT = "jarvis-web-google-credential-store-v1";
const ACCOUNT_UNIQUE_INDEX = "idx_google_credentials_provider_account_email";
const { normalizeCredentialOwner } = require("./credentialOwnership");

class CredentialDecryptionError extends Error {
  constructor() { super("Stored credential could not be decrypted."); this.code = "credential_decryption_failed"; }
}

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

function decryptTokensWithFallback(row, currentKey, legacyKeys = []) {
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", currentKey, row.token_iv);
    decipher.setAuthTag(row.token_tag);
    plaintext = Buffer.concat([decipher.update(row.token_ciphertext), decipher.final()]);
  } catch {
    // Authenticated current-key decryption failed; legacy keys are attempted below.
    plaintext = null;
  }
  if (plaintext) {
    try { return { tokens: JSON.parse(plaintext.toString("utf8")), migrated: false }; }
    catch { throw new CredentialDecryptionError(); }
  }
  for (const legacyKey of legacyKeys) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", legacyKey, row.token_iv);
      decipher.setAuthTag(row.token_tag);
      plaintext = Buffer.concat([decipher.update(row.token_ciphertext), decipher.final()]);
      let tokens;
      try { tokens = JSON.parse(plaintext.toString("utf8")); } catch { throw new CredentialDecryptionError(); }
      return { tokens, migrated: true };
    } catch (error) {
      if (error instanceof CredentialDecryptionError) throw error;
    }
  }
  throw new CredentialDecryptionError();
}

function encryptionKeys(encryptionSecret, legacyEncryptionSecrets = []) {
  const currentKey = deriveEncryptionKey(encryptionSecret);
  const legacyKeys = [...new Set(legacyEncryptionSecrets.filter((secret) => typeof secret === "string" && secret))]
    .map(deriveEncryptionKey).filter((key) => !key.equals(currentKey));
  return { currentKey, legacyKeys };
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
  constructor({ dbPath, encryptionSecret, legacyEncryptionSecrets = [] }) {
    if (!dbPath) throw new Error("Credential database path is required.");
    this.dbPath = path.resolve(dbPath);
    const keys = encryptionKeys(encryptionSecret, legacyEncryptionSecrets);
    this.key = keys.currentKey;
    this.legacyKeys = keys.legacyKeys;
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
    const columns = new Set(this.db.prepare("PRAGMA table_info(google_credentials)").all().map((column) => column.name));
    if (!columns.has("owner_type")) this.db.exec("ALTER TABLE google_credentials ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'admin'");
    if (!columns.has("owner_id")) this.db.exec("ALTER TABLE google_credentials ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'primary'");
    this.migrateCredentialUniqueness();
    return this;
  }

  migrateCredentialUniqueness() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        DELETE FROM google_credentials
        WHERE id IN (
          SELECT id
          FROM (
            SELECT
              id,
              ROW_NUMBER() OVER (
                PARTITION BY provider, owner_type, owner_id, lower(trim(account_email))
                ORDER BY updated_at DESC, created_at DESC, id DESC
              ) AS duplicate_rank
            FROM google_credentials
            WHERE trim(account_email) <> ''
          )
          WHERE duplicate_rank > 1
        )
      `);
      this.db.exec(`DROP INDEX IF EXISTS ${ACCOUNT_UNIQUE_INDEX}`);
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${ACCOUNT_UNIQUE_INDEX}
        ON google_credentials(provider, owner_type, owner_id, lower(trim(account_email)))
        WHERE trim(account_email) <> ''
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the migration error that triggered the rollback.
      }
      throw error;
    }
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

  getRow(id, owner) {
    const { ownerType, ownerId } = normalizeCredentialOwner(owner);
    const row = this.db
      .prepare("SELECT * FROM google_credentials WHERE id = ? AND owner_type = ? AND owner_id = ?")
      .get(id, ownerType, ownerId);
    return Promise.resolve(row || null);
  }

  readTokens(row) {
    const result = decryptTokensWithFallback(row, this.key, this.legacyKeys);
    if (result.migrated) {
      const encrypted = encryptTokens(result.tokens, this.key);
      this.db.prepare(`UPDATE google_credentials SET token_ciphertext = ?, token_iv = ?, token_tag = ? WHERE id = ?`)
        .run(encrypted.ciphertext, encrypted.iv, encrypted.tag, row.id);
    }
    return result.tokens;
  }

  async findByAccountEmail(accountEmail, { includeTokens = false, owner } = {}) {
    const { ownerType, ownerId } = normalizeCredentialOwner(owner);
    const normalizedEmail = String(accountEmail || "").trim().toLowerCase();
    if (!normalizedEmail) return null;
    const row = this.db.prepare(`
      SELECT *
      FROM google_credentials
      WHERE provider = ? AND owner_type = ? AND owner_id = ? AND lower(trim(account_email)) = ?
      LIMIT 1
    `).get(PROVIDER, ownerType, ownerId, normalizedEmail);
    if (!row) return null;
    const credential = publicCredential(row); const tokens = this.readTokens(row);
    if (includeTokens) credential.tokens = tokens;
    return credential;
  }

  async list(owner) {
    const { ownerType, ownerId } = normalizeCredentialOwner(owner);
    const rows = await this.all(
      "SELECT * FROM google_credentials WHERE owner_type = ? AND owner_id = ? ORDER BY created_at ASC",
      [ownerType, ownerId]
    );
    return rows.map(publicCredential);
  }

  async get(id, { includeTokens = false, owner } = {}) {
    if (!CredentialStore.isValidId(id)) return null;
    const row = await this.getRow(id, owner);
    if (!row) return null;
    const credential = publicCredential(row); const tokens = this.readTokens(row);
    if (includeTokens) credential.tokens = tokens;
    return credential;
  }

  async save({ id, accountEmail = "", accountName = "", tokens }, owner) {
    const normalizedOwner = normalizeCredentialOwner(owner);
    if (!CredentialStore.isValidId(id)) throw new Error("Invalid credential ID.");
    if (!tokens || typeof tokens !== "object") throw new Error("OAuth tokens are required.");
    const anyExisting = this.db.prepare("SELECT owner_type, owner_id FROM google_credentials WHERE id = ?").get(id);
    if (anyExisting && (anyExisting.owner_type !== normalizedOwner.ownerType || anyExisting.owner_id !== normalizedOwner.ownerId)) {
      throw new Error("Credential ID belongs to another workspace.");
    }
    const existing = await this.getRow(id, normalizedOwner);
    const now = new Date().toISOString();
    const encrypted = encryptTokens(tokens, this.key);
    await this.run(
      `INSERT INTO google_credentials (
        id, provider, type, account_email, account_name,
        token_ciphertext, token_iv, token_tag, created_at, updated_at, owner_type, owner_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        existing?.created_at || now, now, normalizedOwner.ownerType, normalizedOwner.ownerId,
      ]
    );
    return this.get(id, { owner: normalizedOwner });
  }

  async delete(id, owner) {
    if (!CredentialStore.isValidId(id)) return false;
    const { ownerType, ownerId } = normalizeCredentialOwner(owner);
    const result = await this.run(
      "DELETE FROM google_credentials WHERE id = ? AND owner_type = ? AND owner_id = ?",
      [id, ownerType, ownerId]
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
  CredentialDecryptionError,
  CredentialStore,
  decryptTokens,
  decryptTokensWithFallback,
  deriveEncryptionKey,
  encryptionKeys,
  encryptTokens,
};
