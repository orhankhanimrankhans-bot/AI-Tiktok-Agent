const WORKFLOW_ID = /^wf_[A-Za-z0-9_-]{8,255}$/;
const WORKFLOW_STATUSES = new Set(["DRAFT", "ACTIVE", "PAUSED"]);
const RUNTIME_NODE_FIELDS = new Set(["status", "input", "output", "error"]);

function jsonClone(value, label) {
  try { return JSON.parse(JSON.stringify(value)); } catch { throw new Error(`${label} is invalid.`); }
}

function definitionNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("Workflow nodes are invalid.");
  return Object.fromEntries(Object.entries(node).filter(([key]) => !RUNTIME_NODE_FIELDS.has(key)));
}

export function editorDefinition(nodes, connections) {
  if (!Array.isArray(nodes) || !Array.isArray(connections)) throw new Error("Workflow definition is invalid.");
  return { nodes: jsonClone(nodes.map(definitionNode), "Workflow nodes"), connections: jsonClone(connections, "Workflow connections") };
}

export function definitionFingerprint(nodes, connections) {
  return JSON.stringify(editorDefinition(nodes, connections));
}

export function validateStoredWorkflow(value) {
  if (!value || typeof value !== "object" || !WORKFLOW_ID.test(value.id) || typeof value.name !== "string" || !WORKFLOW_STATUSES.has(value.status)) throw new Error("Stored workflow could not be opened.");
  const definition = editorDefinition(value.nodes, value.connections);
  if (!Number.isInteger(value.version) || value.version < 1) throw new Error("Stored workflow could not be opened.");
  return { id: value.id, name: value.name, status: value.status, version: value.version, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null, ...definition };
}
