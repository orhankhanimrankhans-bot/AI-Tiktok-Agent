const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { FacebookGraphError, FacebookGraphService } = require("./facebookGraph");
const { pageContext, publishPageReel, resolveBinaryReference, uploadVideo, validateUploadUrl, waitForPublished } = require("./facebookReels");

const REF = "bin_1234567890123456789012";
const TOKEN = "page-token-fixture";
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-reel-")); fs.writeFileSync(path.join(dir, REF), Buffer.from("video-bytes")); return dir; }
function request(overrides = {}) { return { credentialId: "fcred_1234567890123456789012", binaryProperty: "data",
  binary: { property: "data", referenceId: REF, size: 999 }, fileName: "clip.mp4", mimeType: "video/mp4",
  title: "A title", description: "A caption", waitForProcessing: true, ...overrides }; }

test("Graph v26 starts and finishes Reel sessions only on graph.facebook.com", async () => {
  const calls = []; const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async (url, options) => {
    calls.push([String(url), options]); return calls.length === 1 ? response({ video_id: "987654", upload_url: "https://rupload.facebook.com/video-upload/opaque" }) : response({ success: true });
  } });
  assert.deepEqual(await service.startPageReelUpload(TOKEN), { videoId: "987654", uploadUrl: "https://rupload.facebook.com/video-upload/opaque" });
  await service.finishPageReelUpload(TOKEN, { videoId: "987654", title: "Title", description: "Caption" });
  assert.ok(calls.every(([url]) => new URL(url).origin === "https://graph.facebook.com"));
  assert.equal(new URL(calls[0][0]).pathname, "/v26.0/me/video_reels");
  assert.deepEqual(Object.fromEntries(calls[0][1].body), { upload_phase: "start" });
  assert.deepEqual(Object.fromEntries(calls[1][1].body), { video_id: "987654", upload_phase: "finish", video_state: "PUBLISHED", title: "Title", description: "Caption" });
  assert.equal(calls[0][1].headers.Authorization, `Bearer ${TOKEN}`); assert.ok(calls.every((call) => !call[0][0].includes(TOKEN)));
});

test("Reel Graph validation errors prove Meta was reached and remain redacted", async () => {
  const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async () => response({ error: { code: 100, message: `invalid request ${TOKEN}` } }, 400) });
  await assert.rejects(() => service.startPageReelUpload(TOKEN),
    (error) => error.code === "meta_100" && error.statusCode === 400 && !error.message.includes(TOKEN) && !/network/i.test(error.message));
});

test("Managed OAuth publishing resolves exactly one Page token", async () => {
  const calls = []; const service = { pages: async (token) => { calls.push(["pages", token]); return { pageTokens: { "123456": "oauth-page-token" } }; },
    pageIdentity: async (token) => { calls.push(["identity", token]); return { id: "123456", name: "OAuth Page" }; } };
  const page = await pageContext(service, { authMode: "oauth", tokens: { userAccessToken: "oauth-user-token" } });
  assert.deepEqual(page, { token: "oauth-page-token", pageId: "123456", pageName: "OAuth Page" });
  assert.deepEqual(calls, [["pages", "oauth-user-token"], ["identity", "oauth-page-token"]]);
});

test("upload URL validation blocks SSRF and credentials", () => {
  assert.equal(validateUploadUrl("https://rupload.facebook.com/video-upload/opaque").hostname, "rupload.facebook.com");
  for (const url of ["http://rupload.facebook.com/a", "https://evil.example/a", "https://rupload.facebook.com.evil.example/a", "https://user:pass@rupload.facebook.com/a"]) {
    assert.throws(() => validateUploadUrl(url), (error) => error instanceof FacebookGraphError && error.code === "invalid_upload_url");
  }
});

test("binary references resolve inside the binary store and use actual file size", () => {
  const dir = fixture(); try {
    const file = resolveBinaryReference({ binaryDir: dir, binary: request().binary, binaryProperty: "data", fileName: "clip.mp4", mimeType: "video/mp4" });
    assert.equal(file.size, 11); assert.equal(file.fileName, "clip.mp4");
    assert.throws(() => resolveBinaryReference({ binaryDir: dir, binary: { property: "data", referenceId: "../secret" }, binaryProperty: "data", fileName: "clip.mp4", mimeType: "video/mp4" }), /valid downloaded file reference/i);
    assert.throws(() => resolveBinaryReference({ binaryDir: dir, binary: { property: "data", referenceId: "bin_0000000000000000000000" }, binaryProperty: "data", fileName: "clip.mp4", mimeType: "video/mp4" }), /missing or has expired/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("rupload streams bytes with exact headers and never returns secrets", async () => {
  const dir = fixture(); let seen; try {
    await uploadVideo({ uploadUrl: "https://rupload.facebook.com/video-upload/opaque", token: TOKEN, filePath: path.join(dir, REF), size: 11,
      fetchImpl: async (url, options) => { const chunks = []; for await (const chunk of options.body) chunks.push(chunk); seen = { url: String(url), options, bytes: Buffer.concat(chunks).toString() }; return response({ success: true }); } });
    assert.equal(seen.bytes, "video-bytes"); assert.equal(seen.options.headers.Authorization, `OAuth ${TOKEN}`);
    assert.equal(seen.options.headers.offset, "0"); assert.equal(seen.options.headers.file_size, "11"); assert.equal(seen.options.headers["Content-Type"], "application/octet-stream");
    assert.equal(seen.options.redirect, "error"); assert.equal(seen.url.includes(TOKEN), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("publish flow returns metadata only after published processing state", async () => {
  const dir = fixture(); const calls = []; const service = {
    pageIdentity: async (token) => { calls.push(["identity", token]); return { id: "1307346875785068", name: "TinyTech" }; },
    startPageReelUpload: async (token) => { calls.push(["start", token]); return { videoId: "987654", uploadUrl: "https://rupload.facebook.com/video-upload/opaque" }; },
    finishPageReelUpload: async (token, values) => { calls.push(["finish", token, values]); return { success: true }; },
    reelStatus: async (token, id) => { calls.push(["status", token, id]); return { status: { uploading_phase: { status: "complete" }, processing_phase: { status: "complete" }, publishing_phase: { status: "complete", publish_status: "published" } } }; },
  };
  try {
    const result = await publishPageReel({ request: request(), binaryDir: dir, service,
      credential: { authMode: "manual_access_token", tokens: { pageAccessToken: TOKEN } }, sleep: async () => {},
      uploadFetch: async (_url, options) => { for await (const _chunk of options.body) { /* consume stream */ } return response({ success: true }); } });
    assert.equal(result.status, "published"); assert.equal(result.pageName, "TinyTech"); assert.equal(result.fileName, "clip.mp4");
    assert.deepEqual(calls.map((call) => call[0]), ["identity", "start", "finish", "status"]);
    assert.doesNotMatch(JSON.stringify(result), /page-token|Authorization|rupload|binary|[A-Z]:\\/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("status polling fails safely and is bounded", async () => {
  await assert.rejects(() => waitForPublished({ service: { reelStatus: async () => ({ status: { processing_phase: { status: "failed", error: "copyright" } } }) }, token: TOKEN, videoId: "987654", sleep: async () => {} }),
    (error) => error.code === "reel_processing_failed" && !error.message.includes(TOKEN));
  let attempts = 0;
  await assert.rejects(() => waitForPublished({ service: { reelStatus: async () => { attempts += 1; return { status: { processing_phase: { status: "in_progress" } } }; } },
    token: TOKEN, videoId: "987654", maxAttempts: 3, intervalMs: 0, sleep: async () => {} }), (error) => error.code === "reel_processing_timeout");
  assert.equal(attempts, 3);
});

test("upload failures redact token and upload destination", async () => {
  const dir = fixture(); try {
    await assert.rejects(() => uploadVideo({ uploadUrl: "https://rupload.facebook.com/signed/opaque", token: TOKEN, filePath: path.join(dir, REF), size: 11,
      fetchImpl: async (_url, options) => { for await (const _chunk of options.body) { /* consume mocked request */ } return response({ error: { message: `rejected ${TOKEN}` } }, 400); } }),
    (error) => !error.message.includes(TOKEN) && !error.message.includes("rupload") && error.code === "reel_upload_rejected");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
