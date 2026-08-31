import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("./WorkflowManager.jsx", import.meta.url), "utf8");
const openLocal = source.slice(source.indexOf("  const openLocalWorkflow = () =>"), source.indexOf("  const requestOpenLocalWorkflow = () =>"));
const requestLocal = source.slice(source.indexOf("  const requestOpenLocalWorkflow = () =>"), source.indexOf("  const runWorkflow = async () =>"));
const run = source.slice(source.indexOf("  const runWorkflow = async () =>"), source.indexOf("  const saveWorkflow = async () =>"));
const save = source.slice(source.indexOf("  const saveWorkflow = async () =>"), source.indexOf("  const openNextNodePicker"));

test("Workflow Manager lists persisted records only and New Workflow starts an unlinked local draft", () => {
  assert.doesNotMatch(manager, /Local browser workflow|Open Local Workflow|onSelectLocalWorkflow/);
  assert.match(manager, /onClick=\{startNew\}/);
  assert.match(source, /const startNewWorkflow = async \(\) =>/);
  assert.match(source, /setEditorWorkflowSource\("local"\)/);
  assert.match(source, /localStorage\.removeItem\(WORKFLOW_STORAGE_KEY\)/);
});

test("opening Local Workflow restores the existing local storage definition and clears only editor binding", () => {
  assert.match(source, /function loadStoredLocalWorkflow\(\)/); assert.match(source, /normalizeSavedWorkflow\(parsedWorkflow\)/); assert.match(source, /workflowForStorage\(parsedWorkflow\)/);
  assert.match(openLocal, /setCanvasNodes\(definition\.nodes\)/); assert.match(openLocal, /setConnections\(definition\.connections\)/); assert.match(openLocal, /setEditorWorkflowSource\("local"\)/); assert.match(openLocal, /setActiveServerWorkflow\(null\)/); assert.doesNotMatch(openLocal, /getWorkflow|updateWorkflow|deleteWorkflow|fetch\(/);
});

test("legacy local return remains guarded without creating a manager row", () => {
  assert.match(requestLocal, /hasUnsavedEditorChanges\(\)/); assert.match(requestLocal, /setPendingOpenWorkflowId\(LOCAL_WORKFLOW_MANAGER_ID\)/); assert.doesNotMatch(manager, /onDiscardAndOpenLocal/); assert.match(openLocal, /setPendingOpenWorkflowId\(null\)/);
});

test("returning local preserves the existing local Save and local-workflow Run paths without automation", () => {
  assert.match(save, /localStorage\.setItem\(\s*WORKFLOW_STORAGE_KEY/); assert.match(run, /editorWorkflowSource === "server" \? activeServerWorkflow\?\.id : "local-workflow"/); assert.doesNotMatch(requestLocal, /setInterval|setTimeout|scheduler|workflowExecutor/);
});
