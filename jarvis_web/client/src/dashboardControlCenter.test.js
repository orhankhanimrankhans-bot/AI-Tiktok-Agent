import assert from "node:assert/strict";
import test from "node:test";
import { controlCenterState, dashboardFacts } from "./dashboardControlCenter.js";

test("control center state is derived only from real workflow inputs", () => {
  assert.equal(controlCenterState({ graph: { nodes: [] } }), "disconnected");
  assert.equal(controlCenterState({ graph: { nodes: [{ id: "trigger" }] } }), "ready");
  assert.equal(controlCenterState({ graph: { nodes: [{ id: "trigger" }] }, workflowActive: true }), "running");
  assert.equal(controlCenterState({ graph: { nodes: [{ id: "trigger" }] }, workflowError: true }), "error");
  assert.equal(controlCenterState({ graph: { nodes: [{ id: "trigger" }] }, healthStates: ["disconnected"] }), "disconnected");
  assert.equal(controlCenterState({ graph: { nodes: [{ id: "trigger" }] }, healthStates: ["error"] }), "error");
});

test("dashboard facts use actual graph, credentials, history, and Search output only", () => {
  const graph = { nodes: [{ id: "s", name: "Search Files and Folders", provider: "Google Drive", output: [{ id: "f1", name: "one.mp4" }] },
    { id: "f", name: "Facebook Graph API" }], connections: [{ source: "s", target: "f" }], branches: [{ nodes: [] }], triggers: [] };
  const facts = dashboardFacts({ graph, googleCredentials: [{ id: "g1" }], facebookCredentials: [{ id: "f1", name: "Page" }], executions: [{ id: "e1" }], lastExecutionAt: "2026-08-22T00:00:00.000Z" });
  assert.equal(facts.queuedItems[0].name, "one.mp4"); assert.equal(facts.nodeCount, 2); assert.equal(facts.connectionCount, 1); assert.equal(facts.branchCount, 1);
  assert.equal(facts.googleCredentials.length, 1); assert.equal(facts.facebookCredentials.length, 1); assert.equal(facts.lastExecution.id, "e1");
});
