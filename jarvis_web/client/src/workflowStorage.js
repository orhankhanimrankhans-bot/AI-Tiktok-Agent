import { sanitizeFacebookConfig } from "./facebookConfig.js";

export function normalizeSavedWorkflow(value) {
  if (!value || typeof value !== "object") throw new Error("Saved workflow is invalid.");
  return {
    version: Number(value.version) || 1,
    name: typeof value.name === "string" ? value.name : "My Workflow",
    nodes: Array.isArray(value.nodes) ? value.nodes.map((node) => node?.provider === "Facebook" ? { ...node, config: sanitizeFacebookConfig(node.config) } : node) : [],
    connections: Array.isArray(value.connections) ? value.connections : [],
    savedAt: value.savedAt || null,
  };
}

export function workflowForStorage(value) {
  const normalized = normalizeSavedWorkflow(value);
  return { ...value, nodes: normalized.nodes, connections: normalized.connections };
}
