import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSavedWorkflow, workflowForStorage } from "./workflowStorage.js";

test("older saved workflows remain loadable without losing nodes or connections", () => {
  const old = { nodes: [{ id: "a", config: { credentialId: "gcred_example" }, x: 1, y: 2 }], connections: [{ source: "a", target: "b" }] };
  const loaded = normalizeSavedWorkflow(old);
  assert.equal(loaded.version, 1);
  assert.deepEqual(loaded.nodes, old.nodes);
  assert.deepEqual(loaded.connections, old.connections);
});
test("Facebook secrets cannot enter workflow storage", () => {
  const saved = workflowForStorage({ version: 2, nodes: [{ id: "fb", provider: "Facebook", config: { headers: [{ name: "Authorization", value: "Bearer secret" }] } }], connections: [] });
  assert.doesNotMatch(JSON.stringify(saved), /Authorization|Bearer secret/);
});
