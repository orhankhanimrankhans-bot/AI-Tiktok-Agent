import assert from "node:assert/strict";
import test from "node:test";
import { runLinearWorkflow } from "./workflowRunner.js";

const nodes = [{ id: "s", name: "Schedule Trigger" }, { id: "d", name: "Search Files and Folders" }, { id: "l", name: "Limit" }];
const connections = [{ source: "s", target: "d" }, { source: "d", target: "l" }];
test("workflow executes Schedule, Drive Search, and Limit in order with propagation", async () => {
  const order = [];
  const result = await runLinearWorkflow({ nodes, connections, executeNode: async (node, input) => {
    order.push(node.id);
    if (node.id === "s") return { mode: "manual-test" };
    if (node.id === "d") { assert.equal(input.mode, "manual-test"); return [{ id: 1 }, { id: 2 }]; }
    assert.deepEqual(input, [{ id: 1 }, { id: 2 }]); return input.slice(0, 1);
  } });
  assert.deepEqual(order, ["s", "d", "l"]); assert.equal(result.status, "success");
});
test("workflow stops after an error", async () => {
  const order = [];
  const result = await runLinearWorkflow({ nodes, connections, executeNode: async (node) => { order.push(node.id); if (node.id === "d") throw new Error("Drive failed"); return {}; } });
  assert.deepEqual(order, ["s", "d"]); assert.equal(result.nodes.find((node) => node.id === "l").status, "idle");
});
test("cycles and unsupported branches are rejected", async () => {
  await assert.rejects(() => runLinearWorkflow({ nodes: nodes.slice(0, 2), connections: [{ source: "s", target: "d" }, { source: "d", target: "s" }], executeNode: async () => ({}) }), /cycle/i);
  await assert.rejects(() => runLinearWorkflow({ nodes, connections: [{ source: "s", target: "d" }, { source: "s", target: "l" }], executeNode: async () => ({}) }), /branching/i);
});
