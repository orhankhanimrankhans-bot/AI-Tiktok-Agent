const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { CredentialStore } = require("./credentialStore");

test("encrypted credentials persist across reload and remain independently deletable", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-credentials-"));
  const dbPath = path.join(tempDir, "credentials.sqlite3");
  const secret = "test-only-secret-with-sufficient-entropy-123456";
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
    /authenticate data/
  );
});
