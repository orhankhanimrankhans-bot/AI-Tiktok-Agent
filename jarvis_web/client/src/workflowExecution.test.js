import assert from "node:assert/strict";
import test from "node:test";

import {
  applyManualNodeResult,
  createStructuredExecutionError,
  createScheduleManualOutput,
  executeUpstreamLinear,
  executeWithLifecycle,
  upstreamInputError,
} from "./workflowExecution.js";
import { runLinearWorkflow } from "./workflowRunner.js";

const chain = [{ source: "search", target: "limit" }, { source: "limit", target: "download" }, { source: "download", target: "facebook" }];

test("manual Search error to success refreshes Limit input and allows execution", () => {
  const staleError = { status: "error", message: "Google Drive search could not be completed." };
  const nodes = [
    { id: "search", status: "error", output: staleError },
    { id: "limit", config: { maxItems: 1, keep: "First Items" }, status: "error", input: staleError, output: { status: "error", message: "Limit requires array input." } },
    { id: "download", status: "idle" }, { id: "facebook", status: "idle" },
  ];
  const searchOutput = [{ id: "video-1" }, { id: "video-2" }];
  const refreshed = applyManualNodeResult(nodes, chain, { ...nodes[0], status: "success", output: searchOutput, error: null });
  const limit = refreshed.find((node) => node.id === "limit");
  assert.deepEqual(limit.input, searchOutput); assert.equal(limit.status, "idle"); assert.equal(limit.output, null);
  assert.deepEqual(limit.input.slice(0, limit.config.maxItems), [{ id: "video-1" }]);
});

test("manual Search success replaces an older successful downstream input", () => {
  const arrayA = [{ id: "old-1" }, { id: "old-2" }]; const arrayB = [{ id: "new-1" }, { id: "new-2" }];
  const nodes = [{ id: "search", status: "success", output: arrayA },
    { id: "limit", status: "success", input: arrayA, output: [arrayA[0]] }, { id: "download", status: "idle" }, { id: "facebook", status: "idle" }];
  const refreshed = applyManualNodeResult(nodes, chain, { ...nodes[0], output: arrayB });
  assert.deepEqual(refreshed.find((node) => node.id === "limit").input, arrayB);
  assert.notDeepEqual(refreshed.find((node) => node.id === "limit").input, arrayA);
});

test("manual upstream rerun invalidates the full downstream chain but preserves unrelated runtime", () => {
  const nodes = [{ id: "schedule", status: "success", output: { triggered: true } }, { id: "search", status: "success", output: [{ id: 2 }] },
    { id: "limit", status: "success", input: [{ id: 1 }], output: [{ id: 1 }], config: { maxItems: 1, credentialId: "gcred_safe" } },
    { id: "download", status: "success", input: [{ id: 1 }], output: { binary: { referenceId: "bin_safe" } } },
    { id: "facebook", status: "error", input: { binary: { referenceId: "bin_safe" } }, output: { status: "error" } },
    { id: "unrelated", status: "success", output: { keep: true } }];
  const refreshed = applyManualNodeResult(nodes, chain, nodes[1]);
  assert.deepEqual(refreshed.find((node) => node.id === "limit").input, [{ id: 2 }]);
  for (const id of ["limit", "download", "facebook"]) { const node = refreshed.find((item) => item.id === id); assert.equal(node.status, "idle"); assert.equal(node.output, null); }
  assert.equal(refreshed.find((node) => node.id === "download").input, null); assert.equal(refreshed.find((node) => node.id === "facebook").input, null);
  assert.deepEqual(refreshed.find((node) => node.id === "unrelated").output, { keep: true });
  assert.equal(refreshed.find((node) => node.id === "limit").config.credentialId, "gcred_safe");
  assert.doesNotMatch(JSON.stringify(refreshed), /access_token|Authorization|video-bytes/);
});

test("previous node output becomes the connected node input", async () => {
  const result = await executeUpstreamLinear({
    targetNodeId: "second",
    nodes: [{ id: "first", output: null }, { id: "second", output: null }],
    connections: [{ id: "c1", source: "first", target: "second" }],
    executeNode: async (node) => ({ ...node, output: [{ id: 1 }] }),
  });
  assert.deepEqual(result.input, [{ id: 1 }]);
  assert.deepEqual(result.nodes.find((node) => node.id === "second").input, [{ id: 1 }]);
});

test("Schedule Trigger executes once and becomes Google Drive input", async () => {
  let executionCount = 0;
  const triggerOutput = createScheduleManualOutput(
    { rules: [{ interval: "Minutes", minutes: 5 }] },
    new Date("2026-01-01T00:00:00Z")
  );
  const result = await executeUpstreamLinear({
    targetNodeId: "drive",
    nodes: [
      { id: "schedule", name: "Schedule Trigger", status: "idle" },
      { id: "drive", name: "Search Files and Folders", input: null },
    ],
    connections: [{ id: "schedule-drive", source: "schedule", target: "drive" }],
    executeNode: async (node) => {
      executionCount += 1;
      return { ...node, status: "success", output: triggerOutput };
    },
  });

  assert.equal(executionCount, 1);
  assert.deepEqual(result.input, triggerOutput);
  assert.deepEqual(result.nodes.find((node) => node.id === "drive").input, triggerOutput);
});

test("no incoming connection reports a visible error instead of null", async () => {
  try {
    await executeUpstreamLinear({
      targetNodeId: "drive",
      nodes: [{ id: "drive", input: null }],
      connections: [],
      executeNode: async (node) => node,
    });
    assert.fail("Expected missing upstream connection to fail.");
  } catch (error) {
    assert.deepEqual(upstreamInputError(error), {
      status: "error",
      message: "No upstream node is connected.",
    });
  }
});

test("upstream lifecycle failure is surfaced with updated runtime nodes", async () => {
  try {
    await executeUpstreamLinear({
      targetNodeId: "drive",
      nodes: [{ id: "schedule", name: "Schedule Trigger" }, { id: "drive" }],
      connections: [{ source: "schedule", target: "drive" }],
      executeNode: async (node) => ({ ...node, status: "error", error: "Trigger failed", output: { status: "error", message: "Trigger failed" } }),
    });
    assert.fail("Expected upstream lifecycle failure.");
  } catch (error) {
    assert.deepEqual(upstreamInputError(error), { status: "error", message: "Trigger failed" });
    assert.equal(error.updatedNodes.find((node) => node.id === "schedule").status, "error");
  }
});

test("cyclic upstream execution is rejected safely", async () => {
  await assert.rejects(() => executeUpstreamLinear({
    targetNodeId: "a",
    nodes: [{ id: "a" }, { id: "b" }],
    connections: [{ source: "a", target: "b" }, { source: "b", target: "a" }],
    executeNode: async (node) => node,
  }), /cycle detected/i);
});

test("Schedule Trigger manual execution returns structured test output", () => {
  const output = createScheduleManualOutput({ rules: [{ interval: "Minutes", minutes: 5 }] }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(output.mode, "manual-test");
  assert.equal(output.schedule.rules[0].value, 5);
});

test("node lifecycle transitions running to success", async () => {
  const transitions = [];
  const result = await executeWithLifecycle({ node: { id: "a" }, input: { id: 1 }, executor: async () => [1], onTransition: (node) => transitions.push(node.status) });
  assert.deepEqual(transitions, ["running", "success"]);
  assert.equal(result.status, "success");
});

test("node lifecycle transitions running to error", async () => {
  const transitions = [];
  const result = await executeWithLifecycle({ node: { id: "a" }, executor: async () => { throw new Error("failed"); }, onTransition: (node) => transitions.push(node.status) });
  assert.deepEqual(transitions, ["running", "error"]);
  assert.equal(result.error, "failed");
});

test("plain errors remain message-only while structured errors preserve the safe allowlist", async () => {
  const plain = await executeWithLifecycle({ node: { id: "plain" }, executor: async () => { throw new Error("plain failure"); } });
  assert.deepEqual(plain.output, { status: "error", message: "plain failure" });

  const diagnostic = { stage: "upload", reasonCode: "reel_upload_rejected", metaCode: 6000, metaSubcode: 1363019,
    httpStatus: 400, responseKind: "graph_error", phaseStatus: "failed", publishStatus: "rejected", copyrightStatus: "complete", reason: "Safe Meta reason",
    isTransient: false, traceId: "trace_123", unknown: "do-not-copy" };
  const structured = await executeWithLifecycle({ node: { id: "facebook" }, executor: async () => {
    throw createStructuredExecutionError({ message: "Facebook rejected the Reel video upload.", code: "reel_upload_rejected",
      diagnostic, rawResponse: { secret: true }, accessToken: "never-copy" });
  } });
  assert.deepEqual(structured.output, { status: "error", message: "Facebook rejected the Reel video upload.",
    code: "reel_upload_rejected", diagnostic: { stage: "upload", reasonCode: "reel_upload_rejected", metaCode: 6000,
      metaSubcode: 1363019, httpStatus: 400, responseKind: "graph_error", phaseStatus: "failed", publishStatus: "rejected", copyrightStatus: "complete",
      reason: "Safe Meta reason", isTransient: false, traceId: "trace_123" } });
  assert.doesNotMatch(JSON.stringify(structured.output), /do-not-copy|never-copy|rawResponse|accessToken/);
});

test("structured diagnostics redact credentials, URLs, and internal paths", async () => {
  const unsafe = createStructuredExecutionError({ message: "Rejected", code: "reel_upload_rejected", diagnostic: {
    stage: "upload", reasonCode: "reel_upload_rejected", reason: "Bearer secret-token https://rupload.facebook.com/signed C:\\private\\video.mp4",
    httpStatus: "200", responseKind: "raw_body",
    traceId: "trace-safe", Authorization: "Bearer never-copy", uploadUrl: "https://never-copy.example", raw: { token: "never-copy" },
  } });
  const failed = await executeWithLifecycle({ node: { id: "facebook" }, executor: async () => { throw unsafe; } });
  const serialized = JSON.stringify(failed.output);
  assert.match(serialized, /\[REDACTED\]/); assert.match(serialized, /\[REDACTED_URL\]/); assert.match(serialized, /\[REDACTED_PATH\]/);
  assert.match(serialized, /Authorization \[REDACTED\]/);
  assert.doesNotMatch(serialized, /secret-token|rupload\.facebook|C:\\private|never-copy|uploadUrl|raw/);
  assert.equal(failed.output.diagnostic.httpStatus, undefined); assert.equal(failed.output.diagnostic.responseKind, undefined);
});

test("Run Workflow keeps safe diagnostics on the failed node", async () => {
  const result = await runLinearWorkflow({ nodes: [{ id: "schedule", name: "Schedule Trigger" }, { id: "facebook", name: "Facebook Graph API" }],
    connections: [{ source: "schedule", target: "facebook" }], executeNode: async (node) => {
      if (node.id === "schedule") return { triggered: true };
      throw createStructuredExecutionError({ message: "Rejected", code: "reel_upload_rejected",
        diagnostic: { stage: "upload", reasonCode: "reel_upload_rejected", unknown: "drop" } });
    } });
  assert.equal(result.status, "error");
  assert.deepEqual(result.nodes.find((node) => node.id === "facebook").output,
    { status: "error", message: "Rejected", code: "reel_upload_rejected",
      diagnostic: { stage: "upload", reasonCode: "reel_upload_rejected" } });
});
