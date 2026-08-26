import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./WorkflowManager.jsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("Workflow Manager contains loading, empty, safe error, and summary-only list states", () => {
  assert.match(source, /Loading workflows…/); assert.match(source, /No saved workflows yet\./); assert.match(source, /Try again/); assert.match(source, /workflow-manager-list/); assert.match(source, /workflow\.name/); assert.match(source, /workflow\.status/); assert.match(source, /workflow\.updatedAt/); assert.doesNotMatch(source, /workflow\.nodes|workflow\.connections|credentialId|accessToken|refreshToken/);
});

test("Workflow Manager creates DRAFT workflows and keeps manager selection separate from editor state", () => {
  assert.match(source, /\+ New Workflow/); assert.match(source, /Create DRAFT/); assert.match(source, /onSelectWorkflow\(created\.id\)/); assert.match(source, /onSelectWorkflow\(workflow\.id\)/); assert.match(source, /This selection does not replace the current editor\./);
  assert.match(appSource, /showWorkflowManager/); assert.match(appSource, /selectedManagedWorkflowId/); assert.match(appSource, /<WorkflowManager/); assert.doesNotMatch(appSource.slice(appSource.indexOf("<WorkflowManager"), appSource.indexOf("{workflowTab === \"EDITOR\"")), /setCanvasNodes|setConnections/);
});

test("Workflow Manager supports DRAFT, ACTIVE, and PAUSED presentation with explicit schedule controls", () => {
  assert.match(source, /workflow-manager-status/); assert.match(appSource, /workflow-manager-entry/); assert.match(source, /Activate Schedule/); assert.match(source, /Pause Schedule/); assert.match(source, /updateWorkflow\(fetch, apiBaseUrl, workflow\.id/);
});

test("workflow list owns the flexible independently scrollable panel area", () => {
  assert.match(source, /className="workflow-manager-body"/); assert.match(cssSource, /\.workflow-manager-body\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s); assert.match(cssSource, /\.workflow-manager-selection\s*\{[^}]*flex:\s*0 0 auto/s);
});

test("selected actions remain compact for local and server workflows", () => {
  assert.match(source, /workflow-manager-selection-summary/); assert.match(source, /workflow-manager-selection-actions/); assert.match(source, /Open Local Workflow/); assert.match(source, /Open Workflow/); assert.match(cssSource, /\.workflow-manager-selection\s*\{[^}]*padding:\s*10px 16px 11px/s); assert.match(cssSource, /\.workflow-manager-selection-actions button\s*\{[^}]*min-height:\s*29px/s);
});

test("many workflow rows remain mapped inside the scroll area without displacing actions", () => {
  const bodyStart = source.indexOf('className="workflow-manager-body"'); const bodyEnd = source.indexOf("</div>\n      {selectedLocal", bodyStart); assert.ok(bodyStart >= 0 && bodyEnd > bodyStart); const body = source.slice(bodyStart, bodyEnd); assert.match(body, /workflows\.map\(\(workflow\)/); assert.doesNotMatch(body, /workflow-manager-selection/); assert.match(cssSource, /\.workflow-manager-row\s*\{[^}]*min-height:\s*72px[^}]*max-height:\s*104px/s); assert.match(cssSource, /@media \(max-width: 480px\)/); assert.match(cssSource, /\.workflow-manager-selection-actions \{ display: grid; grid-template-columns: 1fr; \}/);
});
