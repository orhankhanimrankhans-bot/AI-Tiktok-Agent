import { editorDefinition } from "./workflowEditorBinding.js";

export const DEFAULT_WORKFLOW_TIMEZONE = "Asia/Riyadh";

function safePublishError(response) {
  if (response.status === 401 || response.status === 403) return new Error("You do not have permission to publish workflows.");
  if (response.status === 400) return new Error("Check the workflow configuration and try again.");
  return new Error("Could not publish the workflow. Try again.");
}

export function buildLocalPublishPayload({ name = "My Workflow", nodes, connections, timezone = DEFAULT_WORKFLOW_TIMEZONE }) {
  const definition = editorDefinition(nodes, connections);
  if (!definition.nodes.length) throw new Error("Add workflow nodes before publishing.");
  const nodeIds = new Set();
  for (const node of definition.nodes) {
    if (typeof node.id !== "string" || !node.id || nodeIds.has(node.id)) throw new Error("Workflow nodes must have unique IDs.");
    nodeIds.add(node.id);
  }
  if (definition.connections.some((connection) => !nodeIds.has(connection?.source) || !nodeIds.has(connection?.target))) throw new Error("Workflow connections must reference saved nodes.");
  const triggers = definition.nodes.filter((node) => node.name === "Schedule Trigger");
  if (triggers.length !== 1) throw new Error("Publishing requires exactly one Schedule Trigger.");
  const rules = triggers[0]?.config?.rules;
  if (!Array.isArray(rules)) throw new Error("Schedule Trigger rules are invalid.");
  return { name: String(name || "My Workflow").trim() || "My Workflow", status: "DRAFT", nodes: definition.nodes, connections: definition.connections, schedule: { rules: JSON.parse(JSON.stringify(rules)) }, timezone };
}

export async function publishLocalWorkflow(fetchImpl, apiBaseUrl, workflow) {
  const payload = buildLocalPublishPayload(workflow);
  const response = await fetchImpl(`${apiBaseUrl}/api/workflows`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw safePublishError(response);
  return response.json();
}

export async function runSingleFlightPublish(lock, publish) {
  if (lock.current) return null;
  lock.current = true;
  try { return await publish(); } finally { lock.current = false; }
}
