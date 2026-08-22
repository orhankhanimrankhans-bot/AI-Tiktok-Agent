import assert from "node:assert/strict";
import test from "node:test";

import { FAN_OUT_CONCURRENCY, isStrictlyLinearWorkflow, runFanOutWorkflow, validateFanOutTopology } from "./workflowFanOutRunner.js";

const trigger = { id: "trigger", name: "Schedule Trigger" };
const fanOut = (count) => ({
  nodes: [trigger, ...Array.from({ length: count }, (_, index) => ({ id: `branch-${index}`, name: "Mock Action", config: { credentialId: `cred-${index}` } }))],
  connections: Array.from({ length: count }, (_, index) => ({ source: "trigger", target: `branch-${index}` })),
});

test("strictly linear workflows remain eligible for the production linear runner", () => {
  assert.equal(isStrictlyLinearWorkflow([trigger, { id: "a" }, { id: "b" }], [{ source: "trigger", target: "a" }, { source: "a", target: "b" }]), true);
  assert.equal(isStrictlyLinearWorkflow(fanOut(2).nodes, fanOut(2).connections), false);
});

for (const count of [2, 10]) test(`one trigger runs ${count} independent branches`, async () => {
  const graph = fanOut(count);
  const seen = [];
  const result = await runFanOutWorkflow({ ...graph, executeNode: async (node, input, context) => {
    seen.push({ id: node.id, input, context });
    return node.id === "trigger" ? { trigger: true } : { branch: node.id, credentialId: node.config.credentialId };
  } });
  assert.equal(result.status, "success");
  assert.equal(result.branches.length, count);
  assert.deepEqual(result.branches.map((branch) => branch.branchId), Array.from({ length: count }, (_, index) => `branch-${index}`));
  assert.equal(seen.filter((item) => item.id === "trigger").length, 1);
  assert.ok(seen.every((item) => item.context.triggerMode === "workflow"));
});

test("100 branches use bounded concurrency, preserve isolated output, and report deterministic order", async () => {
  const graph = fanOut(100);
  let active = 0; let peak = 0;
  const result = await runFanOutWorkflow({ ...graph, executeNode: async (node, input) => {
    if (node.id === "trigger") return { seed: "safe" };
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, Number(node.id.slice(7)) % 3));
    assert.deepEqual(input, { seed: "safe" });
    active -= 1;
    return { owner: node.id };
  } });
  assert.equal(result.status, "success");
  assert.ok(peak <= FAN_OUT_CONCURRENCY);
  assert.deepEqual(result.branches.map((branch) => branch.branchId), Array.from({ length: 100 }, (_, index) => `branch-${index}`));
  for (let index = 0; index < 100; index += 1) assert.deepEqual(result.nodes.find((node) => node.id === `branch-${index}`).output, { owner: `branch-${index}` });
});

test("a failed branch stops only its descendants while a sibling completes", async () => {
  const nodes = [trigger, { id: "a1", name: "Facebook Graph API" }, { id: "a2", name: "Move File" }, { id: "b1", name: "Facebook Graph API" }, { id: "b2", name: "Move File" }];
  const connections = [{ source: "trigger", target: "a1" }, { source: "a1", target: "a2" }, { source: "trigger", target: "b1" }, { source: "b1", target: "b2" }];
  const calls = [];
  const result = await runFanOutWorkflow({ nodes, connections, executeNode: async (node, input, context) => {
    calls.push({ id: node.id, input, branchId: context.branchId });
    if (node.id === "trigger") return { triggered: true };
    if (node.id === "a1") throw new Error("Page A rejected");
    if (node.id === "b1") return { success: true, status: "published", sourceFileId: "file-b" };
    assert.equal(node.id, "b2"); assert.equal(input.sourceFileId, "file-b"); return { moved: "file-b" };
  } });
  assert.equal(result.status, "error");
  assert.equal(result.branches[0].failedNodeId, "a1");
  assert.equal(result.branches[1].status, "success");
  assert.equal(calls.some((call) => call.id === "a2"), false);
  assert.equal(calls.some((call) => call.id === "b2"), true);
  assert.equal(result.nodes.find((node) => node.id === "a2").status, "idle");
});

test("branch credentials and Drive source metadata never cross branches", async () => {
  const nodes = [trigger,
    { id: "a", name: "Facebook Graph API", config: { credentialId: "cred-a" } }, { id: "am", name: "Move File" },
    { id: "b", name: "Facebook Graph API", config: { credentialId: "cred-b" } }, { id: "bm", name: "Move File" }];
  const connections = [{ source: "trigger", target: "a" }, { source: "a", target: "am" }, { source: "trigger", target: "b" }, { source: "b", target: "bm" }];
  await runFanOutWorkflow({ nodes, connections, executeNode: async (node, input) => {
    if (node.id === "trigger") return { triggered: true };
    if (node.name === "Facebook Graph API") return { success: true, status: "published", credentialId: node.config.credentialId, sourceFileId: `file-${node.id}` };
    const branch = node.id[0]; assert.equal(input.credentialId, `cred-${branch}`); assert.equal(input.sourceFileId, `file-${branch}`); return input;
  } });
});

test("fan-out validator rejects cycles, merges, nested branches, duplicate edges, disconnected nodes, and multiple triggers", () => {
  const rejects = (nodes, connections, pattern) => assert.throws(() => validateFanOutTopology(nodes, connections), pattern);
  rejects([trigger, { id: "a" }, { id: "b" }], [{ source: "trigger", target: "a" }, { source: "trigger", target: "b" }, { source: "a", target: "trigger" }], /cycle|start/i);
  rejects([trigger, { id: "a" }, { id: "b" }, { id: "merge" }], [{ source: "trigger", target: "a" }, { source: "trigger", target: "b" }, { source: "a", target: "merge" }, { source: "b", target: "merge" }], /merge/i);
  rejects([trigger, { id: "a" }, { id: "b" }, { id: "nested" }], [{ source: "trigger", target: "a" }, { source: "trigger", target: "b" }, { source: "a", target: "nested" }, { source: "a", target: "b" }], /branch|merge/i);
  rejects(fanOut(2).nodes, [...fanOut(2).connections, fanOut(2).connections[0]], /duplicate/i);
  rejects([...fanOut(2).nodes, { id: "lost" }], fanOut(2).connections, /disconnected/i);
  rejects([trigger, { id: "trigger-2", name: "Schedule Trigger" }, { id: "a" }], [{ source: "trigger", target: "a" }, { source: "trigger", target: "trigger-2" }], /exactly one/i);
});
