import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./WorkflowManager.jsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("Workflow Manager contains loading, empty, safe error, and summary-only list states", () => {
  assert.match(source, /Loading workflows…/); assert.match(source, /No saved workflows yet\./); assert.match(source, /Try again/); assert.match(source, /workflow-manager-list/); assert.match(source, /workflow\.name/); assert.match(source, /workflow\.status/); assert.match(source, /workflow\.updatedAt/); assert.doesNotMatch(source, /workflow\.nodes|workflow\.connections|credentialId|accessToken|refreshToken/);
});

test("Workflow Manager creates DRAFT workflows and keeps manager selection separate from editor state", () => {
  assert.match(source, /\+ New Workflow/); assert.match(source, /Create DRAFT/); assert.match(source, /onSelectWorkflow\(created\.id\)/); assert.match(source, /onSelectWorkflow\(workflow\.id\)/); assert.match(source, /This selection does not replace the current editor\./);
  assert.match(appSource, /showWorkflowManager/); assert.match(appSource, /selectedManagedWorkflowId/); assert.match(appSource, /<WorkflowManager/); assert.doesNotMatch(appSource.slice(appSource.indexOf("<WorkflowManager"), appSource.indexOf("{workflowTab === \"EDITOR\"")), /setCanvasNodes|setConnections/);
});

test("Workflow Manager supports DRAFT, ACTIVE, and PAUSED presentation without status controls", () => {
  assert.match(source, /workflow-manager-status/); assert.match(appSource, /workflow-manager-entry/); const managerWindow = source.slice(source.indexOf("workflow-manager-list"), source.indexOf("workflow-manager-selection")); assert.doesNotMatch(managerWindow, /PATCH|updateWorkflow|setStatus/);
});
