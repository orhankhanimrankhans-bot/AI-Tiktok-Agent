const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  CredentialStore,
  decryptTokens,
  deriveEncryptionKey,
  encryptTokens,
} = require("./credentialStore");

const TEST_SECRET = "test-only-secret-with-sufficient-entropy-123456";

function insertRawCredential(db, { id, email, name, tokens, createdAt, updatedAt, secret = TEST_SECRET }) {
  const encrypted = encryptTokens(tokens, deriveEncryptionKey(secret));
  db.prepare(`
    INSERT INTO google_credentials (
      id, provider, type, account_email, account_name,
      token_ciphertext, token_iv, token_tag, created_at, updated_at
    ) VALUES (?, 'google-drive', 'oauth2', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, email, name, encrypted.ciphertext, encrypted.iv, encrypted.tag,
    createdAt, updatedAt
  );
}

test("encrypted credentials persist across reload and remain independently deletable", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-credentials-"));
  const dbPath = path.join(tempDir, "credentials.sqlite3");
  const secret = TEST_SECRET;
  const firstId = CredentialStore.generateId();
  const secondId = CredentialStore.generateId();
  const firstTokens = { access_token: "first-access-token", refresh_token: "first-refresh-token" };
  const secondTokens = { access_token: "second-access-token", refresh_token: "second-refresh-token" };
  let store = new CredentialStore({ dbPath, encryptionSecret: secret });

  t.after(async () => {
    await store.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await store.open();
  await store.save({ id: firstId, accountEmail: "first@example.com", accountName: "First", tokens: firstTokens });
  await store.save({ id: secondId, accountEmail: "second@example.com", accountName: "Second", tokens: secondTokens });

  const publicRows = await store.list();
  assert.equal(publicRows.length, 2);
  assert.equal(Object.hasOwn(publicRows[0], "tokens"), false);
  assert.equal(Object.hasOwn(publicRows[0], "token_ciphertext"), false);
  await store.close();

  const databaseBytes = fs.readFileSync(dbPath);
  assert.equal(databaseBytes.includes(Buffer.from(firstTokens.access_token)), false);
  assert.equal(databaseBytes.includes(Buffer.from(firstTokens.refresh_token)), false);

  store = new CredentialStore({ dbPath, encryptionSecret: secret });
  await store.open();
  assert.deepEqual((await store.get(firstId, { includeTokens: true })).tokens, firstTokens);
  assert.deepEqual((await store.get(secondId, { includeTokens: true })).tokens, secondTokens);

  assert.equal(await store.delete(firstId), true);
  assert.equal(await store.get(firstId), null);
  assert.equal((await store.get(secondId)).accountEmail, "second@example.com");
  assert.deepEqual((await store.get(secondId, { includeTokens: true })).tokens, secondTokens);

  await store.run(
    "UPDATE google_credentials SET token_tag = ? WHERE id = ?",
    [Buffer.alloc(16), secondId]
  );
  await assert.rejects(
    () => store.get(secondId, { includeTokens: true }),
    (error) => error.code === "credential_decryption_failed" && !/token|secret|cipher/i.test(error.message)
  );
});

test("legacy SESSION_SECRET credentials migrate once to the current encryption key", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-key-migration-"));
  const dbPath = path.join(tempDir, "credentials.sqlite3");
  const currentSecret = "current-dedicated-encryption-secret-test-only";
  const legacySecret = "legacy-session-secret-test-only";
  const tokens = { access_token: "legacy-access-value", refresh_token: "legacy-refresh-value" };
  const id = CredentialStore.generateId();
  let store = new CredentialStore({ dbPath, encryptionSecret: currentSecret });
  t.after(async () => { await store.close().catch(() => {}); fs.rmSync(tempDir, { recursive: true, force: true }); });
  await store.open(); await store.close();
  const db = new DatabaseSync(dbPath);
  insertRawCredential(db, { id, email: "legacy@example.com", name: "Legacy", tokens, secret: legacySecret,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  const before = db.prepare("SELECT * FROM google_credentials WHERE id = ?").get(id); db.close();

  store = new CredentialStore({ dbPath, encryptionSecret: currentSecret, legacyEncryptionSecrets: [legacySecret] });
  await store.open();
  const publicRead = await store.get(id);
  assert.equal(publicRead.id, id); assert.equal(Object.hasOwn(publicRead, "tokens"), false);
  const migrated = await store.getRow(id);
  assert.equal(Buffer.from(migrated.token_ciphertext).equals(Buffer.from(before.token_ciphertext)), false);
  assert.deepEqual(decryptTokens(migrated, deriveEncryptionKey(currentSecret)), tokens);
  await store.close();

  store = new CredentialStore({ dbPath, encryptionSecret: currentSecret });
  await store.open();
  assert.deepEqual((await store.get(id, { includeTokens: true })).tokens, tokens);
  const afterSecondRead = await store.getRow(id);
  assert.equal(Buffer.from(afterSecondRead.token_ciphertext).equals(Buffer.from(migrated.token_ciphertext)), true);
  assert.equal(Buffer.from(afterSecondRead.token_iv).equals(Buffer.from(migrated.token_iv)), true);
  assert.equal(Buffer.from(afterSecondRead.token_tag).equals(Buffer.from(migrated.token_tag)), true);
});

test("wrong legacy key and corrupted ciphertext fail with safe errors", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-key-failure-")); const dbPath = path.join(tempDir, "credentials.sqlite3");
  const id = CredentialStore.generateId(); let store = new CredentialStore({ dbPath, encryptionSecret: "current-key", legacyEncryptionSecrets: ["wrong-legacy-key"] });
  t.after(async () => { await store.close().catch(() => {}); fs.rmSync(tempDir, { recursive: true, force: true }); });
  await store.open();
  insertRawCredential(store.db, { id, email: "failure@example.com", name: "Failure",
    tokens: { access_token: "must-never-appear", refresh_token: "also-hidden" }, secret: "actual-legacy-key",
    createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  await assert.rejects(() => store.get(id, { includeTokens: true }),
    (error) => error.code === "credential_decryption_failed" && error.message === "Stored credential could not be decrypted.");
  store.db.prepare("UPDATE google_credentials SET token_tag = ? WHERE id = ?").run(Buffer.alloc(16), id);
  await assert.rejects(() => store.get(id),
    (error) => error.code === "credential_decryption_failed" && !/must-never-appear|also-hidden|current-key|legacy/i.test(error.message));
});

test("uniqueness migration removes duplicate accounts atomically and keeps the newest", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-credential-migration-"));
  const dbPath = path.join(tempDir, "credentials.sqlite3");
  let store = new CredentialStore({ dbPath, encryptionSecret: TEST_SECRET });
  t.after(async () => {
    await store.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await store.open();
  await store.close();
  const legacyDb = new DatabaseSync(dbPath);
  legacyDb.exec("DROP INDEX idx_google_credentials_provider_account_email");
  const olderId = CredentialStore.generateId();
  const newerId = CredentialStore.generateId();
  insertRawCredential(legacyDb, {
    id: olderId,
    email: "Duplicate@Example.com ",
    name: "Older",
    tokens: { access_token: "older-token" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  insertRawCredential(legacyDb, {
    id: newerId,
    email: "duplicate@example.com",
    name: "Newer",
    tokens: { access_token: "newer-token" },
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  legacyDb.close();

  store = new CredentialStore({ dbPath, encryptionSecret: TEST_SECRET });
  await store.open();
  const credentials = await store.list();
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0].id, newerId);
  assert.equal(
    (await store.findByAccountEmail(" DUPLICATE@example.com ")).id,
    newerId
  );
  assert.deepEqual(
    (await store.get(newerId, { includeTokens: true })).tokens,
    { access_token: "newer-token" }
  );
  await assert.rejects(
    () => store.save({
      id: CredentialStore.generateId(),
      accountEmail: " DUPLICATE@example.com ",
      accountName: "Duplicate",
      tokens: { access_token: "third-token" },
    }),
    /UNIQUE constraint failed/
  );
});

test("uniqueness migration rolls duplicate cleanup back when index creation fails", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-credential-rollback-"));
  const dbPath = path.join(tempDir, "credentials.sqlite3");
  let store = new CredentialStore({ dbPath, encryptionSecret: TEST_SECRET });
  t.after(async () => {
    await store.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await store.open();
  await store.close();
  const legacyDb = new DatabaseSync(dbPath);
  legacyDb.exec("DROP INDEX idx_google_credentials_provider_account_email");
  insertRawCredential(legacyDb, {
    id: CredentialStore.generateId(), email: "same@example.com", name: "One",
    tokens: { access_token: "one" }, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  });
  insertRawCredential(legacyDb, {
    id: CredentialStore.generateId(), email: "SAME@example.com", name: "Two",
    tokens: { access_token: "two" }, createdAt: "2026-01-02", updatedAt: "2026-01-02",
  });
  legacyDb.exec("CREATE TABLE idx_google_credentials_provider_account_email (value TEXT)");
  legacyDb.close();

  store = new CredentialStore({ dbPath, encryptionSecret: TEST_SECRET });
  await assert.rejects(() => store.open(), /already a table/);
  await store.close();

  const verificationDb = new DatabaseSync(dbPath, { readOnly: true });
  const row = verificationDb.prepare(
    "SELECT count(*) AS count FROM google_credentials"
  ).get();
  verificationDb.close();
  assert.equal(Number(row.count), 2);
});
