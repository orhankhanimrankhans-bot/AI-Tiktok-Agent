const test = require("node:test"), assert = require("node:assert/strict");
const { createWorkflowExecutor } = require("./workflowExecutor");
const workspace = { ownerType: "additional", ownerId: "creator" };
for (const triggerMode of ["manual", "scheduled"]) for (const instagramSucceeds of [true, false]) {
  test(`${triggerMode}: four publishing branches archive only when Instagram confirms (${instagramSucceeds})`, async () => {
    const nodes = [{ id: "t", name: "Schedule Trigger" }, { id: "s", name: "Search Files and Folders", config: {} }, { id: "p", name: "Prepare Content", config: {} },
      { id: "f", name: "Facebook Graph API", config: { operation: "Publish Reel" } }, { id: "y", name: "YouTube", config: {} }, { id: "k", name: "TikTok", config: {} },
      { id: "i", name: "Instagram", config: { operation: "Publish Reel", caption: "{{ $json.socialCaption }}", publishConsent: true } }, { id: "m", name: "Move File", config: { fileId: "{{ $json.sourceFileId }}" } }];
    const connections = [{ source: "t", target: "s" }, { source: "s", target: "p" }, ...["f", "y", "k", "i"].flatMap(id => [{ source: "p", target: id }, { source: id, target: "m" }])];
    const calls = [], result = request => ({ success: true, status: "published", sourceFileId: request.sourceFileId });
    const services = { google: { searchFiles: async () => [{ fileId: "source", fileName: "video.mp4", binary: { referenceId: "binary" } }], moveFile: async request => { calls.push("move"); assert.equal(request.fileId, "source"); return {}; } },
      openAI: { prepare: async () => ({ socialCaption: "Prepared caption" }) }, facebook: { publishReel: async r => result(r) }, youtube: { uploadVideo: async r => ({ ...result(r), videoId: "yt" }) },
      tiktok: { uploadVideo: async r => ({ ...result(r), provider: "tiktok", status: "inbox_uploaded", uploadId: "tt", inboxStatus: "SEND_TO_USER_INBOX" }) },
      instagram: { publishReel: async (r, owner) => { assert.deepEqual(owner, workspace); assert.equal(r.caption, "Prepared caption"); assert.equal(r.publishConsent, true); assert.equal(r.binary.referenceId, "binary"); assert.equal(r.triggerMode, triggerMode); return { ...result(r), provider: "instagram", status: instagramSucceeds ? "published" : "processing", mediaId: instagramSucceeds ? "123" : "" }; } } };
    const execution = await createWorkflowExecutor({ executionServices: services, logger: { error() {} } }).execute({ workflowId: "workflow", nodes, connections, owner: workspace, triggerMode });
    assert.equal(execution.status, instagramSucceeds ? "success" : "error", JSON.stringify(execution)); assert.equal(calls.length, instagramSucceeds ? 1 : 0);
  });
}
test("linear Instagram scheduled execution binds the workspace and empty input never posts", async () => {
  const nodes = [{ id: "t", name: "Schedule Trigger" }, { id: "s", name: "Search Files and Folders" }, { id: "i", name: "Instagram", config: { publishConsent: true } }];
  const connections = [{ source: "t", target: "s" }, { source: "s", target: "i" }]; let input = [], calls = 0;
  const services = { google: { searchFiles: async () => input }, instagram: { publishReel: async (request, owner) => { calls++; assert.deepEqual(owner, workspace); return { success: true, provider: "instagram", status: "published", mediaId: "123" }; } } };
  const executor = createWorkflowExecutor({ executionServices: services });
  assert.equal((await executor.execute({ nodes, connections, owner: workspace })).status, "success"); assert.equal(calls, 0);
  input = [{ fileId: "source" }]; assert.equal((await executor.execute({ nodes, connections, owner: workspace })).status, "success"); assert.equal(calls, 1);
});
