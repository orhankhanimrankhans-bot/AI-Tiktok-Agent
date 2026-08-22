import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executePerItem, resolveExpression } from "./expressionResolver.js";
import { buildFacebookReelRequest, facebookNodeDefaults, FACEBOOK_OPERATION_PUBLISH_REEL } from "./facebookReelConfig.js";
import { buildPrepareContentRequest, mergePreparedContent, prepareContentDefaults } from "./prepareContentConfig.js";
import { buildArchiveMoveRequest, preservePublishedSource } from "./postPublishArchive.js";
import { applyManualNodeResult, createScheduleManualOutput } from "./workflowExecution.js";
import { runLinearWorkflow } from "./workflowRunner.js";
import { normalizeSavedWorkflow, workflowForStorage } from "./workflowStorage.js";

const nodes = [
  { id: "trigger", name: "Schedule Trigger", x: 100, y: 120, config: { rules: [{ interval: "Days", days: 1, hour: "Midnight" }] } },
  { id: "search", name: "Search Files and Folders", x: 320, y: 120, config: { credentialId: "gcred_production", query: "reels", limit: 50 } },
  { id: "limit", name: "Limit", x: 540, y: 120, config: { keep: "First Items", maxItems: 1 } },
  { id: "download", name: "Download File", x: 760, y: 120, config: { credentialId: "gcred_production", fileId: "{{ $json.id }}", binaryProperty: "data" } },
  { id: "prepare", name: "Prepare Content", x: 980, y: 120, config: prepareContentDefaults() },
  { id: "facebook", provider: "Facebook", name: "Facebook Graph API", x: 1200, y: 120,
    config: { ...facebookNodeDefaults(), operation: FACEBOOK_OPERATION_PUBLISH_REEL, credentialId: "fcred_production",
      title: "{{ $json.title }}", description: "{{ $json.socialCaption }}" } },
];
const connections = nodes.slice(0, -1).map((node, index) => ({ id: `edge-${index}`, source: node.id, target: nodes[index + 1].id }));

test("production Schedule → Search → Limit 1 → Download → Prepare → Facebook behavior remains linear and lossless", async () => {
  const calls = []; const executionContexts = []; let facebookRequest;
  const services = {
    search: async (config) => { calls.push(["search", config.credentialId]); return [{ id: "drive-first", name: "first.mp4" }, { id: "drive-second", name: "second.mp4" }]; },
    download: async (credentialId, fileId) => { calls.push(["download", credentialId, fileId]); return { id: fileId, fileName: "first.mp4", mimeType: "video/mp4",
      binary: { property: "data", referenceId: "bin_1234567890123456789012", size: 4096 } }; },
    prepare: async (request) => { calls.push(["prepare", request.fileName]); return { title: "Production Reel", caption: "Ready to publish",
      hashtags: ["#jarvis"], socialCaption: "Ready to publish\n\n#jarvis" }; },
    publish: async (request) => { facebookRequest = request; calls.push(["facebook", request.credentialId]); return { status: "published", videoId: "safe-id" }; },
  };
  const transitions = [];
  const result = await runLinearWorkflow({ nodes, connections,
    onNodeTransition: (node) => transitions.push([node.id, node.status]), executeNode: async (node, input, context) => {
      executionContexts.push(context);
      if (node.id === "trigger") return createScheduleManualOutput(node.config, new Date("2026-08-22T10:00:00.000Z"));
      if (node.id === "search") return services.search(node.config);
      if (node.id === "limit") return input.slice(0, Number(node.config.maxItems));
      if (node.id === "download") return executePerItem(input, async (item) => services.download(node.config.credentialId, resolveExpression(node.config.fileId, item)));
      if (node.id === "prepare") return executePerItem(input, async (item) => {
        const generated = await services.prepare(buildPrepareContentRequest(node.config, item)); return mergePreparedContent(item, generated, true);
      });
      return executePerItem(input, async (item) => services.publish(buildFacebookReelRequest(node.config, item)));
    } });

  assert.equal(result.status, "success"); assert.deepEqual(result.nodes.map((node) => node.status), Array(6).fill("success"));
  assert.deepEqual(calls, [["search", "gcred_production"], ["download", "gcred_production", "drive-first"], ["prepare", "first.mp4"], ["facebook", "fcred_production"]]);
  assert.equal(facebookRequest.binary.referenceId, "bin_1234567890123456789012"); assert.equal(facebookRequest.binary.size, 4096);
  assert.equal(facebookRequest.title, "Production Reel"); assert.equal(facebookRequest.description, "Ready to publish\n\n#jarvis");
  assert.equal(resolveExpression("{{ $json.id }}", { id: "drive-first" }), "drive-first");
  assert.equal(resolveExpression("{{ $json.title }}", { title: "Production Reel" }), "Production Reel");
  assert.equal(resolveExpression("{{ $json.socialCaption }}", { socialCaption: "caption" }), "caption");
  assert.deepEqual(transitions, nodes.flatMap((node) => [[node.id, "running"], [node.id, "success"]]));
  assert.deepEqual(result.summaries.map((summary) => summary.nodeId), nodes.map((node) => node.id));
  assert.ok(executionContexts.every((context) => context?.triggerMode === "workflow"));
});

test("production configs, credential references, positions, and binary metadata survive Save/load", () => {
  const workflow = { version: 2, name: "My Workflow", nodes: nodes.map((node) => node.id === "download" ? { ...node,
    status: "success", output: { binary: { property: "data", referenceId: "bin_runtime_only", size: 4096 } } } : node), connections };
  const saved = workflowForStorage(workflow); const restored = normalizeSavedWorkflow(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.connections, connections); assert.deepEqual(restored.nodes.map(({ id, x, y }) => ({ id, x, y })), nodes.map(({ id, x, y }) => ({ id, x, y })));
  assert.equal(restored.nodes.find((node) => node.id === "search").config.credentialId, "gcred_production");
  assert.equal(restored.nodes.find((node) => node.id === "facebook").config.credentialId, "fcred_production");
  assert.deepEqual(restored.nodes.find((node) => node.id === "download").output,
    { binary: { property: "data", referenceId: "bin_runtime_only", size: 4096 } });
});

test("Schedule Trigger Execute Step remains node-only and browser auto-scheduling is absent", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /onRunTrigger|window\.setInterval|pendingTriggerRunsRef/);
  assert.match(source, /onExecuteNode\(\{ \.\.\.node, config \}, null, \{ triggerMode: "manual" \}\)/);
  assert.match(source, /isStrictlyLinearWorkflow\(runNodes, connectionsRef\.current\) \? runLinearWorkflow : runFanOutWorkflow/);
  assert.match(source, /triggerMode: "workflow", startedAt/);
});

test("Execute Step downstream invalidation still resets the complete original linear tail", () => {
  const completed = nodes.map((node) => ({ ...node, status: "success", output: { old: node.id } }));
  const rerunSearch = { ...completed[1], status: "success", output: [{ id: "new-file" }] };
  const updated = applyManualNodeResult(completed, connections, rerunSearch);
  assert.equal(updated[0].status, "success"); assert.deepEqual(updated[1].output, [{ id: "new-file" }]);
  for (const node of updated.slice(2)) { assert.equal(node.status, "idle"); assert.equal(node.output, null); }
  assert.deepEqual(updated[2].input, [{ id: "new-file" }]);
});

test("seven-node production flow archives the exact source only after Facebook publishes", async () => {
  const archiveNode = { id: "archive", provider: "Google Drive", name: "Move File", x: 1420, y: 120,
    config: { credentialId: "gcred_production", fileId: "{{ $json.sourceFileId }}", destinationFolderId: "done_folder_id" } };
  const sevenNodes = [...nodes, archiveNode]; const sevenConnections = sevenNodes.slice(0, -1)
    .map((node, index) => ({ id: `archive-edge-${index}`, source: node.id, target: sevenNodes[index + 1].id }));
  const moved = [];
  const result = await runLinearWorkflow({ nodes: sevenNodes, connections: sevenConnections, executeNode: async (node, input) => {
    if (node.id === "trigger") return createScheduleManualOutput(node.config);
    if (node.id === "search") return [{ id: "original_drive_file", name: "original.mp4" }];
    if (node.id === "limit") return input.slice(0, 1);
    if (node.id === "download") return [{ fileId: input[0].id, fileName: "original.mp4", mimeType: "video/mp4",
      binary: { property: "data", referenceId: "bin_1234567890123456789012", size: 12 } }];
    if (node.id === "prepare") return input.map((item) => ({ ...item, title: "Ready", socialCaption: "Caption" }));
    if (node.id === "facebook") return input.map((item) => preservePublishedSource({ success: true, status: "published", videoId: "video_1" }, item));
    const request = buildArchiveMoveRequest(node.config, input[0]); moved.push(request);
    return [{ success: true, fileId: request.fileId, destinationFolderId: request.destinationFolderId, status: "moved" }];
  } });
  assert.equal(result.status, "success"); assert.deepEqual(result.nodes.map((node) => node.status), Array(7).fill("success"));
  assert.deepEqual(moved, [{ credentialId: "gcred_production", fileId: "original_drive_file", destinationFolderId: "done_folder_id" }]);
});

test("Facebook failure stops the linear workflow before Move File", async () => {
  const archiveNode = { id: "archive", name: "Move File", config: { credentialId: "gcred_production",
    fileId: "{{ $json.sourceFileId }}", destinationFolderId: "done_folder_id" } };
  const failureNodes = [...nodes, archiveNode]; const failureConnections = failureNodes.slice(0, -1)
    .map((node, index) => ({ id: `failure-edge-${index}`, source: node.id, target: failureNodes[index + 1].id }));
  let moveCalls = 0;
  const result = await runLinearWorkflow({ nodes: failureNodes, connections: failureConnections, executeNode: async (node, input) => {
    if (node.id === "trigger") return {};
    if (node.id === "search") return [{ id: "original_drive_file" }];
    if (node.id === "limit") return input;
    if (node.id === "download") return [{ fileId: "original_drive_file" }];
    if (node.id === "prepare") return input;
    if (node.id === "facebook") throw new Error("Facebook rejected publishing.");
    moveCalls += 1; return input;
  } });
  assert.equal(result.status, "error"); assert.equal(moveCalls, 0); assert.equal(result.nodes.find((node) => node.id === "archive").status, "idle");
});
