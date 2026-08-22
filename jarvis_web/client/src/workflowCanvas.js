export const CANVAS_NODE_WIDTH = 176;
export const CANVAS_NODE_HEIGHT = 78;
export const CANVAS_MIN_ZOOM = 0.35;
export const CANVAS_MAX_ZOOM = 1.75;
export const CANVAS_APPEARANCE_KEY = "jarvis_canvas_appearance_v1";
export const CANVAS_COLORS = ["#0d1117", "#15191d", "#23282d", "#000000", "#25123d", "#102a43", "#12372a", "#43151d", "#4a1533", "#e8edf2"];
export const HEADER_COLORS = ["#171d22", "#102a43", "#12372a", "#25123d", "#43151d", "#20262b", "#e3e9ee"];

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

export function connectionVisualState(source, target) {
  if (target?.status === "error") return "error";
  if (source?.status === "success" && target?.status === "running") return "running";
  if (source?.status === "success" && target?.status === "success") return "success";
  return "idle";
}

export function safeAppearance(value = {}) {
  const canvasColor = CANVAS_COLORS.includes(value.canvasColor) ? value.canvasColor : CANVAS_COLORS[0];
  const headerColor = HEADER_COLORS.includes(value.headerColor) ? value.headerColor : HEADER_COLORS[0];
  const viewport = value.viewport && [value.viewport.x, value.viewport.y, value.viewport.zoom].every(Number.isFinite)
    ? { x: value.viewport.x, y: value.viewport.y, zoom: clampCanvasZoom(value.viewport.zoom) } : { x: 0, y: 0, zoom: 1 };
  return { canvasColor, headerColor, viewport };
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
