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

test("Strong Engine is a lightweight CSS and SVG 3D orb at far right", () => {
  assert.match(component, /Strong Engine 3D activity orb/); assert.match(component, /className="engine-shell"/); assert.match(component, /<StrongEngine state=\{state\}/); assert.match(styles, /\.pipeline-live-stage \{[^}]*grid-template-columns: minmax\(135px, 190px\) minmax\(115px, 160px\) minmax\(145px, 190px\)/); assert.match(styles, /perspective\(420px\) rotateX\(9deg\)/);
  assert.match(component, /className="engine-core"/); assert.match(component, /className="engine-meridian meridian-one"/); assert.doesNotMatch(component, /<svg viewBox="0 0 160 160"/);
  assert.doesNotMatch(component, /WebGL|setInterval|requestAnimationFrame/);
});
