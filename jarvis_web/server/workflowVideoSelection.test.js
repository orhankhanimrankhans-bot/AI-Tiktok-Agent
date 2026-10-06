const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { WorkflowVideoSelection } = require("./workflowVideoSelection");
const { ExecutionStore } = require("./executionStore");
const { FacebookDuplicateGuard } = require("./facebookDuplicateGuard");
const { createWorkflowExecutor } = require("./workflowExecutor");
const owner = { ownerType: "additional", ownerId: "user-a" };

function setup(t) {
  const db = new DatabaseSync(":memory:"); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-selection-"));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const history = new ExecutionStore(db); history.open(); const guard = new FacebookDuplicateGuard(db); guard.open();
  const selection = new WorkflowVideoSelection({ db, binaryDirectory: dir, requireMedia: (_ref, who) => assert.ok(who.ownerId), facebookCredentials: { get: () => ({ pageId: "123456" }) } });
  const nodes = [
    { id: "start", name: "Schedule Trigger" },
    { id: "search", name: "Search Files and Folders", config: { query: ".mp4" } },
    { id: "limit", name: "Limit", config: { maxItems: 1 } },
    { id: "download", name: "Download File", config: { fileId: "{{ $json.id }}" } },
    { id: "prepare", name: "Prepare Content" },
    { id: "facebook", name: "Facebook Graph API", config: { operation: "Publish Reel", credentialId: "facebook-a" } },
    { id: "youtube", name: "YouTube", config: { credentialId: "youtube-a" } },
    { id: "move", name: "Move File", config: { fileId: "{{ $json.sourceFileId }}" } },
  ];
  const connections = [["start","search"],["search","limit"],["limit","download"],["download","prepare"],["prepare","facebook"],["prepare","youtube"],["facebook","move"],["youtube","move"]].map(([source,target]) => ({source,target}));
  const request = { workflowId: "workflow-a", nodes, connections, owner, triggerMode: "schedule" };
  let files = ["one", "two", "three"], failFacebook = false; const calls = [], moved = [];
  const download = async ({ fileId }) => {
    const ref = "bin_" + fileId.padEnd(22,"x"); fs.writeFileSync(path.join(dir,ref),fileId === "alias" ? "one" : fileId);
    return { fileId, fileName: fileId+".mp4", mimeType: "video/mp4", binary: { property: "data", referenceId: ref } };
  };
  const executor = createWorkflowExecutor({ logger: { error() {} }, executionServices: {
    videoSelection: selection, google: { searchFiles: async () => files.map(id => ({ id })), downloadFile: download, moveFile: async value => { moved.push(value.fileId); return { moved: true }; } },
    openAI: { prepare: async () => ({ title: "Video" }) },
    facebook: { publishReel: async value => { calls.push(["facebook",value.sourceFileId]); if (failFacebook) throw Object.assign(new Error("uncertain"), { code: "facebook_duplicate_pending" }); return {success:true,status:"published",sourceFileId:value.sourceFileId}; } },
    youtube: { uploadVideo: async value => { calls.push(["youtube",value.sourceFileId]); return {success:true,videoId:"yt",sourceFileId:value.sourceFileId}; } },
  } });
  return { db, history, guard, selection, request, executor, calls, moved, download, setFiles: v => files=v, failFacebook: () => failFacebook=true };
}
test("partial publishing success skips that source on retry and publishes the next video without moving the failed source", async t => {
  const x=setup(t); x.failFacebook(); const first=await x.executor.execute(x.request);
  assert.equal(first.status,"error"); assert.deepEqual(x.moved,[]);
  await x.executor.execute(x.request);
  assert.deepEqual(x.calls,[["facebook","one"],["youtube","one"],["facebook","two"],["youtube","two"]]);
  assert.deepEqual(x.moved,[]);
});
test("renamed identical bytes are skipped before either publisher, and next candidate replaces them", async t => {
  const x=setup(t); await x.executor.execute(x.request); x.setFiles(["alias","two"]);
  const result=await x.executor.execute(x.request);
  assert.equal(result.status,"success"); assert.deepEqual(x.calls.map(c=>c[1]),["one","one","two","two"]);
  assert.deepEqual(x.moved,["one","two"]); assert.ok(result.nodes.some(n=>n.skippedVideos?.some(s=>s.sourceFileId==="alias")));
});
test("historical Facebook reservations skip uncertain submissions; all duplicates call no providers", async t => {
  const x=setup(t); x.guard.reserve({owner,pageId:"123456",sourceId:"one"}); x.setFiles(["one"]);
  const result=await x.executor.execute(x.request); assert.equal(result.status,"success"); assert.deepEqual(x.calls,[]); assert.deepEqual(x.moved,[]);
});
test("workspace isolation allows a different owner to publish its own same-named source", async t => {
  const x=setup(t); await x.executor.execute(x.request); await x.executor.execute({...x.request,owner:{...owner,ownerId:"user-b"}});
  assert.deepEqual(x.calls.map(c=>c[1]),["one","one","one","one"]);
});
test("reservations block concurrent selection but pre-publish failure releases the reservation", async t => {
  const x=setup(t), a=x.selection.create(x.request), b=x.selection.create(x.request), node=x.request.nodes.find(n=>n.id==="download");
  try {
    const results=await Promise.all([a.download(node,{id:"one"},v=>x.download({fileId:v.id})),b.download(node,{id:"one"},v=>x.download({fileId:v.id}))]);
    assert.equal(results.filter(Array.isArray).length,1);
  } finally { a.close(); b.close(); }
  assert.equal(x.db.prepare('SELECT count(*) AS n FROM workflow_video_claims').get().n,0);
  await x.executor.execute(x.request); assert.equal(x.calls.length,2);
});
test("legacy partial success is read only within its workspace and workflow", async t => {
  const x=setup(t); x.history.save({workflowId:"workflow-a",status:"error",startedAt:"2026-10-05",finishedAt:"2026-10-05",nodes:[{nodeId:"youtube",status:"success",output:[{success:true,videoId:"old",sourceFileId:"one"}]}]},owner);
  await x.executor.execute(x.request); assert.deepEqual(x.calls.map(c=>c[1]),["two","two"]);
});
