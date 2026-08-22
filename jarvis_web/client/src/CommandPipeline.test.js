import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
const pipelineLogic = readFileSync(new URL("./dashboardPipeline.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("Command Pipeline renders the actual graph rather than demo cards", () => {
  assert.match(component, /graph\.branches\.map/); assert.match(component, /branch\.nodes\.map/); assert.match(component, /node\.name/);
  assert.match(component, /data-node-id=\{node\.id\}/); assert.match(component, /Central routing core/); assert.match(component, /STRONG ENGINE/);
  assert.doesNotMatch(component, /PDF, DOCX, TXT|URL \/ LINKS|VIDEO CONTENT|DATA FILES|const SOURCES|const DESTINATIONS/);
});

test("pipeline state follows real workflow activity and never starts execution", () => {
  assert.match(component, /workflowActive \? "running" : workflowError \? "error" : "idle"/);
  assert.match(app, /<CommandPipeline graph=\{dashboardGraph\} workflowActive=\{isWorkflowRunning\}/);
  assert.match(app, /workflowError=\{!isWorkflowRunning && workflowNotice\?\.status === "error"\}/);
  assert.match(styles, /\.pipeline-running \.pipeline-graph-lines path[^}]*animation:/);
  assert.match(styles, /\.pipeline-running \.engine-ring-one[^}]*animation:/);
  assert.doesNotMatch(styles, /\.pipeline-idle[^}]*animation:/);
  assert.doesNotMatch(component, /setInterval|setTimeout|requestAnimationFrame|onRunWorkflow|runWorkflow\(/);
});

test("dashboard initial null execution state and empty history remain render-safe", () => {
  assert.match(app, /const \[workflowNotice, setWorkflowNotice\] = useState\(null\)/);
  assert.match(app, /const \[lastExecutionAt, setLastExecutionAt\] = useState\(null\)/);
  assert.match(app, /const \[selectedExecution, setSelectedExecution\] = useState\(null\)/);
  assert.match(app, /const \[executions, setExecutions\] = useState\(\[\]\)/);
  assert.doesNotMatch(app, /workflowError=\{!isWorkflowRunning && workflowNotice\.status/);
  assert.match(component, /workflowActive = false, workflowError = false/);
  assert.match(pipelineLogic, /workflowError \? "Last run error" : "Waiting"/);
});

test("backend fetch failure cannot reintroduce a null workflow notice status access", () => {
  assert.match(app, /fetch\(`\$\{API_BASE_URL\}\/api\/health`/);
  assert.match(app, /\.catch\(\(\) => \{ if \(!cancelled\) setOpenAIConfigured\(false\); \}\)/);
  assert.match(app, /workflowNotice\?\.status/);
  assert.doesNotMatch(app, /workflowError=\{!isWorkflowRunning && workflowNotice\.status/);
});

test("pipeline uses real counts, health, Appearance Studio variables, and responsive reflow", () => {
  assert.match(app, /dashboardGraph\.nodes\.length/); assert.match(app, /dashboardGraph\.connections\.length/); assert.match(app, /dashboardGraph\.branches\.length/);
  assert.match(component, /nodeConnectionHealth\(node, healthContext\)/); assert.match(component, /health-\$\{health\}/);
  for (const variable of ["--jarvis-panel-background", "--jarvis-panel-border", "--jarvis-main-text", "--jarvis-muted-text", "--jarvis-accent"]) assert.ok(styles.includes(variable));
  assert.match(styles, /@media \(max-width: 1380px\)[\s\S]*actual-workflow-pipeline/); assert.match(styles, /@media \(max-width: 780px\)[\s\S]*pipeline-graph-stage/);
});
