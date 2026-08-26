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
  assert.match(component, /className="wire-tracer"/); assert.match(component, /className="route-tracer core-module-tracer"/); assert.match(component, /className="route-tracer module-engine-tracer"/); assert.match(styles, /stroke-dasharray: 16 76/); assert.match(styles, /pipeline-data-tracer 2\.8s ease-in-out infinite/); assert.match(styles, /\.wire-running \.wire-tracer[^}]*animation-duration: 2\.2s/);
});

test("neon routing deck shows only real workflows and active workflow nodes", () => {
  assert.match(component, />WORKFLOWS</); assert.match(component, /displayed\.map/); assert.match(component, /WORKFLOW NODES/); assert.match(component, /routedNodes/); assert.match(component, /nodes\.map/);
  for (const name of ["Chat", "Voice", "WhatsApp", "TikTok", "Tools", "Memory"]) assert.doesNotMatch(component, new RegExp(`"${name}"`));
  assert.match(component, /node\.provider \|\| node\.type \|\| "JARVIS"/); assert.doesNotMatch(component, /CONNECTED|ONLINE|SUCCESS/);
  assert.match(styles, /Neon Command Pipeline routing deck/); assert.match(styles, /background-size: 22px 22px/); assert.match(styles, /vector-effect: non-scaling-stroke/);
  assert.match(component, /className="module-engine-wire"/); assert.match(styles, /grid-template-columns: 200px 150px 175px 170px/); assert.match(styles, /min-height: 54px; height: 54px/);
  assert.match(styles, /pipeline-core-live 1\.8s/); assert.match(styles, /engine-nucleus-live 1\.8s/);
});

test("Strong Engine restores the original lightweight vector atom orb at far right", () => {
  assert.match(component, /Strong Engine activity orb/); assert.match(component, /<svg viewBox="0 0 160 160"/); assert.match(component, /<ellipse className="atom-orbit atom-orbit-one" cx="80" cy="80" rx="58" ry="22"/); assert.match(component, /<circle cx="80" cy="80" r="12"/); assert.match(component, /<WorkflowNodes nodes=\{routedNodes\} \/><StrongEngine state=\{state\}/); assert.match(styles, /\.jarvis-control-center \.pipeline-live-stage \{[^}]*grid-template-columns: 220px 170px 180px 190px/);
  assert.match(styles, /Original Strong Engine atom orb restored/); assert.match(styles, /\.strong-engine-orb svg \{[^}]*display: block/); assert.doesNotMatch(component, /engine-shell|engine-core|engine-meridian/);
  assert.doesNotMatch(component, /WebGL|setInterval|requestAnimationFrame/);
});

test("reference motion layers rotate independently and respect reduced motion", () => {
  for (const orbit of ["atom-orbit-one", "atom-orbit-two", "atom-orbit-three"]) assert.match(component, new RegExp(`className="atom-orbit ${orbit}"`));
  assert.match(styles, /engine-ring-one[^}]*pipeline-spin 16s/); assert.match(styles, /engine-ring-two[^}]*pipeline-spin-reverse 12s/); assert.match(styles, /engine-ring-three[^}]*pipeline-spin 9s/);
  assert.match(styles, /atom-orbit-one 18s/); assert.match(styles, /reference-core-breathe 2\.6s/); assert.match(styles, /reference-error-breathe 2\.5s/); assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workflow-wire-layer \.wire-tracer[\s\S]*animation: none !important/);
  assert.doesNotMatch(component, /canvas|WebGL|requestAnimationFrame/);
});
