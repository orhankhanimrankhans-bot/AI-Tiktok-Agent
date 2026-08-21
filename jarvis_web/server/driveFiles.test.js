const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { executeDriveDelete, executeDriveDownload } = require("./driveFiles");
const ID = "gcred_1234567890123456789012";
class Auth extends EventEmitter { setCredentials(tokens) { this.tokens = tokens; } }
const store = (id = ID) => ({ get: async (value) => value === id ? { id, tokens: { access_token: "secret" } } : null, save: async () => {} });

test("Drive delete uses only the selected credential", async () => {
  let deleted;
  const result = await executeDriveDelete({ request: { credentialId: ID, fileId: "file_1" }, credentialStore: store(),
    createOAuthClient: () => new Auth(), createDriveClient: () => ({ files: { delete: async ({ fileId }) => { deleted = fileId; } } }) });
  assert.equal(deleted, "file_1"); assert.deepEqual(result, { deleted: true, fileId: "file_1" });
  await assert.rejects(() => executeDriveDelete({ request: { credentialId: "gcred_0000000000000000000000", fileId: "file_1" }, credentialStore: store(), createOAuthClient: () => new Auth(), createDriveClient: () => ({}) }), /not found/i);
});

test("Drive download stores binary by reference without exposing OAuth data", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-binary-"));
  const result = await executeDriveDownload({ request: { credentialId: ID, fileId: "file_1", binaryProperty: "data" }, credentialStore: store(), binaryDir: dir,
    createOAuthClient: () => new Auth(), createDriveClient: () => ({ files: { get: async (request) => request.alt === "media" ? { data: Buffer.from("file") } : { data: { id: "file_1", name: "a.txt", mimeType: "text/plain" } } } }) });
  assert.equal(result.binary.size, 4); assert.equal(fs.readFileSync(path.join(dir, result.binary.referenceId), "utf8"), "file");
  assert.doesNotMatch(JSON.stringify(result), /access_token|secret/);
  fs.rmSync(dir, { recursive: true, force: true });
});
