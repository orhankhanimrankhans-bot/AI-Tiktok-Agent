import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CANVAS_APPEARANCE_KEY, CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH, THEME_PRESETS, canvasBackground, canvasPointFromClient, canvasViewportStyle, clampCanvasZoom, connectionPathToPoint, connectionVisualState,
  fitCanvasViewport, insertNodeBetween, isPersistedWorkflowActive, moveNodeFromPointer, nodeBorderVisualState, nodeConnectionHealth, readableForeground, safeAppearance, validateConnectionCandidate, visualNodeStatus, workflowNodeSubtitle } from "./workflowCanvas.js";

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

test("Appearance Studio allowlists the complete control center palette", () => {
  const safe = safeAppearance({ dashboardBackground: "#010203", dashboardPanel: "#040506", dashboardBorder: "#070809", engineReady: "#ffcc00",
    engineRunning: "#00dd88", engineError: "#ff3344", engineDisconnected: "#cccccc", conversationPanel: "#111111", conversationUser: "#222222",
    conversationJarvis: "#123321", conversationInput: "#333333", dashboardIcon: "#55eeff" });
  assert.equal(safe.dashboardBackground, "#010203"); assert.equal(safe.engineReady, "#ffcc00"); assert.equal(safe.engineRunning, "#00dd88");
  assert.equal(safe.engineError, "#ff3344"); assert.equal(safe.engineDisconnected, "#cccccc"); assert.equal(safe.conversationUser, "#222222");
  assert.equal(safe.conversationJarvis, "#123321"); assert.equal(safe.conversationInput, "#333333"); assert.equal(safe.dashboardIcon, "#55eeff");
});

test("theme system supports presets, custom solid and white-black two-color canvas", () => {
  assert.deepEqual(THEME_PRESETS.map((preset) => preset.label), ["Corex Dark", "Midnight Blue", "Black", "Graphite", "White", "Silver", "Purple", "Blue", "Cyan", "Green", "Red", "Pink"]);
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
  const dashboard = fs.readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
  const pipeline = fs.readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(source, /JarvisDashboard apiBaseUrl=\{API_BASE_URL\} graph=\{dashboardGraph\} workflowActive=\{isWorkflowRunning\}/); assert.match(dashboard, /CommandPipeline graph=\{graph\}/); assert.match(pipeline, /workflow-wire-layer/);
  assert.match(pipeline, /workflowError \? "error" : workflowActive \? "running" : healthStates\.includes\("error"\)/); assert.match(pipeline, /healthStates\.includes\("disconnected"\)/);
  assert.match(styles, /\.wire-running \.wire-energy[^}]*animation-duration: 1s/);
  assert.match(styles, /\.pipeline-running \.core-ring-outer[^}]*animation:/);
  assert.match(styles, /\.pipeline-ready \.engine-ring[^}]*animation: none !important/);
  assert.doesNotMatch(pipeline, /setInterval|setTimeout|requestAnimationFrame/);
});

test("insert between removes the direct edge and creates two valid edges", () => {
  const result = insertNodeBetween({ nodes: [{ id: "a", x: 100, y: 100 }, { id: "b", x: 500, y: 100 }],
    connections: [{ id: "ab", source: "a", target: "b" }], connectionId: "ab", node: { id: "middle", name: "Limit" } });
  assert.equal(result.connections.some((edge) => edge.source === "a" && edge.target === "b"), false);
  assert.deepEqual(result.connections.map(({ source, target }) => [source, target]), [["a", "middle"], ["middle", "b"]]);
  assert.equal(result.nodes.at(-1).x, 300); assert.equal(result.nodes.at(-1).y, 100);
});

test("direct connection validator permits linear edges and Schedule Trigger fan-out", () => {
  const nodes = [{ id: "trigger", name: "Schedule Trigger" }, { id: "a", name: "Search" }, { id: "b", name: "Limit" }, { id: "c", name: "Prepare" }];
  assert.equal(validateConnectionCandidate(nodes, [], "trigger", "a").ok, true);
  assert.equal(validateConnectionCandidate(nodes, [{ id: "ta", source: "trigger", target: "a" }], "trigger", "b").ok, true);
  assert.equal(validateConnectionCandidate(nodes, [{ id: "ta", source: "trigger", target: "a" }], "a", "c").ok, true);
});

test("direct connection validator rejects self, duplicate, merge, cycle, and nested branch", () => {
  const nodes = [{ id: "trigger", name: "Schedule Trigger" }, { id: "a", name: "Search" }, { id: "b", name: "Limit" }, { id: "c", name: "Prepare" }];
  const linear = [{ id: "ta", source: "trigger", target: "a" }, { id: "ab", source: "a", target: "b" }];
  assert.equal(validateConnectionCandidate(nodes, linear, "a", "a").ok, false);
  assert.equal(validateConnectionCandidate(nodes, linear, "trigger", "a").ok, false);
  assert.match(validateConnectionCandidate(nodes, linear, "c", "b").error, /merges/i);
  assert.match(validateConnectionCandidate(nodes, linear, "b", "trigger").error, /start node/i);
  assert.match(validateConnectionCandidate(nodes, [...linear, { id: "bc", source: "b", target: "c" }], "c", "a").error, /cycle/i);
  assert.match(validateConnectionCandidate(nodes, linear, "a", "c").error, /branch/i);
});

test("temporary wire coordinates honor canvas pan and zoom", () => {
  assert.deepEqual(canvasPointFromClient({ clientX: 170, clientY: 140 }, { left: 20, top: 40 }, { x: 50, y: 20, zoom: 0.5 }), { x: 200, y: 160 });
  assert.match(connectionPathToPoint({ x: 100, y: 80 }, { x: 500, y: 220 }), /^M 248 154 C/);
});

test("canvas permits only the Prepare Content Facebook and YouTube fork joined by Move File", () => {
  const nodes = [{ id: "p", name: "Prepare Content" }, { id: "f", name: "Facebook Graph API" }, { id: "y", name: "YouTube" }, { id: "m", name: "Move File" }, { id: "x", name: "Limit" }];
  const firstBranch = [{ id: "pf", source: "p", target: "f" }];
  assert.equal(validateConnectionCandidate(nodes, firstBranch, "p", "y").ok, true);
  const publishers = [...firstBranch, { id: "py", source: "p", target: "y" }, { id: "fm", source: "f", target: "m" }];
  assert.equal(validateConnectionCandidate(nodes, publishers, "y", "m").ok, true);
  assert.equal(validateConnectionCandidate(nodes, firstBranch, "p", "x").ok, false);
  assert.equal(validateConnectionCandidate(nodes, [{ id: "xm", source: "x", target: "m" }], "y", "m").ok, false);
  assert.equal(nodeConnectionHealth({ name: "YouTube", config: { credentialId: "yt-ready" } }, { youtubeCredentials: [{ id: "yt-ready", connected: true }] }), "connected");
});

test("persisted ACTIVE server workflow decorates nodes, connections, and ports while idle", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.equal(isPersistedWorkflowActive("server", { status: "ACTIVE" }), true);
  assert.equal(isPersistedWorkflowActive("server", { status: "DRAFT" }), false);
  assert.equal(isPersistedWorkflowActive("server", { status: "PAUSED" }), false);
  assert.equal(isPersistedWorkflowActive("local", { status: "ACTIVE" }), false);
  assert.match(source, /activeServerWorkflowPresentation = isPersistedWorkflowActive\(editorWorkflowSource, activeServerWorkflow\)/);
  assert.match(source, /workflow-canvas[^`]*active-server-workflow/);
  assert.match(source, /workflow-connections[^`]*active/);
  assert.match(styles, /\.workflow-connections\.active \.workflow-connection-path\s*\{[^}]*stroke:\s*#48f08f[^}]*animation:\s*active-workflow-connection-flow 2s/s);
  assert.match(styles, /\.workflow-canvas\.active-server-workflow \.workflow-node\s*\{[^}]*border-color:\s*#48f08f/s);
  assert.match(styles, /\.workflow-canvas\.active-server-workflow \.node-port\s*\{[^}]*border-color:\s*#48f08f/s);
});

test("reduced motion keeps ACTIVE green styling and disables only animation", () => {
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(styles, /\.workflow-connections\.active marker path\s*\{[^}]*fill:\s*#48f08f/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.workflow-connections\.active \.workflow-connection-path[^}]*animation:\s*none !important/s);
});

test("viewport paints at browser resolution without rasterizing the full scene", () => {
  assert.deepEqual(canvasViewportStyle({ x: 10.31, y: -4.26, zoom: 1.25 }, 2), { transform: "translate(10.5px, -4.5px)", zoom: 1.25 });
  assert.deepEqual(canvasViewportStyle({ x: 10.31, y: -4.26, zoom: 1 }, 1.25), { transform: "translate(10.4px, -4px)", zoom: 1 });
  for (const ratio of [1, 1.25, 1.5, 2]) for (const zoom of [.5, .67, .75, .8, .9, 1, 1.1, 1.25, 1.5, 1.75, 2]) {
    const style = canvasViewportStyle({ x: 13.37, y: -7.19, zoom }, ratio);
    assert.equal(style.zoom, clampCanvasZoom(zoom)); assert.match(style.transform, /^translate\(-?\d+(?:\.\d+)?px, -?\d+(?:\.\d+)?px\)$/);
  }
  const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("./App.css", import.meta.url), "utf8");
  assert.match(app, /canvasViewportStyle\(canvasViewport, window\.devicePixelRatio\)/);
  assert.doesNotMatch(app, /translate3d\([^\n]+scale\(/);
  assert.doesNotMatch(styles.match(/\.canvas-viewport \{[\s\S]*?\}/)?.[0] || "", /will-change/);
});

test("App wires Pointer Events from existing ports without changing workflow runtime", () => {
  const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(app, /onPointerDown=\{\(event\) => startConnectionDrag\(event, node.id\)\}/);
  assert.match(app, /workflow-connection-preview/); assert.match(app, /validateConnectionCandidate/);
  assert.match(app, /data-node-input-id=\{node.id\}/); assert.match(app, /setWorkflowDirty\(true\)/);
  for (const runtime of ["workflowRunner.js", "workflowFanOutRunner.js", "workflowStorage.js"]) assert.equal(fs.existsSync(new URL(`./${runtime}`, import.meta.url)), true);
});
