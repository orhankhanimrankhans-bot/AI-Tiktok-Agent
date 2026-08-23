import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const runWorkflow = source.slice(source.indexOf("  const runWorkflow = async () =>"), source.indexOf("  const saveWorkflow = async () =>"));

test("manual Run Workflow posts one sanitized workflow definition to the server executor", () => {
  assert.match(runWorkflow, /\/api\/workflow-executions\/run/);
  assert.match(runWorkflow, /method: "POST", credentials: "include"/);
  assert.match(runWorkflow, /const workflowId = editorWorkflowSource === "server" \? activeServerWorkflow\?\.id : "local-workflow"/);
  assert.match(runWorkflow, /workflowId, nodes: serverNodes, connections: serverConnections, triggerMode: "workflow"/);
  assert.match(runWorkflow, /serverNodes = runNodes\.map\(\(\{ id, name, config \}\)/);
  assert.doesNotMatch(runWorkflow, /runLinearWorkflow|runFanOutWorkflow|executeNodeOperation/);
  assert.doesNotMatch(runWorkflow, /retry|setTimeout|setInterval/);
});

test("manual Run Workflow prevents duplicate clicks and maps only server summaries to node state", () => {
  assert.match(runWorkflow, /if \(isWorkflowRunning\) return/);
  assert.match(runWorkflow, /setIsWorkflowRunning\(true\)/);
  assert.match(runWorkflow, /const summaries = new Map\(result\.nodes/);
  assert.match(runWorkflow, /status: summary\.status/);
  assert.match(runWorkflow, /setIsWorkflowRunning\(false\)/);
  assert.match(runWorkflow, /nodes: result\.nodes/);
});
