import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CANVAS_APPEARANCE_KEY, CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH, THEME_PRESETS, canvasBackground, connectionVisualState,
  fitCanvasViewport, insertNodeBetween, moveNodeFromPointer, nodeBorderVisualState, nodeConnectionHealth, readableForeground, safeAppearance, visualNodeStatus, workflowNodeSubtitle } from "./workflowCanvas.js";

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

test("idle workflow neutralizes persisted node and edge states without changing runtime data", () => {
  const persistedSuccess = { status: "success", output: { binary: { referenceId: "bin_preserved" } } };
  assert.equal(visualNodeStatus(persistedSuccess, false), "idle");
  assert.equal(connectionVisualState({ status: "success" }, { status: "success" }, false), "idle");
  assert.equal(persistedSuccess.status, "success");
  assert.equal(persistedSuccess.output.binary.referenceId, "bin_preserved");
});

test("active workflow preserves running, success, and error presentation states", () => {
  assert.equal(visualNodeStatus({ status: "running" }, true), "running");
  assert.equal(visualNodeStatus({ status: "success" }, true), "success");
  assert.equal(visualNodeStatus({ status: "error" }, true), "error");
  assert.equal(connectionVisualState({ status: "success" }, { status: "running" }, true), "running");
  assert.equal(connectionVisualState({ status: "success" }, { status: "error" }, true), "error");
});

test("connection health is configuration-derived and independent from execution state", () => {
  const googleCredentials = [{ id: "g-ready", connected: true }, { id: "g-error", connectionStatus: "error" }];
  const facebookCredentials = [{ id: "f-ready", status: "connected" }];
  assert.equal(nodeConnectionHealth({ name: "Google Drive Search", status: "idle", config: { credentialId: "g-ready" } }, { googleCredentials }), "connected");
  assert.equal(nodeConnectionHealth({ name: "Facebook Graph API", status: "success", config: {} }, { facebookCredentials }), "disconnected");
  assert.equal(nodeConnectionHealth({ name: "Google Drive Download", status: "idle", config: { credentialId: "g-error" } }, { googleCredentials }), "error");
  assert.equal(nodeConnectionHealth({ name: "Prepare Content / AI", config: {} }, { openAIConfigured: true }), "connected");
  assert.equal(visualNodeStatus({ status: "success", config: { credentialId: "g-ready" } }, false), "idle");
});

test("node borders combine execution status and connection health without changing the health light", () => {
  assert.equal(nodeBorderVisualState({ status: "success" }, false, "connected"), "success");
  assert.equal(nodeBorderVisualState({ status: "error" }, true, "connected"), "error");
  assert.equal(nodeBorderVisualState({ status: "failed" }, false, "connected"), "error");
  assert.equal(nodeBorderVisualState({ status: "idle" }, false, "error"), "error");
  assert.equal(nodeBorderVisualState({ status: "idle" }, false, "disconnected"), "disconnected");
  assert.equal(nodeBorderVisualState({ status: "idle" }, false, "connected"), "idle");
  assert.equal(nodeBorderVisualState({ status: "running" }, true, "connected"), "running");
  assert.equal(nodeBorderVisualState({ status: "running" }, false, "connected"), "idle");
});

test("node contrast, LED health colors, and appearance controls remain presentation-only", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  const safe = safeAppearance({ nodeTitle: "#ffffff", nodeSubtitle: "#ccddee", iconBackground: "#112233", iconTint: "#aabbcc",
    nodeBorderSuccess: "#00ee77", nodeBorderError: "#ee2233", nodeBorderDisconnected: "#ffffff", nodeBorderRunning: "#22ccff",
    connectedLight: "#00ff88", disconnectedLight: "#ffffff", errorLight: "#ff3344" });
  assert.equal(safe.nodeBorderSuccess, "#00ee77"); assert.equal(safe.nodeBorderError, "#ee2233");
  assert.equal(safe.nodeBorderDisconnected, "#ffffff"); assert.equal(safe.nodeBorderRunning, "#22ccff");
  assert.equal(safe.connectedLight, "#00ff88"); assert.equal(safe.disconnectedLight, "#ffffff"); assert.equal(safe.errorLight, "#ff3344");
  assert.match(source, /nodeConnectionHealth\(node/); assert.match(source, /health-\$\{health\}/);
  assert.match(styles, /workflow-node-copy strong[^}]*font-weight: 900/);
  assert.match(styles, /workflow-node-copy small[^}]*font-weight: 600/);
  assert.match(styles, /health-connected[^}]*--jarvis-connected-light/);
  assert.match(styles, /health-disconnected[^}]*--jarvis-disconnected-light/);
  assert.match(styles, /health-error[^}]*--jarvis-error-light/);
  assert.match(source, /border-\$\{borderState\}/);
  assert.match(styles, /border-success[^}]*--jarvis-node-border-success/);
  assert.match(styles, /border-error[^}]*--jarvis-node-border-error/);
  assert.match(styles, /border-disconnected[^}]*--jarvis-node-border-disconnected/);
  assert.match(styles, /border-running[^}]*--jarvis-node-border-running/);
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

test("all workflow nodes use one square geometry with readable titles and aligned icons", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.equal(CANVAS_NODE_WIDTH, 148); assert.equal(CANVAS_NODE_HEIGHT, 148);
  assert.match(styles, /\.canvas-viewport \.workflow-node \{[\s\S]*width: 148px;[\s\S]*height: 148px;/);
  assert.match(styles, /-webkit-line-clamp: 2/); assert.match(styles, /justify-items: center/);
  assert.match(source, /trigger-clock-face/); assert.match(source, /className="ai-mark"/); assert.match(source, /className="limit-mark"/);
});

test("fit viewport zooms out and centers the workflow without changing node coordinates", () => {
  const nodes = [{ x: 100, y: 100 }, { x: 1400, y: 700 }];
  const snapshot = structuredClone(nodes);
  const viewport = fitCanvasViewport(nodes, 1000, 600);
  assert.ok(viewport.zoom < 1);
  assert.deepEqual(nodes, snapshot);
});

test("appearance preferences are allowlisted and select readable contrast", () => {
  const safe = safeAppearance({ canvasColor: "red", headerColor: "#fff", accessToken: "forbidden", viewport: { x: "bad", y: 0, zoom: 99 } });
  assert.equal(safe.canvasColor, "#0d1117"); assert.equal(safe.headerColor, "#171d22"); assert.deepEqual(safe.viewport, { x: 0, y: 0, zoom: 1 });
  assert.equal(Object.hasOwn(safe, "accessToken"), false);
  assert.equal(readableForeground("#e8edf2"), "#11181c"); assert.equal(readableForeground("#0d1117"), "#eef7fa");
});

test("theme system supports presets, custom solid and white-black two-color canvas", () => {
  assert.deepEqual(THEME_PRESETS.map((preset) => preset.label), ["Jarvis Dark", "Midnight Blue", "Black", "Graphite", "White", "Silver", "Purple", "Blue", "Cyan", "Green", "Red", "Pink"]);
  const twoColor = safeAppearance({ preset: "custom", canvasStyle: "two-color", canvasColor: "#ffffff", canvasColorB: "#000000",
    headerColor: "#123456", accentColor: "#00ddee" });
  assert.equal(canvasBackground(twoColor), "linear-gradient(135deg, #ffffff 0%, #000000 100%)");
  assert.equal(canvasBackground({ ...twoColor, canvasStyle: "solid" }), "#ffffff");
  assert.equal(twoColor.headerColor, "#123456"); assert.equal(twoColor.accentColor, "#00ddee");
});

test("appearance persistence stays separate and contains UI-only theme fields", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.equal(CANVAS_APPEARANCE_KEY, "jarvis_canvas_appearance_v1");
  assert.match(source, /localStorage\.setItem\(CANVAS_APPEARANCE_KEY/);
  assert.match(source, /canvasStyle/); assert.match(source, /APPEARANCE_COLOR_SECTIONS/); assert.match(source, /appearanceCssVariables/);
  assert.doesNotMatch(JSON.stringify(safeAppearance({ accessToken: "not-allowed", binary: { referenceId: "not-allowed" } })), /accessToken|referenceId/);
});

test("workflow header is thin and canvas has no dotted background", () => {
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(styles, /\.workflow-header \{[\s\S]*min-height: 62px/);
  assert.match(styles, /\.workflow-canvas \{ background-image: none !important/);
});

test("dashboard pipeline consumes real workflow state and animates only while running", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const pipeline = fs.readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(source, /jarvis-command-center/); assert.match(source, /CommandPipeline graph=\{dashboardGraph\} workflowActive=\{isWorkflowRunning\}/); assert.match(pipeline, /pipeline-graph-lines/);
  assert.match(source, /isWorkflowRunning \? "workflow-running" : "workflow-idle"/);
  assert.match(pipeline, /workflowActive \? "running" : workflowError \? "error" : "idle"/);
  assert.match(styles, /\.pipeline-running \.pipeline-route-map path[^}]*animation:/);
  assert.match(styles, /\.pipeline-running \.core-ring-outer[^}]*animation:/);
  assert.doesNotMatch(pipeline, /setInterval|setTimeout|requestAnimationFrame/);
});

test("insert between removes the direct edge and creates two valid edges", () => {
  const result = insertNodeBetween({ nodes: [{ id: "a", x: 100, y: 100 }, { id: "b", x: 500, y: 100 }],
    connections: [{ id: "ab", source: "a", target: "b" }], connectionId: "ab", node: { id: "middle", name: "Limit" } });
  assert.equal(result.connections.some((edge) => edge.source === "a" && edge.target === "b"), false);
  assert.deepEqual(result.connections.map(({ source, target }) => [source, target]), [["a", "middle"], ["middle", "b"]]);
  assert.equal(result.nodes.at(-1).x, 300); assert.equal(result.nodes.at(-1).y, 100);
});
