const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { executeYouTubeUpload, normalizeUploadRequest, YouTubeUploadError } = require("./youtubeUpload");

const referenceId = "bin_1234567890123456789012";
async function closeMedia(stream) { await new Promise((resolve, reject) => { stream.once("open", () => stream.destroy()); stream.once("close", resolve); stream.once("error", reject); }); }
function fixture(t) {
  const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-youtube-binary-")); fs.writeFileSync(path.join(binaryDir, referenceId), Buffer.from("video"));
  t.after(() => fs.rmSync(binaryDir, { recursive: true, force: true }));
  const saved = []; const calls = [];
  const credentialStore = { get: async (_id, options) => { calls.push(["credential", options]); return { id: "gcred_1234567890123456789012", provider: "youtube", accountEmail: "channel@example.com", accountName: "Channel", tokens: { refresh_token: "private-refresh" } }; }, save: async (value, owner) => saved.push([value, owner]) };
  const auth = { setCredentials(tokens) { assert.equal(tokens.refresh_token, "private-refresh"); }, on(_event, handler) { this.refresh = handler; } };
  const youtube = { videos: { insert: async (request) => { calls.push(["insert", request]); await closeMedia(request.media.body); return { data: { id: "video123", snippet: { channelId: "channel123", channelTitle: "COREX Channel", title: request.requestBody.snippet.title }, status: { privacyStatus: "unlisted", uploadStatus: "uploaded" } } }; }, list: async () => ({ data: { items: [{ id: "video123", snippet: { channelId: "channel123", channelTitle: "COREX Channel", title: "Rendered title" }, status: { privacyStatus: "unlisted", uploadStatus: "uploaded" }, processingDetails: { processingStatus: "processing" } }] } }) } };
  return { binaryDir, credentialStore, auth, youtube, calls, saved };
}

test("YouTube videos.insert uploads the private binary and returns structured safe output", async (t) => {
  const value = fixture(t); const owner = { ownerType: "additional", ownerId: "workspace_a" };
  const result = await executeYouTubeUpload({ request: { credentialId: "gcred_1234567890123456789012", binaryProperty: "data", binary: { property: "data", referenceId }, mimeType: "video/mp4", fileName: "clip.mp4", title: "Rendered title", description: "Rendered description", privacyStatus: "unlisted", madeForKids: false, tags: "one, two", categoryId: "22", sourceFileId: "drive123", sourceFileName: "clip.mp4" }, owner, credentialStore: value.credentialStore, createOAuthClient: () => value.auth, createYouTubeClient: () => value.youtube, binaryDir: value.binaryDir, logger: { error() {}, warn() {} } });
  const insert = value.calls.find(([name]) => name === "insert")[1];
  assert.deepEqual(insert.part, ["snippet", "status"]); assert.equal(insert.requestBody.snippet.description, "Rendered description"); assert.deepEqual(insert.requestBody.snippet.tags, ["one", "two"]); assert.equal(insert.requestBody.status.selfDeclaredMadeForKids, false); assert.equal(insert.media.body.path, path.join(value.binaryDir, referenceId));
  assert.deepEqual(result, { success: true, videoId: "video123", channelId: "channel123", channelTitle: "COREX Channel", title: "Rendered title", privacyStatus: "unlisted", uploadStatus: "uploaded", processingStatus: "processing", sourceFileId: "drive123", sourceFileName: "clip.mp4", youtubeUrl: "https://www.youtube.com/watch?v=video123" });
  assert.doesNotMatch(JSON.stringify(result), /private-refresh|token|binaryDir/i); assert.equal(value.calls[0][1].provider, "youtube");
});

test("YouTube request validation and API failures are safe", async (t) => {
  assert.throws(() => normalizeUploadRequest({}), (error) => error instanceof YouTubeUploadError && error.code === "invalid_credential_id");
  const value = fixture(t); value.youtube.videos.insert = async (request) => { await closeMedia(request.media.body); const error = new Error("Bearer private-token"); error.response = { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } }; throw error; };
  await assert.rejects(() => executeYouTubeUpload({ request: { credentialId: "gcred_1234567890123456789012", binaryProperty: "data", binary: { property: "data", referenceId }, mimeType: "video/mp4", title: "Title" }, credentialStore: value.credentialStore, createOAuthClient: () => value.auth, createYouTubeClient: () => value.youtube, binaryDir: value.binaryDir, logger: { error() {} } }), (error) => error.code === "insufficient_youtube_scope" && !/private-token|Bearer/.test(error.message));
});

test("YouTube upload limits and invalid metadata retain actionable secret-safe codes without retries", async t => {
 for(const [reason,code] of [["uploadLimitExceeded","youtube_upload_limit"],["invalidTags","youtube_invalid_tags"],["invalidCategoryId","youtube_invalid_category"]]) {
 const f=fixture(t);let attempts=0;const logs=[];
 f.youtube.videos.insert=async request=>{attempts++;await closeMedia(request.media.body);throw Object.assign(new Error("Bearer secret"),{response:{status:400,data:{error:{errors:[{reason}]}}}});};
 await assert.rejects(executeYouTubeUpload({request:{credentialId:"gcred_1234567890123456789012",binary:{property:"data",referenceId},title:"Title"},credentialStore:f.credentialStore,createOAuthClient:()=>f.auth,createYouTubeClient:()=>f.youtube,binaryDir:f.binaryDir,logger:{error:(...a)=>logs.push(a)}}),{code});
 assert.equal(attempts,1);assert.match(JSON.stringify(logs),new RegExp(code));assert.doesNotMatch(JSON.stringify(logs),/Bearer|secret/);
 }
});
