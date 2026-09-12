import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
const office = readFileSync(new URL("./OfficeSimulation.jsx", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("dashboard renders a coded technical pipeline board", () => {
  assert.match(dashboard, /className="technical-pipeline-board compact-technical-board balanced-technical-board"/); assert.match(dashboard, /<h1>COREX CORE<\/h1>/); assert.match(dashboard, /className="technical-isk-core"/); assert.match(dashboard, /<span>ISK<\/span>/);
  for (const label of ["INPUT", "TOOLS", "MEMORY SERVICES", "COMMAND PIPELINE"]) assert.match(dashboard, new RegExp(label)); assert.doesNotMatch(dashboard, /RESPONSE<br \/>STREAM/);
  for (const label of ["Web App", "Mobile App", "API / SDK", "Enterprise Systems", "Search", "Code Executor", "Data Analyzer", "Integrations"]) assert.match(dashboard, new RegExp(label));
  assert.match(styles, /\.technical-pipeline-board/); assert.match(styles, /\.compact-pipeline-grid/); assert.match(styles, /\.compact-flow-arrow/); assert.match(styles, /\.data-cylinder/);
});

test("saved workflows and real execution inputs feed the technical dashboard", () => {
  assert.match(dashboard, /listWorkflows\(fetch, apiBaseUrl\)/); assert.match(dashboard, /savedWorkflows\.filter/); assert.match(dashboard, /dashboardFacts\(\{ graph, googleCredentials: healthContext\.googleCredentials, facebookCredentials: healthContext\.facebookCredentials, executions/);
  assert.match(dashboard, /workflowItems = workflows\.slice\(0, 4\)/); assert.match(dashboard, /onOpenWorkflow\?\.\(workflow\.id\)/); assert.match(dashboard, /facts\.workflowCount\} workflows \/ \{facts\.nodeCount\} active nodes \/ \{facts\.connectionCount\} connections/);
  assert.match(app, /apiBaseUrl=\{API_BASE_URL\}/); assert.match(app, /activeWorkflowId=\{editorWorkflowSource/); assert.match(app, /requestOpenServerWorkflow\(workflowId\)/);
});

test("conversation routes tasks to agents and reports unavailable connectors honestly", () => {
  for (const name of ["NOVA", "PULSE", "ORBIT", "ATLAS", "LINK"]) assert.match(`${dashboard}\n${office}`, new RegExp(name));
  for (const member of ["IMRAN", "SULAIMAN", "KAZIM"]) assert.match(office, new RegExp(member));
  assert.match(dashboard, /setAgentStates/); assert.match(dashboard, /taskStatus = "DONE"/);
  assert.doesNotMatch(dashboard, /setTimeout|setInterval/);
  assert.match(dashboard, /WhatsApp is NOT CONNECTED/); assert.match(dashboard, /analytics are NOT CONNECTED/); assert.match(dashboard, /No metric was fabricated/);
  assert.match(dashboard, /className="conversation-mic" disabled/); assert.doesNotMatch(dashboard, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(dashboard, /handoffIntent\(text\)/); assert.match(dashboard, /setOfficeHandoff/); assert.match(dashboard, /No external action was claimed/);
});

test("technical dashboard keeps the office below coded pipeline modules", () => {
  assert.match(dashboard, /<OfficeSimulation/); assert.match(office, /jarvis-ai-office\.webp/);
  assert.doesNotMatch(dashboard, /compact-plane-labels/); assert.doesNotMatch(dashboard, /CONTROL PLANE/); assert.match(dashboard, /input-grid/); assert.match(dashboard, /tool-grid/); assert.match(dashboard, /memory-grid/);
  assert.doesNotMatch(dashboard, /privacy-shield/); assert.doesNotMatch(dashboard, /technical-flow-lines/); assert.match(dashboard, /compact-flow-arrow/); assert.match(dashboard, /technical-workflow-strip/);
  assert.match(dashboard, /facts\.facebookCredentials\.length \? "Facebook connected" : "Limited"/); assert.match(dashboard, /Amazon is not connected/);
  assert.match(styles, /\.compact-pipeline-grid/); assert.match(styles, /\.compact-flow-arrow/); assert.match(styles, /\.technical-workflow-strip/); assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*compact-pipeline-grid/);
});
test("responsive and reduced-motion safeguards cover the headquarters", () => {
  assert.match(styles, /@media \(max-width: 1450px\)[\s\S]*pipeline-live-stage/); assert.match(styles, /@media \(max-width: 1080px\)/); assert.match(styles, /@media \(max-width: 760px\)[\s\S]*workflow-wire-layer/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*workflow-wire-layer \.wire-energy/);
});
