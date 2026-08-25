const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DriveSearchError,
  buildDriveQuery,
  executeDriveSearch,
  inspectGoogleError,
  normalizeSearchRequest,
} = require("./driveSearch");

const CREDENTIAL_ID = "gcred_1234567890123456789012";

test("Drive Search HTTP route delegates through the execution service without changing its safe contract", () => {
  const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
  const route = source.slice(source.indexOf('app.post("/api/google/drive/search"'), source.indexOf("async function handleDriveFileAction"));
  assert.match(route, /executionServices\.google\.searchFiles\(req\.body, owner\)/);
  assert.match(route, /error instanceof DriveSearchError/);
  assert.match(route, /status: "error",\s*code: error\.code,\s*error: error\.message/);
  assert.doesNotMatch(route, /credentialStore|createOAuthClient|createDriveClient/);
});

class FakeOAuthClient extends EventEmitter {
  setCredentials(tokens) {
    this.credentials = tokens;
  }
}

function credentialStoreWith(credential) {
  return {
    saved: [],
    async get(id) {
      return id === credential?.id ? credential : null;
    },
    async save(value) {
      this.saved.push(value);
      return value;
    },
  };
}

test("name search builds escaped query with folder and mime type filters", () => {
  const query = buildDriveQuery({
    query: "Director's \\ Report",
    folderId: "folder'123",
    mimeType: "application/pdf",
  });
  assert.equal(
    query,
    "name contains 'Director\\'s \\\\ Report' and trashed = false and 'folder\\'123' in parents and mimeType = 'application/pdf'"
  );
});

test("Google diagnostics retain reason while redacting token-like values", () => {
  const diagnostic = inspectGoogleError({
    response: {
      status: 403,
      data: { error: { code: 403, message: "access_token=secret-value", errors: [{ reason: "accessNotConfigured" }] } },
    },
  });
  assert.equal(diagnostic.status, 403);
  assert.equal(diagnostic.reason, "accessNotConfigured");
  assert.doesNotMatch(diagnostic.message, /secret-value/);
});

test("Drive API disabled errors are classified and logged without secrets", async () => {
  const store = credentialStoreWith({
    id: CREDENTIAL_ID,
    accountEmail: "user@example.com",
    accountName: "User",
    tokens: { access_token: "stored-secret" },
  });
  const logged = [];

  await assert.rejects(
    () => executeDriveSearch({
      request: { credentialId: CREDENTIAL_ID, query: "report" },
      credentialStore: store,
      createOAuthClient: () => new FakeOAuthClient(),
      createDriveClient: () => ({ files: { list: async () => {
        const error = new Error("access_token=leaked-secret");
        error.response = {
          status: 403,
          data: { error: { code: 403, message: error.message, errors: [{ reason: "accessNotConfigured" }] } },
        };
        throw error;
      } } }),
      logger: { error: (...args) => logged.push(args) },
    }),
    (error) => error instanceof DriveSearchError
      && error.statusCode === 503
      && error.code === "drive_api_not_enabled"
  );

  assert.equal(logged[0][1].reason, "accessNotConfigured");
  assert.doesNotMatch(JSON.stringify(logged), /stored-secret|leaked-secret/);
});

test("request validation rejects missing credential and clamps limits", () => {
  assert.throws(
    () => normalizeSearchRequest({ query: "report" }),
    (error) => error instanceof DriveSearchError && error.code === "missing_credential"
  );
  const normalized = normalizeSearchRequest({
    credentialId: CREDENTIAL_ID,
    query: "report",
    limit: 9000,
  });
  assert.equal(normalized.limit, 1000);
});

test("unknown credential is rejected before calling Google Drive", async () => {
  let driveCalled = false;
  await assert.rejects(
    () => executeDriveSearch({
      request: { credentialId: CREDENTIAL_ID, query: "report" },
      credentialStore: credentialStoreWith(null),
      createOAuthClient: () => new FakeOAuthClient(),
      createDriveClient: () => {
        driveCalled = true;
        return { files: { list: async () => ({ data: { files: [] } }) } };
      },
    }),
    (error) => error instanceof DriveSearchError && error.code === "credential_not_found"
  );
  assert.equal(driveCalled, false);
});

test("selected credential reaches Drive search and response exposes no tokens", async () => {
  const store = credentialStoreWith({
    id: CREDENTIAL_ID,
    accountEmail: "user@example.com",
    accountName: "User",
    tokens: { access_token: "secret-access", refresh_token: "secret-refresh" },
  });
  const oauthClient = new FakeOAuthClient();
  let listRequest;
  const result = await executeDriveSearch({
    request: {
      credentialId: CREDENTIAL_ID,
      query: "Quarterly",
      folderId: "folder-1",
      mimeType: "application/pdf",
      limit: 2,
      searchMethod: "Search File/Folder Name",
    },
    credentialStore: store,
    createOAuthClient: () => oauthClient,
    createDriveClient: (auth) => ({
      files: {
        list: async (request) => {
          assert.equal(auth, oauthClient);
          listRequest = request;
          return {
            data: {
              files: [{ id: "file-1", name: "Quarterly.pdf", mimeType: "application/pdf", access_token: "must-not-leak" }],
            },
          };
        },
      },
    }),
  });

  assert.equal(oauthClient.credentials.refresh_token, "secret-refresh");
  assert.match(listRequest.q, /name contains 'Quarterly'/);
  assert.match(listRequest.q, /'folder-1' in parents/);
  assert.match(listRequest.q, /mimeType = 'application\/pdf'/);
  assert.equal(listRequest.pageSize, 2);
  assert.equal(result.files[0].id, "file-1");
  assert.doesNotMatch(JSON.stringify(result), /secret-access|secret-refresh|must-not-leak|access_token|refresh_token/);
});

test("refreshed tokens persist to the same credential ID", async () => {
  const store = credentialStoreWith({
    id: CREDENTIAL_ID,
    accountEmail: "user@example.com",
    accountName: "User",
    tokens: { access_token: "old-access", refresh_token: "keep-refresh" },
  });
  const oauthClient = new FakeOAuthClient();
  await executeDriveSearch({
    request: { credentialId: CREDENTIAL_ID, query: "report" },
    credentialStore: store,
    createOAuthClient: () => oauthClient,
    createDriveClient: () => ({
      files: {
        list: async () => {
          oauthClient.emit("tokens", { access_token: "new-access", expiry_date: 12345 });
          return { data: { files: [] } };
        },
      },
    }),
  });

  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].id, CREDENTIAL_ID);
  assert.equal(store.saved[0].tokens.access_token, "new-access");
  assert.equal(store.saved[0].tokens.refresh_token, "keep-refresh");
});

test("Return All follows pagination while normal limit stops at requested count", async () => {
  const store = credentialStoreWith({
    id: CREDENTIAL_ID,
    accountEmail: "user@example.com",
    accountName: "User",
    tokens: { access_token: "test-access" },
  });
  let calls = 0;
  const result = await executeDriveSearch({
    request: { credentialId: CREDENTIAL_ID, query: "report", returnAll: true },
    credentialStore: store,
    createOAuthClient: () => new FakeOAuthClient(),
    createDriveClient: () => ({ files: { list: async () => {
      calls += 1;
      return calls === 1
        ? { data: { files: [{ id: "one" }], nextPageToken: "next" } }
        : { data: { files: [{ id: "two" }] } };
    } } }),
  });
  assert.equal(calls, 2);
  assert.equal(result.count, 2);
});
