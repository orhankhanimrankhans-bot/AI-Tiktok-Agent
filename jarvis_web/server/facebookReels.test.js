const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { FacebookGraphError, FacebookGraphService } = require("./facebookGraph");
const { logReelFailure, pageContext, publishPageReel, published, resolveBinaryReference, statusFailureDiagnostic,
  uploadVideo, validateUploadUrl, waitForPublished } = require("./facebookReels");

const REF = "bin_1234567890123456789012";
const TOKEN = "page-token-fixture";
function response(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}
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
  const dir = fixture(); const filePath = path.join(dir, REF); const actualSize = fs.lstatSync(filePath).size; let seen; try {
    await uploadVideo({ uploadUrl: "https://rupload.facebook.com/video-upload/opaque", token: TOKEN, filePath: path.join(dir, REF), size: 11,
      fetchImpl: async (url, options) => { let receivedSize = 0; const bodyIsFileStream = options.body instanceof fs.ReadStream;
        for await (const chunk of options.body) receivedSize += chunk.length;
        seen = { url: String(url), options, receivedSize, bodyIsFileStream }; return response({ success: true }); } });
    assert.equal(seen.receivedSize, actualSize); assert.equal(seen.bodyIsFileStream, true); assert.equal(seen.options.headers.Authorization, `OAuth ${TOKEN}`);
    assert.equal(seen.options.headers.offset, "0"); assert.equal(seen.options.headers.file_size, String(actualSize));
    assert.equal(seen.options.headers["Content-Length"], String(actualSize)); assert.equal(seen.options.headers["Content-Type"], "application/octet-stream");
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

test("rupload Graph errors expose only allowlisted sanitized diagnostics", async () => {
  const dir = fixture(); const localPath = path.join(dir, REF); const uploadUrl = "https://rupload.facebook.com/signed/opaque?signature=secret";
  const longReason = `Use ${TOKEN} at ${uploadUrl} from ${localPath} ${"x".repeat(400)}`;
  try {
    await assert.rejects(() => uploadVideo({ uploadUrl, token: TOKEN, filePath: localPath, size: 11,
      fetchImpl: async (_url, options) => { for await (const _chunk of options.body) { /* consume */ }
        return response({ success: false, ignored: { raw: "do-not-return" }, error: { code: 6000, error_subcode: 1363019,
          type: "OAuthException", message: "fallback", error_user_title: "Upload failed", error_user_msg: longReason,
          is_transient: false, fbtrace_id: "AbC_123-safe", access_token: TOKEN } }, 400); } }), (error) => {
      assert.equal(error.statusCode, 502); assert.equal(error.code, "reel_upload_rejected");
      assert.deepEqual(Object.keys(error.diagnostic).sort(), ["httpStatus", "isTransient", "metaCode", "metaSubcode", "reason", "reasonCode", "responseKind", "stage", "traceId"].sort());
      assert.equal(error.diagnostic.stage, "upload"); assert.equal(error.diagnostic.metaCode, 6000);
      assert.equal(error.diagnostic.httpStatus, 400); assert.equal(error.diagnostic.responseKind, "graph_error");
      assert.equal(error.diagnostic.metaSubcode, 1363019); assert.equal(error.diagnostic.traceId, "AbC_123-safe");
      assert.equal(error.diagnostic.isTransient, false); assert.ok(error.diagnostic.reason.length <= 240);
      const serialized = JSON.stringify(error.diagnostic);
      assert.doesNotMatch(serialized, /page-token-fixture|rupload\.facebook|signature=|jarvis-reel-|do-not-return|OAuthException|access_token/i);
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("rupload rejection diagnostics distinguish all safe response categories", async () => {
  const cases = [
    ["non-2xx Graph error", response({ error: { code: 4, message: "Rate limited" } }, 429), 429, "graph_error"],
    ["2xx success false", response({ success: false }), 200, "success_false"],
    ["2xx missing success", response({ status: "accepted" }), 200, "missing_success"],
    ["empty response", { ok: true, status: 200, text: async () => "" }, 200, "empty"],
    ["invalid non-JSON response", { ok: true, status: 200, text: async () => "<html>rejected</html>" }, 200, "non_json"],
  ];
  for (const [name, mockedResponse, httpStatus, responseKind] of cases) {
    const dir = fixture(); try {
      await assert.rejects(() => uploadVideo({ uploadUrl: "https://rupload.facebook.com/video-upload/opaque", token: TOKEN,
        filePath: path.join(dir, REF), size: 11, fetchImpl: async (_url, options) => {
          for await (const _chunk of options.body) { /* consume */ } return mockedResponse;
        } }), (error) => {
        assert.equal(error.diagnostic.stage, "upload", name); assert.equal(error.diagnostic.reasonCode, "reel_upload_rejected", name);
        assert.equal(error.diagnostic.httpStatus, httpStatus, name); assert.equal(error.diagnostic.responseKind, responseKind, name);
        assert.equal(error.statusCode, httpStatus === 429 ? 429 : 502, name);
        if (responseKind !== "graph_error") assert.equal(error.diagnostic.reason, undefined, name);
        return true;
      });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("status diagnostics parse uploading, processing, and publishing error arrays", () => {
  for (const [stage, phase] of [["upload", "uploading_phase"], ["processing", "processing_phase"], ["publishing", "publishing_phase"]]) {
    const status = { status: { copyright_check_status: "complete", [phase]: { status: "failed",
      errors: [{ code: 6000, message: `${stage} rejected` }] } } };
    if (stage === "publishing") status.status[phase].publish_status = "rejected";
    const diagnostic = statusFailureDiagnostic(status);
    assert.equal(diagnostic.stage, stage); assert.equal(diagnostic.metaCode, 6000);
    assert.equal(diagnostic.phaseStatus, "failed"); assert.equal(diagnostic.reason, `${stage} rejected`);
    if (stage === "publishing") assert.equal(diagnostic.publishStatus, "rejected");
  }
});

test("copyright and top-level video failure states are normalized safely", () => {
  const copyright = statusFailureDiagnostic({ status: { video_status: "error", copyright_check_status: "rejected" } });
  assert.equal(copyright.stage, "processing"); assert.equal(copyright.copyrightStatus, "rejected");
  const video = statusFailureDiagnostic({ status: { video_status: "failed" } });
  assert.equal(video.stage, "processing"); assert.equal(video.phaseStatus, "failed");
});

test("terminal success does not require optional publish_status", async () => {
  const status = { status: { video_status: "ready", uploading_phase: { status: "complete" },
    processing_phase: { status: "complete" }, publishing_phase: { status: "complete" } } };
  assert.equal(published(status), true);
  assert.deepEqual(await waitForPublished({ service: { reelStatus: async () => status }, token: TOKEN,
    videoId: "987654", maxAttempts: 1, sleep: async () => {} }), status.status);
  assert.equal(published({ status: { video_status: "published" } }), true);
});

test("known Reel failure produces exactly one sanitized structured log entry", () => {
  const entries = []; const error = new FacebookGraphError(502, "reel_upload_rejected", "safe", "",
    { stage: "upload", reasonCode: "reel_upload_rejected", reason: "safe reason", traceId: "trace_123" });
  assert.equal(logReelFailure(error, (entry) => entries.push(entry)), true); assert.equal(entries.length, 1);
  const parsed = JSON.parse(entries[0]); assert.deepEqual(parsed, { event: "facebook_reel_failure", stage: "upload",
    reasonCode: "reel_upload_rejected", reason: "safe reason", traceId: "trace_123" });
  assert.doesNotMatch(entries[0], /Authorization|rupload|[A-Z]:\\|page-token/i);
  assert.equal(logReelFailure(new FacebookGraphError(400, "meta_100", "safe"), (entry) => entries.push(entry)), false);
  assert.equal(entries.length, 1);
});
