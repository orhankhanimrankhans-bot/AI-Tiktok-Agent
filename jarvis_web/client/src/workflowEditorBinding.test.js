import assert from "node:assert/strict";
import test from "node:test";
import { definitionFingerprint, editorDefinition, validateStoredWorkflow } from "./workflowEditorBinding.js";

test("stored workflow validation accepts a complete wf definition and removes transient execution fields", () => {
  const workflow = validateStoredWorkflow({ id: "wf_abcdefgh", name: "Stored", status: "DRAFT", version: 2, updatedAt: "2026-08-24T10:00:00.000Z", nodes: [{ id: "node", x: 1, config: { credentialId: "gcred_fake" }, status: "success", input: { item: 1 }, output: { item: 1 }, error: null }], connections: [{ source: "node", target: "next" }] });
  assert.deepEqual(workflow.nodes, [{ id: "node", x: 1, config: { credentialId: "gcred_fake" } }]); assert.deepEqual(workflow.connections, [{ source: "node", target: "next" }]);
});

test("malformed stored workflows do not produce a canvas definition", () => {
  for (const value of [{}, { id: "local", name: "Bad", status: "DRAFT", version: 1, nodes: [], connections: [] }, { id: "wf_abcdefgh", name: "Bad", status: "RUNNING", version: 1, nodes: [], connections: [] }, { id: "wf_abcdefgh", name: "Bad", status: "DRAFT", version: 1, nodes: {}, connections: [] }]) assert.throws(() => validateStoredWorkflow(value), /Stored workflow could not be opened|Workflow definition/);
});

test("definition fingerprints ignore execution-only fields but retain editable node and connection changes", () => {
  const baseline = definitionFingerprint([{ id: "node", config: { value: "one" }, status: "idle", output: null }], [{ source: "node", target: "next" }]);
  assert.equal(baseline, definitionFingerprint([{ id: "node", config: { value: "one" }, status: "error", output: { unsafe: "runtime" }, error: "failed" }], [{ source: "node", target: "next" }]));
  assert.notEqual(baseline, definitionFingerprint([{ id: "node", config: { value: "two" } }], [{ source: "node", target: "next" }]));
  assert.deepEqual(editorDefinition([], []), { nodes: [], connections: [] });
});
