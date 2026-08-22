import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { connectionVisualState, fitCanvasViewport, insertNodeBetween, moveNodeFromPointer, readableForeground, safeAppearance, workflowNodeSubtitle } from "./workflowCanvas.js";

test("dragging updates logical node position without zoom jumps", () => {
  const moved = moveNodeFromPointer({ id: "drive", x: 100, y: 80 }, { nodeX: 100, nodeY: 80, pointerX: 200, pointerY: 100 }, { x: 260, y: 140 }, 0.5);
  assert.deepEqual({ x: moved.x, y: moved.y }, { x: 220, y: 160 });
});

test("node subtitles reflect configured operations without credential data", () => {
  assert.equal(workflowNodeSubtitle({ name: "Schedule Trigger", config: { rules: [{ interval: "Days", days: 1 }] } }), "Every 1 day");
  assert.equal(workflowNodeSubtitle({ name: "Schedule Trigger", config: { rules: [{ interval: "Hours", hours: 2 }] } }), "Every 2 hours");
  assert.equal(workflowNodeSubtitle({ name: "Limit", config: { keep: "First Items", maxItems: 1 } }), "First Items · 1");
  assert.equal(workflowNodeSubtitle({ name: "Facebook Graph API", config: { endpoint: "me/accounts", credentialId: "secret-reference" } }), "Get Pages");
  assert.doesNotMatch(workflowNodeSubtitle({ name: "Facebook Graph API", config: { endpoint: "me", credentialId: "secret-reference" } }), /secret-reference/);
});

test("edge state follows the exact source and target runtime lifecycle", () => {
  assert.equal(connectionVisualState({ status: "success" }, { status: "running" }), "running");
  assert.equal(connectionVisualState({ status: "success" }, { status: "success" }), "success");
  assert.equal(connectionVisualState({ status: "success" }, { status: "error" }), "error");
  assert.equal(connectionVisualState({ status: "success" }, { status: "idle" }), "idle");
  assert.equal(connectionVisualState({ status: "idle" }, { status: "idle" }), "idle");
  assert.equal(connectionVisualState({ status: "error" }, { status: "idle" }), "idle");
});

test("canvas markup includes compact node content, provider icon, and connection handles", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(source, /aria-label="ISK">ISK/);
  assert.match(source, /workflow-node-copy/);
  assert.match(source, /schedule-trigger-node/);
  assert.match(source, /trigger-clock-face/);
  assert.match(source, /node-input-port/);
  assert.match(source, /node-output-port/);
  assert.match(source, /<NodeProviderIcon node=\{node\}/);
  assert.match(source, /workflowNodeSubtitle\(node\)/);
  assert.match(source, /edge-insert-button/); assert.match(source, /CANVAS_APPEARANCE_KEY/);
  assert.match(styles, /background-image:\s*none !important/); assert.match(styles, /\.sidebar \{ width: 214px/);
});

test("fit viewport zooms out and centers the workflow without changing node coordinates", () => {
  const nodes = [{ x: 100, y: 100 }, { x: 1400, y: 700 }];
  const snapshot = structuredClone(nodes);
  const viewport = fitCanvasViewport(nodes, 1000, 600);
  assert.ok(viewport.zoom < 1);
  assert.deepEqual(nodes, snapshot);
});

test("appearance preferences are allowlisted and select readable contrast", () => {
  assert.deepEqual(safeAppearance({ canvasColor: "red", headerColor: "#fff", viewport: { x: "bad", y: 0, zoom: 99 } }),
    { canvasColor: "#0d1117", headerColor: "#171d22", viewport: { x: 0, y: 0, zoom: 1 } });
  assert.equal(readableForeground("#e8edf2"), "#11181c"); assert.equal(readableForeground("#0d1117"), "#eef7fa");
});

test("insert between removes the direct edge and creates two valid edges", () => {
  const result = insertNodeBetween({ nodes: [{ id: "a", x: 100, y: 100 }, { id: "b", x: 500, y: 100 }],
    connections: [{ id: "ab", source: "a", target: "b" }], connectionId: "ab", node: { id: "middle", name: "Limit" } });
  assert.equal(result.connections.some((edge) => edge.source === "a" && edge.target === "b"), false);
  assert.deepEqual(result.connections.map(({ source, target }) => [source, target]), [["a", "middle"], ["middle", "b"]]);
  assert.equal(result.nodes.at(-1).x, 300); assert.equal(result.nodes.at(-1).y, 100);
});
