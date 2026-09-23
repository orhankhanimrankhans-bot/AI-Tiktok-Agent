const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { TikTokStore, hash } = require("./tiktokStore");
const { createTikTokWorkflowService } = require("./tiktokWorkflow");
const owner = { ownerType: "additional", ownerId: "creator" };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-node-"));
  const store = new TikTokStore(new DatabaseSync(":memory:"), "test-encryption-secret");
  t.after(async () => { store.db.close(); await fs.rm(dir, { recursive: true }); });
  const config = { configured: true, clientKey: "key", clientSecret: "secret", redirectUri: "https://example.test/api/tiktok/auth/callback" };
  const configHash = hash(JSON.stringify([config.clientKey, config.clientSecret, config.redirectUri]));
  store.save(owner, { openId: "account", accessToken: "private-token", configHash, displayName: "Creator" });
  const referenceId = "bin_abcdefghijklmnopqrstuv";
  await fs.writeFile(path.join(dir, referenceId), Buffer.from("0000ftypisom0000"));
  const request = { operation: "Upload to Inbox", credentialId: hash("account" + configHash), uploadConsent: true,
    binaryProperty: "data", binary: { property: "data", referenceId }, mimeType: "video/mp4", sourceFileId: "drive-original" };
  const calls = []; let status = "SEND_TO_USER_INBOX", allowed = true;
  const api = { access: async a => a, transfer: async () => calls.push("transfer"), request: async route => {
    calls.push(route); return route.includes("init") ? { data: { publish_id: "publish-id", upload_url: "https://open-upload.tiktokapis.com/video" } } : { data: { status } };
  } };
  const service = createTikTokWorkflowService({ store, config, api, binaryDirectory: dir, sleep: async () => {},
    authorizeOwner: o => { assert.deepEqual(o, owner); if (!allowed) throw new Error("revoked"); },
    requireMedia: async (ref, o) => { assert.deepEqual(o, owner); assert.equal(ref, referenceId); } });
  return { service, request, calls, store, api, setStatus: s => { status = s; }, revoke: () => { allowed = false; } };
}
test("inbox node confirms delivery, retains Drive identity and deduplicates reruns", async t => {
  const f = await fixture(t);
  const result = await f.service.uploadVideo(f.request, owner);
  assert.equal(result.status, "inbox_uploaded"); assert.equal(result.published, false);
  assert.equal(result.sourceFileId, "drive-original"); assert.doesNotMatch(JSON.stringify(result), /private-token|accessToken/);
  assert.equal((await f.service.uploadVideo(f.request, owner)).uploadId, result.uploadId);
  assert.equal(f.calls.filter(x => x === "transfer").length, 1);
});
test("no consent, stale account, foreign media and revoked permissions fail before provider work", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.uploadVideo({ ...f.request, uploadConsent: false }, owner), /authorize/);
  await assert.rejects(f.service.uploadVideo({ ...f.request, credentialId: "stale" }, owner), /connected/);
  await assert.rejects(f.service.uploadVideo({ ...f.request, binary: { property: "data", referenceId: "bin_zzzzzzzzzzzzzzzzzzzzzz" } }, owner));
  f.revoke(); await assert.rejects(f.service.uploadVideo(f.request, owner), /revoked/);
  assert.deepEqual(f.calls, []);
});
test("processing retry checks the existing upload without transferring again", async t => {
  const f = await fixture(t); f.setStatus("PROCESSING_UPLOAD");
  await assert.rejects(f.service.uploadVideo(f.request, owner), e => e.code === "tiktok_processing");
  f.setStatus("SEND_TO_USER_INBOX"); assert.equal((await f.service.uploadVideo(f.request, owner)).status, "inbox_uploaded");
  assert.equal(f.calls.filter(x => x === "transfer").length, 1);
});
test("failed and unknown provider status never report successful delivery", async t => {
  const f = await fixture(t);
  for (const status of ["FAILED", "NEW_UNKNOWN_STATUS"]) {
    f.setStatus(status); await assert.rejects(f.service.uploadVideo(f.request, owner));
  }
  assert.equal(f.calls.filter(x => x === "transfer").length, 1);
});
test("uncertain init is durable and cannot cause a second upload", async t => {
  const f = await fixture(t); let count = 0;
  f.api.request = async () => { count++; throw new Error("network"); };
  await assert.rejects(f.service.uploadVideo(f.request, owner));
  await assert.rejects(f.service.uploadVideo(f.request, owner), e => e.code === "tiktok_outcome_uncertain");
  assert.equal(count, 1);
});
