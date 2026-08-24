import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
const office = readFileSync(new URL("./OfficeSimulation.jsx", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("dashboard keeps a compact Jarvis Core and equal compact controls", () => {
  assert.match(dashboard, /<h1>JARVIS CORE<\/h1>/); assert.match(dashboard, /className="isk-core-button"/); assert.match(dashboard, /<span>ISK<\/span>/);
  for (const label of ["UPLOAD QUEUE", "WORKFLOW CONTROL", "FACEBOOK", "YOUTUBE", "STORAGE & MEDIA"]) assert.match(dashboard, new RegExp(label));
  assert.match(styles, /\.jarvis-core-header \{ min-height: 64px/); assert.match(styles, /\.operational-controls \{ grid-template-rows: repeat\(5, 48px\)/);
});

test("saved workflows and real execution inputs feed the live pipeline", () => {
  assert.match(dashboard, /listWorkflows\(fetch, apiBaseUrl\)/); assert.match(dashboard, /savedWorkflows\.filter/); assert.match(dashboard, /executions=\{executions\}/);
  assert.match(app, /apiBaseUrl=\{API_BASE_URL\}/); assert.match(app, /activeWorkflowId=\{editorWorkflowSource/); assert.match(app, /requestOpenServerWorkflow\(workflowId\)/);
  assert.match(pipeline, /executions\.find\(\(item\) => item\.workflowId === workflow\.id\)/);
});

test("conversation routes tasks to agents and reports unavailable connectors honestly", () => {
  for (const name of ["NOVA", "PULSE", "ORBIT", "ATLAS", "LINK"]) assert.match(`${dashboard}\n${office}`, new RegExp(name));
  for (const member of ["IMRAN", "SULAIMAN", "KAZIM"]) assert.match(office, new RegExp(member));
  assert.match(dashboard, /setAgentStates/); assert.match(dashboard, /workflowActive \? "WORKING"/); assert.match(dashboard, /taskStatus = "DONE"/);
  assert.doesNotMatch(dashboard, /setTimeout|setInterval/);
  assert.match(dashboard, /WhatsApp is NOT CONNECTED/); assert.match(dashboard, /analytics are NOT CONNECTED/); assert.match(dashboard, /No metric was fabricated/);
  assert.match(dashboard, /className="conversation-mic" disabled/); assert.doesNotMatch(dashboard, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(dashboard, /handoffIntent\(text\)/); assert.match(dashboard, /setOfficeHandoff/); assert.match(dashboard, /No external action was claimed/);
});

test("AI Office is configuration-driven and exposes rooms, agents, tasks, and states", () => {
  assert.match(office, /const AGENTS = \[/); assert.match(office, /const MEMBERS = \[/); assert.match(office, /MAIN ACCESS ROOM/); assert.match(office, /COORDINATOR ROOM/); assert.match(office, /OfficeHotspot/); assert.match(office, /RoomHighlight/);
  assert.match(office, /jarvis-ai-office\.webp/); assert.match(office, /--office-x/); assert.match(office, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(office, /MovingOfficeAgent/); assert.match(office, /findOfficeRoute/); assert.match(office, /HANDING_OVER/); assert.match(office, /RETURNING/);
  assert.match(office, /WALKING_TO_DESTINATION/); assert.match(office, /ARRIVED/); assert.match(office, /requestAnimationFrame/); assert.match(office, /interpolateRoutePosition/);
  assert.match(office, /OfficeEmployee/); assert.match(office, /STANDING_UP/); assert.match(office, /RETURNED/); assert.match(office, /DELIVERING/); assert.match(styles, /\.office-character\.pose-seated/);
  for (const employee of ["nova", "pulse", "orbit", "atlas", "link", "imran", "sulaiman", "kazim"]) assert.match(office, new RegExp(`${employee}-poses\\.webp`));
  assert.match(styles, /employee-walk-frames/); assert.match(styles, /background-size: 300% 200%/); assert.match(styles, /width: clamp\(96px, 9\.2vw, 148px\)/); assert.match(styles, /animation-duration: \.44s/); assert.match(styles, /\.employee-identity/); assert.doesNotMatch(office, /ai-head|ai-torso|ai-visor/);
  assert.match(office, /AMAZON OPERATIONS/); assert.match(office, /PlatformSign/); assert.match(office, /platformStates\.facebook/);
  for (const platform of ["amazon", "facebook", "tiktok", "youtube"]) assert.match(styles, new RegExp(`\\.platform-${platform}`));
  assert.match(styles, /Physical platform branding is baked into the office wall/); assert.match(styles, /\.platform-a11y/); assert.doesNotMatch(office, /social-operations-label|className="platform-mark"/);
  assert.match(dashboard, /facts\.facebookCredentials\.length \? "CONNECTED" : "NOT CONNECTED"/); assert.match(dashboard, /Amazon is not connected/);
  assert.match(styles, /\.office-scene \{/); assert.match(styles, /\.office-hotspot\.state-working/); assert.match(styles, /\.office-live-route\.route-visible/);
  assert.match(office, /office-detail-popover/); assert.match(office, /office-live-route/);
});

test("responsive and reduced-motion safeguards cover the headquarters", () => {
  assert.match(styles, /@media \(max-width: 1450px\)[\s\S]*pipeline-live-stage/); assert.match(styles, /@media \(max-width: 1080px\)/); assert.match(styles, /@media \(max-width: 760px\)[\s\S]*workflow-wire-layer/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*workflow-wire-layer \.wire-energy/);
});
