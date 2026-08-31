import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./WorkflowManager.jsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("Workflow Manager contains loading, empty, safe error, and summary-only list states", () => {
  assert.match(source, /Loading workflows…/); assert.match(source, /No saved workflows yet\./); assert.match(source, /Try again/); assert.match(source, /workflow-manager-list/); assert.match(source, /workflow\.name/); assert.match(source, /workflow\.status/); assert.match(source, /workflow\.updatedAt/); assert.doesNotMatch(source, /workflow\.nodes|workflow\.connections|credentialId|accessToken|refreshToken/);
});

test("Workflow Manager starts a deliberate new local workflow and keeps manager selection separate from editor state", () => {
  assert.match(source, /\+ New Workflow/); assert.match(source, /onClick=\{startNew\}/); assert.match(source, /onSelectWorkflow\(workflow\.id\)/); assert.doesNotMatch(source, /createWorkflow\(/);
  assert.match(appSource, /showWorkflowManager/); assert.match(appSource, /selectedManagedWorkflowId/); assert.match(appSource, /<WorkflowManager/); assert.doesNotMatch(appSource.slice(appSource.indexOf("<WorkflowManager"), appSource.indexOf("{workflowTab === \"EDITOR\"")), /setCanvasNodes|setConnections/);
});

test("Workflow Manager supports DRAFT, ACTIVE, and PAUSED presentation with explicit schedule controls", () => {
  assert.match(source, /workflow-manager-status/); assert.match(appSource, /workflow-manager-entry/); assert.match(source, /Activate Schedule/); assert.match(source, /Pause Schedule/); assert.match(source, /updateWorkflow\(fetch, apiBaseUrl, workflow\.id/);
});

test("rename preserves the workflow ID and delete requires confirmation", () => {
  assert.match(source, /updateWorkflow\(fetch, apiBaseUrl, renaming\.id, \{ name: trimmedName \}\)/);
  assert.match(source, /Rename workflow/); assert.match(source, /Delete &quot;\{deleting\.name\}&quot;\?/);
  assert.match(source, /This permanently deletes this workflow and its saved configuration/);
  assert.match(source, /deleteWorkflow\(fetch, apiBaseUrl, deleting\.id\)/);
  assert.match(appSource, /onWorkflowUpdated=\{handleManagedWorkflowUpdated\}/);
  assert.match(appSource, /onWorkflowDeleted=\{handleManagedWorkflowDeleted\}/);
});

test("manager renders one row per persisted workflow and no synthetic local row", () => {
  assert.match(source, /workflows\.map\(\(workflow\)/);
  assert.doesNotMatch(source, /aria-label="Local workflow"|workflow-manager-local|Local browser workflow/);
});

test("workflow list owns the flexible independently scrollable panel area", () => {
  assert.match(source, /className="workflow-manager-body"/); assert.match(cssSource, /\.workflow-manager-body\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s); assert.match(cssSource, /\.workflow-manager-selection\s*\{[^}]*flex:\s*0 0 auto/s);
});

test("selected actions remain compact for local and server workflows", () => {
  assert.match(source, /workflow-manager-selection-summary/); assert.match(source, /workflow-manager-selection-actions/); assert.match(source, /Open Workflow/); assert.match(source, /Rename/); assert.match(source, /Delete Workflow/); assert.match(cssSource, /\.workflow-manager-selection\s*\{[^}]*padding:\s*10px 16px 11px/s); assert.match(cssSource, /\.workflow-manager-selection-actions button\s*\{[^}]*min-height:\s*29px/s);
});

test("many workflow rows remain mapped inside the scroll area without displacing actions", () => {
  const normalized = source.replace(/\r\n/g, "\n"); const bodyStart = normalized.indexOf('className="workflow-manager-body"'); const bodyEnd = normalized.indexOf("</div>\n      {selected", bodyStart); assert.ok(bodyStart >= 0 && bodyEnd > bodyStart); const body = normalized.slice(bodyStart, bodyEnd); assert.match(body, /workflows\.map\(\(workflow\)/); assert.doesNotMatch(body, /workflow-manager-selection/); assert.match(cssSource, /\.workflow-manager-row\s*\{[^}]*min-height:\s*72px[^}]*max-height:\s*104px/s); assert.match(cssSource, /@media \(max-width: 480px\)/); assert.match(cssSource, /\.workflow-manager-selection-actions \{ display: grid; grid-template-columns: 1fr; \}/);
});

test("only the workflow with a live execution receives the transient running treatment", () => {
  assert.match(appSource, /runningWorkflowId=\{isWorkflowRunning && editorWorkflowSource === "server" \? activeServerWorkflow\?\.id : null\}/);
  assert.match(source, /workflow\.id === runningWorkflowId \? " running" : ""/);
  assert.match(source, /workflow-manager-running-indicator/);
  assert.match(source, />RUNNING</);
  assert.doesNotMatch(source, /workflow\.status === "ACTIVE"[^\n]*running/);
});

test("running animation is presentation-only and preserves saved workflow statuses", () => {
  assert.match(source, /workflow-manager-status \$\{String\(workflow\.status \|\| "DRAFT"\)\.toLowerCase\(\)\}/);
  assert.match(source, /workflow\.status \|\| "DRAFT"/);
  assert.match(cssSource, /\.workflow-manager-row\.running\s*\{[^}]*border-color:\s*#42ed91[^}]*animation:\s*workflow-manager-running-pulse 2s/s);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.workflow-manager-row\.running, \.workflow-manager-running-indicator i\s*\{\s*animation:\s*none/s);
});

test("compact footer clears fixed session controls at desktop and laptop heights", () => {
  assert.match(cssSource, /\.workflow-manager\s*\{[^}]*height:\s*100%[^}]*padding-bottom:\s*max\(50px, env\(safe-area-inset-bottom\)\)/s);
  assert.match(cssSource, /\.workflow-manager-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(cssSource, /\.workflow-manager-selection\s*\{[^}]*flex:\s*0 0 auto[^}]*padding:\s*10px 16px 11px/s);
});
