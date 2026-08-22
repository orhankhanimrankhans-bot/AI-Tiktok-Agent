import { safeCustomColors } from "./appearanceColor.js";

export const CANVAS_NODE_WIDTH = 148;
export const CANVAS_NODE_HEIGHT = 148;
export const CANVAS_MIN_ZOOM = 0.35;
export const CANVAS_MAX_ZOOM = 1.75;
export const CANVAS_APPEARANCE_KEY = "jarvis_canvas_appearance_v1";
export const CANVAS_COLORS = ["#0d1117", "#15191d", "#23282d", "#000000", "#25123d", "#102a43", "#12372a", "#43151d", "#4a1533", "#e8edf2"];
export const HEADER_COLORS = ["#171d22", "#102a43", "#12372a", "#25123d", "#43151d", "#20262b", "#e3e9ee"];
export const THEME_PRESETS = [
  { id: "jarvis-dark", label: "Jarvis Dark", canvasColor: "#0d1117", canvasColorB: "#102a43", headerColor: "#171d22", accentColor: "#37d9ee" },
  { id: "midnight-blue", label: "Midnight Blue", canvasColor: "#071521", canvasColorB: "#123a59", headerColor: "#102a43", accentColor: "#58c8ff" },
  { id: "black", label: "Black", canvasColor: "#000000", canvasColorB: "#171d22", headerColor: "#0b0d0f", accentColor: "#79e7f6" },
  { id: "graphite", label: "Graphite", canvasColor: "#171b1f", canvasColorB: "#353d42", headerColor: "#20262b", accentColor: "#8bdce8" },
  { id: "white", label: "White", canvasColor: "#f4f7f9", canvasColorB: "#222a30", headerColor: "#e3e9ee", accentColor: "#087f9a" },
  { id: "silver", label: "Silver", canvasColor: "#c9d1d6", canvasColorB: "#4b5961", headerColor: "#aeb9bf", accentColor: "#046c83" },
  { id: "purple", label: "Purple", canvasColor: "#160f23", canvasColorB: "#55258a", headerColor: "#25123d", accentColor: "#b78cff" },
  { id: "blue", label: "Blue", canvasColor: "#071a33", canvasColorB: "#155ec8", headerColor: "#102a43", accentColor: "#55a7ff" },
  { id: "cyan", label: "Cyan", canvasColor: "#07191d", canvasColorB: "#087e8b", headerColor: "#10353b", accentColor: "#4ce5f4" },
  { id: "green", label: "Green", canvasColor: "#091b14", canvasColorB: "#17643c", headerColor: "#12372a", accentColor: "#56e69b" },
  { id: "red", label: "Red", canvasColor: "#1d0b0f", canvasColorB: "#7a2030", headerColor: "#43151d", accentColor: "#ff7181" },
  { id: "pink", label: "Pink", canvasColor: "#21101b", canvasColorB: "#8c315f", headerColor: "#4a1533", accentColor: "#ff82bd" },
];

export const APPEARANCE_COLOR_SECTIONS = [
  { id: "canvas", label: "Canvas", fields: [["canvasColor", "Canvas Color A"], ["canvasColorB", "Canvas Color B"]] },
  { id: "header", label: "Workflow Header", fields: [["headerColor", "Background"], ["headerTextColor", "Text"], ["statusTextColor", "Status Text"], ["headerBorderColor", "Border / Accent"]] },
  { id: "sidebar", label: "Sidebar", fields: [["sidebarBackground", "Background"], ["sidebarText", "Text"], ["sidebarActiveText", "Active Text"], ["sidebarIcon", "Icon"], ["sidebarActiveBackground", "Active Background"], ["sidebarBorder", "Border"]] },
  { id: "nodes", label: "Workflow Nodes", fields: [["nodeBackground", "Background"], ["nodeBorder", "Idle Border"], ["nodeBorderSuccess", "Success Border"], ["nodeBorderError", "Error Border"], ["nodeBorderDisconnected", "Disconnected Border"], ["nodeBorderRunning", "Running Border"], ["nodeTitle", "Node Title Color"], ["nodeSubtitle", "Node Subtitle Color"], ["iconBackground", "Node Icon Container Background"], ["iconTint", "Generic Icon Tint"], ["connectedLight", "Connected Light Color"], ["disconnectedLight", "Disconnected Light Color"], ["errorLight", "Error Light Color"], ["connectorColor", "Connector"]] },
  { id: "wires", label: "Wires", fields: [["wireIdle", "Idle"], ["wireRunning", "Running"], ["wireSuccess", "Success"], ["wireError", "Error"]] },
  { id: "controls", label: "Top Controls", fields: [["controlBackground", "Background"], ["controlText", "Text"], ["controlAccent", "Active Accent"], ["controlBorder", "Border"], ["controlHover", "Hover"]] },
  { id: "general", label: "General", fields: [["accentColor", "Primary Accent"], ["secondaryAccent", "Secondary Accent"], ["mainText", "Main Text"], ["mutedText", "Muted Text"], ["panelBackground", "Panel Background"], ["panelBorder", "Panel Border"]] },
];

export const DEFAULT_APPEARANCE = { preset: "jarvis-dark", canvasStyle: "solid", gradientAngle: 135, canvasColor: "#0d1117", canvasColorB: "#102a43",
  headerColor: "#171d22", headerTextColor: "#f4f7f9", statusTextColor: "#9aacb3", headerBorderColor: "#2d424b",
  sidebarBackground: "#101518", sidebarText: "#aebbc1", sidebarActiveText: "#e9fcff", sidebarIcon: "#79dce9", sidebarActiveBackground: "#123442", sidebarBorder: "#24343b",
  nodeBackground: "#1a2024", nodeBorder: "#52636b", nodeBorderSuccess: "#3dff91", nodeBorderError: "#ff4d5f", nodeBorderDisconnected: "#ffffff", nodeBorderRunning: "#37d9ee",
  nodeTitle: "#f8fdff", nodeSubtitle: "#bdcbd1", iconBackground: "#182b33", iconTint: "#9af2ff",
  connectedLight: "#3dff91", disconnectedLight: "#ffffff", errorLight: "#ff4d5f", connectorColor: "#78878e",
  wireIdle: "#647078", wireRunning: "#31d9b0", wireSuccess: "#3aa76d", wireError: "#e45d68",
  controlBackground: "#20282d", controlText: "#e9f9fb", controlAccent: "#37d9ee", controlBorder: "#46545b", controlHover: "#34434a",
  accentColor: "#37d9ee", secondaryAccent: "#59b7c8", mainText: "#eefcff", mutedText: "#83969e", panelBackground: "#10171b", panelBorder: "#33474f",
  providerLogoMode: "original", customColors: [] };

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

export function clampCanvasZoom(value) {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, Number(value) || 1));
}

export function moveNodeFromPointer(node, dragStart, pointer, zoom = 1) {
  return {
    ...node,
    x: Math.round(dragStart.nodeX + (pointer.x - dragStart.pointerX) / zoom),
    y: Math.round(dragStart.nodeY + (pointer.y - dragStart.pointerY) / zoom),
  };
}

export function workflowNodeSubtitle(node = {}) {
  if (node.name === "Schedule Trigger") {
    const rule = node.config?.rules?.[0];
    if (!rule) return "Manual schedule";
    const value = rule.interval === "Seconds" ? rule.seconds : rule.interval === "Minutes" ? rule.minutes : rule.interval === "Hours" ? rule.hours : rule.days;
    if (!value) return "Scheduled trigger";
    const unit = String(rule.interval || "").toLowerCase();
    return `Every ${value} ${Number(value) === 1 ? unit.replace(/s$/, "") : unit}`;
  }
  if (node.name === "Limit") return `${node.config?.keep || "First Items"} · ${node.config?.maxItems || 1}`;
  if (node.name === "Facebook Graph API") {
    const endpoint = String(node.config?.endpoint || "").replace(/^\/+/, "");
    if (endpoint === "me/accounts") return "Get Pages";
    if (endpoint === "me") return "Get Account";
    if (node.config?.operation) return node.config.operation;
    return node.config?.method ? `${node.config.method} Graph request` : "Graph request";
  }
  return node.config?.operation || node.operation || node.type || "Workflow step";
}

export function visualNodeStatus(node, workflowActive) {
  return workflowActive ? (node?.status || "idle") : "idle";
}

function credentialHealth(credentialId, credentials) {
  if (!credentialId) return "disconnected";
  const credential = credentials.find((item) => item.id === credentialId);
  if (!credential) return "disconnected";
  const status = String(credential.connectionStatus || credential.status || "connected").toLowerCase();
  if (["error", "failed", "invalid"].includes(status)) return "error";
  if (credential.connected === false || ["disconnected", "not_connected", "not_configured"].includes(status)) return "disconnected";
  return "connected";
}

export function nodeConnectionHealth(node = {}, { googleCredentials = [], facebookCredentials = [], openAIConfigured = false } = {}) {
  if (node.config?.configurationError || node.config?.credentialError) return "error";
  if (node.provider === "Google Drive" || /^Google Drive/.test(node.name || "") || ["Search Files and Folders", "Download File", "Delete File", "Move File"].includes(node.name)) {
    return credentialHealth(node.config?.credentialId, googleCredentials);
  }
  if (node.name === "Facebook Graph API") return credentialHealth(node.config?.credentialId, facebookCredentials);
  if (["Prepare Content", "Prepare Content / AI"].includes(node.name)) return openAIConfigured ? "connected" : "disconnected";
  if (node.name === "Limit") return Number(node.config?.maxItems || 1) > 0 ? "connected" : "disconnected";
  if (node.name === "Schedule Trigger") return "connected";
  return "connected";
}

export function nodeBorderVisualState(node = {}, workflowActive = false, health = "connected") {
  const status = String(node.status || "idle").toLowerCase();
  if (status === "error" || status === "failed" || health === "error") return "error";
  if (workflowActive && status === "running") return "running";
  if (health === "disconnected") return "disconnected";
  if (status === "success") return "success";
  return "idle";
}

export function connectionVisualState(source, target, workflowActive = true) {
  if (!workflowActive) return "idle";
  if (target?.status === "error") return "error";
  if (source?.status === "success" && target?.status === "running") return "running";
  if (source?.status === "success" && target?.status === "success") return "success";
  return "idle";
}

export function safeAppearance(value = {}) {
  const preset = value.preset === "custom" ? "custom" : THEME_PRESETS.find((item) => item.id === value.preset)?.id || DEFAULT_APPEARANCE.preset;
  const legacyStyle = value.canvasStyle === "two-color" ? "linear-gradient" : value.canvasStyle;
  const canvasStyle = ["solid", "linear-gradient", "radial-gradient"].includes(legacyStyle) ? legacyStyle : "solid";
  const gradientAngle = Math.max(0, Math.min(360, Number.isFinite(Number(value.gradientAngle)) ? Number(value.gradientAngle) : DEFAULT_APPEARANCE.gradientAngle));
  const colors = Object.fromEntries(APPEARANCE_COLOR_SECTIONS.flatMap((section) => section.fields)
    .map(([key]) => [key, safeColor(value[key], DEFAULT_APPEARANCE[key])]));
  const providerLogoMode = value.providerLogoMode === "monochrome" ? "monochrome" : "original";
  const customColors = safeCustomColors(value.customColors);
  const viewport = value.viewport && [value.viewport.x, value.viewport.y, value.viewport.zoom].every(Number.isFinite)
    ? { x: value.viewport.x, y: value.viewport.y, zoom: clampCanvasZoom(value.viewport.zoom) } : { x: 0, y: 0, zoom: 1 };
  return { preset, canvasStyle, gradientAngle, ...colors, providerLogoMode, customColors, viewport };
}

export function canvasBackground(appearance) {
  const safe = safeAppearance(appearance);
  if (safe.canvasStyle === "linear-gradient") return `linear-gradient(${safe.gradientAngle}deg, ${safe.canvasColor} 0%, ${safe.canvasColorB} 100%)`;
  if (safe.canvasStyle === "radial-gradient") return `radial-gradient(circle at center, ${safe.canvasColor} 0%, ${safe.canvasColorB} 100%)`;
  return safe.canvasColor;
}

export function appearanceCssVariables(value) {
  const safe = safeAppearance(value); const entries = APPEARANCE_COLOR_SECTIONS.flatMap((section) => section.fields);
  return { ...Object.fromEntries(entries.map(([key]) => [`--jarvis-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, safe[key]])),
    "--jarvis-accent": safe.accentColor };
}

export function readableForeground(background) {
  const hex = String(background || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#eef7fa";
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#11181c" : "#eef7fa";
}

export function connectionMidpoint(source, target) {
  return { x: ((source.x ?? 140) + CANVAS_NODE_WIDTH + (target.x ?? 140)) / 2,
    y: ((source.y ?? 200) + (target.y ?? 200)) / 2 + CANVAS_NODE_HEIGHT / 2 };
}

export function insertNodeBetween({ nodes, connections, connectionId, node }) {
  const connection = connections.find((item) => item.id === connectionId);
  if (!connection) throw new Error("The selected connection no longer exists.");
  const source = nodes.find((item) => item.id === connection.source); const target = nodes.find((item) => item.id === connection.target);
  if (!source || !target) throw new Error("The selected connection is invalid.");
  const midpoint = connectionMidpoint(source, target); const inserted = { ...node, x: midpoint.x - CANVAS_NODE_WIDTH / 2, y: midpoint.y - CANVAS_NODE_HEIGHT / 2 };
  const remaining = connections.filter((item) => item.id !== connectionId);
  return { nodes: [...nodes, inserted], connections: [...remaining,
    { id: `${connection.id}-in`, source: connection.source, target: inserted.id },
    { id: `${connection.id}-out`, source: inserted.id, target: connection.target }] };
}

export function connectionPath(source, target) {
  const sourceX = (source.x ?? 140) + CANVAS_NODE_WIDTH;
  const sourceY = (source.y ?? 200) + CANVAS_NODE_HEIGHT / 2;
  const targetX = target.x ?? 140;
  const targetY = (target.y ?? 200) + CANVAS_NODE_HEIGHT / 2;
  const curve = Math.max(64, Math.abs(targetX - sourceX) * 0.42);
  return `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`;
}

export function fitCanvasViewport(nodes, width, height, padding = 80) {
  if (!nodes.length || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...nodes.map((node) => node.x ?? 140));
  const minY = Math.min(...nodes.map((node) => node.y ?? 200));
  const maxX = Math.max(...nodes.map((node) => (node.x ?? 140) + CANVAS_NODE_WIDTH));
  const maxY = Math.max(...nodes.map((node) => (node.y ?? 200) + CANVAS_NODE_HEIGHT));
  const zoom = clampCanvasZoom(Math.min((width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY)));
  return { x: (width - (minX + maxX) * zoom) / 2, y: (height - (minY + maxY) * zoom) / 2, zoom };
}
