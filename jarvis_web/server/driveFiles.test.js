const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { executeDriveDelete, executeDriveDownload, executeDriveMove } = require("./driveFiles");
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

test("Drive Download HTTP route delegates through the execution service and keeps the existing safe error contract", () => {
  const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
  const route = source.slice(source.indexOf("async function handleDriveDownload"), source.indexOf('app.post("/api/google/drive/delete"'));
  assert.match(route, /executionServices\.google\.downloadFile\(req\.body, owner\)/);
  assert.match(route, /error instanceof DriveSearchError/);
  assert.match(route, /status: "error", code: error\.code, error: error\.message/);
  assert.doesNotMatch(route, /credentialStore|createOAuthClient|createDriveClient|binaryDir/);
});

test("Drive Move HTTP route delegates through the execution service while Delete remains on its existing path", () => {
  const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
  const route = source.slice(source.indexOf("async function handleDriveMove"), source.indexOf("app.get(\"/api/executions\""));
  assert.match(route, /executionServices\.google\.moveFile\(req\.body, owner\)/);
  assert.match(route, /error instanceof DriveSearchError/);
  assert.match(route, /status: "error", code: error\.code, error: error\.message/);
  assert.doesNotMatch(route, /credentialStore|createOAuthClient|createDriveClient|executeDriveMove/);
  assert.match(source, /\/api\/google\/drive\/delete", \(req, res\) => handleDriveFileAction\(req, res, executeDriveDelete\)/);
});

test("Drive download rejects an invalid file ID before creating a Drive client", async () => {
  let created = false;
  await assert.rejects(() => executeDriveDownload({ request: { credentialId: ID, fileId: "../private" }, credentialStore: store(), binaryDir: os.tmpdir(),
    createOAuthClient: () => new Auth(), createDriveClient: () => { created = true; return {}; } }), (error) => error.code === "invalid_file_id" && !/private/i.test(error.message));
  assert.equal(created, false);
});

test("Drive move adds Done and removes every original parent without copying or uploading", async () => {
  let updateRequest; let copyCalls = 0; let createCalls = 0;
  const result = await executeDriveMove({ request: { credentialId: ID, fileId: "source_file_1", destinationFolderId: "done_folder_1" }, credentialStore: store(),
    createOAuthClient: () => new Auth(), createDriveClient: () => ({ files: {
      get: async ({ fileId }) => ({ data: { id: fileId, name: "video.mp4", parents: ["source_folder", "secondary_parent"] } }),
      update: async (request) => { updateRequest = request; return { data: { id: request.fileId } }; },
      copy: async () => { copyCalls += 1; }, create: async () => { createCalls += 1; },
    } }) });
  assert.deepEqual(result, { success: true, fileId: "source_file_1", fileName: "video.mp4", destinationFolderId: "done_folder_1", status: "moved" });
  assert.equal(updateRequest.addParents, "done_folder_1"); assert.equal(updateRequest.removeParents, "source_folder,secondary_parent");
  assert.equal(copyCalls, 0); assert.equal(createCalls, 0); assert.doesNotMatch(JSON.stringify(result), /access_token|Authorization|secret/);
});

test("Drive move retries transient failures at most three times", async () => {
  let attempts = 0; const pauses = [];
  const result = await executeDriveMove({ request: { credentialId: ID, fileId: "source_file_2", destinationFolderId: "done_folder_2" }, credentialStore: store(),
    sleep: async (ms) => pauses.push(ms), createOAuthClient: () => new Auth(), createDriveClient: () => ({ files: {
      get: async () => ({ data: { name: "retry.mp4", parents: ["source"] } }), update: async () => {
        attempts += 1; if (attempts < 3) throw { response: { status: attempts === 1 ? 429 : 503 } };
      },
    } }) });
  assert.equal(result.status, "moved"); assert.equal(attempts, 3); assert.deepEqual(pauses, [100, 200]);
});

test("Drive move does not retry permanent errors and reports a safe archive failure", async () => {
  let attempts = 0;
  await assert.rejects(() => executeDriveMove({ request: { credentialId: ID, fileId: "source_file_3", destinationFolderId: "done_folder_3" }, credentialStore: store(),
    sleep: async () => {}, createOAuthClient: () => new Auth(), createDriveClient: () => ({ files: {
      get: async () => ({ data: { name: "failed.mp4", parents: ["source"] } }), update: async () => { attempts += 1; throw { response: { status: 403 }, message: "sensitive upstream detail" }; },
    } }) }), (error) => error.code === "drive_move_failed" && !/sensitive/i.test(error.message));
  assert.equal(attempts, 1);
});
