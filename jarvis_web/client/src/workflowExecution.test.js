import assert from "node:assert/strict";
import test from "node:test";

import {
  createScheduleManualOutput,
  executeUpstreamLinear,
  executeWithLifecycle,
  upstreamInputError,
} from "./workflowExecution.js";

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
