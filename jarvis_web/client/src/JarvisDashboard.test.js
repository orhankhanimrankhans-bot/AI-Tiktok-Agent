import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
const office = readFileSync(new URL("./OfficeSimulation.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

 test("dashboard renders the requested three-card Corex summary", () => {
  assert.match(dashboard, /className="corex-summary-dashboard"/);
  assert.match(dashboard, /<h1>COREX CORE<\/h1>/);
  assert.match(dashboard, /className="corex-summary-orb"/);
  assert.match(dashboard, /<span>ISK<\/span>/);
  for (const label of ["FACEBOOK PAGES", "ACTIVE WORKFLOWS", "INACTIVE WORKFLOWS", "COREX LIVE ENGINE", "WORKFLOWS", "FACEBOOK", "QUEUE"]) assert.match(dashboard, new RegExp(label));
  for (const removed of ["Active Nodes", "Connections", "LIVE WORKFLOWS", "Command pipeline"]) assert.doesNotMatch(dashboard, new RegExp(removed));
  assert.doesNotMatch(dashboard, /technical-pipeline-board compact-technical-board balanced-technical-board/);
  assert.doesNotMatch(dashboard, /INPUT<br \/>CHANNELS/);
  assert.doesNotMatch(dashboard, /MEMORY SERVICES/);
  assert.match(styles, /\.corex-summary-dashboard/);
  assert.match(styles, /\.corex-summary-grid/);
  assert.match(styles, /\.corex-summary-card/);
  assert.match(styles, /\.corex-live-engine/);
  assert.match(dashboard, /onOpenFacebookPages/);
});

test("saved workflows and persisted Facebook control feed the dashboard", () => {
  assert.match(dashboard, /listWorkflows\(fetch, apiBaseUrl\)/);
  assert.match(dashboard, /getFacebookControl\(fetch, apiBaseUrl\)/);
  assert.match(dashboard, /savedWorkflows\.filter/);
  assert.match(dashboard, /dashboardFacts\(\{ graph, googleCredentials: healthContext\.googleCredentials, facebookCredentials: healthContext\.facebookCredentials, executions/);
  assert.match(dashboard, /onOpenWorkflow\?\.\(workflow\.id\)/);
  assert.match(dashboard, /\["FACEBOOK PAGES", String\(facebookPages\.length\)/);
  assert.match(dashboard, /\["ACTIVE WORKFLOWS", String\(activeWorkflows\.length\)/);
  assert.match(dashboard, /\["INACTIVE WORKFLOWS", String\(inactiveWorkflows\.length\)/);
  assert.match(app, /apiBaseUrl=\{API_BASE_URL\}/);
  assert.match(app, /activeWorkflowId=\{editorWorkflowSource/);
  assert.match(app, /requestOpenServerWorkflow\(workflowId\)/);
});


test("facebook pages card opens the custom performance page", () => {
  assert.match(dashboard, /function FacebookPagesDashboard/);
  assert.match(dashboard, /dashboardView === "facebookPages"/);
  assert.match(dashboard, /setDashboardView\("facebookPages"\)/);
  for (const label of ["Facebook Page Performance / Ranking", "Team Performance Graph", "Data connection required", "Not synced"]) assert.match(dashboard, new RegExp(label));
  assert.match(styles, /\.corex-facebook-performance/);
  assert.match(styles, /\.facebook-ranking-list/);
  assert.match(styles, /\.team-performance-row/);
  assert.match(styles, /\.facebook-empty-state/);
});

test("conversation routes tasks to agents and reports unavailable connectors honestly", () => {
  for (const name of ["NOVA", "PULSE", "ORBIT", "ATLAS", "LINK"]) assert.match(`${dashboard}\n${office}`, new RegExp(name));
  for (const member of ["IMRAN", "SULAIMAN", "KAZIM"]) assert.match(office, new RegExp(member));
  assert.match(dashboard, /setAgentStates/);
  assert.match(dashboard, /taskStatus = "DONE"/);
  assert.doesNotMatch(dashboard, /setTimeout|setInterval/);
  assert.match(dashboard, /WhatsApp is NOT CONNECTED/);
  assert.match(dashboard, /analytics are NOT CONNECTED/);
  assert.match(dashboard, /No metric was fabricated/);
  assert.match(dashboard, /className="conversation-mic" disabled/);
  assert.doesNotMatch(dashboard, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(dashboard, /handoffIntent\(text\)/);
  assert.match(dashboard, /setOfficeHandoff/);
  assert.match(dashboard, /No external action was claimed/);
});

test("technical dashboard keeps the office below the clean summary", () => {
  assert.match(dashboard, /<OfficeSimulation/);
  assert.match(office, /jarvis-ai-office\.webp/);
  assert.doesNotMatch(dashboard, /compact-plane-labels/);
  assert.doesNotMatch(dashboard, /CONTROL PLANE/);
  assert.doesNotMatch(dashboard, /input-grid/);
  assert.doesNotMatch(dashboard, /tool-grid/);
  assert.doesNotMatch(dashboard, /memory-grid/);
  assert.doesNotMatch(dashboard, /privacy-shield/);
  assert.doesNotMatch(dashboard, /technical-flow-lines/);
  assert.doesNotMatch(dashboard, /compact-flow-arrow/);
  assert.match(dashboard, /COREX LIVE ENGINE/);
  assert.match(dashboard, /facts\.facebookCredentials\.length \? "Credentials ready" : "Not configured"/);
  assert.match(styles, /\.corex-summary-dashboard/);
  assert.match(styles, /\.corex-live-engine/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*corex-summary-grid/);
});

test("responsive and reduced-motion safeguards cover the headquarters", () => {
  assert.match(styles, /@media \(max-width: 1450px\)[\s\S]*pipeline-live-stage/);
  assert.match(styles, /@media \(max-width: 1080px\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*workflow-wire-layer/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*workflow-wire-layer \.wire-energy/);
});