import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("pipeline renders every real workflow, including third and fourth entries", () => {
  assert.match(component, /workflows\.map\(\(workflow\)/);
  assert.match(component, /displayed\.map\(\(workflow\)/);
  assert.doesNotMatch(component, /workflows\.slice|displayed\.slice/);
  assert.match(styles, /pipeline-workflow-stack[^}]*overflow-y: auto/);
  assert.match(dashboard, /My Workflow/);
});

test("workflow cards show live metadata and open the selected workflow", () => {
  assert.match(component, /workflow\.name/);
  assert.match(component, /workflow\.updatedAt/);
  assert.match(component, /onOpen\?\.\(workflow\.id\)/);
  for (const state of ["running", "ready", "error", "offline"]) assert.match(component, new RegExp(`workflow-${state}|${state}:`));
});

test("Add Workflow opens the existing permission-protected Workflow Manager", () => {
  assert.match(component, /className="pipeline-add-workflow"[^>]*onClick=\{onAddWorkflow\}/);
  assert.match(component, /onAddWorkflow = onOpenWorkflow/);
  assert.match(app, /if \(!workflowId\) \{ if \(can\("edit_workflow"\)\) setShowWorkflowManager\(true\); return; \}/);
  assert.match(app, /showWorkflowManager && <WorkflowManager/);
});

test("running, ready, error, and disconnected states derive from real runtime health", () => {
  assert.match(component, /workflowError \? "error" : workflowActive \? "running"/);
  assert.match(component, /healthStates\.includes\("error"\)/);
  assert.match(component, /!graph\.nodes\.length \|\| healthStates\.includes\("disconnected"\)/);
  assert.match(component, /className="pipeline-state-indicator"[^>]*>\{state === "disconnected" \? "READY" : state\.toUpperCase\(\)\}/);
  assert.match(styles, /pipeline-running \.pipeline-state-indicator[^}]*#9ff4df/);
});

test("clean composition routes workflows through J Route directly to Strong Engine", () => {
  assert.match(component, /Central J Route core/);
  assert.match(component, />J \/ ROUTE</);
  assert.match(component, />Command Router</);
  assert.match(component, /data-route-state=\{state\}/);
  assert.match(component, /data-engine-state=\{state\}/);
  assert.match(component, /className="engine-route"/);
  assert.doesNotMatch(component, /WorkflowNodes|WORKFLOW NODES|pipeline-destination-bay|routedNodes/);
  assert.doesNotMatch(component, /CONFIGURE|BRANCH|Chat|Voice|WhatsApp|TikTok|Tools|Memory/);
  assert.match(styles, /grid-template-columns: minmax\(220px, 270px\) 210px 220px/);
});

test("footer counts and state-aware vector animation remain data-driven and accessible", () => {
  assert.match(component, /\{displayed\.length\} workflows \/ \{graph\.nodes\.length\} active nodes \/ \{graph\.connections\.length\} connections/);
  assert.match(component, /workflowActive \? "ACTIVE DATA FLOW"/);
  assert.match(component, /workflowError \? "ATTENTION REQUIRED"/);
  assert.match(component, /className="wire-tracer"/);
  assert.match(component, /className="route-tracer module-engine-tracer"/);
  assert.match(styles, /pipeline-data-tracer 2\.8s ease-in-out infinite/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  assert.doesNotMatch(component, /canvas|WebGL|requestAnimationFrame/);
});
