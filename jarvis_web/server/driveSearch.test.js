const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DriveSearchError,
  buildDriveQuery,
  executeDriveSearch,
  normalizeSearchRequest,
} = require("./driveSearch");

const CREDENTIAL_ID = "gcred_1234567890123456789012";

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
