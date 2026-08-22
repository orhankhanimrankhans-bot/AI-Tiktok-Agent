const assert = require("node:assert/strict"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test");
const { CredentialStore, decryptTokens, deriveEncryptionKey, encryptTokens } = require("./credentialStore"); const { FacebookCredentialStore } = require("./facebookCredentialStore");
test("Facebook credentials are encrypted, persistent, multi-account, and isolated from Google", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-store-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const google = new CredentialStore({ dbPath, encryptionSecret: "test-secret-long-enough" }); await google.open();
  const facebook = new FacebookCredentialStore({ db: google.db, encryptionSecret: "test-secret-long-enough" }); facebook.open();
  t.after(async () => { await google.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const googleId = CredentialStore.generateId(); await google.save({ id: googleId, accountEmail: "google@example.com", tokens: { access_token: "google-secret" } });
  const ids = [FacebookCredentialStore.generateId(), FacebookCredentialStore.generateId()];
  facebook.save({ id: ids[0], accountId: "1001", accountName: "One", tokens: { userAccessToken: "facebook-secret-one" } });
  facebook.save({ id: ids[1], accountId: "1002", accountName: "Two", tokens: { userAccessToken: "facebook-secret-two" } });
  assert.equal(facebook.list().length, 2); assert.equal((await google.list()).length, 1);
  assert.equal(Object.hasOwn(facebook.list()[0], "tokens"), false);
  await google.close(); assert.doesNotMatch(fs.readFileSync(dbPath).toString("latin1"), /facebook-secret-one|facebook-secret-two/);
  const reopenedGoogle = new CredentialStore({ dbPath, encryptionSecret: "test-secret-long-enough" }); await reopenedGoogle.open();
  const reopened = new FacebookCredentialStore({ db: reopenedGoogle.db, encryptionSecret: "test-secret-long-enough" }); reopened.open();
  assert.equal(reopened.get(ids[1], { includeTokens: true }).tokens.userAccessToken, "facebook-secret-two");
  google.db = reopenedGoogle.db;
});

test("manual Page credentials encrypt, update, list with OAuth, and delete without exposing tokens", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-manual-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const google = new CredentialStore({ dbPath, encryptionSecret: "manual-test-secret-long-enough" }); await google.open();
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: "manual-test-secret-long-enough" }); store.open();
  t.after(async () => { try { await google.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const oauthId = FacebookCredentialStore.generateId(); const manualId = FacebookCredentialStore.generateId();
  store.save({ id: oauthId, accountId: "10001", accountName: "OAuth User", tokens: { userAccessToken: "oauth-plaintext-secret" } });
  const created = store.saveManual({ id: manualId, name: "TinyTech Facebook", pageId: "20002", pageName: "TinyTech", accessToken: "manual-plaintext-secret-one" });
  assert.equal(created.authMode, "manual_access_token"); assert.equal(created.pageName, "TinyTech"); assert.equal(Object.hasOwn(created, "tokens"), false);
  assert.deepEqual(new Set(store.list().map((item) => item.authMode)), new Set(["oauth", "manual_access_token"]));
  const rowBefore = google.db.prepare("SELECT token_ciphertext FROM facebook_credentials WHERE id = ?").get(manualId);
  store.updateManual({ id: manualId, name: "Renamed Page" });
  const rowAfterName = google.db.prepare("SELECT token_ciphertext FROM facebook_credentials WHERE id = ?").get(manualId);
  assert.deepEqual(rowAfterName.token_ciphertext, rowBefore.token_ciphertext);
  assert.equal(store.get(manualId, { includeTokens: true }).tokens.pageAccessToken, "manual-plaintext-secret-one");
  store.updateManual({ id: manualId, name: "Renamed Page", accessToken: "manual-plaintext-secret-two" });
  const rowAfter = google.db.prepare("SELECT token_ciphertext FROM facebook_credentials WHERE id = ?").get(manualId);
  assert.notDeepEqual(rowAfter.token_ciphertext, rowBefore.token_ciphertext);
  assert.equal(store.get(manualId, { includeTokens: true }).tokens.pageAccessToken, "manual-plaintext-secret-two");
  assert.equal(store.delete(manualId), true); assert.equal(store.get(manualId), null); assert.equal(store.get(oauthId).authMode, "oauth");
  await google.close();
  assert.doesNotMatch(fs.readFileSync(dbPath).toString("latin1"), /manual-plaintext-secret|oauth-plaintext-secret/);
});

test("schema migration preserves existing Phase 3A OAuth records", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-migration-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const secret = "migration-test-secret-long-enough"; const google = new CredentialStore({ dbPath, encryptionSecret: secret }); await google.open();
  t.after(async () => { try { await google.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  google.db.exec(`CREATE TABLE facebook_credentials (id TEXT PRIMARY KEY, provider TEXT NOT NULL, type TEXT NOT NULL,
    account_id TEXT NOT NULL, account_name TEXT NOT NULL DEFAULT '', token_ciphertext BLOB NOT NULL, token_iv BLOB NOT NULL,
    token_tag BLOB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  const id = FacebookCredentialStore.generateId(); const encrypted = encryptTokens({ userAccessToken: "legacy-oauth-secret" }, deriveEncryptionKey(secret)); const now = new Date().toISOString();
  google.db.prepare("INSERT INTO facebook_credentials VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, "facebook", "oauth2", "998877", "Legacy Account", encrypted.ciphertext, encrypted.iv, encrypted.tag, now, now);
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: secret }); store.open();
  const migrated = store.get(id, { includeTokens: true });
  assert.equal(migrated.authMode, "oauth"); assert.equal(migrated.accountName, "Legacy Account"); assert.equal(migrated.tokens.userAccessToken, "legacy-oauth-secret");
});

test("legacy-key Facebook OAuth migrates while current-key manual credentials remain unchanged", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-key-migration-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const currentSecret = "facebook-current-dedicated-key"; const legacySecret = "facebook-legacy-session-key";
  const google = new CredentialStore({ dbPath, encryptionSecret: currentSecret }); await google.open();
  t.after(async () => { try { await google.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const initial = new FacebookCredentialStore({ db: google.db, encryptionSecret: currentSecret }); initial.open();
  const oauthId = FacebookCredentialStore.generateId(); const manualId = FacebookCredentialStore.generateId();
  initial.saveManual({ id: manualId, name: "Current Manual", pageId: "123456", pageName: "Page", accessToken: "current-manual-token" });
  const legacy = encryptTokens({ userAccessToken: "legacy-oauth-token" }, deriveEncryptionKey(legacySecret)); const now = new Date().toISOString();
  google.db.prepare(`INSERT INTO facebook_credentials (id,provider,type,account_id,account_name,token_ciphertext,token_iv,token_tag,created_at,updated_at,name,auth_mode,connection_status,page_id,page_name,app_id,last_tested_at)
    VALUES (?,'facebook','oauth2','654321','Legacy OAuth',?,?,?,?,?,'Legacy OAuth','oauth','connected','','','','')`)
    .run(oauthId, legacy.ciphertext, legacy.iv, legacy.tag, now, now);
  const manualBefore = google.db.prepare("SELECT token_ciphertext,token_iv,token_tag FROM facebook_credentials WHERE id = ?").get(manualId);
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: currentSecret, legacyEncryptionSecrets: [legacySecret] });
  assert.equal(store.get(oauthId, { includeTokens: true }).tokens.userAccessToken, "legacy-oauth-token");
  const oauthAfter = google.db.prepare("SELECT * FROM facebook_credentials WHERE id = ?").get(oauthId);
  assert.deepEqual(decryptTokens(oauthAfter, deriveEncryptionKey(currentSecret)), { userAccessToken: "legacy-oauth-token" });
  assert.equal(store.get(manualId, { includeTokens: true }).tokens.pageAccessToken, "current-manual-token");
  const manualAfter = google.db.prepare("SELECT token_ciphertext,token_iv,token_tag FROM facebook_credentials WHERE id = ?").get(manualId);
  assert.equal(Buffer.from(manualAfter.token_ciphertext).equals(Buffer.from(manualBefore.token_ciphertext)), true);
  assert.equal(Buffer.from(manualAfter.token_iv).equals(Buffer.from(manualBefore.token_iv)), true);
  assert.equal(Buffer.from(manualAfter.token_tag).equals(Buffer.from(manualBefore.token_tag)), true);
});
