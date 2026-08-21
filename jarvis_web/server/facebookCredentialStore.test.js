const assert = require("node:assert/strict"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test");
const { CredentialStore } = require("./credentialStore"); const { FacebookCredentialStore } = require("./facebookCredentialStore");
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
