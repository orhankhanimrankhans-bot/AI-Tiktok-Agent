const assert = require("node:assert/strict"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test");
const { CredentialStore, decryptTokens, deriveEncryptionKey, encryptTokens } = require("./credentialStore"); const { FacebookCredentialStore } = require("./facebookCredentialStore");
test("Facebook credentials are isolated by stable workspace owner", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-owner-")); const google = new CredentialStore({ dbPath: path.join(dir, "db.sqlite3"), encryptionSecret: "owner-test-secret" }); await google.open();
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: "owner-test-secret" }); store.open(); t.after(async () => { await google.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const a = { ownerType: "additional", ownerId: "a" }; const b = { ownerType: "additional", ownerId: "b" }; const id = FacebookCredentialStore.generateId();
  store.save({ id, accountId: "100", pageId: "200", tokens: { userAccessToken: "secret" } }, a);
  assert.equal(store.list(a).length, 1); assert.equal(store.list(b).length, 0); assert.equal(store.get(id, { owner: b }), null); assert.equal(store.delete(id, b), false); assert.ok(store.get(id, { owner: a }));
});
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

test("independent Page credentials never overwrite rows sharing a Meta account or Page", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-pages-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const google = new CredentialStore({ dbPath, encryptionSecret: "independent-pages-test-secret" }); await google.open();
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: "independent-pages-test-secret" }); store.open();
  t.after(async () => { try { await google.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const firstId = FacebookCredentialStore.generateId(); const secondId = FacebookCredentialStore.generateId(); const duplicatePageId = FacebookCredentialStore.generateId();
  store.save({ id: firstId, accountId: "meta-user-1", accountName: "Owner", pageId: "10101", pageName: "TinyTech", tokens: { userAccessToken: "user-one", pageAccessTokens: { 10101: "page-one" } } });
  store.save({ id: secondId, accountId: "meta-user-1", accountName: "Owner", pageId: "20202", pageName: "Page 2", tokens: { userAccessToken: "user-one", pageAccessTokens: { 20202: "page-two" } } });
  store.saveManual({ id: duplicatePageId, name: "Independent copy", pageId: "10101", pageName: "TinyTech copy", accessToken: "manual-page-copy" });
  assert.deepEqual(store.list().map((item) => item.id), [firstId, secondId, duplicatePageId]);
  assert.deepEqual(store.list().map((item) => item.pageName), ["TinyTech", "Page 2", "TinyTech copy"]);
});

test("one hundred OAuth Pages coexist and exact Page creation reuses only that opaque ID", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-100-pages-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const google = new CredentialStore({ dbPath, encryptionSecret: "one-hundred-pages-test-secret" }); await google.open();
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: "one-hundred-pages-test-secret" }); store.open();
  t.after(async () => { try { await google.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const ids = [];
  for (let index = 1; index <= 100; index += 1) { const id = FacebookCredentialStore.generateId(); ids.push(id); const pageId = String(900000 + index); store.save({ id, accountId: "shared-meta-account", accountName: "Owner", pageId, pageName: `Page ${index}`, tokens: { userAccessToken: "shared-user-token", pageAccessTokens: { [pageId]: `page-token-${index}` } } }); }
  assert.equal(store.list().length, 100);
  const duplicate = store.save({ id: FacebookCredentialStore.generateId(), accountId: "shared-meta-account", accountName: "Owner", pageId: "900002", pageName: "Page 2 reconnected", tokens: { userAccessToken: "updated-user-token", pageAccessTokens: { 900002: "updated-page-token" } } });
  assert.equal(duplicate.id, ids[1]); assert.equal(store.list().length, 100);
});

test("Page-aware indexes preserve OAuth/manual separation and pending selection tokens stay encrypted", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-facebook-page-indexes-")); const dbPath = path.join(dir, "credentials.sqlite3");
  const google = new CredentialStore({ dbPath, encryptionSecret: "page-index-selection-test-secret" }); await google.open();
  const store = new FacebookCredentialStore({ db: google.db, encryptionSecret: "page-index-selection-test-secret" }); store.open();
  t.after(async () => { try { await google.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const oauth = store.save({ id: FacebookCredentialStore.generateId(), accountId: "owner", pageId: "123456", pageName: "OAuth Page", tokens: { userAccessToken: "oauth-user-secret", pageAccessTokens: { 123456: "oauth-page-secret" } } });
  const manual = store.saveManual({ id: FacebookCredentialStore.generateId(), name: "Manual Page", pageId: "123456", accessToken: "manual-page-secret" });
  assert.notEqual(oauth.id, manual.id);
  const selection = store.createPageSelection({ accountId: "owner", pages: [{ id: "222222", name: "Second Page" }], tokens: { userAccessToken: "pending-user-secret", pageAccessTokens: { 222222: "pending-page-secret" } } });
  assert.doesNotMatch(fs.readFileSync(dbPath).toString("latin1"), /pending-user-secret|pending-page-secret/);
  assert.equal(store.consumePageSelection({ selectionId: selection.id, pageId: "222222" }).page.name, "Second Page");
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
