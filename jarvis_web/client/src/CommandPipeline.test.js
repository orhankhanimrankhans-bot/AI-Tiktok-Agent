import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("pipeline renders dynamic workflows around a clean J Route core", () => {
  assert.match(component, /workflows\.map/); assert.match(component, /displayed\.map/); assert.match(component, /workflow\.name/); assert.match(component, /onOpen\?\.\(workflow\.id\)/);
  assert.match(component, /Central J Route core/); assert.match(component, /<span>J<\/span><small>ROUTE<\/small>/); assert.doesNotMatch(component, /BRANCH|pipeline-branch-label|pipeline-core-axis/);
});

test("workflow status comes from current activity and real execution history", () => {
  assert.match(component, /workflow\.id === activeWorkflowId && workflowActive/); assert.match(component, /workflow\.id === activeWorkflowId && workflowError/); assert.match(component, /execution\?\.status === "error"/);
  for (const state of ["running", "ready", "error", "offline"]) assert.match(component, new RegExp(`wire-\\$\\{workflow\\.dashboardStatus\\}|workflow-${state}|${state}:`));
});

test("SVG wires animate energy independently by workflow state", () => {
  assert.match(component, /className="workflow-wire-layer"/); assert.match(component, /className="wire-energy"/); assert.match(styles, /\.wire-running \.wire-energy[^}]*animation-duration: 1s/); assert.match(styles, /\.wire-ready \.wire-energy[^}]*animation-duration: 4s/); assert.match(styles, /\.wire-error \.wire-energy[^}]*animation-duration: 2s/); assert.match(styles, /\.wire-offline \.wire-energy[^}]*animation: none/);
});

test("neon routing deck keeps real workflow sources and neutral Jarvis destination modules", () => {
  assert.match(component, /WORKFLOW SOURCES/); assert.match(component, /displayed\.map/); assert.match(component, /DESTINATIONS/); assert.match(component, /destinationModules\.map/);
  for (const name of ["Chat", "Voice", "WhatsApp", "TikTok", "Tools", "Memory"]) assert.match(component, new RegExp(`"${name}"`));
  assert.match(component, /<small>MODULE<\/small>/); assert.doesNotMatch(component, /CONNECTED|ONLINE|SUCCESS/);
  assert.match(styles, /Neon Command Pipeline routing deck/); assert.match(styles, /background-size: 22px 22px/); assert.match(styles, /vector-effect: non-scaling-stroke/);
  assert.match(component, /className="module-engine-wire"/); assert.match(styles, /grid-template-columns: 200px 150px 175px 170px/); assert.match(styles, /min-height: 54px; height: 54px/);
});

test("Strong Engine restores the original lightweight vector atom orb at far right", () => {
  assert.match(component, /Strong Engine activity orb/); assert.match(component, /<svg viewBox="0 0 160 160"/); assert.match(component, /<ellipse cx="80" cy="80" rx="58" ry="22"/); assert.match(component, /<circle cx="80" cy="80" r="12"/); assert.match(component, /<DestinationModules \/><StrongEngine state=\{state\}/); assert.match(styles, /\.jarvis-control-center \.pipeline-live-stage \{[^}]*grid-template-columns: 220px 170px 180px 190px/);
  assert.match(styles, /Original Strong Engine atom orb restored/); assert.match(styles, /\.strong-engine-orb svg \{[^}]*display: block/); assert.doesNotMatch(component, /engine-shell|engine-core|engine-meridian/);
  assert.doesNotMatch(component, /WebGL|setInterval|requestAnimationFrame/);
});
