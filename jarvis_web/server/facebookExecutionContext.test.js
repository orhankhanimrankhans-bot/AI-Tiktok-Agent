const assert = require("node:assert/strict");
const test = require("node:test");
const { createFacebookExecutionContext, toLegacyReelResponse } = require("./facebookExecutionContext");
const { FacebookGraphError } = require("./facebookGraph");

test("Facebook execution context keeps credential and provider wiring internal", () => {
  const calls = []; const credential = { id: "fb_opaque", tokens: { userAccessToken: "secret" } }; const publish = () => ({ success: true });
  const context = createFacebookExecutionContext({ credentialStore: { get: (...args) => { calls.push(args); return credential; } }, graphServiceFactory: () => ({ graph: true }), publishPageReel: publish, binaryDirectory: "C:/private", binaryResolver: (referenceId) => ({ referenceId }) });
  assert.equal(context.resolveCredential("fb_opaque"), credential); assert.deepEqual(calls, [["fb_opaque", { includeTokens: true }]]); assert.deepEqual(context.createGraphService(), { graph: true }); assert.equal(context.publishPageReel, publish); assert.deepEqual(context.resolveBinaryReference("bin_1"), { referenceId: "bin_1" }); assert.doesNotMatch(JSON.stringify({}), /secret|private/);
});
test("Facebook execution context rejects missing dependencies", () => assert.throws(() => createFacebookExecutionContext({}), /credentialStore/));

test("graphRequest resolves an opaque credential and creates the Graph service internally", async () => {
  const calls = []; const credential = { id: "fcred_1234567890123456789012", authMode: "oauth", accountId: "42", accountName: "Jarvis", tokens: { userAccessToken: "facebook-token-secret" } };
  const service = { me: async (token) => { calls.push(["me", token]); return { id: "42", name: "Jarvis" }; } };
  const context = createFacebookExecutionContext({ credentialStore: { get: (...args) => { calls.push(["get", ...args]); return credential; } }, graphServiceFactory: () => { calls.push(["factory"]); return service; }, publishPageReel() {}, binaryDirectory: "C:/private", validateCredentialId: (id) => id === credential.id });
  const result = await context.graphRequest({ credentialId: credential.id, method: "POST", endpoint: "me", body: { credentialId: credential.id }, query: {} });
  assert.deepEqual(result, { id: "42", name: "Jarvis" });
  assert.deepEqual(calls, [["get", credential.id, { includeTokens: true }], ["factory"], ["me", "facebook-token-secret"]]);
  assert.doesNotMatch(JSON.stringify(result), /facebook-token-secret|tokens|Authorization|credential|factory/i);
});

test("graphRequest preserves the supported Page body and returns only the provider result", async () => {
  const credential = { id: "fcred_1234567890123456789012", authMode: "manual_access_token", tokens: { pageAccessToken: "page-token-secret" } };
  const calls = []; const context = createFacebookExecutionContext({ credentialStore: { get: () => credential }, graphServiceFactory: () => ({ pageMetadata: async (...args) => { calls.push(args); return { id: "123456", name: "Page" }; } }), publishPageReel() {}, binaryDirectory: "C:/private", validateCredentialId: () => true });
  const result = await context.graphRequest({ credentialId: credential.id, method: "POST", endpoint: "page", body: { credentialId: credential.id, pageId: "123456" }, query: {} });
  assert.deepEqual(calls, [["123456", "page-token-secret"]]); assert.deepEqual(result, { id: "123456", name: "Page" });
});

test("graphRequest rejects unsupported methods, endpoints, secrets, and missing credentials safely", async () => {
  const context = createFacebookExecutionContext({ credentialStore: { get: () => null }, graphServiceFactory: () => ({ me() {} }), publishPageReel() {}, binaryDirectory: "C:/private", validateCredentialId: () => true });
  await assert.rejects(context.graphRequest({ credentialId: "fcred_123", method: "GET", endpoint: "me", body: {}, query: {} }), (error) => error instanceof FacebookGraphError && error.statusCode === 405 && !/token|private/i.test(error.message));
  await assert.rejects(context.graphRequest({ credentialId: "fcred_123", method: "POST", endpoint: "https://evil.example", body: {}, query: {} }), (error) => error instanceof FacebookGraphError && error.statusCode === 400);
  await assert.rejects(context.graphRequest({ credentialId: "fcred_123", method: "POST", endpoint: "me", body: { accessToken: "secret" }, query: {} }), (error) => error.publicBody?.error === "Facebook secrets must not be supplied by the client.");
  await assert.rejects(context.graphRequest({ credentialId: "fcred_123", method: "POST", endpoint: "me", body: {}, query: {} }), (error) => error.statusCode === 404 && error.publicBody?.error === "Facebook credential was not found or is disconnected.");
});

test("graphRequest preserves safe provider failures without returning internal objects", async () => {
  const credential = { id: "fcred_123", authMode: "oauth", tokens: { userAccessToken: "facebook-token-secret" } };
  const context = createFacebookExecutionContext({ credentialStore: { get: () => credential }, graphServiceFactory: () => ({ me: async () => { throw new FacebookGraphError(403, "meta_200", "Permission required: pages_show_list."); } }), publishPageReel() {}, binaryDirectory: "C:/private", validateCredentialId: () => true });
  await assert.rejects(context.graphRequest({ credentialId: credential.id, method: "POST", endpoint: "me", body: {}, query: {} }), (error) => error instanceof FacebookGraphError && error.statusCode === 403 && error.code === "meta_200" && !/facebook-token-secret|Authorization/i.test(error.message));
});

test("publishReel resolves opaque credential and binary references internally before invoking the existing publisher", async () => {
  const calls = []; const credential = { id: "fcred_1234567890123456789012", authMode: "manual_access_token", tokens: { pageAccessToken: "page-token-secret" } };
  const publisher = async (options) => { calls.push(["publish", options]); return { success: true, status: "published", videoId: "987654", fileName: "clip.mp4" }; };
  const context = createFacebookExecutionContext({ credentialStore: { get: (...args) => { calls.push(["credential", ...args]); return credential; } }, graphServiceFactory: () => { calls.push(["graph"]); return { internal: true }; }, publishPageReel: publisher, binaryDirectory: "C:/private", binaryResolver: (referenceId) => { calls.push(["binary", referenceId]); return { referenceId, binaryDirectory: "C:/private" }; }, validateCredentialId: (id) => id === credential.id });
  const request = { credentialId: credential.id, binaryProperty: "data", binary: { property: "data", referenceId: "bin_1234567890123456789012" }, fileName: "clip.mp4", mimeType: "video/mp4", title: "Title", description: "Caption", waitForProcessing: false, sourceFileId: "drive_1", sourceFileName: "source.mp4" };
  const result = await context.publishReel(request);
  assert.deepEqual(result, { success: true, status: "published", videoId: "987654", fileName: "clip.mp4", sourceFileId: "drive_1", sourceFileName: "source.mp4" });
  assert.deepEqual(calls.slice(0, 3), [["credential", credential.id, { includeTokens: true }], ["binary", request.binary.referenceId], ["graph"]]);
  const options = calls[3][1]; assert.equal(options.request, request); assert.equal(options.credential, credential); assert.equal(options.binaryDir, "C:/private"); assert.equal(options.service.internal, true);
  assert.doesNotMatch(JSON.stringify(result), /page-token|credential|Authorization|private|binary|Buffer/i);
});

test("publishReel preserves safe failures and never converts a failed publisher result to publication success", async () => {
  const credential = { id: "fcred_123", authMode: "oauth", tokens: { userAccessToken: "facebook-token-secret" } };
  const context = createFacebookExecutionContext({ credentialStore: { get: () => credential }, graphServiceFactory: () => ({}), publishPageReel: async () => ({ success: false, status: "error" }), binaryDirectory: "C:/private", binaryResolver: (referenceId) => ({ referenceId, binaryDirectory: "C:/private" }), validateCredentialId: () => true });
  const request = { credentialId: credential.id, binary: { referenceId: "bin_123" } };
  assert.deepEqual(await context.publishReel(request), { success: false, status: "error" });
  await assert.rejects(context.publishReel({ credentialId: credential.id, binary: null }), (error) => error instanceof FacebookGraphError && error.statusCode === 400 && error.code === "missing_binary_reference");
  const unavailable = createFacebookExecutionContext({ credentialStore: { get: () => null }, graphServiceFactory: () => ({}), publishPageReel: async () => ({}), binaryDirectory: "C:/private", validateCredentialId: () => true });
  await assert.rejects(unavailable.publishReel(request), (error) => error.statusCode === 404 && error.publicBody?.error === "Facebook credential was not found or is disconnected.");
});

test("publishReel validates source metadata and the browser route mapper preserves the legacy response shape", async () => {
  const credential = { id: "fcred_123", authMode: "oauth", tokens: { userAccessToken: "facebook-token-secret" } };
  const context = createFacebookExecutionContext({ credentialStore: { get: () => credential }, graphServiceFactory: () => ({}), publishPageReel: async () => ({ success: true, status: "published", videoId: "987654" }), binaryDirectory: "C:/private", validateCredentialId: () => true });
  const internal = await context.publishReel({ credentialId: credential.id, binary: { referenceId: "bin_123" }, sourceFileId: "drive_1", sourceFileName: "source.mp4" });
  assert.deepEqual(internal, { success: true, status: "published", videoId: "987654", sourceFileId: "drive_1", sourceFileName: "source.mp4" });
  assert.deepEqual(toLegacyReelResponse(internal), { success: true, status: "published", videoId: "987654" });
  assert.deepEqual(toLegacyReelResponse({ success: false, status: "error" }), { success: false, status: "error" });
  await assert.rejects(context.publishReel({ credentialId: credential.id, binary: { referenceId: "bin_123" }, sourceFileId: "../private" }), (error) => error instanceof FacebookGraphError && error.code === "invalid_source_file_id");
});

test("publishReel propagates existing sanitized publisher failures", async () => {
  const credential = { id: "fcred_123", authMode: "oauth", tokens: { userAccessToken: "facebook-token-secret" } };
  const context = createFacebookExecutionContext({ credentialStore: { get: () => credential }, graphServiceFactory: () => ({}), publishPageReel: async () => { throw new FacebookGraphError(422, "reel_processing_failed", "Facebook reported that Reel processing failed."); }, binaryDirectory: "C:/private", validateCredentialId: () => true });
  await assert.rejects(context.publishReel({ credentialId: credential.id, binary: { referenceId: "bin_123" } }), (error) => error instanceof FacebookGraphError && error.statusCode === 422 && error.code === "reel_processing_failed" && !/facebook-token-secret|Authorization|private/i.test(error.message));
});
