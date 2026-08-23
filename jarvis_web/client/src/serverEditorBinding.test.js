import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("./WorkflowManager.jsx", import.meta.url), "utf8");
const open = source.slice(source.indexOf("  const openServerWorkflow = async"), source.indexOf("  const runWorkflow = async"));
const save = source.slice(source.indexOf("  const saveWorkflow = async"), source.indexOf("  const openNextNodePicker"));
const run = source.slice(source.indexOf("  const runWorkflow = async"), source.indexOf("  const saveWorkflow = async"));

test("selection is passive until explicit Open Workflow fetches and validates the full stored definition", () => {
  assert.match(manager, /Open Workflow/); assert.match(open, /getWorkflow\(fetch, API_BASE_URL, workflowId\)/); assert.match(open, /validateStoredWorkflow/); assert.match(open, /setCanvasNodes\(definition\.nodes\)/); assert.match(open, /setConnections\(definition\.connections\)/); assert.match(open, /setEditorWorkflowSource\("server"\)/); assert.match(open, /setActiveServerWorkflow/);
});

test("malformed or missing workflow opens retain the canvas and report a safe error", () => {
  assert.match(open, /catch \{ setWorkflowNotice\(\{ status: "error", message: "Could not open the selected workflow\." \}\)/); assert.doesNotMatch(open.slice(open.indexOf("catch {")), /setCanvasNodes|setConnections/);
});

test("server saves patch only editable definitions and local saves remain localStorage-backed", () => {
  assert.match(save, /updateWorkflow\(fetch, API_BASE_URL, activeServerWorkflow\.id, definition\)/); assert.match(save, /const definition = editorDefinition\(canvasNodesRef\.current, connectionsRef\.current\)/); assert.doesNotMatch(save.slice(0, save.indexOf("return;")), /localStorage\.setItem|lastRunAt|nextRunAt/); assert.match(save.slice(save.indexOf("return;") + 1), /localStorage\.setItem/); assert.match(save, /setWorkflowManagerRefreshKey/);
});

test("server-bound and local runs retain the existing endpoint and choose the correct workflow ID", () => {
  assert.match(run, /editorWorkflowSource === "server" \? activeServerWorkflow\?\.id : "local-workflow"/); assert.match(run, /\/api\/workflow-executions\/run/); assert.match(run, /workflowId, nodes: serverNodes, connections: serverConnections, triggerMode: "workflow"/); assert.doesNotMatch(run, /setInterval|setTimeout|scheduler|workflowExecutor/);
});

test("dirty guard keeps selection separate and requires explicit discard before another open", () => {
  assert.match(source, /selectedManagedWorkflowId/); assert.match(source, /activeServerWorkflow/); assert.match(source, /hasUnsavedEditorChanges/); assert.match(source, /setPendingOpenWorkflowId\(workflowId\)/); assert.match(manager, /Discard and Open/); assert.match(manager, /onCancelOpen/); assert.match(source, /definitionFingerprint/);
});
